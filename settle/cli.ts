// CLI coordinator. Signer routing is private, pinned before funding; no recipient input is accepted at run/sign time.
import {copyFileSync,existsSync,fsyncSync,mkdirSync,openSync,closeSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {spawn,spawnSync} from "node:child_process";
import path from "node:path";
import {hash,jsonBytes,requireThat,verifyRecord} from "../manifest/schema";
import {clientCommon as client} from "../clear/registry"; // design §6.1: every registry mode
import {agreedBatchMaps} from "../witness";
import {treasuryBlock} from "../clear/mode-b";
import {Ledger,type Row} from "./ledger";
import {classifyBuildAttempts,onePoolRefusal,type BuildOutcome} from "./build-outcome";
import {ROOT,STATE,bin,env,run,wallet,pczt,inspect,monetary,notes,prove,mined,chainTx,isTransientGrpc,lwdEndpoints,timing} from "./io";
import {pubkey,zcashSign,withSigningLock} from "./sign";
import {envelopeRecipient,memoEnvelopeRecipient,ownEnvelopePrivate,openDestination} from "./envelopes";
import {fetchVerifiedBeacon,publishedClient} from "../cli/published-beacon";
import type {ChainClient} from "tlock-js";
import {partyNote,reserveUnspent,walletSpendable} from "./deposits";
// B54 (P3-2): the one candidate check on the non-custody path too (cli/host-derive.ts reserveCandidateVerdict).
import {reserveCandidateVerdict} from "../cli/host-derive";
import { vaultDir, pcztBin } from "../manifest/paths";
const [command,id,arg1,arg2,arg3,arg4,arg5]=process.argv.slice(2);
// §11 H1: every vault use for this auction resolves to its own per-auction vault when it ran its own DKG.
if(id&&/^[0-9a-f]{64}$/.test(id))process.env.BNZ_AUCTION_ID=id;
const dir=path.join(STATE,"settle",id??""),file=(n:string)=>path.join(dir,n);
const read=(n:string)=>JSON.parse(readFileSync(file(n),"utf8"));
const settings=()=>existsSync(path.join(STATE,"product",`${id}.json`))?JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8")).settlement:{signers:["alice","bob"],pczt_expiry_blocks:364,batch_cap:13};
const auction=()=>JSON.parse(readFileSync(path.join(STATE,"auction",`${id}.json`),"utf8"));
// G-7: every benzo-pczt call takes the network from the signed manifest — never a hardcoded default
const manifestNet=()=>client(auction().manifest,auction().signer).manifest.network as string;
type ResolvedRow=Row&{recipient?:string;reason?:string};
async function destinations(rows:Row[],name:string,plan:{opened:any[]|null;claim_envelopes?:Record<string,string>;envelope_agreed?:Record<string,string>}):Promise<ResolvedRow[]> {
  const route=read(`routing-${name}.json`),observed=notes(manifestNet());
  requireThat(hash(jsonBytes(route))===read("routing-commitment.json").sha256,"signer routing changed after intake");
  // R6 (W): in product mode a bid's destination comes only from its owner-signed settlement envelope, opened
  // with the signer's own key; operator routing pins only the non-bid sinks (seller, stray refunds).
  const product=existsSync(path.join(STATE,"product",`${id}.json`));
  // R7 (Reviewer R F-3 = Reviewer G G1): product destinations resolve ONLY from the signer's own fresh
  // openings (settle/plan.ts) and the published auction.json envelope records. The coordinator's private
  // ledger is cross-checked against both and refused on any difference; it is never consulted as a source.
  let a:any;
  if(product) {
    const config=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
    const doc=JSON.parse(readFileSync(path.join(path.resolve(config.public_dir),"auction.json"),"utf8"));
    const ledgerDoc=auction();
    requireThat(jsonBytes(ledgerDoc.opened??null).equals(jsonBytes(plan.opened??null)),"private ledger opening differs from signer-derived opening");
    requireThat(jsonBytes(ledgerDoc.envelopes??[]).equals(jsonBytes(doc.envelopes??[])),"private ledger envelope records differ from published records");
    a={manifest:doc.manifest,frozen:doc.frozen,opened:plan.opened,envelopes:doc.envelopes,...(doc.beacon?{beacon:doc.beacon}:{})};
  } else a=auction();
  // B43 (item 3): the beacon for stray-memo openings (lazy): the published/ledger beacon when the auction
  // carries one (publishedClient BLS-checks it), else the round-R beacon from the shared failover-plus-verify
  // fetch. Built per row inside its own try, so a beacon outage parks that row, never the batch.
  let beaconClient:ChainClient|null=null;
  const memoBeacon=async():Promise<ChainClient>=>beaconClient??=publishedClient((a as any).beacon??await fetchVerifiedBeacon(client(auction().manifest,auction().signer).manifest.drand.R));
  return Promise.all(rows.map(async (row):Promise<ResolvedRow>=> {
    // R16 item 1 (Reviewer R F4): destinations() never throws for a single row. An unresolvable row comes
    // back with its reason and no recipient; the worker turns it into an exception row and the batch
    // proceeds with the rows that resolve.
    try {
    // R7 item 4 + R15 item 3: a claim-promoted row's destination is sealed in its claim envelope and opened
    // here with THIS signer's own key (with the R10 item 4 agreed-hash cross-check) — signer-derived like
    // every other destination, never operator input.
    const claimCt=plan.claim_envelopes?.[row.party];
    if(claimCt) {
      const recipient=openDestination({ciphertext_hash:hash(Buffer.from(claimCt,"hex")),envelope_ct:claimCt,owner_sig:""},ownEnvelopePrivate(STATE,name)??"",manifestNet());
      if(recipient) {const ua=recipient.reveal();requireThat(plan.envelope_agreed?.[row.party]===hash(Buffer.from(ua,"utf8")),"this signer's opening differs from the agreed envelope destination");return {...row,recipient:ua}}
      return {...row,reason:`claim envelope refused: this signer's key does not open it (party ${row.party}; refund waits in the exception queue)`};
    }
    // R10 item 2 (design §4): a product-mode refund whose bid carries a validated v2 envelope is paid to the
    // envelope's destination, opened here with THIS signer's own key — never an operator-chosen or
    // coordinator-pinned destination. A row whose envelope this signer cannot open is an exception row with
    // its reason, never a throw (R12 item 3); the row is claimable through benzo claim-refund.
    if(product&&row.party.startsWith("leaf:")) {
      const recipient=envelopeRecipient(a,Number(row.party.slice(5)),ownEnvelopePrivate(STATE,name)??"");
      if(recipient) {const ua=recipient.reveal();requireThat(plan.envelope_agreed?.[row.party]===hash(Buffer.from(ua,"utf8")),"this signer's opening differs from the agreed envelope destination");return {...row,recipient:ua}}
      return {...row,reason:`envelope destination refused: this signer's key does not open the envelope (party ${row.party}; refund waits in the exception queue)`};
    }
    // Design §6.1: the buyback treasury return goes to the signed manifest's treasury_ua, never to routing.
    if(row.party==="treasury") return {...row,recipient:treasuryBlock(client(auction().manifest,auction().signer).manifest)!.treasury_ua};
    const address=row.party.startsWith("leaf:")?a.frozen.leaves[Number(row.party.slice(5))].deposit.address:
      partyNote(observed,row.party)?.address;
    // R7 item 6 (Reviewer G G6) + R10 item 2: a product-mode stray or cancelled deposit resolves through its
    // own memo-bound owner-signed envelope (opened with this signer's key) or its owner-signed claim; there
    // is no operator-chosen destination.
    if(product&&row.party!=="seller") {
      const recipient=await memoEnvelopeRecipient(observed,row.party,(a as any).manifest,(a as any).envelopes,await memoBeacon(),ownEnvelopePrivate(STATE,name)??"");
      if(recipient) {const ua=recipient.reveal();requireThat(plan.envelope_agreed?.[row.party]===hash(Buffer.from(ua,"utf8")),"this signer's opening differs from the agreed envelope destination");return {...row,recipient:ua}}
      return {...row,reason:`stray refund refused: no owner-signed settlement envelope or claim (party ${row.party}; claim it with benzo claim-refund or leave it in the exception queue)`};
    }
    const recipient=row.party==="seller"?route.seller_ua:
      // B46 (H15): the reserve-return row pays the routing config's reserve_return_ua (the signed manifest
      // commits its hash; the hosts check it there). Non-host-custody routing pins it like the seller_ua.
      row.party==="reserve-return"?(route as any).reserve_return_ua:route.bidders.find((b:any)=>b.deposit_ua===address)?.refund_ua;
    requireThat(recipient,"missing independently pinned settlement recipient");return {...row,recipient};
    } catch(e) {return {...row,reason:(e as Error).message}}
  }));
}
// F4 (R28): the per-output routing bit is computed from the pinned routing, never asserted as a constant.
// Change outputs are not part of the pinned settlement routing and compute false.
const routedInspect=(i:any,expected:{recipient?:string;amount_zats:string}[])=>({...i,outputs:i.outputs.map((o:any)=>({...o,matches_pinned_routing:!o.is_change&&expected.some(e=>e.recipient===o.recipient&&e.amount_zats===o.amount_zats)}))});
async function check(ledger:Ledger,batch:number,candidate:string,name:string,randomizer?:string,sighash?:string) {
  requireThat(["alice","bob","carol"].includes(name),"unknown signer");
  const plan=monetary(id),rows=ledger.rows().filter(o=>o.batch===batch);
  const independentlyExpected=rows.map(row=> {
    // B46 (H15): the reserve-return row is checked against the plan's own reserve_return derivation (the same
    // fresh signer clearing as every obligation row).
    const obligation=plan.obligations.find((p:any)=>p.party===row.party)??(row.party==="reserve-return"?plan.reserve_return??null:null);
    requireThat(obligation&&obligation.amount_zats===row.amount_zats&&obligation.kind===row.kind,"batch row differs from fresh signer clearing");
    return {...row,...obligation};
  });
  const expected=(await destinations(independentlyExpected,name,plan)).filter(o=>o.recipient),i=inspect(candidate,manifestNet());
  // B54 (P3-2, Reviewer R round 5): the non-custody path pins the reserve-return candidate exactly as the
  // host paths do (cli/host-derive.ts reserveCandidateVerdict) — before anything is signed. A candidate
  // that carries change (or any other shape than the one-row sweep the row describes) is refused here;
  // before this, check() accepted a change-carrying return candidate and the kept accounting then threw
  // post-broadcast on every re-run (the settlement could never publish).
  const returnRow=rows.find(o=>o.party==="reserve-return");
  if(returnRow) {
    const route0=read(`routing-${name}.json`);
    const why=reserveCandidateVerdict(i,(route0 as any).reserve_return_ua,plan.reserve_return?.remaining_zats,returnRow.amount_zats);
    if(why)throw Error(why);
  }
  const outputs=i.outputs.filter((o:any)=>!o.is_change);
  requireThat(outputs.length===expected.length,"PCZT recipient count differs from result");
  const routed:boolean[]=[];
  for(const e of expected) {
    const index=outputs.findIndex((o:any)=>o.recipient===e.recipient&&o.amount_zats===e.amount_zats);
    routed.push(index>=0);
    requireThat(index>=0,"PCZT amount differs from result.json");outputs.splice(index,1);
  }
  requireThat(i.input_zats===i.output_zats+i.fee_zats,"PCZT fee conservation");
  requireThat(!randomizer || i.shielded_sighash===sighash,"coordinator digest differs from checked PCZT");
  return {sighash:i.shielded_sighash,participant:name,pubkey:pubkey(name),randomizer:randomizer??null,checked_at:Date.now(),result_hash:plan.result_hash,manifest_hash:plan.manifest_hash,pczt_hash:hash(readFileSync(candidate)),matches_pinned_routing:routed.length===expected.length&&routed.every(Boolean),fee_zats:i.fee_zats,checks:plan.checks};
}
function guard(metadata:any,tip:number) {
  requireThat(metadata.expiry_height>tip,"expired PCZT; refusing broadcast");
  // Published testnet height in ZIP 214; expiry must not straddle the next consensus branch. R33 P2-1: the
  // straddle guard is testnet-only (mainnet's activation height is not set; settle/src/main.rs agrees).
  if(manifestNet()==="test")requireThat(!(tip<4465026&&metadata.expiry_height>=4465026),"PCZT expiry reaches NU7 activation; refusing create/broadcast");
}
// §11 H3/H4 (host custody): build the batch packet, have each preferred signer host approve it from its own data,
// sign with two approving hosts, and on a mid-session failure (the kill drill) record the abandoned session and
// re-plan the SAME batch with the next host that approves. A host that failed is not asked again for this batch.
// §11 H6: the first preferred signer host that can derive every allocated row builds and proves the candidate on its
// own vault; the coordinator receives only the REDACTED proven PCZT (H7) and {party, output_index} (recipients stay on the hosts).
// Reviewer G's G-5: before allocation, the first preferred host that answers lists the {party, amount} rows it derives
// from its own data (`sign derivable`, no recipients). A row no host derives is pinned to the exception queue with its
// reason instead of being allocated into a batch no host could build.
function hostDerivable():{rows:Set<string>;refused:Map<string,string>}|null {
  const cfg=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
  const publicDir=path.resolve(cfg.public_dir),doc=JSON.parse(readFileSync(path.join(publicDir,"auction.json"),"utf8"));
  const packet=file("derivable");run("rm",["-rf",packet]);mkdirSync(packet,{recursive:true,mode:0o700});run("cp",["-R",publicDir,path.join(packet,"public")]);
  if(existsSync(file("claims.json")))copyFileSync(file("claims.json"),path.join(packet,"claims.json"));
  writeFileSync(path.join(packet,"packet.json"),jsonBytes({auction_id:id,signer:doc.signer,seller_ua:cfg.routing?.seller_ua??null,reserve_return_ua:cfg.routing?.reserve_return_ua??null}),{mode:0o600});
  const remote=`derivable-${id.slice(0,16)}`;
  for(const n of [...settings().signers,...["alice","bob","carol"].filter(n=>!settings().signers.includes(n))]) {
    if(spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","rm","-rf",`/home/benzo/${remote}`],{timeout:120_000,killSignal:"SIGKILL"}).status!==0)continue;
    if(spawnSync("orbctl",["push","-m",`benzo-${n}`,packet,remote],{timeout:120_000,killSignal:"SIGKILL"}).status!==0)continue;
    spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","chown","-R","benzo:benzo",`/home/benzo/${remote}`],{timeout:120_000,killSignal:"SIGKILL"});
    const r=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","/home/benzo/.benzo/bin/benzo","sign","derivable","--id",id,"--packet",`/home/benzo/${remote}`,"--name",n],{encoding:"utf8",maxBuffer:64<<20,timeout:15*60_000,killSignal:"SIGKILL"});
    if(r.status!==0){console.error(`ERROR signer ${n} could not list derivable rows: ${(r.stderr||"").trim().slice(-200)}`);continue}
    const out=JSON.parse(r.stdout.trim().split("\n").filter(l=>l.startsWith("{")).at(-1)!);
    // H21 (B50): a listing may tag a row refused (typed — `refused: true` with its reason, e.g. the H10
    // seller mismatch): the tagged rows do NOT derive, and their reason rides to the exception queue so
    // the refunds still pay while the refused row waits.
    const rows=new Set<string>(),refused=new Map<string,string>();
    for(const x of out.rows as any[]) {
      if(x.refused)refused.set(`${x.party}:${x.amount_zats}`,String(x.reason??"refused by the signer host"));
      else rows.add(`${x.party}:${x.amount_zats}`);
    }
    // P3-4 (B52, Reviewer R round 4): `sign derivable`'s TOP-LEVEL refused_rows (the reserve-return refusal
    // that is not a per-row tag) rides into the same refused map, keyed by party alone — so the reserve row
    // parks with the host's true reason, never the generic "claimable through benzo claim-refund" (it is
    // not claimable; it waits for the tool's sweep quote and the paid gate).
    for(const name of (out.refused_rows??[]) as string[])if(typeof name==="string")
      refused.set(name,String((out.refused_reasons??{})[name]??"refused by the signer host"));
    return {rows,refused};
  }
  return null;
}
async function hostBuild(batchId:number,rows:{party:string;kind:string;amount_zats:string}[],proven:string) {
  // R28 liveness: hosts approve each deposit in at most one live candidate, so a retry after a failed signing reuses
  // the candidate already built for this batch (same txid, which the hosts' ledgers accept again) while it is valid,
  // instead of building a new one the hosts must refuse until the first expires.
  const prior=file(`batch-${batchId}.build.json`);
  if(existsSync(prior)&&existsSync(proven)&&["alice","bob","carol"].every(s=>existsSync(file(`batch-${batchId}.sealed-${s}.bin`)))) {
    const b=JSON.parse(readFileSync(prior,"utf8")),tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
    if(hash(readFileSync(proven))===b.plan_version&&inspect(proven,manifestNet(),true).expiry_height>tip+20&&jsonBytes(b.outputs.map((o:any)=>o.party).sort()).equals(jsonBytes(rows.map(r=>r.party).sort())))return b;
  }
  const cfg=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
  const publicDir=path.resolve(cfg.public_dir),doc=JSON.parse(readFileSync(path.join(publicDir,"auction.json"),"utf8"));
  const packet=file(`build-${batchId}`);
  run("rm",["-rf",packet]);mkdirSync(packet,{recursive:true,mode:0o700});run("cp",["-R",publicDir,path.join(packet,"public")]);
  if(existsSync(file("claims.json")))copyFileSync(file("claims.json"),path.join(packet,"claims.json"));
  writeFileSync(path.join(packet,"rows.json"),jsonBytes(rows),{mode:0o600});
  // B46 (H15, Revision R103): the reserve-return batch's packet names the row's amount and the return UA, so
  // every host checks it against its own derivation (cli/host-derive.ts deriveReserveReturn) and the
  // candidate's input_zats against its own scanned unspent total.
  const rr=(rows as any[]).find((r:any)=>r.party==="reserve-return");
  writeFileSync(path.join(packet,"packet.json"),jsonBytes({auction_id:id,batch:batchId,signer:doc.signer,seller_ua:cfg.routing?.seller_ua,expiry_blocks:settings().pczt_expiry_blocks,
    reserve_return_ua:cfg.routing?.reserve_return_ua??null,...(rr?{reserve_row:{amount_zats:rr.amount_zats}}:{})}),{mode:0o600});
  const prefer=[...settings().signers,...["alice","bob","carol"].filter(n=>!settings().signers.includes(n))];
  const remote=`build-${id.slice(0,16)}-${batchId}`;
  // R45 (F20): a host counts as refusing only on its TYPED refusal (sign build exit 3 with the rows it cannot derive);
  // a timeout, kill or any other failure is "unreachable" and the batch is retried, never condemned. The pure
  // classification lives in settle/build-outcome.ts (the R45 lab repro drives it).
  const attempts:BuildOutcome[]=[];
  for(const n of prefer) {
    if(spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","rm","-rf",`/home/benzo/${remote}`],{timeout:120_000,killSignal:"SIGKILL"}).status!==0)continue;
    if(spawnSync("orbctl",["push","-m",`benzo-${n}`,packet,remote],{timeout:120_000,killSignal:"SIGKILL"}).status!==0)continue;
    spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","chown","-R","benzo:benzo",`/home/benzo/${remote}`],{timeout:120_000,killSignal:"SIGKILL"});
    // A22 live-run defect (the b5b3b38 class): orb can stall and ignores SIGTERM, so a spawnSync without a
    // SIGKILL bound waits forever (a `rm -rf` stalled 50 min and orphaned a funded settle). Every orb/orbctl
    // call here is bounded with SIGKILL — an unreachable host fails loudly and the batch flow moves on.
    const b=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","/home/benzo/.benzo/bin/benzo","sign","build","--id",id,"--batch",String(batchId),"--packet",`/home/benzo/${remote}`,"--name",n],{encoding:"utf8",maxBuffer:64<<20,timeout:15*60_000,killSignal:"SIGKILL"});
    if(b.status!==0){
      attempts.push({status:b.status,stderr:b.stderr??""});
      console.error(`ERROR signer ${n} could not build batch ${batchId}: ${(b.stderr||"").trim().slice(-200)}`);continue;
    }
    const built=JSON.parse(b.stdout.trim().split("\n").filter(l=>l.startsWith("{")).at(-1)!);
    // §11 H7: pull only the redacted candidate and the sealed full copies; the full candidate never reaches here.
    const pulled=file(`batch-${batchId}.pulled.pczt`);
    run("rm",["-f",pulled]);
    requireThat(spawnSync("orbctl",["pull","-m",`benzo-${n}`,`${remote}/proven.redacted.pczt`,pulled],{timeout:120_000,killSignal:"SIGKILL"}).status===0&&existsSync(pulled),`could not pull the candidate from ${n}`);
    requireThat(hash(readFileSync(pulled))===built.plan_version,"pulled candidate differs from the builder's plan_version");
    for(const s of ["alice","bob","carol"]) {
      const f=file(`batch-${batchId}.sealed-${s}.bin`);run("rm",["-f",f]);
      requireThat(spawnSync("orbctl",["pull","-m",`benzo-${n}`,`${remote}/sealed-${s}.bin`,f],{timeout:120_000,killSignal:"SIGKILL"}).status===0&&existsSync(f),`could not pull the candidate sealed to ${s}`);
    }
    copyFileSync(pulled,proven);
    writeFileSync(file(`batch-${batchId}.build.json`),jsonBytes(built),{mode:0o600});
    // H3 (B50): the one-pool rule (R81) also on the coordinator side of the custody build, as the same typed
    // set-aside the hosts give it (defense in depth — `sign build` refuses a two-pool candidate first): the
    // minority pool's rows are named and wait in the exception queue; the batch's other rows settle next.
    const namedPools=onePoolRefusal((built.outputs??[]).map((o:any)=>({party:String(o.party),pool:String(o.pool)})));
    if(namedPools.length)throw Object.assign(Error(`the built batch ${batchId} pays more than one pool (one-pool rule, R81)`),{unbuildable:true,isolate:false,refusedRows:namedPools,onePool:true});
    return built;
  }
  // R44 (F16) + Ruling R45 (F20): unbuildable only when EVERY reached host gave a typed refusal; the rows to
  // set aside are the ones no reached host derives (the intersection).
  const {unbuildable,isolate,refusedRows}=classifyBuildAttempts(attempts,rows.map(r=>r.party));
  // P3-8a: when every typed refusal IS the one-pool rule, the set-aside carries the local build's one-pool
  // reason (the catch below maps it) instead of the generic "no reachable signer host builds it" one.
  const onePool=unbuildable&&attempts.every(a=>a.status!==3||/more than one pool/.test(a.stderr||""));
  throw Object.assign(Error(`no signer host could build batch ${batchId}`),{unbuildable,isolate,refusedRows,onePool});
}
async function hostSign(batchId:number,proven:string,signed:string,groupKey:string,reserveRow?:{amount_zats:string}|null) {return withSigningLock(()=>hostSignLocked(batchId,proven,signed,groupKey,reserveRow))}
async function hostSignLocked(batchId:number,proven:string,signed:string,groupKey:string,reserveRow?:{amount_zats:string}|null) {
  const cfg=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
  const publicDir=path.resolve(cfg.public_dir),doc=JSON.parse(readFileSync(path.join(publicDir,"auction.json"),"utf8"));
  const packet=file(`packet-${batchId}`);
  run("rm",["-rf",packet]);mkdirSync(packet,{recursive:true,mode:0o700});run("cp",["-R",publicDir,path.join(packet,"public")]);
  copyFileSync(proven,path.join(packet,"candidate.pczt"));
  for(const s of ["alice","bob","carol"])copyFileSync(file(`batch-${batchId}.sealed-${s}.bin`),path.join(packet,`sealed-${s}.bin`));
  if(existsSync(file("claims.json")))copyFileSync(file("claims.json"),path.join(packet,"claims.json"));
  writeFileSync(path.join(packet,"packet.json"),jsonBytes({auction_id:id,batch:batchId,plan_version:hash(readFileSync(proven)),signer:doc.signer,seller_ua:cfg.routing?.seller_ua??null,
    reserve_return_ua:cfg.routing?.reserve_return_ua??null,...(reserveRow?{reserve_row:reserveRow}:{})}),{mode:0o600}); // R28 item 8 (G-2): the seller output must pay this
  const server=process.env.BNZ_FROSTD_HOST??`host.orb.internal:${env("BNZ_FROSTD_ADDR").split(":").at(-1)}`;
  const prefer=[...settings().signers,...["alice","bob","carol"].filter(n=>!settings().signers.includes(n))];
  const failed=new Set<string>(),events:any[]=[],maps:Record<string,any>={};
  // Phase 6: the hosts approve in parallel (each derives and checks on its own machine; ~20 s each, serial before).
  const orbAsync=(args:string[],timeout=0)=>new Promise<{status:number|null;stdout:string;stderr:string}>(resolve=>{
    const c=spawn("orb",args);let stdout="",stderr="";c.stdout.on("data",d=>stdout+=d);c.stderr.on("data",d=>stderr+=d);
    const t=timeout?setTimeout(()=>c.kill("SIGKILL"),timeout):undefined;
    c.on("error",e=>{stderr+=String(e);});c.on("close",code=>{if(t)clearTimeout(t);resolve({status:code,stdout,stderr})});
  });
  // frostd lets only a session's coordinator close it, and `sessions --close-all` stops at the first session the host
  // may not close; so every host (the failed one too, best effort) runs it, in rounds, until none lists a session
  // (R29 review P1). Hosts share one contact key across auctions, so this also clears other auctions' leftovers.
  const closeStale=(pair:string[])=>{
    let failing:string[]=[];
    for(let round=0;round<4;round++){
      failing=[];
      for(const n of ["alice","bob","carol"]){
        const r=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","env","SSL_CERT_FILE=/home/benzo/.benzo/tls/rootCA.pem","/home/benzo/.benzo/bin/frost-client","sessions","-c",`/home/benzo/.benzo/auctions/${id}/frost.toml`,"-s",server,"--close-all"],{encoding:"utf8",timeout:120_000,killSignal:"SIGKILL"});
        if(r.status!==0)failing.push(n); // exit 0: every session it listed was closed
      }
      if(!failing.length)return;
    }
    // R33 P2-2: never give up silently. A host that cannot close its own sessions (usually: unreachable) is named;
    // if it is in the signing pair the attempt cannot work, otherwise the pair's joins will name any leftover count.
    console.error(`ERROR stale FROST sessions could not be closed on ${failing.join(",")} (unreachable or sessions owned by an unreachable coordinator)`);
    requireThat(!failing.some(n=>pair.includes(n)),`signing pair host ${failing.filter(n=>pair.includes(n)).join(",")} cannot close its stale FROST sessions`);
  };
  const approve=async(n:string):Promise<boolean>=>{
    const remote=`packet-${id.slice(0,16)}-${batchId}`;
    const r=await orbAsync(["run","-m",`benzo-${n}`,"-u","root","rm","-rf",`/home/benzo/${remote}`],120_000);
    if(r.status!==0){events.push({signer:n,approve:"unreachable"});return false}
    if(spawnSync("orbctl",["push","-m",`benzo-${n}`,packet,remote],{encoding:"utf8",timeout:120_000,killSignal:"SIGKILL"}).status!==0){events.push({signer:n,approve:"push failed"});return false}
    await orbAsync(["run","-m",`benzo-${n}`,"-u","root","chown","-R","benzo:benzo",`/home/benzo/${remote}`],120_000);
    const tA=Date.now();
    const a=await orbAsync(["run","-m",`benzo-${n}`,"-u","benzo","/home/benzo/.benzo/bin/benzo","sign","approve","--id",id,"--batch",String(batchId),"--packet",`/home/benzo/${remote}`,"--name",n],15*60_000);
    timing({auction:id,batch:batchId,phase:"host-approve",signer:n,ms:Date.now()-tA,ok:a.status===0});
    events.push(a.status===0?{signer:n,approve:"approved"}:{signer:n,approve:"refused",detail:(a.stderr||"").trim().slice(-200)});
    if(a.status===0){try{maps[n]=JSON.parse(a.stdout.trim().split("\n").filter(l=>l.startsWith("{")).at(-1)!).map??null}catch{maps[n]=null}}
    if(a.status!==0)console.error(`ERROR signer ${n} refused batch ${batchId}: ${(a.stderr||"").trim().slice(-200)}`);
    return a.status===0;
  };
  for(let attempt=1;attempt<=3;attempt++) {
    const pair:string[]=[];
    const pool=prefer.filter(n=>!failed.has(n));
    while(pair.length<2&&pool.length){const take=pool.splice(0,2-pair.length),ok=await Promise.all(take.map(approve));take.forEach((n,i)=>ok[i]?pair.push(n):failed.add(n))}
    pair.sort((a,b)=>prefer.indexOf(a)-prefer.indexOf(b)); // the first preferred approving host coordinates
    requireThat(pair.length===2,`fewer than two signer hosts approve batch ${batchId}`);
    // Under the signing lock no other round is live, so any session a host still has is stale (an abandoned round of
    // this or another auction) and would make a join see the wrong session count: close them all first.
    closeStale(pair);
    try {
      const signing=await zcashSign(proven,signed,()=>{},pair,id,batchId,{id,groupKey,server,network:manifestNet()});
      writeFileSync(file(`batch-${batchId}.custody.json`),jsonBytes({pair,events,attempts:attempt}),{mode:0o600});
        writeFileSync(file(`batch-${batchId}.maps.json`),jsonBytes(pair.map(n=>maps[n]??null)),{mode:0o600}); // G-4: the signing pair's signed maps
      return signing;
    } catch(e) {
      const lost=(e as any).failedSigners??[];
      events.push({abandoned_session:{pair,failed:lost,reason:String((e as Error).message).slice(0,200)}});
      console.error(`ERROR signing session abandoned (batch ${batchId}, pair ${pair.join("+")}, failed ${lost.join(",")||"?"}); re-planning with the next approving host`);
      for(const n of lost)failed.add(n);
      if(!lost.length)throw e;
      // frostd keeps the abandoned sessions (24 h); a survivor would then list too many and refuse to join. Close them
      // on every reachable host — including a failed coordinator, the only one frostd lets close its sessions.
      closeStale(prefer.filter(n=>!failed.has(n)).slice(0,2));
    }
  }
  throw Error(`batch ${batchId} could not be signed by two hosts`);
}
async function worker(ledger:Ledger) {
  const plan=monetary(id);
  for(const r of plan.refusals??[])console.error(`ERROR refund ${r.party} to the exception queue: ${r.reason}`);
  // R16 item 1 (Reviewer R F4): an unresolvable row becomes an exception row and the batch proceeds — the
  // rows that resolve are pinned payable, the rest wait in the queue with their reason.
  const custody=existsSync(path.join(STATE,"vaults",id,"keys.json"));
  // B46 (H15, Revision R103): the plan's final `reserve-return` row — it exists only when the auction owes
  // NOTHING (the plan's one shared gate) and it pays the vault's whole unspent value minus the ZIP-317 fee.
  const reserve=plan.reserve_return??null;
  const planRows:any[]=[...plan.obligations,...(reserve?[reserve]:[])];
  // §11 H6: under host custody the coordinator holds no envelope key; the plan already gated every envelope refund on
  // host-signed agreement reports, and the recipients are derived on the hosts (sign build / sign approve).
  // Nothing payable (every row already an exception, e.g. a cancel before R) needs no host derivation.
  const listing=custody&&(plan.obligations.length||reserve)?hostDerivable():{rows:new Set<string>(),refused:new Map<string,string>()};
  if(custody&&(plan.obligations.length||reserve))requireThat(listing,"no signer host could list its derivable rows");
  // R44 (F16): rows of a batch every reachable host refused to build stay exceptions (monotone, never re-promoted).
  // R46 (F20 claimability, F25): rows no reached host can build are set aside for THIS run only (never persisted).
  // Every run re-derives every row through the derivable gate, so an owner's claim pays a set-aside refund on the
  // next settle and a payout re-derives as soon as a host can build it.
  const setAside=new Set<string>();
  const asideReason="set aside this run: no reachable signer host builds it; re-derived on the next settle (an owner claim makes a refund derivable)";
  // H3 (B50): a row set aside by the one-pool rule carries its own reason (the shared pinRows maps it) —
  // the SAME text on every build path (P3-8a: the custody path used to publish the generic reason).
  const onePoolReason="set aside this run: this batch's payments would span two pools (one-pool rule, R81); re-derived on the next settle";
  const asideReasons=new Map<string,string>();
  // B53 (P2-2): the rows of a mined batch parked for manual reconciliation carry its reason into the summary.
  const manualReason="manual reconciliation: pre-H3 two-pool batch (H2)";
  const manualReasons=new Map<string,string>();
  // B52 (H23): rows a pending mixed reserve-return batch carried are set aside as an exception with this
  // reason and re-plan; the reason rides into the summary for any that stay parked.
  const h23Reasons=new Map<string,string>();
  // P3-4 (B52): a refusal rides by (party, amount) from the in-row tag or by party alone from the
  // top-level refused_rows; the generic reason is only for a row no host named at all — and it is never
  // "claimable" for the reserve-return row (it waits for the tool's quote and the paid gate).
  const genericReason=(party:string)=>party==="reserve-return"
    ?"the reserve-return row is not derivable on any signer host (the tool's sweep quote refused or no host answered); it waits for the paid gate — it is not claimable"
    :"no signer host derives this row from its own data (claim or envelope missing or invalid); claimable through benzo claim-refund";
  const pinned:any[]=custody?planRows.map((o:any)=>setAside.has(o.party)?{...o,reason:asideReason}:listing!.rows.has(`${o.party}:${o.amount_zats}`)?{...o,recipient:"host-derived"}:{...o,reason:listing!.refused.get(`${o.party}:${o.amount_zats}`)??listing!.refused.get(o.party)??genericReason(o.party)}):(await destinations(planRows,settings().signers[0],plan));
  for(const o of pinned.filter(o=>!o.recipient))console.error(`ERROR refund ${o.party} to the exception queue: ${o.reason}`);
  // Ruling R42 (F15): each refund row carries its backing note identities into the ledger (keyed by note
  // identity: one note backs at most one refund row across all row classes) — the shared derivation's rows.
  const backing=new Map<string,string[]>((plan.balance_refunds??[]).map((r:any)=>[r.party,(r.notes??[])as string[]]));
  const keyed=(o:any)=>backing.has(o.party)&&backing.get(o.party)!.length?{...o,notes:backing.get(o.party)}:o;
  // R44 (F16): the first pin and every re-pin use these same arguments, so a re-pin can never promote a row the
  // derivable gate (G-5) or the unbuildable record parked.
  const pinRows=()=>{
    for(const o of pinned)if(setAside.has(o.party)&&o.recipient){delete o.recipient;o.reason=asideReasons.get(o.party)??asideReason;}
    ledger.pin(pinned.filter(o=>o.recipient).map(({party,kind,amount_zats})=>keyed({party,kind,amount_zats})),
      [...plan.exceptions,...pinned.filter(o=>!o.recipient).map(({party,kind,amount_zats,reason})=>keyed({party,kind,amount_zats,reason}))].map(keyed));
  };
  pinRows();
  ledger.eligible();
  // H19 (R105, docs/design/phase7-b47-settle-worker.md §1.3): the fee-reserve preflight. Before the first batch
  // of a run, compare the vault's spendable value with the remaining unpaid obligations plus a fee upper bound
  // of 5,000 x (spendable notes + remaining rows + 2 x remaining batches — each batch and the change re-spend
  // it adds). Short: stop before any broadcast and
  // before any host build with the exact top-up line — never fail inside a host build for this. Spendable is
  // the wallet's own rule: an unspent, positive-value note with the manifest's confirmations. The
  // reserve-return row never counts as an obligation (it pays itself out of the sweep), but its row and its
  // own batch do count in the fee bound. The top-up N is the exact shortfall plus a 10% margin
  // (shortfall + max(ceil(shortfall/10), 5,000), R109: one fee slot of slack so a small top-up never needs a second one). With only the self-funding return left there is nothing to reserve for:
  // the preflight is skipped and the return pass runs as before (its own failure is the spendable-change
  // case, not a fee shortfall).
  // B51 (P2-2): rows in a staged or broadcast batch and the notes that batch spent are excluded from both
  // sides (the `owned` rule below), so resuming an in-flight batch is never refused.
  {
    const m=client(auction().manifest,auction().signer).manifest as any;
    const tip=Number(JSON.parse(wallet("balance","--json")).chain_tip_height);
    // B51 (P2-2, Reviewer R's probe): mirror settle/plan.ts's `owned` rule here. A row whose batch is already
    // staged or broadcast is NOT a remaining obligation, and the notes that batch spent are excluded from
    // both the spendable value and the fee bound — the whole in-flight batch leaves both sides of the
    // comparison. Before this, a re-run whose only work was to confirm an in-flight batch counted its rows
    // as unpaid at full value while their funding notes had already left spendable value, and refused
    // "fee reserve short: pay N zats" demanding roughly the total that batch had already paid on chain.
    const owned=new Set<number>();
    for(const b of ledger.db.prepare("SELECT id FROM batches WHERE txid IS NOT NULL AND state!='exception'").all() as {id:number}[])owned.add(Number(b.id));
    const spendableNotes=notes(manifestNet()).filter((n:any)=>(n.spent_in_txid??null)===null&&walletSpendable(n)&&!!n.height&&tip-Number(n.height)+1>=m.confirmations);
    const spendableValue=spendableNotes.reduce((s:number,n:any)=>s+Number(n.value_zats),0);
    const unpaid=ledger.rows().filter(o=>["eligible","allocated"].includes(o.state)&&!(o.batch!==null&&owned.has(o.batch)));
    const obligationZats=unpaid.filter(o=>o.party!=="reserve-return").reduce((s,o)=>s+Number(o.amount_zats),0);
    const allocatedBatches=new Set(unpaid.filter(o=>o.batch!==null).map(o=>o.batch));
    const eligibleRows=unpaid.filter(o=>o.batch===null).length;
    const remainingBatches=allocatedBatches.size+Math.ceil(eligibleRows/settings().batch_cap);
    // B51 (P3, Reviewer R P3-1): the bound also counts ONE extra spend per remaining batch — each later
    // batch re-spends the previous batch's change note (an extra input is an extra action), which the old
    // bound never counted and could under-shoot by 5,000 x (batches-1) on a large run.
    const shortfall=obligationZats+5000*(spendableNotes.length+unpaid.length+remainingBatches*2)-spendableValue;
    if(shortfall>0&&unpaid.some(o=>o.party!=="reserve-return")) {
      const topUp=shortfall+Math.max(Math.ceil(shortfall/10),5000);
      let feeUa="";
      try {feeUa=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"))?.routing?.fee_reserve_ua??""} catch {}
      if(!feeUa) try {feeUa=JSON.parse(readFileSync(file(`routing-${settings().signers[0]}.json`),"utf8")).fee_reserve_ua??""} catch {}
      requireThat(typeof feeUa==="string"&&feeUa.length>0,"fee_reserve_ua is not pinned in the operator config or the signer routing");
      throw Error(`fee reserve short: pay ${topUp} zats to ${feeUa} and run benzo settle again`);
    }
  }
  const signoffs:any[]=existsSync(file("signoffs.json"))?read("signoffs.json"):[];
  let batch;
  let isolate=0; // R46 (F25): after a disjoint-refusal batch, the next rows are allocated one per batch
  while((batch=ledger.allocate(isolate>0?1:settings().batch_cap))) {
    if(isolate>0)isolate--;
    requireThat(batch.outputs.length>0,"allocated batch has no payable obligations");
    // B52 (H23, Reviewer R round 4 P2-2's note): the reserve-return row must be its own batch — and the
    // check runs BEFORE the batch is used, never after it was committed. settle/ledger.ts `allocate` keeps
    // new batches unmixed (the return is allocated alone, last); a PENDING mixed batch already in the
    // ledger (staged before this rule — every re-run resurfaced the old mid-loop throw) is set aside as an
    // exception with its reason and its rows re-plan in this run. No throw, exit 0.
    if(batch.outputs.some((o:any)=>o.party==="reserve-return")&&batch.outputs.length>1) {
      console.error(`ERROR batch ${batch.id}: reserve-return mixed with rows (H23); the batch is set aside as an exception and its rows re-plan`);
      for(const o of batch.outputs)h23Reasons.set(o.party,"reserve-return mixed with rows (H23)");
      ledger.expire(batch.id);pinRows();ledger.eligible();continue;
    }
    console.log(JSON.stringify({auction_id:id,batch:batch.id,allocated:batch.outputs.length}));
    const base=file(`batch-${batch.id}`),created=base+".pczt",proven=base+".proven.pczt",signed=base+".signed.pczt";
    // B54 (P2-1): the reserve-return batch's inspect record also carries the sweep's unspendable residue —
    // dust_notes (count) and dust_zats (value), the notes the wallet can never select
    // (settle/deposits.ts walletSpendable) that therefore stay in the vault. The kept accounting at
    // republish (below) reads them from THIS record — the ledger's own record of the paid batch — so the
    // published accounting is never re-derived from the emptied vault (H20 item 2). The first write wins:
    // a confirm re-write keeps the residue recorded when the batch was staged. Only the return batch
    // carries them; every other batch's record is unchanged.
    const isReturnBatch=batch.outputs.some((o:any)=>o.party==="reserve-return");
    const writeInspect=(record:any)=>{
      if(!isReturnBatch) {writeFileSync(base+".inspect.json",jsonBytes(record),{mode:0o600});return}
      let prior:any=null;try{prior=JSON.parse(readFileSync(base+".inspect.json","utf8"))}catch{prior=null}
      const dust=prior&&Number.isInteger(prior.dust_notes)&&/^[0-9]+$/.test(String(prior.dust_zats))
        ?{dust_notes:prior.dust_notes,dust_zats:String(prior.dust_zats)}
        :(()=>{const r=reserveUnspent(notes(manifestNet()));return{dust_notes:r.dust_notes,dust_zats:r.dust_zats}})();
      writeFileSync(base+".inspect.json",jsonBytes({...record,...dust}),{mode:0o600});
    };
    let staged=ledger.batch(batch.id)!;
    if(!staged.txid) {
      const custodyKeys=path.join(STATE,"vaults",id,"keys.json");
      if(custody) {
        // §11 H6: a signer host builds and proves the candidate from its own derivations; only {party, output_index} returns.
        {const t0=Date.now();
        try{await hostBuild(batch.id,batch.outputs.map(({party,kind,amount_zats}:any)=>({party,kind,amount_zats})),proven);}
        catch(e){
          const ex=e as any;
          if(!ex.unbuildable&&!ex.isolate)throw e; // a timeout, kill or non-typed failure: retried, as before R44
          if(ex.unbuildable||batch.outputs.length===1){
            // R46: the rows NO reached host builds (or the lone row of a singleton batch) are set aside for this run.
            const aside=ex.unbuildable?ex.refusedRows as string[]:[batch.outputs[0].party];
            for(const p of aside)setAside.add(p);
            // P3-8a: a set-aside the one-pool rule caused carries the local build's one-pool reason.
            if(ex.onePool)for(const p of aside)asideReasons.set(p,onePoolReason);
            console.error(`ERROR batch ${batch.id}: every reachable signer host refused ${aside.join(",")}; set aside this run (re-derived on the next settle), the other rows settle next`);
          } else {
            // R46 (F25): disjoint typed refusals — split the batch: its rows are retried one per batch.
            isolate=batch.outputs.length;
            console.error(`ERROR batch ${batch.id}: every reachable signer host refused, but no row by all of them; retrying its ${batch.outputs.length} rows one per batch`);
          }
          ledger.expire(batch.id);pinRows();ledger.eligible();continue;
        }
        timing({auction:id,batch:batch.id,phase:"host-build",ms:Date.now()-t0});}
        guard(inspect(proven,manifestNet(),true),JSON.parse(wallet("balance","--json")).chain_tip_height);
      } else {
        const resolved=(await destinations(batch.outputs,settings().signers[0],plan)).filter(o=>o.recipient);
        const payment=resolved.map(o=>({recipient:o.recipient!,amount_zats:o.amount_zats}));
        run(pcztBin(ROOT,STATE),["create",vaultDir(STATE),created,String(settings().pczt_expiry_blocks),"--network",manifestNet()],JSON.stringify(payment));
        const createdInfo=inspect(created,manifestNet());guard(createdInfo,JSON.parse(wallet("balance","--json")).chain_tip_height);
        // R81 (Reviewer R R-1 on R80): output_index is a per-bundle action index, and the host maps attribute outputs by
        // {party, output_index}. A batch whose payments span two pools would make that attribution ambiguous.
        // H3 (B50): the same one-pool rule as the host paths, but as an R46-style typed set-aside instead of the old
        // untyped throw that wedged the run — the minority pool's rows wait in the exception queue with their reason
        // (no funds move: nothing was signed) and the batch's other rows settle next.
        {
          const outs=createdInfo.outputs.filter((o:any)=>!o.is_change);
          const mappedPools:{party:string;pool:string}[]=[];
          for(const o of outs) {
            const row=resolved.find((p:any)=>p.recipient===o.recipient&&p.amount_zats===String(o.amount_zats)&&!mappedPools.some((m)=>m.party===p.party));
            if(row)mappedPools.push({party:row.party,pool:String(o.pool)});
          }
          const namedPools=onePoolRefusal(mappedPools);
          if(namedPools.length) {
            for(const p of namedPools) {
              setAside.add(p);
              asideReasons.set(p,onePoolReason);
            }
            console.error(`ERROR batch ${batch.id}: the candidate would pay more than one pool; ${namedPools.join(",")} set aside this run (one-pool rule R81), the other rows settle next`);
            ledger.expire(batch.id);pinRows();ledger.eligible();continue;
          }
        }
        await prove(created,proven);
      }
      const tSign=Date.now();
      const signing=custody?await hostSign(batch.id,proven,signed,JSON.parse(readFileSync(custodyKeys,"utf8")).group_key,batch.outputs.some((o:any)=>o.party==="reserve-return")?{amount_zats:String(batch.outputs.find((o:any)=>o.party==="reserve-return")!.amount_zats)}:null):await zcashSign(proven,signed,(name,randomizer,sighash)=> {
        const approved=JSON.parse(run(process.execPath,existsSync(path.join(STATE,"product",`${id}.json`))?[path.join(ROOT,"cli/dist/benzo.mjs"),"sign","inspect","--id",id,"--batch",String(batch!.id),"--candidate",proven,"--name",name,"--randomizer",randomizer,"--sighash",sighash]:[path.join(ROOT,"settle/dist/cli.mjs"),"check",id,String(batch!.id),proven,name,randomizer,sighash]));signoffs.push(approved);writeFileSync(file("signoffs.json"),jsonBytes(signoffs),{mode:0o600});
      },settings().signers,existsSync(path.join(STATE,"product",`${id}.json`))?id:undefined,batch.id,undefined,manifestNet()); // R38.7: the signed manifest's network
      timing({auction:id,batch:batch.id,phase:"sign",ms:Date.now()-tSign,spends:(signing as any).sessions?.length??null,custody});
      writeFileSync(base+".signatures.json",jsonBytes(signing),{mode:0o600});
      const fd=openSync(signed,"r");fsyncSync(fd);closeSync(fd);
      const df=openSync(dir,"r");fsyncSync(df);closeSync(df);
      const txid=run(bin("zcash-devtool"),["pczt","extract"],readFileSync(signed)).trim().split("\n").at(-1)!;
      ledger.stage(batch.id,signed,txid);writeInspect(custody?inspect(signed,manifestNet(),true):routedInspect(inspect(signed,manifestNet()),(await destinations(batch.outputs,settings().signers[0],plan)).filter(o=>o.recipient)));
    }
    staged=ledger.batch(batch.id)!;
    requireThat(staged.txid&&staged.pczt_path&&staged.pczt_hash===hash(readFileSync(staged.pczt_path)),"stored signed PCZT missing or changed");
    wallet("sync","-s",env("BNZ_LWD_URL"));
    const known=JSON.parse(wallet("list-tx","--json")).find((t:any)=>t.txid===staged.txid);
    if(!known?.mined_height) {
      const metadata=inspect(staged.pczt_path!,manifestNet(),custody),tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
      if(metadata.expiry_height<=tip) {
        const m=client(auction().manifest,auction().signer).manifest;
        const funding=notes(m.network).filter(n=>m.deposit_addresses.includes(n.address)&&n.height>0&&n.height<=metadata.expiry_height&&n.value_zats>0);
        const start=Math.min(...funding.map(n=>n.height));
        requireThat(Number.isSafeInteger(start)&&start>0&&start<=metadata.expiry_height,"expired batch deposit range missing");
        let endHash:string|undefined;
        // Pinned service.proto:259 GetBlockRange and compact_formats.proto:54 CompactTx.txid.
        // A complete range through expiry proves absence; expired transactions cannot mine later.
        for(const endpoint of lwdEndpoints(client(auction().manifest,auction().signer).manifest.network)) {
          const raw=run(bin("grpcurl"),["-import-path",path.join(STATE,"proto"),"-proto","service.proto","-d",JSON.stringify({start:{height:start},end:{height:metadata.expiry_height}}),endpoint,"cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange"]);
          const blocks=raw.trim().split(/\n(?=\{)/).map(l=>JSON.parse(l));
          requireThat(blocks.length===metadata.expiry_height-start+1&&blocks.every((b,i)=>Number(b.height)===start+i),"incomplete expired batch block range");
          const ids=blocks.flatMap(b=>b.vtx??[]).map(t=>Buffer.from(t.txid,"base64").reverse().toString("hex"));
          requireThat(funding.every(n=>ids.includes(n.txid)),"expired batch range omits known funding transactions");
          requireThat(!ids.includes(staged.txid!),"expired batch is mined; reconcile before replanning");
          requireThat(typeof blocks.at(-1).hash==="string"&&Buffer.from(blocks.at(-1).hash,"base64").length===32,"expired batch end hash missing");
          requireThat(!endHash||endHash===blocks.at(-1).hash,"expired batch endpoints disagree");endHash=blocks.at(-1).hash;
        }
        ledger.expire(batch.id);console.log(JSON.stringify({auction_id:id,batch:batch.id,state:"exception",expiry_height:metadata.expiry_height,tip}));pinRows();ledger.eligible();continue;
      }
      guard(metadata,tip);
      // Under host custody the candidate was built in a signer host's own vault, whose account id this operator vault
      // does not know (store fails AccountUnknown, live Y2); broadcast without storing (the vault still supplies the network config), the next sync records it.
      // H20 item 1 (R108): a send that answers "transaction already exists in mempool" — the resend after a lost
      // response, or a resend on a re-run — counts as broadcast, and so does a send whose transaction has already
      // mined (checked against this worker's own wallet). The batch continues to the mined-wait.
      // B51 (P3, Reviewer R P3-2): the error string alone is never trusted. On a send error the STAGED TXID
      // itself must be known to this worker's own wallet (the same list-tx the mined-wait repeats when it finds
      // the transaction). Known — mempool or mined — counts as broadcast; unknown with an "already exists in
      // mempool" claim is treated as NOT broadcast and the send is retried once with the same bytes; any other
      // error stays an immediate error. The old catch assigned sent = staged.txid and then "checked"
      // sent === staged.txid — a vacuous pair; the txid check now runs only on a send that returned one.
      // B53 (P3-3, Reviewer R round 4): under custody the wallet stores nothing until the transaction mines
      // (send-without-storing), so a TRUE "already exists in mempool" — the re-send after run 1 died between
      // broadcast and the mined-wait — can never be confirmed by list-tx while it sits in the mempool, and
      // the old terminal throw crash-looped every re-run until it mined. The one retry above stays (it is
      // what catches a lying wrapper that answers the phrase without recording anything — B51 P3-2); when
      // the retry hears the same phrase again and the wallet still does not know the txid, the transaction
      // is presumed already broadcast and the run falls through to the bounded mined-wait below (the
      // design's "or the next mined-wait finds it" leg). That wait is fail-safe: its deadline throws a clear
      // error and a later run retries; nothing is recorded here. Every other send error stays immediate.
      let sent:string|null=null;
      for(let attempt=0;attempt<2&&sent===null;attempt++) {
        let returned:string|null=null,sendError:Error|null=null;
        try {returned=(custody?pczt("send-without-storing","-s",env("BNZ_LWD_URL"),staged.pczt_path!):pczt("send","-s",env("BNZ_LWD_URL"),staged.pczt_path!)).trim().split("\n").at(-1)??null}
        catch(e) {sendError=e as Error}
        if(sendError===null) {
          requireThat(returned===staged.txid,"broadcast returned a different txid");
          sent=staged.txid!;break;
        }
        let known=false;
        try {known=!!JSON.parse(wallet("list-tx","--json")).find((t:any)=>t.txid===staged.txid)} catch {}
        if(known) {sent=staged.txid!;break}
        if(!/already exists in mempool/i.test(sendError.message))throw sendError;
        if(attempt===1)break; // twice the same phrase, wallet blind: fall through to the mined-wait
      }
      if(sent)console.log(`settlement broadcast ${sent}`);
      else console.log(`settlement already in mempool ${staged.txid}; waiting for it to mine`);
    }
    const tMine=Date.now();
    const height=await mined(staged.txid!,Date.now()+30*60_000);
    timing({auction:id,batch:batch.id,phase:"mined-wait",ms:Date.now()-tMine,height});
    // Head (2026-10-03, live run 12): a lagging endpoint that has not seen the block yet is waited for (up to 15
    // min); only a DIFFERENT non-zero height is a real disagreement and refuses.
    const agreeBy=Date.now()+15*60_000;
    for(const endpoint of lwdEndpoints(client(auction().manifest,auction().signer).manifest.network)) {
      for(;;) {
        let seen=0;
        // Head (live buyback run 3): an endpoint down (503) past chainTx's own retries counts as "not seen yet" until the deadline.
        try{seen=Number(chainTx(staged.txid!,endpoint).height)||0}catch(e){if(!/NotFound|not found/i.test(String((e as Error)?.message??e))&&!isTransientGrpc(e))throw e}
        if(seen===height)break;
        requireThat(seen===0,"settlement height differs across endpoints");
        requireThat(Date.now()<agreeBy,"endpoint did not observe the settlement within 15 minutes");
        await new Promise(r=>setTimeout(r,15000));
      }
    }
    const i=inspect(staged.pczt_path!,manifestNet(),custody);
    if(custody) {
      // G-4: receipts map outputs to parties by the two signing hosts' signed {party, output_index} maps, which must
      // verify against the pinned witness set and agree (same txid, same outputs); the builder's build.json is only a
      // cross-check, logged if it differs. Never by recipient.
      const doc=JSON.parse(readFileSync(path.join(path.resolve(JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8")).public_dir),"auction.json"),"utf8"));
      const wkeys=verifyRecord<any>(doc.witness_set,doc.signer).keys as string[],maps=JSON.parse(readFileSync(base+".maps.json","utf8"));
      // Ruling R41 (F7): the two agreeing maps of THIS batch bind exactly what it pays — the `balance-late:`/
      // `balance-excess:` rows among its outputs are attested here, at paid time, and nowhere else. Ruling R42
      // (F11/F12): the strays among its outputs are attested here too, and the stable defaults list is compared
      // MAP-TO-MAP only — never against this run's fresh derivation, which chain drift can move (the F12 wedge).
      const pair=agreedBatchMaps(maps,wkeys,staged.txid!);
      const built={outputs:pair[0].outputs},relayed=JSON.parse(readFileSync(base+".build.json","utf8"));
      for(const x of built.outputs)if(!relayed.outputs.some((y:any)=>y.party===x.party&&y.output_index===x.output_index))console.error(`ERROR build.json differs from the hosts' signed map for ${x.party}; using the hosts' map`);
      // B53 (P2-2, Reviewer R round 4): receipts resolve by (output_index, amount_zats), each match UNIQUE
      // among the mined non-change outputs — `output_index` is a per-pool action index, so a pre-H3 two-pool
      // batch's signed maps carry colliding indexes and the old index-only `find` either threw "mined amount
      // differs" on every re-run (a permanent wedge) or attributed a receipt to the wrong pool. A row that
      // matches zero or several outputs, a row the maps do not cover, or two rows claiming one output cannot
      // be attributed: the batch is parked for manual reconciliation (settle/ledger.ts park — its rows keep
      // their batch binding and can never be paid again), the run continues and exits 0. Nothing throws
      // inside the loop.
      const minedOutputs=i.outputs.filter((x:any)=>!x.is_change);
      const receipt:{party:string;amount_zats:string;index:number;pool:string}[]=[];
      let unattributable=false;
      for(const row of batch.outputs) {
        const m:any=built.outputs.find((x:any)=>x.party===row.party);
        const hits=m?minedOutputs.filter((x:any)=>x.index===m.output_index&&String(x.amount_zats)===row.amount_zats):[];
        if(hits.length!==1){unattributable=true;break}
        receipt.push({party:row.party,amount_zats:String(hits[0].amount_zats),index:hits[0].index,pool:String(hits[0].pool)});
      }
      if(!unattributable&&new Set(receipt.map(o=>`${o.pool}:${o.index}`)).size!==receipt.length)unattributable=true;
      if(unattributable) {
        ledger.park(batch.id,height);
        console.error(`ERROR batch ${batch.id}: ${manualReason}; the mined batch is parked as an exception and its rows wait for manual reconciliation`);
        writeInspect(i);
        continue;
      }
      ledger.confirm(batch.id,staged.txid!,height,receipt);
      writeInspect(i);
    } else {
    const expected=(await destinations(batch.outputs,settings().signers[0],plan)).filter(o=>o.recipient);
    const available=i.outputs.filter((o:any)=>!o.is_change);
    const receipt=expected.map(e=>{const index=available.findIndex((o:any)=>o.recipient===e.recipient&&o.amount_zats===e.amount_zats);requireThat(index>=0,"mined amount differs from result.json");const [o]=available.splice(index,1);return {party:e.party,amount_zats:o.amount_zats,index:o.index,pool:o.pool}});
    ledger.confirm(batch.id,staged.txid!,height,receipt);
    writeInspect(routedInspect(i,expected));
    }
  }
  writeFileSync(file("receipts.json"),jsonBytes(ledger.receipts()),{mode:0o600});
  // H20 item 2 (R108): a re-run after the return has mined must republish idempotently. The emptied vault no
  // longer derives the return, so the published reserve_return accounting is KEPT once its receipt exists —
  // from the ledger's own record of the paid batch (its inspect: the candidate swept the whole unspent value,
  // so input_zats is the recorded remaining and fee_zats the recorded fee). It is never re-derived from the
  // emptied vault. B51 (P3-3): the old second source — the already-published doc — is gone: a doc can never
  // feed its own accounting back (a doctored accounting would survive every re-run that way).
  // B54 (P2-1): the kept accounting also carries the recorded residue (dust_notes/dust_zats) the record
  // wrote when the batch was staged — the same never-re-derived rule.
  const summaryPlan:any=plan;
  const paidReturn=ledger.rows().find(o=>o.party==="reserve-return"&&["paid","refunded"].includes(o.state))??null;
  if(paidReturn) {
    const kept=():{remaining_zats:string;fee_zats:string;dust_notes:number;dust_zats:string}|null=>{
      try {const i=JSON.parse(readFileSync(file(`batch-${paidReturn.batch}.inspect.json`),"utf8"));
        if(i&&i.input_zats!==undefined&&i.fee_zats!==undefined&&Number.isInteger(i.dust_notes)&&i.dust_notes>=0&&/^[0-9]+$/.test(String(i.dust_zats)))
          return {remaining_zats:String(i.input_zats),fee_zats:String(i.fee_zats),dust_notes:i.dust_notes,dust_zats:String(i.dust_zats)}} catch {}
      return null;
    };
    const accounting=kept();
    requireThat(accounting,"a paid reserve-return receipt without its accounting in the ledger (the paid batch's own inspect record)");
    requireThat(BigInt(accounting!.remaining_zats)-BigInt(accounting!.fee_zats)===BigInt(paidReturn.amount_zats),"the kept reserve_return accounting does not match the paid receipt");
    summaryPlan.reserve_return={party:"reserve-return",kind:"payout",amount_zats:paidReturn.amount_zats,...accounting!};
  }
  // H7 (B50): the set-aside reasons travel with their exception rows into the summary — and from there into
  // the published no-payment settlement — so a reader sees WHY each row waits, not just that it does.
  // B53 (P2-2): the manual-reconciliation reason rides on the parked rows on EVERY run — it is re-derived
  // from the parked batch (settle/ledger.ts park) here, not carried in memory, so a re-run republishes it.
  for(const b of ledger.db.prepare("SELECT id FROM batches WHERE state='exception' AND height IS NOT NULL").all() as {id:number}[])
    for(const r of ledger.rows().filter(o=>o.batch===Number(b.id)))manualReasons.set(r.party,manualReason);
  const reasonOf=new Map<string,string>([...(plan.exceptions??[]),...pinned.filter((o:any)=>o.reason)].map((o:any)=>[o.party,String(o.reason)] as [string,string]));
  for(const [party,reason] of manualReasons)reasonOf.set(party,reason);
  for(const [party,reason] of h23Reasons)if(!reasonOf.has(party))reasonOf.set(party,reason);
  const summaryRows=ledger.rows().map(r=>r.state==="exception"&&reasonOf.get(r.party)?{...r,reason:reasonOf.get(r.party)}:r);
  writeFileSync(file("summary.json"),jsonBytes({auction_id:id,lwd_endpoints:lwdEndpoints(client(auction().manifest,auction().signer).manifest.network),rows:summaryRows,batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all(),signoffs,plan:summaryPlan,offline_signer:["alice","bob","carol"].find(n=>!signoffs.some(c=>c.participant===n))}),{mode:0o600});
  process.stdout.write(jsonBytes({auction_id:id,settled:ledger.receipts().length}));
}
try {
  requireThat(/^[0-9a-f]{64}$/.test(id),"settlement auction id");mkdirSync(dir,{recursive:true,mode:0o700});
  if(command==="init") {
    requireThat(auction().state==="OPEN","routing intake must precede funding/clearing");
    const routing=JSON.parse(readFileSync(0,"utf8")),{manifest:m}=client(auction().manifest,auction().signer);
    // R6 (W): product mode refuses operator-pinned bidder destinations — those are envelope-authenticated.
    const product=existsSync(path.join(STATE,"product",`${id}.json`));
    requireThat(routing.bidders.length===m.deposit_addresses.length&&routing.bidders.every((b:any)=>m.deposit_addresses.includes(b.deposit_ua))&&new Set(routing.bidders.map((b:any)=>b.deposit_ua)).size===m.deposit_addresses.length,"routing deposit set");
    // R7 item 6 (Reviewer G G6): product routing carries no bidder destinations at all — stray_refund_ua is
    // dropped; a stray refund resolves through the stray's own owner-signed claim or sits in the exception queue.
    if(product)requireThat(routing.bidders.every((b:any)=>Object.keys(b).sort().join()===`deposit_ua`),"stray_refund_ua is dropped; product routing pins only deposit addresses");
    else requireThat(routing.bidders.every((b:any)=>typeof b.refund_ua==="string"),"routing shape");
    requireThat(typeof routing.seller_ua==="string"&&(product||new Set([...routing.bidders.map((b:any)=>b.refund_ua),routing.seller_ua]).size===routing.bidders.length+1),"unique party destinations");
    requireThat(!existsSync(file("routing-commitment.json")),"routing already pinned");
    for(const n of ["alice","bob","carol"])writeFileSync(file(`routing-${n}.json`),jsonBytes(routing),{mode:0o600});
    writeFileSync(file("routing-commitment.json"),jsonBytes({sha256:hash(jsonBytes(routing)),pinned_at:Date.now()}),{mode:0o600});
    process.stdout.write(jsonBytes(read("routing-commitment.json")));
  } else {
    const ledger=new Ledger(STATE,id);
    try {
      if(command==="run")await worker(ledger);
      else if(command==="check")process.stdout.write(jsonBytes(await check(ledger,Number(arg1),arg2,arg3,arg4,arg5)));
      else if(command==="status")process.stdout.write(jsonBytes({rows:ledger.rows(),receipts:ledger.receipts(),batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all()}));
      else throw Error("usage: init | run | status <auction> | check <auction> <batch> <PCZT> <signer>");
    } finally {ledger.close()}
  }
} catch(e) {process.stderr.write(`ERROR settle ${(e as Error).message}\n`);process.exitCode=1}
