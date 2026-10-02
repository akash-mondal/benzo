// Signer-side monetary plan: fresh chain observations and Go tle, then the shipped pure clearing CLI (which
// dispatches through clear/registry.ts). F8 (R28): in the product flow the signer recomputes from the PUBLISHED
// auction.json (manifest, frozen, opened, beacon) and refuses if the coordinator's private result or batch plan
// differs from that recomputation. Recipient authorization is a separate prerequisite; this entry point never
// signs or broadcasts.
import {execFileSync,spawnSync} from "node:child_process";
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {client,hash,jsonBytes,QUICKNET,requireThat} from "../manifest/schema";
import {requireReserveOpening,tleOpening} from "../manifest/reserve";
import {checkFrozen} from "../clear/merkle";
import {modeEntry} from "../clear/registry";
import type {Obligation} from "./ledger";
const root=execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
for(const line of readFileSync(path.join(root,".env"),"utf8").split("\n")) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];
}
const state=path.resolve(root,process.env.BNZ_STATE_DIR!);
function execute(cmd:string,args:string[],input?:string):string {
  const r=spawnSync(cmd,args,{input,encoding:"utf8",maxBuffer:64<<20});
  appendFileSync(path.join(state,"run","settle-plan.log"),`\n${path.basename(cmd)}\n${r.stderr??""}`);
  if(r.error)throw r.error;
  requireThat(r.status===0,`${path.basename(cmd)} failed: ${(r.stderr||r.stdout).trim().slice(-250)}`);return r.stdout;
}
try {
  const [id]=process.argv.slice(2);requireThat(/^[0-9a-f]{64}$/.test(id),"settlement auction id");
  const auction=JSON.parse(readFileSync(path.join(state,"auction",`${id}.json`),"utf8"));
  // The published document is the signer's source of truth when a product config exists; the coordinator's
  // private copy is then only cross-checked against the recomputation, never trusted on its own.
  const config=path.join(state,"product",`${id}.json`);
  const published=existsSync(config)?JSON.parse(readFileSync(path.join(path.resolve(JSON.parse(readFileSync(config,"utf8")).public_dir),"auction.json"),"utf8")):null;
  const src=published??auction;
  const {manifest:m,manifest_hash}=client(src.manifest,src.signer);
  requireThat(m.auction_id===id&&m.fee_zats==="0","settlement requires zero auction fee; network fee comes from reserve");
  const wallet=(...args:string[])=>execute(path.join(state,"bin","zcash-devtool"),["wallet","-w",path.join(state,"vault"),...args]);
  wallet("sync","-s",process.env.BNZ_LWD_URL!);wallet("enhance","-s",process.env.BNZ_LWD_URL!);
  const tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
  const notes=execute(path.join(root,"scan/target/release/benzo-scan"),["scan","test",path.join(state,"vault")]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
  const ledgerFile=path.join(state,"settle",id,"ledger.sqlite"),owned=new Set<string>();
  if(existsSync(ledgerFile)) {
    const db=new DatabaseSync(ledgerFile,{readOnly:true});
    try {for(const b of db.prepare("SELECT txid,pczt_path,pczt_hash FROM batches WHERE txid IS NOT NULL AND state!='exception'").all()) {
      requireThat(hash(readFileSync(String(b.pczt_path)))===b.pczt_hash,"staged PCZT changed on resume");owned.add(String(b.txid));
    }} finally {db.close()}
  }
  const depositNotes=notes.filter(n=>m.deposit_addresses.includes(n.address)&&(!n.spent_in_txid||owned.has(n.spent_in_txid)));
  const confirmed=(n:any)=>n.height&&tip-n.height+1>=m.confirmations;
  const stray=depositNotes.filter(n=>!src.frozen?.leaves.some((l:any)=>l.deposit.txid===n.txid&&l.deposit.address===n.address));
  const exceptions=stray.filter(n=>!confirmed(n)).map(n=>({party:`deposit:${n.txid}:${n.diversifier_index}`,kind:"refund",amount_zats:String(n.value_zats)}));
  const obligations:Obligation[]=[],checks:{operation:string;ciphertext_hash?:string}[]=[];
  let result_hash:string|null=null;
  if(["CANCELLED","REFUNDING"].includes(src.state)) {
    requireThat(!src.opened,"cancelled plan has opened bids");
    for(const n of depositNotes.filter(confirmed))obligations.push({party:`deposit:${n.txid}:${n.diversifier_index}`,kind:"refund",amount_zats:String(n.value_zats)});
  } else {
    requireThat(["CLEARED","SETTLING","SETTLED"].includes(src.state)&&src.result&&src.frozen,"settlement requires cleared result");
    if(published)requireThat(published.beacon&&published.beacon.round===m.drand.R&&published.beacon.chain_hash===m.drand.chain_hash,"published beacon missing or unbound");
    checkFrozen(src.frozen,id,manifest_hash);
    requireThat(Date.now()/1000>=QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"settlement before release");
    const dir=path.join(state,"settle",id,"check",String(process.pid));mkdirSync(dir,{recursive:true,mode:0o700});
    const opened=src.frozen.leaves.map((leaf:any)=> {
      requireThat(depositNotes.some(n=>n.txid===leaf.deposit.txid&&n.address===leaf.deposit.address&&confirmed(n)&&String(n.value_zats)===m.C_zats),"frozen deposit missing or spent; resume needs mined-batch reconciliation");
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
    if(published)requireThat(jsonBytes(opened).equals(jsonBytes(published.opened)),"published opening differs from fresh decryption");
    // R6 (F2): the sealed reserve is re-derived here with the pinned Go tle and must equal the
    // published opening; a forged opening is refused before any signature.
    const derivedReserve=src.manifest.sealed_reserve!==undefined?tleOpening(path.join(state,"bin","tle"),src.manifest.drand.chain_hash,src.manifest.sealed_reserve):null;
    const reserve_opening=requireReserveOpening(src.manifest,published?(published.reserve_opening?.plaintext_hex??null):(auction.reserve_opening??null),derivedReserve);
    const result=JSON.parse(execute(process.execPath,[path.join(root,"clear/dist/cli.mjs")],JSON.stringify({manifest:src.manifest,signer:src.signer,frozen:src.frozen,opened,reserve_opening,serial_beacon:src.serial_beacon??null,launch:src.launch_input})));
    const fresh=jsonBytes(result);
    if(published) {
      requireThat(fresh.equals(jsonBytes(published.result)),"published result differs from signer recomputation");
      requireThat(fresh.equals(jsonBytes(auction.result)),"fresh signer clearing differs from result.json");
    } else requireThat(fresh.equals(jsonBytes(auction.result)),"fresh signer clearing differs from result.json");
    result_hash=hash(fresh);
    for(const [party,amount] of modeEntry(src.manifest).obligations(result))obligations.push({party,kind:party==="seller"?"payout":"refund",amount_zats:amount});
  }
  if(!["CANCELLED","REFUNDING"].includes(src.state))for(const n of stray.filter(confirmed))obligations.push({party:`deposit:${n.txid}:${n.diversifier_index}`,kind:"refund",amount_zats:String(n.value_zats)});
  obligations.sort((a,b)=>a.party.localeCompare(b.party));
  requireThat(obligations.length+exceptions.length>0,"no confirmed settlement obligations");
  process.stdout.write(jsonBytes({auction_id:id,manifest_hash,result_hash,obligations,exceptions,checks,checked_at:Math.floor(Date.now()/1000),chain_tip:tip}));
} catch(e) {process.stderr.write(`ERROR settle ${(e as Error).message}\n`);process.exitCode=1}
