// CLI coordinator. Signer routing is private, pinned before funding; no recipient input is accepted at run/sign time.
import {existsSync,fsyncSync,mkdirSync,openSync,closeSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {client,hash,jsonBytes,requireThat} from "../manifest/schema";
import {Ledger,type Row} from "./ledger";
import {ROOT,STATE,bin,env,run,wallet,pczt,inspect,monetary,notes,prove,mined,chainTx} from "./io";
import {pubkey,zcashSign} from "./sign";
import {ENVELOPE_INTERIM_REFUSAL} from "./envelopes";
const [command,id,arg1,arg2,arg3,arg4,arg5]=process.argv.slice(2);
const dir=path.join(STATE,"settle",id??""),file=(n:string)=>path.join(dir,n);
const read=(n:string)=>JSON.parse(readFileSync(file(n),"utf8"));
const settings=()=>existsSync(path.join(STATE,"product",`${id}.json`))?JSON.parse(readFileSync(path.join(STATE,"product",`${id}.json`),"utf8")).settlement:{signers:["alice","bob"],pczt_expiry_blocks:364,batch_cap:13};
const auction=()=>JSON.parse(readFileSync(path.join(STATE,"auction",`${id}.json`),"utf8"));
function destinations(rows:Row[],name:string,plan:{opened:any[]|null;destinations?:Record<string,string>}) {
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
  return rows.map(row=> {
    // R7 item 4: a claim-promoted row's destination is the one named in the owner-signed request the signer
    // plan verified against its own fresh opening; it is signer-derived, like every other destination here.
    const claimed=plan.destinations?.[row.party];
    if(claimed)return {...row,recipient:claimed};
    // R7 item 2 (R F-1/F-2 = G4): no operator-held envelope key exists, and single-recipient envelopes cannot
    // be opened by every signer, so an envelope destination is refused with a clear error — never paid from a
    // fallback key — and its refund waits in the exception queue (owner-signed claim, R7 item 4).
    if(product&&row.party.startsWith("leaf:"))throw Error(`envelope destination refused: ${ENVELOPE_INTERIM_REFUSAL} (party ${row.party}; refund waits in the exception queue)`);
    const address=row.party.startsWith("leaf:")?a.frozen.leaves[Number(row.party.slice(5))].deposit.address:
      observed.find(n=>row.party===`deposit:${n.txid}:${n.diversifier_index}`)?.address;
    // R7 item 6 (Reviewer G G6): a product-mode stray has no operator-chosen destination — it resolves only
    // through its own owner-signed claim (plan.destinations above) or stays in the exception queue.
    if(product&&row.party!=="seller")throw Error(`stray refund refused: no operator-chosen destination (party ${row.party}; claim it with benzo claim-refund or leave it in the exception queue)`);
    const recipient=row.party==="seller"?route.seller_ua:route.bidders.find((b:any)=>b.deposit_ua===address)?.refund_ua;
    requireThat(recipient,"missing independently pinned settlement recipient");return {...row,recipient};
  });
}
// F4 (R28): the per-output routing bit is computed from the pinned routing, never asserted as a constant.
// Change outputs are not part of the pinned settlement routing and compute false.
const routedInspect=(i:any,expected:{recipient:string;amount_zats:string}[])=>({...i,outputs:i.outputs.map((o:any)=>({...o,matches_pinned_routing:!o.is_change&&expected.some(e=>e.recipient===o.recipient&&e.amount_zats===o.amount_zats)}))});
function check(ledger:Ledger,batch:number,candidate:string,name:string,randomizer?:string,sighash?:string) {
  requireThat(["alice","bob","carol"].includes(name),"unknown signer");
  const plan=monetary(id),rows=ledger.rows().filter(o=>o.batch===batch);
  const independentlyExpected=rows.map(row=> {
    const obligation=plan.obligations.find((p:any)=>p.party===row.party);
    requireThat(obligation&&obligation.amount_zats===row.amount_zats&&obligation.kind===row.kind,"batch row differs from fresh signer clearing");
    return {...row,...obligation};
  });
  const expected=destinations(independentlyExpected,name,plan),i=inspect(candidate);
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
async function worker(ledger:Ledger) {
  const plan=monetary(id);
  for(const r of plan.refusals??[])console.error(`ERROR refund ${r.party} to the exception queue: ${r.reason}`);
  ledger.pin(plan.obligations,plan.exceptions);ledger.eligible();
  const signoffs:any[]=existsSync(file("signoffs.json"))?read("signoffs.json"):[];
  let batch;
  while((batch=ledger.allocate(settings().batch_cap))) {
    requireThat(batch.outputs.length>0,"allocated batch has no payable obligations");
    console.log(JSON.stringify({auction_id:id,batch:batch.id,allocated:batch.outputs.length}));
    const base=file(`batch-${batch.id}`),created=base+".pczt",proven=base+".proven.pczt",signed=base+".signed.pczt";
    let staged=ledger.batch(batch.id)!;
    if(!staged.txid) {
      const payment=destinations(batch.outputs,settings().signers[0],plan).map(o=>({recipient:o.recipient,amount_zats:o.amount_zats}));
      run(path.join(ROOT,"settle/target/release/benzo-pczt"),["create",path.join(STATE,"vault"),created,String(settings().pczt_expiry_blocks)],JSON.stringify(payment));
      const createdInfo=inspect(created);guard(createdInfo,JSON.parse(wallet("balance","--json")).chain_tip_height);
      await prove(created,proven);
      const signing=await zcashSign(proven,signed,(name,randomizer,sighash)=> {
        const approved=JSON.parse(run(process.execPath,existsSync(path.join(STATE,"product",`${id}.json`))?[path.join(ROOT,"cli/dist/benzo.mjs"),"sign","inspect","--id",id,"--batch",String(batch!.id),"--candidate",proven,"--name",name,"--randomizer",randomizer,"--sighash",sighash]:[path.join(ROOT,"settle/dist/cli.mjs"),"check",id,String(batch!.id),proven,name,randomizer,sighash]));signoffs.push(approved);writeFileSync(file("signoffs.json"),jsonBytes(signoffs),{mode:0o600});
      },settings().signers,existsSync(path.join(STATE,"product",`${id}.json`))?id:undefined,batch.id);
      writeFileSync(base+".signatures.json",jsonBytes(signing),{mode:0o600});
      const fd=openSync(signed,"r");fsyncSync(fd);closeSync(fd);
      const df=openSync(dir,"r");fsyncSync(df);closeSync(df);
      const txid=run(bin("zcash-devtool"),["pczt","extract"],readFileSync(signed)).trim().split("\n").at(-1)!;
      ledger.stage(batch.id,signed,txid);writeFileSync(base+".inspect.json",jsonBytes(routedInspect(inspect(signed),destinations(batch.outputs,settings().signers[0],plan))),{mode:0o600});
    }
    staged=ledger.batch(batch.id)!;
    requireThat(staged.txid&&staged.pczt_path&&staged.pczt_hash===hash(readFileSync(staged.pczt_path)),"stored signed PCZT missing or changed");
    wallet("sync","-s",env("BNZ_LWD_URL"));
    const known=JSON.parse(wallet("list-tx","--json")).find((t:any)=>t.txid===staged.txid);
    if(!known?.mined_height) {
      const metadata=inspect(staged.pczt_path!),tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
      if(metadata.expiry_height<=tip) {
        const m=client(auction().manifest,auction().signer).manifest;
        const funding=notes().filter(n=>m.deposit_addresses.includes(n.address)&&n.height>0&&n.height<=metadata.expiry_height&&n.value_zats>0);
        const start=Math.min(...funding.map(n=>n.height));
        requireThat(Number.isSafeInteger(start)&&start>0&&start<=metadata.expiry_height,"expired batch deposit range missing");
        let endHash:string|undefined;
        // Pinned service.proto:259 GetBlockRange and compact_formats.proto:54 CompactTx.txid.
        // A complete range through expiry proves absence; expired transactions cannot mine later.
        for(const endpoint of [env("BNZ_LWD_URL"),env("BNZ_LWD_URL_ALT")]) {
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
      const sent=pczt("send","-s",env("BNZ_LWD_URL"),staged.pczt_path!).trim().split("\n").at(-1);
      requireThat(sent===staged.txid,"broadcast returned a different txid");console.log(`settlement broadcast ${sent}`);
    }
    const height=await mined(staged.txid!,Date.now()+30*60_000);
    for(const endpoint of [env("BNZ_LWD_URL"),env("BNZ_LWD_URL_ALT")]) {
      const observed=chainTx(staged.txid!,endpoint);requireThat(Number(observed.height)===height,"settlement height differs across endpoints");
    }
    const i=inspect(staged.pczt_path!),expected=destinations(batch.outputs,settings().signers[0],plan);
    const available=i.outputs.filter((o:any)=>!o.is_change);
    const receipt=expected.map(e=>{const index=available.findIndex((o:any)=>o.recipient===e.recipient&&o.amount_zats===e.amount_zats);requireThat(index>=0,"mined amount differs from result.json");const [o]=available.splice(index,1);return {party:e.party,amount_zats:o.amount_zats,index:o.index,pool:o.pool}});
    ledger.confirm(batch.id,staged.txid!,height,receipt);
    writeFileSync(base+".inspect.json",jsonBytes(routedInspect(i,expected)),{mode:0o600});
  }
  writeFileSync(file("receipts.json"),jsonBytes(ledger.receipts()),{mode:0o600});
  writeFileSync(file("summary.json"),jsonBytes({auction_id:id,rows:ledger.rows(),batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all(),signoffs,plan,offline_signer:["alice","bob","carol"].find(n=>!signoffs.some(c=>c.participant===n))}),{mode:0o600});
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
