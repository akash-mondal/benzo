#!/usr/bin/env bash
# Re-check generated Phase 4 evidence against real drand, pure clearing, both endpoints and local note recovery.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
set -a; . ./.env; set +a
npm run --silent build:core || exit 1
npm run --silent build:cli || exit 1
cargo build --release --locked --quiet --manifest-path scan/Cargo.toml || exit 1
node --input-type=module - "${1:?usage: verify.sh <evidence directory>}" <<'NODE'
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),ev=path.resolve(process.argv[2]),state=path.resolve(root,process.env.BNZ_STATE_DIR),bin=n=>path.join(state,'bin',n);
const read=f=>readFileSync(path.join(ev,f)),json=f=>JSON.parse(read(f)),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
const bytes=v=>Buffer.from(canonical(v)+'\n'),need=(ok,reason)=>{if(!ok)throw Error(reason)};
let failed=false;const check=(id,fn)=>{try{fn();console.log(`OK ${id}`)}catch(e){failed=true;console.log(`ERROR ${id} ${e.message}`)}};
const execute=(file,args,input)=>execFileSync(file,args,{input,maxBuffer:64<<20,stdio:['pipe','pipe','pipe']});
function tx(endpoint,txid) {
 const r=JSON.parse(execute(bin('grpcurl'),['-import-path',path.join(state,'proto'),'-proto','service.proto','-d',JSON.stringify({hash:Buffer.from(txid,'hex').reverse().toString('base64')}),endpoint,'cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction']));
 need(Number(r.height)>0&&Number(r.height)<2**32-1,'transaction is not mined');return {height:Number(r.height),raw:Buffer.from(r.data,'base64')};
}
const recovered=t=>execute(path.join(root,'scan/target/release/benzo-scan'),['verify','test',path.join(state,'ufvk.txt'),String(t.height)],t.raw.toString('hex')).toString().trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
let doc,m,result,expected;
check('O/P',()=> {
 doc=json('cli/auction.json');m=JSON.parse(execute(process.execPath,['manifest/dist/cli.mjs','client',doc.signer],bytes(doc.manifest))).manifest;
 need(doc.auction_id===m.auction_id&&doc.state==='SETTLED','auction is not bound or settled');
 for(const name of ['manifest','frozen','result','opened','beacon'])need(bytes(doc[name]).equals(read(`cli/${name}.json`)),`${name} projection differs`);
 need(doc.frozen.published_at<m.T_freeze&&doc.frozen.published_at<m.drand.genesis+(m.drand.R-1)*m.drand.period,'freeze after cutoff or release');
 const opened=doc.frozen.leaves.map(l=> {
  const r=spawnSync(bin('tle'),['-d','-c',m.drand.chain_hash],{input:Buffer.from(l.ciphertext_hex,'hex'),maxBuffer:1<<20});if(r.error)throw r.error;
  need(r.status===0,`Go tle failed: ${r.stderr.toString().trim()}`);return {leaf_index:l.leaf_index,plaintext_hex:r.stdout.toString('hex')};
 });
 need(bytes(opened).equals(bytes(doc.opened)),'published openings differ from Go tle');need(doc.beacon.round===m.drand.R&&doc.beacon.chain_hash===m.drand.chain_hash,'published beacon binding');
 result=JSON.parse(execute(process.execPath,['clear/dist/cli.mjs'],bytes({manifest:doc.manifest,signer:doc.signer,frozen:doc.frozen,opened})));
 need(bytes(result).equals(bytes(doc.result)),'fresh clear differs from result');
});
check('T1/T4/accounting',()=> {
 need(result&&doc,'fresh clear unavailable');const drill=json('cli/drill.json'),funding=tx(process.env.BNZ_LWD_URL_ALT,drill.stray_txid);
 const stray=recovered(funding).filter(n=>m.deposit_addresses.includes(n.address)&&n.value_zats>0);
 need(stray.length===2&&stray.some(n=>n.value_zats===Number(m.C_zats))&&stray.some(n=>n.value_zats===Number(m.C_zats)+1),'stray notes not recovered at their actual values');
 expected=[...result.allocations.filter(a=>BigInt(a.refund_zats)>0n).map(a=>({party:`leaf:${a.leaf_index}`,amount_zats:a.refund_zats})),{party:'seller',amount_zats:result.conservation.payout_zats},...stray.map(n=>({party:`deposit:${drill.stray_txid}:${n.diversifier_index}`,amount_zats:String(n.value_zats)}))];
 const s=doc.settlement;need(s.rows.length===expected.length&&s.receipts.length===expected.length,'ledger/receipt count');
 for(const e of expected){need(s.rows.find(r=>r.party===e.party)?.amount_zats===e.amount_zats,'ledger amount differs from independent clearing/chain');need(s.receipts.find(r=>r.party===e.party)?.amount_zats===e.amount_zats,'receipt amount differs from independent clearing/chain')}
 need(new Set(s.receipts.map(r=>`${r.txid}:${r.pool}:${r.output_index}`)).size===expected.length,'duplicate settlement output');
 for(const endpoint of [process.env.BNZ_LWD_URL,process.env.BNZ_LWD_URL_ALT])for(const b of s.batches.filter(b=>b.state==='mined')) {
  const t=tx(endpoint,b.txid),notes=recovered(t);need(t.height===b.height,'batch heights differ');
  need(b.inspect.input_zats===b.inspect.output_zats+b.inspect.fee_zats,'PCZT conservation');
  for(const receipt of s.receipts.filter(r=>r.txid===b.txid))need(notes.some(n=>n.pool===receipt.pool&&n.output_index===receipt.output_index&&String(n.value_zats)===receipt.amount_zats),'receipt amount absent from chain');
  for(const session of b.signing.sessions)need(t.raw.includes(Buffer.from(session.signature,'hex')),'FROST signature absent from chain');
 }
});
check('Q/T3/T5',()=> {
 const s=doc.settlement,d=json('cli/drill.json'),expired=s.batches.filter(b=>b.state==='exception'),paid=s.batches.filter(b=>b.state==='mined');
 need(expired.length===1&&paid.length===1&&expired[0].txid!==paid[0].txid,'expired staged batch not replaced');
 need(d.delay.resumed_height>d.delay.expiry_height&&expired[0].inspect.expiry_height===d.delay.expiry_height,'second signer not delayed beyond expiry');
 need(s.rows.every(r=>['paid','refunded'].includes(r.state)),'unfinished ledger');
 need(s.offline_signer==='alice','offline signer differs from drill');const keys=['bob','carol'].map(n=>readFileSync(path.join(state,'frost',`${n}.pubkey`),'utf8').trim());
 for(const b of paid)for(const session of b.signing.sessions){need(JSON.stringify(session.signers)===JSON.stringify(keys),'wrong signing pair');need(session.participantsSaw.length===2&&session.participantsSaw.every(v=>v===session.sighash),'participant message differs');need(session.duration_ms>0,'missing timing measurement')}
});
check('T2/S',()=> {
 const text=JSON.stringify(doc),api=json('cli/api.json');need(!/recipient_hash|routing_hash|refund_ua|seller_ua/.test(text),'private recipient data in public document');
 need(!/price_zats|quantity|plaintext_hex|recipient_hash|refund_ua/.test(JSON.stringify(api.operator)),'operator API leaks plaintext/recipient data');need(bytes(api.result).equals(bytes(doc.result)),'API result differs');
 for(const r of doc.settlement.receipts)need(JSON.stringify(Object.keys(r).sort())===JSON.stringify(['auction_id','party','txid','pool','output_index','amount_zats'].sort()),'non-settlement receipt fields');
});
check('R',()=>execute(path.join(root,'bin/benzo'),['verify','--dir',path.join(ev,'cli'),'--signer',doc.signer]));
check('run',()=> {
 const r=json('run.json'),ids=['O1','O2','P1','P2','Q1','R1','S1','T1','T2','T3','T4','T5'];need(Object.keys(r.results).length===ids.length&&ids.every(id=>r.results[id]==='PASS'),'not all contracted IDs passed');
 for(const [f,want]of Object.entries(r.sha256)){const p=existsSync(path.join(ev,f))?path.join(ev,f):path.join(root,f);need(sha(readFileSync(p))===want,`file hash ${f}`)}
 execute('git',['diff','--quiet',r.commit,'HEAD','--','cli','api','schemas','e2e','seal','scan','tools','manifest','clear','settle','package-lock.json','package.json','playwright.config.ts']);
});
process.exitCode=failed?1:0;
NODE
