// CLI coordinator. Signer routing is private, pinned before funding; no recipient input is accepted at run/sign time.
import {copyFileSync,existsSync,fsyncSync,mkdirSync,openSync,closeSync,readFileSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {hash,jsonBytes,requireThat,verifyRecord} from "../manifest/schema";
import {clientCommon as client} from "../clear/registry"; // design §6.1: every registry mode
import {verifyApprovalMap} from "../witness";
import {Ledger,type Row} from "./ledger";
import {ROOT,STATE,bin,env,run,wallet,pczt,inspect,monetary,notes,prove,mined,chainTx,isTransientGrpc,lwdEndpoints} from "./io";
import {pubkey,zcashSign} from "./sign";
import {envelopeRecipient,memoEnvelopeRecipient,ownEnvelopePrivate,openDestination} from "./envelopes";
import {partyNote} from "./deposits";
import { vaultDir, pcztBin } from "../manifest/paths";
const [command,id,arg1,arg2,arg3,arg4,arg5]=process.argv.slice(2);
// §11 H1: every vault use for this auction resolves to its own per-auction vault when it ran its own DKG.
if(id&&/^[0-9a-f]{64}$/.test(id))process.env.BNZ_AUCTION_ID=id;
const dir=path.join(STATE,"settle",id??""),file=(n:string)=>path.join(dir,n);
const read=(n:string)=>JSON.parse(readFileSync(file(n),"utf8"));
const settings=()=>existsSync(path.join(STATE,"product",`${id}.json`))?JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8")).settlement:{signers:["alice","bob"],pczt_expiry_blocks:364,batch_cap:13};
const auction=()=>JSON.parse(readFileSync(path.join(STATE,"auction",`${id}.json`),"utf8"));
type ResolvedRow=Row&{recipient?:string;reason?:string};
function destinations(rows:Row[],name:string,plan:{opened:any[]|null;claim_envelopes?:Record<string,string>;envelope_agreed?:Record<string,string>}):ResolvedRow[] {
  const route=read(`routing-${name}.json`),observed=notes();
  requireThat(hash(jsonBytes(route))===read("routing-commitment.json").sha256,"signer routing changed after intake");
  // R6 (W): in product mode a bid's destination comes only from its owner-signed settlement envelope, opened
  // with the signer's own key; operator routing pins only the non-bid sinks (seller, stray refunds).
  const product=existsSync(path.join(STATE,"product",`${id}.json`));
  // R7 (Reviewer R F-3 = Reviewer G G1): product destinations resolve ONLY from the signer's own fresh tle
  // openings (settle/plan.ts) and the published auction.json envelope records. The coordinator's private
  // ledger is cross-checked against both and refused on any difference; it is never consulted as a source.
  let a:any;
  if(product) {
    const config=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
    const doc=JSON.parse(readFileSync(path.join(path.resolve(config.public_dir),"auction.json"),"utf8"));
    const ledgerDoc=auction();
    requireThat(jsonBytes(ledgerDoc.opened??null).equals(jsonBytes(plan.opened??null)),"private ledger opening differs from signer-derived opening");
    requireThat(jsonBytes(ledgerDoc.envelopes??[]).equals(jsonBytes(doc.envelopes??[])),"private ledger envelope records differ from published records");
    a={manifest:doc.manifest,frozen:doc.frozen,opened:plan.opened,envelopes:doc.envelopes};
  } else a=auction();
  return rows.map((row):ResolvedRow=> {
    // R16 item 1 (Reviewer R F4): destinations() never throws for a single row. An unresolvable row comes
    // back with its reason and no recipient; the worker turns it into an exception row and the batch
    // proceeds with the rows that resolve.
    try {
    // R7 item 4 + R15 item 3: a claim-promoted row's destination is sealed in its claim envelope and opened
    // here with THIS signer's own key (with the R10 item 4 agreed-hash cross-check) — signer-derived like
    // every other destination, never operator input.
    const claimCt=plan.claim_envelopes?.[row.party];
    if(claimCt) {
      const recipient=openDestination({ciphertext_hash:hash(Buffer.from(claimCt,"hex")),envelope_ct:claimCt,owner_sig:""},ownEnvelopePrivate(STATE,name)??"");
      if(recipient) {requireThat(plan.envelope_agreed?.[row.party]===hash(Buffer.from(recipient,"utf8")),"this signer's opening differs from the agreed envelope destination");return {...row,recipient}}
      return {...row,reason:`claim envelope refused: this signer's key does not open it (party ${row.party}; refund waits in the exception queue)`};
    }
    // R10 item 2 (design §4): a product-mode refund whose bid carries a validated v2 envelope is paid to the
    // envelope's destination, opened here with THIS signer's own key — never an operator-chosen or
    // coordinator-pinned destination. A row whose envelope this signer cannot open is an exception row with
    // its reason, never a throw (R12 item 3); the row is claimable through benzo claim-refund.
    if(product&&row.party.startsWith("leaf:")) {
      const recipient=envelopeRecipient(a,Number(row.party.slice(5)),ownEnvelopePrivate(STATE,name)??"");
      if(recipient) {requireThat(plan.envelope_agreed?.[row.party]===hash(Buffer.from(recipient,"utf8")),"this signer's opening differs from the agreed envelope destination");return {...row,recipient}}
      return {...row,reason:`envelope destination refused: this signer's key does not open the envelope (party ${row.party}; refund waits in the exception queue)`};
    }
    // Design §6.1: the buyback treasury return goes to the signed manifest's treasury_ua, never to routing.
    if(row.party==="treasury") return {...row,recipient:(client(auction().manifest,auction().signer).manifest as any).buyback.treasury_ua};
    const address=row.party.startsWith("leaf:")?a.frozen.leaves[Number(row.party.slice(5))].deposit.address:
      partyNote(observed,row.party)?.address;
    // R7 item 6 (Reviewer G G6) + R10 item 2: a product-mode stray or cancelled deposit resolves through its
    // own memo-bound owner-signed envelope (opened with this signer's key) or its owner-signed claim; there
    // is no operator-chosen destination.
    if(product&&row.party!=="seller") {
      const recipient=memoEnvelopeRecipient(observed,row.party,(a as any).manifest,(a as any).envelopes,path.join(STATE,"bin","tle"),ownEnvelopePrivate(STATE,name)??"");
      if(recipient) {requireThat(plan.envelope_agreed?.[row.party]===hash(Buffer.from(recipient,"utf8")),"this signer's opening differs from the agreed envelope destination");return {...row,recipient}}
      return {...row,reason:`stray refund refused: no owner-signed settlement envelope or claim (party ${row.party}; claim it with benzo claim-refund or leave it in the exception queue)`};
    }
    const recipient=row.party==="seller"?route.seller_ua:route.bidders.find((b:any)=>b.deposit_ua===address)?.refund_ua;
    requireThat(recipient,"missing independently pinned settlement recipient");return {...row,recipient};
    } catch(e) {return {...row,reason:(e as Error).message}}
  });
}
// F4 (R28): the per-output routing bit is computed from the pinned routing, never asserted as a constant.
// Change outputs are not part of the pinned settlement routing and compute false.
const routedInspect=(i:any,expected:{recipient?:string;amount_zats:string}[])=>({...i,outputs:i.outputs.map((o:any)=>({...o,matches_pinned_routing:!o.is_change&&expected.some(e=>e.recipient===o.recipient&&e.amount_zats===o.amount_zats)}))});
function check(ledger:Ledger,batch:number,candidate:string,name:string,randomizer?:string,sighash?:string) {
  requireThat(["alice","bob","carol"].includes(name),"unknown signer");
  const plan=monetary(id),rows=ledger.rows().filter(o=>o.batch===batch);
  const independentlyExpected=rows.map(row=> {
    const obligation=plan.obligations.find((p:any)=>p.party===row.party);
    requireThat(obligation&&obligation.amount_zats===row.amount_zats&&obligation.kind===row.kind,"batch row differs from fresh signer clearing");
    return {...row,...obligation};
  });
  const expected=destinations(independentlyExpected,name,plan).filter(o=>o.recipient),i=inspect(candidate);
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
  // Published testnet height in ZIP 214; expiry must not straddle the next consensus branch.
  requireThat(!(tip<4465026&&metadata.expiry_height>=4465026),"PCZT expiry reaches NU7 activation; refusing create/broadcast");
}
// §11 H3/H4 (host custody): build the batch packet, have each preferred signer host approve it from its own data,
// sign with two approving hosts, and on a mid-session failure (the kill drill) record the abandoned session and
// re-plan the SAME batch with the next host that approves. A host that failed is not asked again for this batch.
// §11 H6: the first preferred signer host that can derive every allocated row builds and proves the candidate on its
// own vault; the coordinator receives only the REDACTED proven PCZT (H7) and {party, output_index} (recipients stay on the hosts).
// Reviewer G's G-5: before allocation, the first preferred host that answers lists the {party, amount} rows it derives
// from its own data (`sign derivable`, no recipients). A row no host derives is pinned to the exception queue with its
// reason instead of being allocated into a batch no host could build.
function hostDerivable():Set<string>|null {
  const cfg=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
  const publicDir=path.resolve(cfg.public_dir),doc=JSON.parse(readFileSync(path.join(publicDir,"auction.json"),"utf8"));
  const packet=file("derivable");run("rm",["-rf",packet]);mkdirSync(packet,{recursive:true,mode:0o700});run("cp",["-R",publicDir,path.join(packet,"public")]);
  if(existsSync(file("claims.json")))copyFileSync(file("claims.json"),path.join(packet,"claims.json"));
  writeFileSync(path.join(packet,"packet.json"),jsonBytes({auction_id:id,signer:doc.signer,seller_ua:cfg.routing?.seller_ua??null}),{mode:0o600});
  const remote=`derivable-${id.slice(0,16)}`;
  for(const n of [...settings().signers,...["alice","bob","carol"].filter(n=>!settings().signers.includes(n))]) {
    if(spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","rm","-rf",`/home/benzo/${remote}`],{timeout:120_000}).status!==0)continue;
    if(spawnSync("orbctl",["push","-m",`benzo-${n}`,packet,remote],{timeout:120_000}).status!==0)continue;
    spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","chown","-R","benzo:benzo",`/home/benzo/${remote}`],{timeout:120_000});
    const r=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","/home/benzo/.benzo/bin/benzo","sign","derivable","--id",id,"--packet",`/home/benzo/${remote}`,"--name",n],{encoding:"utf8",maxBuffer:64<<20,timeout:15*60_000});
    if(r.status!==0){console.error(`ERROR signer ${n} could not list derivable rows: ${(r.stderr||"").trim().slice(-200)}`);continue}
    const out=JSON.parse(r.stdout.trim().split("\n").filter(l=>l.startsWith("{")).at(-1)!);
    return new Set(out.rows.map((x:any)=>`${x.party}:${x.amount_zats}`));
  }
  return null;
}
async function hostBuild(batchId:number,rows:{party:string;kind:string;amount_zats:string}[],proven:string) {
  const cfg=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
  const publicDir=path.resolve(cfg.public_dir),doc=JSON.parse(readFileSync(path.join(publicDir,"auction.json"),"utf8"));
  const packet=file(`build-${batchId}`);
  run("rm",["-rf",packet]);mkdirSync(packet,{recursive:true,mode:0o700});run("cp",["-R",publicDir,path.join(packet,"public")]);
  if(existsSync(file("claims.json")))copyFileSync(file("claims.json"),path.join(packet,"claims.json"));
  writeFileSync(path.join(packet,"rows.json"),jsonBytes(rows),{mode:0o600});
  writeFileSync(path.join(packet,"packet.json"),jsonBytes({auction_id:id,batch:batchId,signer:doc.signer,seller_ua:cfg.routing?.seller_ua,expiry_blocks:settings().pczt_expiry_blocks}),{mode:0o600});
  const prefer=[...settings().signers,...["alice","bob","carol"].filter(n=>!settings().signers.includes(n))];
  const remote=`build-${id.slice(0,16)}-${batchId}`;
  for(const n of prefer) {
    if(spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","rm","-rf",`/home/benzo/${remote}`],{timeout:120_000}).status!==0)continue;
    if(spawnSync("orbctl",["push","-m",`benzo-${n}`,packet,remote],{timeout:120_000}).status!==0)continue;
    spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","chown","-R","benzo:benzo",`/home/benzo/${remote}`],{timeout:120_000});
    const b=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","/home/benzo/.benzo/bin/benzo","sign","build","--id",id,"--batch",String(batchId),"--packet",`/home/benzo/${remote}`,"--name",n],{encoding:"utf8",maxBuffer:64<<20});
    if(b.status!==0){console.error(`ERROR signer ${n} could not build batch ${batchId}: ${(b.stderr||"").trim().slice(-200)}`);continue}
    const built=JSON.parse(b.stdout.trim().split("\n").filter(l=>l.startsWith("{")).at(-1)!);
    // §11 H7: pull only the redacted candidate and the sealed full copies; the full candidate never reaches here.
    const pulled=file(`batch-${batchId}.pulled.pczt`);
    run("rm",["-f",pulled]);
    requireThat(spawnSync("orbctl",["pull","-m",`benzo-${n}`,`${remote}/proven.redacted.pczt`,pulled]).status===0&&existsSync(pulled),`could not pull the candidate from ${n}`);
    requireThat(hash(readFileSync(pulled))===built.plan_version,"pulled candidate differs from the builder's plan_version");
    for(const s of ["alice","bob","carol"]) {
      const f=file(`batch-${batchId}.sealed-${s}.bin`);run("rm",["-f",f]);
      requireThat(spawnSync("orbctl",["pull","-m",`benzo-${n}`,`${remote}/sealed-${s}.bin`,f]).status===0&&existsSync(f),`could not pull the candidate sealed to ${s}`);
    }
    copyFileSync(pulled,proven);
    writeFileSync(file(`batch-${batchId}.build.json`),jsonBytes(built),{mode:0o600});
    return built;
  }
  throw Error(`no signer host could build batch ${batchId}`);
}
async function hostSign(batchId:number,proven:string,signed:string,groupKey:string) {
  const cfg=JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8"));
  const publicDir=path.resolve(cfg.public_dir),doc=JSON.parse(readFileSync(path.join(publicDir,"auction.json"),"utf8"));
  const packet=file(`packet-${batchId}`);
  run("rm",["-rf",packet]);mkdirSync(packet,{recursive:true,mode:0o700});run("cp",["-R",publicDir,path.join(packet,"public")]);
  copyFileSync(proven,path.join(packet,"candidate.pczt"));
  for(const s of ["alice","bob","carol"])copyFileSync(file(`batch-${batchId}.sealed-${s}.bin`),path.join(packet,`sealed-${s}.bin`));
  if(existsSync(file("claims.json")))copyFileSync(file("claims.json"),path.join(packet,"claims.json"));
  writeFileSync(path.join(packet,"packet.json"),jsonBytes({auction_id:id,batch:batchId,plan_version:hash(readFileSync(proven)),signer:doc.signer,seller_ua:cfg.routing?.seller_ua??null}),{mode:0o600}); // R28 item 8 (G-2): the seller output must pay this
  const server=process.env.BNZ_FROSTD_HOST??`host.orb.internal:${env("BNZ_FROSTD_ADDR").split(":").at(-1)}`;
  const prefer=[...settings().signers,...["alice","bob","carol"].filter(n=>!settings().signers.includes(n))];
  const failed=new Set<string>(),events:any[]=[],maps:Record<string,any>={};
  const approve=(n:string):boolean=>{
    const remote=`packet-${id.slice(0,16)}-${batchId}`;
    const r=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","rm","-rf",`/home/benzo/${remote}`],{encoding:"utf8",timeout:120_000});
    if(r.status!==0){events.push({signer:n,approve:"unreachable"});return false}
    if(spawnSync("orbctl",["push","-m",`benzo-${n}`,packet,remote],{encoding:"utf8"}).status!==0){events.push({signer:n,approve:"push failed"});return false}
    spawnSync("orb",["run","-m",`benzo-${n}`,"-u","root","chown","-R","benzo:benzo",`/home/benzo/${remote}`],{timeout:120_000});
    const a=spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","/home/benzo/.benzo/bin/benzo","sign","approve","--id",id,"--batch",String(batchId),"--packet",`/home/benzo/${remote}`,"--name",n],{encoding:"utf8",maxBuffer:64<<20}); // host sync logs can pass the 1 MiB default
    events.push(a.status===0?{signer:n,approve:"approved"}:{signer:n,approve:"refused",detail:(a.stderr||"").trim().slice(-200)});
    if(a.status===0){try{maps[n]=JSON.parse(a.stdout.trim().split("\n").filter(l=>l.startsWith("{")).at(-1)!).map??null}catch{maps[n]=null}}
    if(a.status!==0)console.error(`ERROR signer ${n} refused batch ${batchId}: ${(a.stderr||"").trim().slice(-200)}`);
    return a.status===0;
  };
  for(let attempt=1;attempt<=3;attempt++) {
    const pair:string[]=[];
    for(const n of prefer){if(pair.length===2)break;if(failed.has(n))continue;if(approve(n))pair.push(n);else failed.add(n)}
    requireThat(pair.length===2,`fewer than two signer hosts approve batch ${batchId}`);
    try {
      const signing=await zcashSign(proven,signed,()=>{},pair,id,batchId,{id,groupKey,server});
      writeFileSync(file(`batch-${batchId}.custody.json`),jsonBytes({pair,events,attempts:attempt}),{mode:0o600});
        writeFileSync(file(`batch-${batchId}.maps.json`),jsonBytes(pair.map(n=>maps[n]??null)),{mode:0o600}); // G-4: the signing pair's signed maps
      return signing;
    } catch(e) {
      const lost=(e as any).failedSigners??[];
      events.push({abandoned_session:{pair,failed:lost,reason:String((e as Error).message).slice(0,200)}});
      console.error(`ERROR signing session abandoned (batch ${batchId}, pair ${pair.join("+")}, failed ${lost.join(",")||"?"}); re-planning with the next approving host`);
      for(const n of lost)failed.add(n);
      if(!lost.length)throw e;
      // frostd keeps the abandoned session; a survivor would then be in two sessions and refuse to join. Close every
      // lingering session of this auction on the surviving hosts before re-planning.
      for(const n of prefer.filter(n=>!failed.has(n)))spawnSync("orb",["run","-m",`benzo-${n}`,"-u","benzo","env","SSL_CERT_FILE=/home/benzo/.benzo/tls/rootCA.pem","/home/benzo/.benzo/bin/frost-client","sessions","-c",`/home/benzo/.benzo/auctions/${id}/frost.toml`,"-s",server,"--close-all"],{encoding:"utf8"});
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
  // §11 H6: under host custody the coordinator holds no envelope key; the plan already gated every envelope refund on
  // host-signed agreement reports, and the recipients are derived on the hosts (sign build / sign approve).
  const derivable=custody?hostDerivable():null;
  if(custody)requireThat(derivable,"no signer host could list its derivable rows");
  const pinned:any[]=custody?plan.obligations.map((o:any)=>derivable!.has(`${o.party}:${o.amount_zats}`)?{...o,recipient:"host-derived"}:{...o,reason:"no signer host derives this row from its own data (claim or envelope missing or invalid); claimable through benzo claim-refund"}):destinations(plan.obligations,settings().signers[0],plan);
  for(const o of pinned.filter(o=>!o.recipient))console.error(`ERROR refund ${o.party} to the exception queue: ${o.reason}`);
  ledger.pin(pinned.filter(o=>o.recipient).map(({party,kind,amount_zats})=>({party,kind,amount_zats})),
    [...plan.exceptions,...pinned.filter(o=>!o.recipient).map(({party,kind,amount_zats,reason})=>({party,kind,amount_zats,reason}))]);
  ledger.eligible();
  const signoffs:any[]=existsSync(file("signoffs.json"))?read("signoffs.json"):[];
  let batch;
  while((batch=ledger.allocate(settings().batch_cap))) {
    requireThat(batch.outputs.length>0,"allocated batch has no payable obligations");
    console.log(JSON.stringify({auction_id:id,batch:batch.id,allocated:batch.outputs.length}));
    const base=file(`batch-${batch.id}`),created=base+".pczt",proven=base+".proven.pczt",signed=base+".signed.pczt";
    let staged=ledger.batch(batch.id)!;
    if(!staged.txid) {
      const custodyKeys=path.join(STATE,"vaults",id,"keys.json");
      if(custody) {
        // §11 H6: a signer host builds and proves the candidate from its own derivations; only {party, output_index} returns.
        await hostBuild(batch.id,batch.outputs.map(({party,kind,amount_zats}:any)=>({party,kind,amount_zats})),proven);
        guard(inspect(proven,true),JSON.parse(wallet("balance","--json")).chain_tip_height);
      } else {
        const payment=destinations(batch.outputs,settings().signers[0],plan).filter(o=>o.recipient).map(o=>({recipient:o.recipient!,amount_zats:o.amount_zats}));
        run(pcztBin(ROOT,STATE),["create",vaultDir(STATE),created,String(settings().pczt_expiry_blocks)],JSON.stringify(payment));
        const createdInfo=inspect(created);guard(createdInfo,JSON.parse(wallet("balance","--json")).chain_tip_height);
        await prove(created,proven);
      }
      const signing=custody?await hostSign(batch.id,proven,signed,JSON.parse(readFileSync(custodyKeys,"utf8")).group_key):await zcashSign(proven,signed,(name,randomizer,sighash)=> {
        const approved=JSON.parse(run(process.execPath,existsSync(path.join(STATE,"product",`${id}.json`))?[path.join(ROOT,"cli/dist/benzo.mjs"),"sign","inspect","--id",id,"--batch",String(batch!.id),"--candidate",proven,"--name",name,"--randomizer",randomizer,"--sighash",sighash]:[path.join(ROOT,"settle/dist/cli.mjs"),"check",id,String(batch!.id),proven,name,randomizer,sighash]));signoffs.push(approved);writeFileSync(file("signoffs.json"),jsonBytes(signoffs),{mode:0o600});
      },settings().signers,existsSync(path.join(STATE,"product",`${id}.json`))?id:undefined,batch.id);
      writeFileSync(base+".signatures.json",jsonBytes(signing),{mode:0o600});
      const fd=openSync(signed,"r");fsyncSync(fd);closeSync(fd);
      const df=openSync(dir,"r");fsyncSync(df);closeSync(df);
      const txid=run(bin("zcash-devtool"),["pczt","extract"],readFileSync(signed)).trim().split("\n").at(-1)!;
      ledger.stage(batch.id,signed,txid);writeFileSync(base+".inspect.json",jsonBytes(custody?inspect(signed,true):routedInspect(inspect(signed),destinations(batch.outputs,settings().signers[0],plan).filter(o=>o.recipient))),{mode:0o600});
    }
    staged=ledger.batch(batch.id)!;
    requireThat(staged.txid&&staged.pczt_path&&staged.pczt_hash===hash(readFileSync(staged.pczt_path)),"stored signed PCZT missing or changed");
    wallet("sync","-s",env("BNZ_LWD_URL"));
    const known=JSON.parse(wallet("list-tx","--json")).find((t:any)=>t.txid===staged.txid);
    if(!known?.mined_height) {
      const metadata=inspect(staged.pczt_path!,custody),tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
      if(metadata.expiry_height<=tip) {
        const m=client(auction().manifest,auction().signer).manifest;
        const funding=notes().filter(n=>m.deposit_addresses.includes(n.address)&&n.height>0&&n.height<=metadata.expiry_height&&n.value_zats>0);
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
        ledger.expire(batch.id);console.log(JSON.stringify({auction_id:id,batch:batch.id,state:"exception",expiry_height:metadata.expiry_height,tip}));ledger.pin(plan.obligations,plan.exceptions);ledger.eligible();continue;
      }
      guard(metadata,tip);
      // Under host custody the candidate was built in a signer host's own vault, whose account id this operator vault
      // does not know (store fails AccountUnknown, live Y2); broadcast without storing (the vault still supplies the network config), the next sync records it.
      const sent=(custody?pczt("send-without-storing","-s",env("BNZ_LWD_URL"),staged.pczt_path!):pczt("send","-s",env("BNZ_LWD_URL"),staged.pczt_path!)).trim().split("\n").at(-1);
      requireThat(sent===staged.txid,"broadcast returned a different txid");console.log(`settlement broadcast ${sent}`);
    }
    const height=await mined(staged.txid!,Date.now()+30*60_000);
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
    const i=inspect(staged.pczt_path!,custody);
    if(custody) {
      // G-4: receipts map outputs to parties by the two signing hosts' signed {party, output_index} maps, which must
      // verify against the pinned witness set and agree (same txid, same outputs); the builder's build.json is only a
      // cross-check, logged if it differs. Never by recipient.
      const doc=JSON.parse(readFileSync(path.join(path.resolve(JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8")).public_dir),"auction.json"),"utf8"));
      const wkeys=verifyRecord<any>(doc.witness_set,doc.signer).keys as string[],maps=JSON.parse(readFileSync(base+".maps.json","utf8"));
      requireThat(Array.isArray(maps)&&maps.length===2&&maps.every((m:any)=>m&&verifyApprovalMap(m,wkeys)&&m.txid===staged.txid)&&maps[0].witness!==maps[1].witness&&jsonBytes(maps[0].outputs).equals(jsonBytes(maps[1].outputs)),"the signing hosts' output maps are missing, unsigned or disagree");
      const built={outputs:maps[0].outputs},relayed=JSON.parse(readFileSync(base+".build.json","utf8"));
      for(const x of built.outputs)if(!relayed.outputs.some((y:any)=>y.party===x.party&&y.output_index===x.output_index))console.error(`ERROR build.json differs from the hosts' signed map for ${x.party}; using the hosts' map`);
      const receipt=batch.outputs.map((row:any)=>{const m=built.outputs.find((x:any)=>x.party===row.party);requireThat(m,`no built output for ${row.party}`);const o=i.outputs.find((x:any)=>x.index===m.output_index&&!x.is_change);requireThat(o&&o.amount_zats===row.amount_zats,"mined amount differs from result.json");return {party:row.party,amount_zats:o.amount_zats,index:o.index,pool:o.pool}});
      ledger.confirm(batch.id,staged.txid!,height,receipt);
      writeFileSync(base+".inspect.json",jsonBytes(i),{mode:0o600});
    } else {
    const expected=destinations(batch.outputs,settings().signers[0],plan).filter(o=>o.recipient);
    const available=i.outputs.filter((o:any)=>!o.is_change);
    const receipt=expected.map(e=>{const index=available.findIndex((o:any)=>o.recipient===e.recipient&&o.amount_zats===e.amount_zats);requireThat(index>=0,"mined amount differs from result.json");const [o]=available.splice(index,1);return {party:e.party,amount_zats:o.amount_zats,index:o.index,pool:o.pool}});
    ledger.confirm(batch.id,staged.txid!,height,receipt);
    writeFileSync(base+".inspect.json",jsonBytes(routedInspect(i,expected)),{mode:0o600});
    }
  }
  writeFileSync(file("receipts.json"),jsonBytes(ledger.receipts()),{mode:0o600});
  writeFileSync(file("summary.json"),jsonBytes({auction_id:id,lwd_endpoints:lwdEndpoints(client(auction().manifest,auction().signer).manifest.network),rows:ledger.rows(),batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all(),signoffs,plan,offline_signer:["alice","bob","carol"].find(n=>!signoffs.some(c=>c.participant===n))}),{mode:0o600});
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
      else if(command==="check")process.stdout.write(jsonBytes(check(ledger,Number(arg1),arg2,arg3,arg4,arg5)));
      else if(command==="status")process.stdout.write(jsonBytes({rows:ledger.rows(),receipts:ledger.receipts(),batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all()}));
      else throw Error("usage: init | run | status <auction> | check <auction> <batch> <PCZT> <signer>");
    } finally {ledger.close()}
  }
} catch(e) {process.stderr.write(`ERROR settle ${(e as Error).message}\n`);process.exitCode=1}
