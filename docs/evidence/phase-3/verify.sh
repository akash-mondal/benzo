#!/usr/bin/env bash
# Re-check recorded Phase 3 payments, independent openings, ledger and signing payloads against real dependencies.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
set -a; . ./.env; set +a
npm run --silent build:core || exit 1
npm run --silent build:settle || exit 1
cargo build --release --locked --quiet --manifest-path scan/Cargo.toml || exit 1
node --input-type=module - "${1:?usage: verify.sh <evidence directory>}" <<'NODE'
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),ev=path.resolve(process.argv[2]),state=path.resolve(root,process.env.BNZ_STATE_DIR),bin=n=>path.join(state,'bin',n);
const read=f=>readFileSync(path.join(ev,f)),json=f=>JSON.parse(read(f)),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
const bytes=v=>Buffer.from(canonical(v)+'\n');
const need=(ok,reason)=>{if(!ok)throw Error(reason)};
let failed=false;const check=(id,fn)=>{try{fn();console.log(`OK ${id}`)}catch(e){failed=true;console.log(`ERROR ${id} ${e.message}`)}};
const execute=(file,args,input)=>execFileSync(file,args,{input,maxBuffer:64<<20,stdio:['pipe','pipe','pipe']});
const manifest=label=>JSON.parse(execute(process.execPath,['manifest/dist/cli.mjs','client',json('settle/signer.json').signer],bytes(json(`settle/${label}/manifest.json`)))).manifest;
function tx(endpoint,txid) {
 const hash=Buffer.from(txid,'hex').reverse().toString('base64');
 const r=JSON.parse(execute(bin('grpcurl'),['-import-path',path.join(state,'proto'),'-proto','service.proto','-d',JSON.stringify({hash}),endpoint,'cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction']));
 need(Number(r.height)>0&&Number(r.height)<2**32-1,'transaction is not mined');return {height:Number(r.height),raw:Buffer.from(r.data,'base64')};
}
const recovered=t=>execute(path.join(root,'scan/target/release/benzo-scan'),['verify','test',path.join(state,'ufvk.txt'),String(t.height)],t.raw.toString('hex')).toString().trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
let result;
check('clearing',()=> {
 const packet=json('settle/main/manifest.json'),m=manifest('main'),frozen=json('settle/main/frozen.json');
 const opened=frozen.leaves.map(l=> {
   const r=spawnSync(bin('tle'),['-d','-c',process.env.BNZ_DRAND_CHAIN_HASH],{input:Buffer.from(l.ciphertext_hex,'hex'),maxBuffer:1<<20});
   if(r.error)throw r.error;need(r.status===0,`Go tle: ${r.stderr.toString().trim()}`);return {leaf_index:l.leaf_index,plaintext_hex:r.stdout.toString('hex')};
 });
 result=JSON.parse(execute(process.execPath,['clear/dist/cli.mjs'],bytes({manifest:packet,signer:json('settle/signer.json').signer,frozen,opened})));
 need(bytes(result).equals(bytes(json('settle/main/result.json'))),'fresh result differs');
 need(m.auction_id===frozen.auction_id&&frozen.published_at<m.T_freeze,'freeze binding/cutoff');
});
function obligations(label) {
 if(label==='cancel')return json('settle/cancel/summary.json').rows.map(r=>({party:r.party,amount_zats:manifest('cancel').C_zats}));
 need(result,'fresh clearing did not succeed');return [...result.allocations.filter(a=>BigInt(a.refund_zats)>0n).map(a=>({party:`leaf:${a.leaf_index}`,amount_zats:a.refund_zats})),...(BigInt(result.conservation.payout_zats)>0n?[{party:'seller',amount_zats:result.conservation.payout_zats}]:[])];
}
check('J',()=> {
 for(const label of ['main','cancel']) {
  const s=json(`settle/${label}/summary.json`),expected=obligations(label);
  need(s.rows.length===expected.length&&s.receipts.length===expected.length,'party/receipt count');
  for(const e of expected){need(s.rows.find(r=>r.party===e.party)?.amount_zats===e.amount_zats,'ledger amount differs from result');need(s.receipts.find(r=>r.party===e.party)?.amount_zats===e.amount_zats,'receipt amount differs from result')}
  const balances=json(label==='main'?'settle/main/balances.json':'settle/cancel/outage.json'),total=expected.reduce((n,e)=>n+BigInt(e.amount_zats),0n);
  need(BigInt(balances.after)-BigInt(balances.before)===total,'receiving wallet balance delta');
  if(label==='main')need(balances.vault===0,'vault not empty');
  for(const endpoint of [process.env.BNZ_LWD_URL,process.env.BNZ_LWD_URL_ALT]) {
   const deposit=tx(endpoint,balances.deposit_txid),funding=recovered(deposit).filter(n=>n.value_zats>0);
   need(funding.filter(n=>n.value_zats===Number(manifest(label).C_zats)).length===(label==='main'?4:2),'chain collateral count');
   need(funding.some(n=>n.value_zats===balances.fee_reserve_zats),'fee reserve missing from chain');
   for(const b of s.batches) {
    const t=tx(endpoint,b.txid),notes=recovered(t);
    need(t.height===b.height&&sha(t.raw)===b.proofs[0].raw_hash,'batch height/raw hash');
    need(b.inspect.input_zats===b.inspect.output_zats+b.inspect.fee_zats,'PCZT conservation');
    const pczt=path.join(state,'settle',s.auction_id,`batch-${b.id}.signed.pczt`);need(sha(readFileSync(pczt))===b.pczt_hash,'stored signed PCZT hash');
    const inspection=JSON.parse(execute(path.join(root,'settle/target/release/benzo-pczt'),['inspect',pczt,path.join(state,'ufvk.txt')]));
    need(inspection.input_zats===b.inspect.input_zats&&inspection.output_zats===b.inspect.output_zats&&inspection.fee_zats===b.inspect.fee_zats,'PCZT totals changed');
    for(const r of s.receipts.filter(r=>r.txid===b.txid))need(notes.some(n=>n.pool===r.pool&&n.output_index===r.output_index&&String(n.value_zats)===r.amount_zats),'receipt not present in chain');
    for(const signature of b.signing.sessions)need(t.raw.includes(Buffer.from(signature.signature,'hex')),'FROST signature absent from chain');
   }
  }
 }
});
check('L',()=> {
 const s=json('settle/main/summary.json'),crash=json('settle/main/crash.json'),expected=obligations('main');
 need(crash.signal==='SIGKILL'&&crash.allocated>0&&crash.rows.filter(r=>r.state==='allocated').length===crash.allocated,'worker not killed after allocation');
 need(new Set(s.rows.map(r=>r.party)).size===expected.length,'duplicate/missing ledger party');
 need(s.rows.every(r=>['paid','refunded'].includes(r.state)&&r.txid&&Number.isInteger(r.output_index)),'non-final ledger state');
 need(new Set(s.receipts.map(r=>`${r.txid}:${r.pool}:${r.output_index}`)).size===expected.length,'duplicate/missing paid output');
 for(const e of expected)need(s.rows.find(r=>r.party===e.party)?.amount_zats===e.amount_zats,'final ledger amount differs from result');
});
check('K/N',()=> {
 const s=json('settle/main/summary.json'),keys=['alice','bob'].map(n=>readFileSync(path.join(state,'frost',`${n}.pubkey`),'utf8').trim()),sessions=s.batches.flatMap(b=>b.signing.sessions);
 need(sessions.length>0&&new Set(sessions.map(s=>s.randomizer)).size===sessions.length,'missing/reused signature randomizer');
 need(s.offline_signer==='carol','offline signer not recorded');
 for(const session of sessions) {
  need(JSON.stringify(session.signers)===JSON.stringify(keys),'wrong participant cohort');
  need(session.participantsSaw.every(m=>m===session.sighash)&&session.participantsSaw.length===2,'participant signed different message');
  for(const name of ['alice','bob']) {
   const checks=s.signoffs.filter(c=>c.randomizer===session.randomizer&&c.participant===name);
   need(checks.length===1&&checks[0].sighash===session.sighash&&checks[0].checked_at<=session.coordinator_started_at,'check absent or after frost-client');
   need(checks[0].result_hash===sha(bytes(result))&&checks[0].checks.length===4,'local clearing check not bound to result');
  }
 }
});
check('M/J2',()=> {
 const s=json('settle/cancel/summary.json'),outage=json('settle/cancel/outage.json'),m=manifest('cancel');
 need(outage.outage==='ECONNREFUSED'&&outage.opening_calls===0&&outage.worker_code===0,'cancel used opening or outage did not reach real boundary');
 need(s.plan.checks.length===0&&s.receipts.length===2&&s.receipts.every(r=>r.amount_zats===m.C_zats),'cancel is not full C without opening');
 for(const label of ['main','cancel'])for(const r of json(`settle/${label}/summary.json`).receipts)need(JSON.stringify(Object.keys(r).sort())===JSON.stringify(['auction_id','party','txid','pool','output_index','amount_zats'].sort()),'receipt contains non-settlement data');
});
check('run',()=> {
 const r=json('run.json'),ids=['J1','J2','K1','L1','M1','N1'];need(ids.every(id=>r.results[id]==='PASS')&&Object.keys(r.results).length===6,'not all contracted IDs passed');
 for(const [f,want]of Object.entries(r.sha256)){const p=existsSync(path.join(ev,f))?path.join(ev,f):path.join(root,f);need(sha(readFileSync(p))===want,`file hash ${f}`)}
 execute('git',['diff','--quiet',r.commit,'HEAD','--','e2e','seal','scan','tools','manifest','clear','settle','package-lock.json','package.json','playwright.config.ts']);
});
process.exitCode=failed?1:0;
NODE
