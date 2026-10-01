// Signer-side monetary plan: fresh chain observations and Go tle, then the shipped pure clearing CLI.
// Recipient authorization is a separate prerequisite; this entry point never signs or broadcasts.
import {execFileSync,spawnSync} from "node:child_process";
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {client,hash,jsonBytes,QUICKNET,requireThat} from "../manifest/schema";
import {checkFrozen} from "../clear/merkle";
import type {Obligation} from "./ledger";
const root=execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
for(const line of readFileSync(path.join(root,".env"),"utf8").split("\n")) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];
}
const state=path.resolve(root,process.env.BNZ_STATE_DIR!);
function execute(cmd:string,args:string[],input?:string):string {
  const r=spawnSync(cmd,args,{input,encoding:"utf8",maxBuffer:64<<20});
  appendFileSync(path.join(state,"run","settle-plan.log"),`\n${path.basename(cmd)}\n${r.stdout??""}${r.stderr??""}`);
  if(r.error)throw r.error;
  requireThat(r.status===0,`${path.basename(cmd)} failed: ${(r.stderr||r.stdout).trim().slice(-250)}`);return r.stdout;
}
try {
  const [id]=process.argv.slice(2);requireThat(/^[0-9a-f]{64}$/.test(id),"settlement auction id");
  const auction=JSON.parse(readFileSync(path.join(state,"auction",`${id}.json`),"utf8"));
  const {manifest:m,manifest_hash}=client(auction.manifest,auction.signer);
  requireThat(m.auction_id===id&&m.fee_zats==="0","settlement requires zero auction fee; network fee comes from reserve");
  const wallet=(...args:string[])=>execute(path.join(state,"bin","zcash-devtool"),["wallet","-w",path.join(state,"vault"),...args]);
  wallet("sync","-s",process.env.BNZ_LWD_URL!);wallet("enhance","-s",process.env.BNZ_LWD_URL!);
  const tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
  const notes=execute(path.join(root,"scan/target/release/benzo-scan"),["scan","test",path.join(state,"vault")]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
  const ledgerFile=path.join(state,"settle",id,"ledger.sqlite"),owned=new Set<string>();
  if(existsSync(ledgerFile)) {
    const db=new DatabaseSync(ledgerFile,{readOnly:true});
    try {for(const b of db.prepare("SELECT txid,pczt_path,pczt_hash FROM batches WHERE txid IS NOT NULL").all()) {
      requireThat(hash(readFileSync(String(b.pczt_path)))===b.pczt_hash,"staged PCZT changed on resume");owned.add(String(b.txid));
    }} finally {db.close()}
  }
  const depositNotes=notes.filter(n=>m.deposit_addresses.includes(n.address)&&(!n.spent_in_txid||owned.has(n.spent_in_txid)));
  requireThat(depositNotes.every(n=>n.height&&tip-n.height+1>=m.confirmations&&String(n.value_zats)===m.C_zats),"settlement deposit amount/confirmation");
  const obligations:Obligation[]=[],checks:{operation:string;ciphertext_hash?:string}[]=[];
  let result_hash:string|null=null;
  if(["CANCELLED","REFUNDING"].includes(auction.state)) {
    requireThat(!auction.opened,"cancelled plan has opened bids");
    for(const n of depositNotes)obligations.push({party:`deposit:${n.txid}:${n.diversifier_index}`,kind:"refund",amount_zats:m.C_zats});
  } else {
    requireThat(auction.state==="CLEARED"&&auction.result&&auction.frozen,"settlement requires cleared result");
    checkFrozen(auction.frozen,id,manifest_hash);
    requireThat(Date.now()/1000>=QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"settlement before release");
    const dir=path.join(state,"settle",id,"check",String(process.pid));mkdirSync(dir,{recursive:true,mode:0o700});
    const opened=auction.frozen.leaves.map((leaf:any)=> {
      requireThat(depositNotes.some(n=>n.txid===leaf.deposit.txid&&n.address===leaf.deposit.address),"frozen deposit missing or spent; resume needs mined-batch reconciliation");
      const ct=path.join(dir,`${leaf.leaf_index}.age`),pt=path.join(dir,`${leaf.leaf_index}.bin`);
      writeFileSync(ct,Buffer.from(leaf.ciphertext_hex,"hex"),{mode:0o600});
      checks.push({operation:"tle -d",ciphertext_hash:hash(Buffer.from(leaf.ciphertext_hex,"hex"))});
      appendFileSync(path.join(state,"run","settle-tle.jsonl"),JSON.stringify({auction_id:id,operation:"tle -d",time:Date.now()})+"\n");
      const r=spawnSync(path.join(state,"bin","tle"),["-d","-n",process.env.BNZ_DRAND_URLS!.split(",")[0],"-c",QUICKNET.chain_hash,"-o",pt,ct],{encoding:"utf8"});
      if(r.error)throw r.error;
      if(r.status!==0) {
        requireThat(/bad header MAC|failed to decrypt and authenticate payload chunk/.test(r.stderr),`fresh tle failed: ${r.stderr.trim().slice(-250)}`);
        return {leaf_index:leaf.leaf_index,plaintext_hex:null,error:"undecryptable"};
      }
      return {leaf_index:leaf.leaf_index,plaintext_hex:readFileSync(pt).toString("hex")};
    });
    const result=JSON.parse(execute(process.execPath,[path.join(root,"clear/dist/cli.mjs")],JSON.stringify({manifest:auction.manifest,signer:auction.signer,frozen:auction.frozen,opened})));
    requireThat(jsonBytes(result).equals(jsonBytes(auction.result)),"fresh signer clearing differs from result.json");
    result_hash=hash(jsonBytes(result));
    for(const a of result.allocations)if(BigInt(a.refund_zats)>0n)obligations.push({party:`leaf:${a.leaf_index}`,kind:"refund",amount_zats:a.refund_zats});
    if(BigInt(result.conservation.payout_zats)>0n)obligations.push({party:"seller",kind:"payout",amount_zats:result.conservation.payout_zats});
  }
  requireThat(obligations.length>0,"no confirmed settlement obligations");
  process.stdout.write(jsonBytes({auction_id:id,manifest_hash,result_hash,obligations,checks,checked_at:Math.floor(Date.now()/1000),chain_tip:tip}));
} catch(e) {process.stderr.write(`ERROR settle ${(e as Error).message}\n`);process.exitCode=1}
