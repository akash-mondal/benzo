// Stateful auction boundary. Chain observations come only from the inherited wallet scanner; clearing stays pure.
import {execFileSync, spawnSync} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import path from "node:path";
import {client, hash, jsonBytes, QUICKNET, requireThat, signRecord, type Signed} from "../manifest/schema";
import {checkFrozen, receiptMember, tree, type Deposit, type Frozen, type Leaf, type Receipt} from "./merkle";
import {clear, type Opened} from "./core";

type Note = {txid:string; height:number|null; pool:string; address:string; diversifier_index:string; value_zats:number; memo_hex:string; spent_in_txid:string|null};
type Ledger = {manifest:Signed; signer:string; state:string; leaves:Leaf[]; receipts:Signed[]; frozen?:Frozen; opened?:Opened[]; beacon?:{round:number;signature:string;chain_hash:string}; result?:ReturnType<typeof clear>; trace:{operation:string; time:number}[]};
const root=execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
for (const line of readFileSync(path.join(root,".env"),"utf8").split("\n")) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m && process.env[m[1]]===undefined)process.env[m[1]]=m[2];
}
const state=path.resolve(root,process.env.BNZ_STATE_DIR!);
const dir=path.join(state,"auction"), key=path.join(dir,"manifest-signing.pem");
mkdirSync(dir,{recursive:true,mode:0o700});
const execute=(cmd:string,args:string[])=> {
  const r=spawnSync(cmd,args,{encoding:"utf8",maxBuffer:64<<20});
  appendFileSync(path.join(state,"run","auction-cli.log"),`\n${path.basename(cmd)} ${args[0]}\n${r.stdout??""}${r.stderr??""}`);
  if(r.error)throw r.error;
  requireThat(r.status===0,`${path.basename(cmd)} exited ${r.status}: ${(r.stderr||r.stdout).trim().slice(-300)}`); return r.stdout;
};
const wallet=(...args:string[])=>execute(path.join(state,"bin","zcash-devtool"),["wallet","-w",path.join(state,"vault"),...args]);
function observed():{notes:Note[]; tip:number} {
  wallet("sync","-s",process.env.BNZ_LWD_URL!); wallet("enhance","-s",process.env.BNZ_LWD_URL!);
  const balance=JSON.parse(wallet("balance","--json"));
  const notes=execute(path.join(root,"scan","target","release","benzo-scan"),["scan","test",path.join(state,"vault")]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
  return {notes,tip:balance.chain_tip_height};
}
function ciphertext(envelope:string,R:number):string {
  requireThat(typeof envelope==="string" && /^[0-9a-f]{1024}$/.test(envelope),"envelope length");
  const memo=Buffer.from(envelope,"hex"), length=memo.readUInt16BE(5);
  requireThat(memo.subarray(0,5).equals(Buffer.from("ff424e5a01","hex")) && length>0 && length<=505 && memo.subarray(7+length).equals(Buffer.alloc(505-length)),"envelope header/padding");
  const ct=memo.subarray(7,7+length), header=ct.toString("latin1").split("--- ")[0];
  requireThat(header.startsWith("age-encryption.org/v1\n") && header.includes(`-> tlock ${R} ${QUICKNET.chain_hash}\n`) && (header.match(/-> /g)||[]).length===1,"tlock round/chain stanza");
  return ct.toString("hex");
}
try {
  const [command,id]=process.argv.slice(2), input=JSON.parse(readFileSync(0,"utf8")||"{}");
  requireThat(/^[0-9a-f]{64}$/.test(id),"auction id");
  const file=path.join(dir,`${id}.json`);
  let ledger:Ledger, result:unknown;
  if(command==="init") {
    requireThat(!existsSync(file),"auction already exists");
    const {manifest:m}=client(input.manifest,input.signer);
    requireThat(m.auction_id===id && Date.now()/1000<m.T_submit,"auction init deadline");
    const ours=signRecord({},readFileSync(key,"utf8")).signer;
    requireThat(ours===input.signer,"local manifest signer");
    ledger={manifest:input.manifest,signer:input.signer,state:"OPEN",leaves:[],receipts:[],trace:[]}; result={state:ledger.state};
  } else {
    ledger=JSON.parse(readFileSync(file,"utf8"));
    const {manifest:m,manifest_hash}=client(ledger.manifest,ledger.signer), now=Math.floor(Date.now()/1000);
    if(command==="admit") {
      requireThat(now<m.T_freeze && ledger.state==="OPEN","admission cutoff");
      requireThat(now<QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"round already passed");
      const ct=ciphertext(input.envelope_hex,m.drand.R);
      requireThat(/^[0-9a-f]{64}$/.test(input.txid) && m.deposit_addresses.includes(input.address),"deposit reference/address");
      const {notes,tip}=observed(), matches=notes.filter(n=>n.txid===input.txid && n.address===input.address);
      requireThat(matches.length===1,"deposit not unique or absent"); const n=matches[0];
      requireThat(n.pool==="ironwood" && n.height && tip-n.height+1>=m.confirmations && !n.spent_in_txid,"deposit confirmation/pool/spent");
      requireThat(n.memo_hex===input.envelope_hex,"deposit memo mismatch");
      requireThat(BigInt(n.value_zats)===BigInt(m.C_zats),"deposit amount differs from C");
      const deposit:Deposit={txid:n.txid,pool:"ironwood",address:n.address,diversifier_index:n.diversifier_index};
      const ciphertext_hash=hash(Buffer.from(ct,"hex"));
      const old=ledger.leaves.find(l=>l.ciphertext_hash===ciphertext_hash || jsonBytes(l.deposit).equals(jsonBytes(deposit)));
      if(old) { requireThat(old.ciphertext_hash===ciphertext_hash && jsonBytes(old.deposit).equals(jsonBytes(deposit)),"ciphertext/deposit replay conflict"); result={replay:true,receipt:ledger.receipts[old.leaf_index]}; }
      else {
        const receipt:Receipt={auction_id:id,manifest_hash,ciphertext_hash,deposit,leaf_index:ledger.leaves.length};
        ledger.leaves.push({...receipt,ciphertext_hex:ct}); const signed=signRecord(receipt,readFileSync(key,"utf8")); ledger.receipts.push(signed); result={replay:false,receipt:signed};
      }
    } else if(command==="freeze") {
      requireThat(ledger.state==="OPEN" && now>=m.T_submit,"freeze outside confirmation buffer");
      const cutoff=(ok:unknown,reason:string)=> {
        if(!ok) { ledger.state="CANCELLED"; writeFileSync(file+".new",jsonBytes(ledger),{mode:0o600}); renameSync(file+".new",file); throw new Error(`refused: ${reason}`); }
      };
      cutoff(now<m.T_freeze,"freeze missed cutoff");
      requireThat(now<QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"freeze after release");
      const {notes}=observed();
      cutoff(ledger.leaves.every(l=>notes.some(n=>n.txid===l.deposit.txid && n.address===l.deposit.address && n.height && !n.spent_in_txid)),"freeze deposit left chain");
      const commitment=tree(ledger.leaves);
      const published=Math.floor(Date.now()/1000);
      cutoff(published<m.T_freeze && published<QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"freeze publication cutoff");
      ledger.frozen={auction_id:id,manifest_hash,...commitment,leaf_count:ledger.leaves.length,cutoff:m.T_freeze,published_at:published,leaves:ledger.leaves}; ledger.state="SEALED-WAIT"; result=ledger.frozen;
    } else if(command==="open") {
      requireThat(ledger.state==="SEALED-WAIT" && now>=QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"opening state/release");
      const {notes}=observed();
      requireThat(ledger.frozen,"no frozen set"); checkFrozen(ledger.frozen!,id,manifest_hash);
      const beacon=await fetch(`${process.env.BNZ_DRAND_URLS!.split(",")[0]}/${QUICKNET.chain_hash}/public/${m.drand.R}`);
      requireThat(beacon.ok,"drand unavailable at opening");
      const b=await beacon.json() as {round:number;signature:string};requireThat(b.round===m.drand.R && /^[0-9a-f]{96}$/.test(b.signature),"drand opening beacon round/signature");ledger.beacon={round:b.round,signature:b.signature,chain_hash:QUICKNET.chain_hash};
      ledger.opened=ledger.leaves.map(l=> {
        if(!notes.some(n=>n.txid===l.deposit.txid && n.address===l.deposit.address && n.height))return {leaf_index:l.leaf_index,plaintext_hex:null,error:"reorg"};
        const ct=path.join(dir,`${id}-${l.leaf_index}.age`), pt=path.join(dir,`${id}-${l.leaf_index}.bin`); writeFileSync(ct,Buffer.from(l.ciphertext_hex,"hex"),{mode:0o600});
        ledger.trace.push({operation:"tle -d",time:now});
        const opening=spawnSync(path.join(state,"bin","tle"),["-d","-c",QUICKNET.chain_hash,"-o",pt,ct],{encoding:"utf8"});
        appendFileSync(path.join(state,"run","auction-cli.log"),`\ntle -d\n${opening.stderr??""}`);
        if(opening.error)throw opening.error;
        if(opening.status!==0) {
          // Only authenticated ciphertext failures are bad bids. Relay/beacon/tool failures remain errors.
          if(/bad header MAC|failed to decrypt and authenticate payload chunk/.test(opening.stderr))return {leaf_index:l.leaf_index,plaintext_hex:null,error:"undecryptable"};
          throw new Error(`tle opening failed: ${opening.stderr.trim().slice(-300)}`);
        }
        return {leaf_index:l.leaf_index,plaintext_hex:readFileSync(pt).toString("hex")};
      }); ledger.state="OPENED"; result={opened:ledger.opened,trace:ledger.trace};
    } else if(command==="clear") {
      requireThat(ledger.state==="OPENED" || ledger.state==="CLEARED","clearing state");
      ledger.result=clear({manifest:ledger.manifest,signer:ledger.signer,frozen:ledger.frozen!,opened:ledger.opened!}); ledger.state="CLEARED"; result=ledger.result;
    } else if(command==="cancel") {
      requireThat(["OPEN","SEALED-WAIT","CANCELLED"].includes(ledger.state) && !ledger.opened,"cancel after opening");
      ledger.state="CANCELLED";
      const {notes}=observed();
      const deposits=notes.filter(n=>m.deposit_addresses.includes(n.address) && n.height && !n.spent_in_txid);
      result={auction_id:id,state:"REFUNDING",refunds:deposits.map(n=>({txid:n.txid,address:n.address,amount_zats:String(n.value_zats)})),trace:ledger.trace}; ledger.state="REFUNDING";
    } else if(command==="receipt") {
      result={included:receiptMember(input.receipt,input.frozen,ledger.signer)};
    } else if(command==="status") result=ledger;
    else throw new Error("usage: init | admit | freeze | open | clear | cancel | receipt | status <auction id>; JSON stdin");
  }
  ledger.trace.push({operation:command,time:Math.floor(Date.now()/1000)});
  writeFileSync(file+".new",jsonBytes(ledger),{mode:0o600}); renameSync(file+".new",file);
  process.stdout.write(jsonBytes(result));
} catch(e) {process.stderr.write(`ERROR auction ${(e as Error).message}\n`);process.exitCode=1;}
