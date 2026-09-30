#!/usr/bin/env bash
# Re-check recorded Phase 2 evidence using independent cryptographic/chain observations and shipped CLIs.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
set -a; . ./.env; set +a
npm run --silent build:core || exit 1
cargo build --release --locked --quiet --manifest-path scan/Cargo.toml || exit 1
node --input-type=module - "${1:?usage: verify.sh <evidence directory>}" <<'NODE'
import {createHash,createPublicKey,verify} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(),ev=path.resolve(process.argv[2]),state=path.resolve(root,process.env.BNZ_STATE_DIR),bin=n=>path.join(state,'bin',n);
let failed=false;
const check=(id,fn)=>{try{fn();console.log(`OK ${id}`)}catch(e){failed=true;console.log(`ERROR ${id} ${e.message}`)}};
const need=(ok,why)=>{if(!ok)throw Error(why)};
const read=f=>readFileSync(path.join(ev,f)),json=f=>JSON.parse(read(f));
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')}}`:JSON.stringify(v);
const bytes=v=>Buffer.from(canonical(v)+'\n');
const signed=(packet,signer)=> {
  const b=Buffer.from(packet.bytes,'base64');need(packet.signer===signer,'untrusted signer');need(sha(b)===packet.sha256,'manifest/receipt byte hash');
  need(verify(null,b,createPublicKey({key:Buffer.from(signer,'hex'),type:'spki',format:'der'}),Buffer.from(packet.signature,'hex')),'manifest/receipt signature');
  const value=JSON.parse(b);need(bytes(value).equals(b),'noncanonical signed bytes');return value;
};
const execute=(file,args,input)=>execFileSync(file,args,{input,maxBuffer:64<<20,stdio:['pipe','pipe','pipe']});
const parent=(a,b)=>sha(Buffer.concat([Buffer.from([1]),Buffer.from(a,'hex'),Buffer.from(b,'hex')]));
let manifest,frozen;
check('E',()=> {
  const signer=json('auction/signer.json').signer,packet=json('auction/manifest.json');manifest=signed(packet,signer);
  const display=JSON.parse(execute(process.execPath,['manifest/dist/cli.mjs','client',signer],bytes(packet)));
  need(display.manifest_hash===sha(Buffer.from(packet.bytes,'base64')),'displayed manifest hash');signed(json('auction/cancel-manifest.json'),signer);
});
check('F',()=> {
  frozen=json('auction/frozen.json');const packet=json('auction/manifest.json'),m=JSON.parse(Buffer.from(packet.bytes,'base64')),signer=json('auction/signer.json').signer;
  need(frozen.auction_id===m.auction_id&&frozen.manifest_hash===packet.sha256,'freeze manifest binding');
  need(frozen.published_at<m.T_freeze&&frozen.published_at<m.drand.genesis+(m.drand.R-1)*m.drand.period,'freeze published too late');
  need(frozen.leaf_count===2&&frozen.leaves.length===2,'accepted count');
  const receipts=json('auction/receipts.json'),nodes=frozen.leaves.map((l,i)=> {
    const receipt=signed(receipts[i],signer);need(receipt.leaf_index===i&&receipt.ciphertext_hash===l.ciphertext_hash,'receipt index/hash');
    need(sha(Buffer.from(l.ciphertext_hex,'hex'))===l.ciphertext_hash,'ciphertext bytes/hash');
    return sha(Buffer.concat([Buffer.from([0]),Buffer.from(l.ciphertext_hash,'hex'),bytes(l.deposit)]));
  });
  let level=nodes;while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2)next.push(parent(level[i],level[i+1]??level[i]));level=next}
  need(level[0]===frozen.root,'Merkle root');
  nodes.forEach((node,i)=>{for(const p of frozen.paths[i])node=p.side==='left'?parent(p.hash,node):parent(node,p.hash);need(node===frozen.root,'Merkle path')});
});
check('G',()=> {
  const input=json('auction/clear-input.json'),opened=json('auction/opened.json');
  const fresh=input.frozen.leaves.map(l=> {
    const r=spawnSync(bin('tle'),['-d','-c',process.env.BNZ_DRAND_CHAIN_HASH],{input:Buffer.from(l.ciphertext_hex,'hex'),maxBuffer:1<<20});
    if(r.error)throw r.error;need(r.status===0,`tle failed ${r.stderr.toString().trim()}`);
    need(r.stdout.toString('hex')===opened.find(o=>o.leaf_index===l.leaf_index).plaintext_hex,'Go tle plaintext differs');return {leaf_index:l.leaf_index,plaintext_hex:r.stdout.toString('hex')};
  }).reverse();
  const actual=execute(process.execPath,['clear/dist/cli.mjs'],bytes({...input,opened:fresh}));
  need(actual.equals(read('auction/result.json')),'canonical result differs');need(bytes(json('auction/result.json')).equals(actual),'result is not canonical');
});
function tx(endpoint,txid) {
  const hash=Buffer.from(txid,'hex').reverse().toString('base64');
  const r=JSON.parse(execute(bin('grpcurl'),['-import-path',path.join(state,'proto'),'-proto','service.proto','-d',JSON.stringify({hash}),endpoint,'cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction']));
  need(Number(r.height)>0&&Number(r.height)<2**32-1,'transaction not mined');return {height:Number(r.height),raw:Buffer.from(r.data,'base64')};
}
check('H',()=> {
  const deposits=json('auction/deposits.json'),bad=json('auction/bad-amounts.json');need(bad.every(b=>b.outcome==='rejected'),'non-C note admitted');
  for(let i=0;i<5;i++) {
    for(const endpoint of [process.env.BNZ_LWD_URL,process.env.BNZ_LWD_URL_ALT]) {
      const t=tx(endpoint,deposits.txids[i]);need(t.height===deposits.heights[i],'deposit height');
      const lines=execute(path.join(root,'scan/target/release/benzo-scan'),['verify','test',path.join(state,'ufvk.txt'),String(t.height)],t.raw.toString('hex')).toString().trim().split('\n').map(l=>JSON.parse(l));
      const memo=read(`auction/bid${i}.memo.hex`).toString().trim(),matches=lines.filter(l=>l.pool==='ironwood'&&l.memo_hex===memo);
      need(matches.length===1,'chain memo not unique or differs');need(matches[0].value_zats===Number(manifest.C_zats)+(i===2?-1:i===3?1:0),'chain deposit amount');
    }
  }
});
check('I',()=> {
  const refund=json('auction/refund.json'),cancel=json('auction/cancel.json'),deposits=json('auction/deposits.json');
  need(cancel.code===0&&cancel.response.refunds.length===1&&cancel.response.refunds[0].amount_zats===manifest.C_zats,'cancel refund not exact C');
  need(!cancel.response.trace.some(t=>t.operation==='tle -d'),'cancel opened ciphertext');
  need(refund.input_zats===refund.output_zats+refund.fee_zats&&refund.fee_zats===refund.fee_reserve_zats,'fee reserve/conservation');
  need(refund.deposits.some(d=>d.txid===deposits.txids[5]&&d.value_zats===refund.fee_reserve_zats&&d.spent_in_txid===refund.refund_txid),'fee-reserve note not spent');
  need(refund.after.bidder-refund.before.bidder===refund.output_zats&&refund.after.vault===0,'wallet refund balances');
  const signatures=json('auction/signatures.json');need(Buffer.from(signatures.sighash,'hex').reverse().toString('hex')===refund.refund_txid,'sighash/txid');
  for(const endpoint of [process.env.BNZ_LWD_URL,process.env.BNZ_LWD_URL_ALT]) {
    const reserve=tx(endpoint,deposits.txids[5]);
    const notes=execute(path.join(root,'scan/target/release/benzo-scan'),['verify','test',path.join(state,'ufvk.txt'),String(reserve.height)],reserve.raw.toString('hex')).toString().trim().split('\n').map(l=>JSON.parse(l));
    need(notes.some(n=>n.value_zats===refund.fee_reserve_zats),'fee-reserve amount on chain');
    const t=tx(endpoint,refund.refund_txid);need(t.height===refund.height,'refund height');
    for(const session of signatures.sessions)need(session.signers.length===2&&t.raw.includes(Buffer.from(session.signature,'hex')),'threshold signature absent');
  }
  need(refund.deposits.some(d=>d.txid===refund.cancel_deposit_txid&&d.value_zats===Number(manifest.C_zats)&&d.spent_in_txid===refund.refund_txid),'cancel note not spent');
});
check('run',()=> {
  const run=json('run.json'),ids=['E1','E2','F1','F2','G1','G2','G3','H1','H2','H3','H4','I1'];
  need(ids.every(id=>run.results[id]==='PASS')&&Object.keys(run.results).length===ids.length,'not every contracted assertion passed');
  for(const [f,want] of Object.entries(run.sha256)) {
    const p=existsSync(path.join(ev,f))?path.join(ev,f):path.join(root,f);need(sha(readFileSync(p))===want,`file hash ${f}`);
  }
  execute('git',['diff','--quiet',run.commit,'HEAD','--','e2e','seal','scan','tools','manifest','clear','package-lock.json','playwright.config.ts']);
});
process.exitCode=failed?1:0;
NODE
