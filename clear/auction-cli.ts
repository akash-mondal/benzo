// Stateful auction boundary. Chain observations come only from the inherited wallet scanner; clearing stays pure.
import {execFileSync, spawnSync} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import path from "node:path";
import {hash, jsonBytes, QUICKNET, requireThat, signRecord, type Signed} from "../manifest/schema";
import {checkFrozen, receiptMember, tree, type Deposit, type Frozen, type Leaf, type Receipt} from "./merkle";
import type {ClearResult, Opened} from "./core";
import {clearForMode, clientCommon as client} from "./registry"; // design §6.1: every registry mode
import {envelopeRecordValid} from "../envelope";
import {memoBindsEnvelope,memoTlockCiphertext} from "../settle/envelopes";
import {verifyStatement} from "../envelope";
import { repoRoot } from "../manifest/root";
import { vaultDir, scanBin } from "../manifest/paths";

type Note = {txid:string; height:number|null; pool:string; address:string; diversifier_index:string; value_zats:number; memo_hex:string; spent_in_txid:string|null};
type Ledger = {manifest:Signed; signer:string; state:string; leaves:Leaf[]; receipts:Signed[]; envelopes?:{ciphertext_hash:string; envelope_ct:string; owner_sig:string}[]; frozen?:Frozen; opened?:Opened[]; reserve_opening?:string; beacon?:{round:number;signature:string;chain_hash:string}; result?:ClearResult; trace:{operation:string; time:number}[]};
const root=repoRoot();
for (const line of (existsSync(path.join(root,".env"))?readFileSync(path.join(root,".env"),"utf8"):"").split("\n")) {
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
const wallet=(...args:string[])=>execute(path.join(state,"bin","zcash-devtool"),["wallet","-w",vaultDir(state),...args]);
function observed():{notes:Note[]; tip:number} {
  wallet("sync","-s",process.env.BNZ_LWD_URL!); wallet("enhance","-s",process.env.BNZ_LWD_URL!);
  const balance=JSON.parse(wallet("balance","--json"));
  const notes=execute(scanBin(root,state),["scan","test",vaultDir(state)]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
  return {notes,tip:balance.chain_tip_height};
}
// The one shared memo rule (settle/envelopes.ts memoTlockCiphertext): v2 (R16 item 2, R18: 18-byte envelope tag)
// and v1 framings both read; v2 binds the record to the deposit memo, v1 binds nothing. Witnesses apply the same rule.
const ciphertext=memoTlockCiphertext;
try {
  const [command,id]=process.argv.slice(2), input=JSON.parse(readFileSync(0,"utf8")||"{}");
  if(id&&/^[0-9a-f]{64}$/.test(id))process.env.BNZ_AUCTION_ID=id; // §11 H1
  requireThat(/^[0-9a-f]{64}$/.test(id),"auction id");
  const file=path.join(dir,`${id}.json`);
  let ledger:Ledger, result:unknown;
  if(command==="init") {
    requireThat(!existsSync(file),"auction already exists");
    const {manifest:m}=client(input.manifest,input.signer);
    requireThat(m.auction_id===id && Date.now()/1000<m.T_submit,"auction init deadline");
    const ours=signRecord({},readFileSync(key,"utf8")).signer;
    requireThat(ours===input.signer,"local manifest signer");
    ledger={manifest:input.manifest,signer:input.signer,state:"OPEN",leaves:[],receipts:[],trace:[],...(input.witness_set?{witness_set:input.witness_set}:{})}; result={state:ledger.state};
  } else {
    ledger=JSON.parse(readFileSync(file,"utf8"));
    const {manifest:m,manifest_hash}=client(ledger.manifest,ledger.signer), now=Math.floor(Date.now()/1000);
    if(command==="admit") {
      requireThat(now<m.T_freeze && ledger.state==="OPEN","admission cutoff");
      requireThat(now<QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period,"round already passed");
      const {ct,memo_tag}=ciphertext(input.envelope_hex,m.drand.R);
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
        ledger.leaves.push({...receipt,ciphertext_hex:ct,...(memo_tag!==null?{memo_envelope_tag:memo_tag}:{})}); const signed=signRecord(receipt,readFileSync(key,"utf8")); ledger.receipts.push(signed); result={replay:false,receipt:signed};
        // R6 (W): the owner-signed settlement envelope record is admitted with the bid and published; its
        // plaintext destination never leaves the bidder's client (design phase5-part1-live §4).
        // R7 item 3 (R F-4 = G3), R12 item 1: the envelope record must satisfy the one shared rule
        // (envelope/index.ts envelopeRecordValid) — exact v2 n = 3 shape with the manifest's `envelope_keys` as
        // stanza recipients in order, or the pre-v2 box where the manifest pins no keys — checked here at intake
        // with the same rule settlement and verify use, so a malformed record can never enter a published
        // directory. A bid carrying no envelope (empty/absent fields) is admitted without a record; its refund is
        // handled by the exception queue.
        if(input.envelope_ct_hex) {
          requireThat(envelopeRecordValid({envelope_ct:input.envelope_ct_hex,owner_sig:input.owner_sig_hex},m.envelope_keys),"envelope record shape");
          // R16 item 2: the record must be the envelope the deposit's memo committed to — the depositor's
          // memo is the only pre-R authenticator, so a record whose envelope tag (first 18 bytes of
          // SHA-256(envelope_ct), R18) differs from the memo's tag (or a v1 memo that binds nothing) is
          // refused at intake.
          requireThat(memoBindsEnvelope(memo_tag,input.envelope_ct_hex),"envelope record not bound to the deposit memo");
          (ledger.envelopes??=[]).push({ciphertext_hash,envelope_ct:input.envelope_ct_hex,owner_sig:input.owner_sig_hex});
        }
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
      });
      if(m.sealed_reserve!==undefined) {
        // Gate CF: the manifest's sealed price bound opens at R with the bids and feeds the clear below.
        ledger.trace.push({operation:"tle -d reserve",time:now});
        const reserveOpen=spawnSync(path.join(state,"bin","tle"),["-d","-c",QUICKNET.chain_hash],{input:Buffer.from(m.sealed_reserve,"hex"),maxBuffer:1<<20});
        appendFileSync(path.join(state,"run","auction-cli.log"),`\ntle -d reserve\n${reserveOpen.stderr??""}`);
        if(reserveOpen.error)throw reserveOpen.error;
        requireThat(reserveOpen.status===0,`tle reserve opening failed: ${(reserveOpen.stderr??Buffer.alloc(0)).toString().trim().slice(-300)}`);
        ledger.reserve_opening=reserveOpen.stdout.toString("hex");
      }
      ledger.state="OPENED"; result={opened:ledger.opened,trace:ledger.trace};
    } else if(command==="clear") {
      requireThat(ledger.state==="OPENED" || ledger.state==="CLEARED","clearing state");
      ledger.result=clearForMode({manifest:ledger.manifest,signer:ledger.signer,frozen:ledger.frozen!,opened:ledger.opened!,reserve_opening:ledger.reserve_opening??null,launch:(ledger as any).launch_input}); ledger.state="CLEARED"; result=ledger.result;
    } else if(command==="deliver") {
      // Part 2 launch: a winner's owner-signed token-chain destinations, recorded before the clear (clearLaunch checks
      // the signature against the opened owner key and the count against the fill; checked here early too).
      requireThat(ledger.state==="OPENED","launch delivery records are taken after opening, before the clear");
      requireThat(input && Number.isInteger(input.leaf_index) && Array.isArray(input.destinations) && /^[0-9a-f]{128}$/.test(input.signature),"launch delivery record");
      const pt=ledger.opened!.find((o:any)=>o.leaf_index===input.leaf_index)?.plaintext_hex;requireThat(pt,"launch delivery for an unopened leaf");
      requireThat(verifyStatement(Buffer.from(pt!,"hex").subarray(61,93).toString("hex"),{auction_id:id,leaf_index:input.leaf_index,destinations:input.destinations},input.signature),"launch delivery owner signature");
      const li=(ledger as any).launch_input??{};li.delivery=[...(li.delivery??[]).filter((r:any)=>r.leaf_index!==input.leaf_index),{leaf_index:input.leaf_index,destinations:input.destinations,signature:input.signature}].sort((a:any,b:any)=>a.leaf_index-b.leaf_index);
      (ledger as any).launch_input=li;result={recorded:input.leaf_index,delivery:li.delivery.length};
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
