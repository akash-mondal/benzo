// CLI coordinator. Signer routing is private, pinned before funding; no recipient input is accepted at run/sign time.
import {existsSync,fsyncSync,mkdirSync,openSync,closeSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {client,hash,jsonBytes,requireThat} from "../manifest/schema";
import {Ledger,type Row} from "./ledger";
import {ROOT,STATE,bin,env,run,wallet,pczt,inspect,monetary,notes,prove,mined,chainTx} from "./io";
import {pubkey,zcashSign} from "./sign";
const [command,id,arg1,arg2,arg3,arg4]=process.argv.slice(2);
const dir=path.join(STATE,"settle",id??""),file=(n:string)=>path.join(dir,n);
const read=(n:string)=>JSON.parse(readFileSync(file(n),"utf8"));
const auction=()=>JSON.parse(readFileSync(path.join(STATE,"auction",`${id}.json`),"utf8"));
function destinations(rows:Row[],name:string) {
  const route=read(`routing-${name}.json`),a=auction(),observed=notes();
  requireThat(hash(jsonBytes(route))===read("routing-commitment.json").sha256,"signer routing changed after intake");
  return rows.map(row=> {
    const address=row.party.startsWith("leaf:")?a.frozen.leaves[Number(row.party.slice(5))].deposit.address:
      observed.find(n=>row.party===`deposit:${n.txid}:${n.diversifier_index}`)?.address;
    const recipient=row.party==="seller"?route.seller_ua:route.bidders.find((b:any)=>b.deposit_ua===address)?.refund_ua;
    requireThat(recipient,"missing independently pinned settlement recipient");return {...row,recipient};
  });
}
function check(ledger:Ledger,batch:number,candidate:string,name:string,randomizer?:string) {
  requireThat(["alice","bob","carol"].includes(name),"unknown signer");
  const plan=monetary(id);requireThat(hash(jsonBytes(plan.obligations))===ledger.db.prepare("SELECT hash FROM plan").get()?.hash,"signer result differs from pinned obligations");
  const expected=destinations(ledger.rows().filter(o=>o.batch===batch),name),i=inspect(candidate);
  const outputs=i.outputs.filter((o:any)=>!o.is_change);
  requireThat(outputs.length===expected.length,"PCZT recipient count differs from result");
  for(const e of expected) {
    const o=outputs.find((o:any)=>o.recipient===e.recipient);
    requireThat(o,"PCZT recipient differs from pinned routing");
    requireThat(o.amount_zats===e.amount_zats,"PCZT amount differs from result.json");
  }
  requireThat(i.input_zats===i.output_zats+i.fee_zats,"PCZT fee conservation");
  return {participant:name,pubkey:pubkey(name),randomizer:randomizer??null,checked_at:Date.now(),result_hash:plan.result_hash,manifest_hash:plan.manifest_hash,pczt_hash:hash(readFileSync(candidate)),routing_hash:read("routing-commitment.json").sha256,fee_zats:i.fee_zats,checks:plan.checks};
}
async function worker(ledger:Ledger) {
  const plan=monetary(id);ledger.pin(plan.obligations);ledger.eligible();
  const signoffs:any[]=existsSync(file("signoffs.json"))?read("signoffs.json"):[];
  let batch;
  while((batch=ledger.allocate())) {
    requireThat(batch.outputs.length>0,"allocated batch has no payable obligations");
    console.log(JSON.stringify({auction_id:id,batch:batch.id,allocated:batch.outputs.length}));
    const base=file(`batch-${batch.id}`),created=base+".pczt",proven=base+".proven.pczt",signed=base+".signed.pczt";
    let staged=ledger.batch(batch.id)!;
    if(!staged.txid) {
      const payment=destinations(batch.outputs,"alice").map(o=>({recipient:o.recipient,amount_zats:o.amount_zats}));
      run(path.join(ROOT,"settle/target/release/benzo-pczt"),["create",path.join(STATE,"vault"),created],JSON.stringify(payment));
      await prove(created,proven);
      const signing=await zcashSign(proven,signed,(name,randomizer)=> {
        const approved=JSON.parse(run(process.execPath,[path.join(ROOT,"settle/dist/cli.mjs"),"check",id,String(batch!.id),proven,name,randomizer]));signoffs.push(approved);writeFileSync(file("signoffs.json"),jsonBytes(signoffs),{mode:0o600});
      });
      writeFileSync(base+".signatures.json",jsonBytes(signing),{mode:0o600});
      const fd=openSync(signed,"r");fsyncSync(fd);closeSync(fd);
      const df=openSync(dir,"r");fsyncSync(df);closeSync(df);
      const txid=run(bin("zcash-devtool"),["pczt","extract"],readFileSync(signed)).trim().split("\n").at(-1)!;
      ledger.stage(batch.id,signed,txid);
    }
    staged=ledger.batch(batch.id)!;
    requireThat(staged.txid&&staged.pczt_path&&staged.pczt_hash===hash(readFileSync(staged.pczt_path)),"stored signed PCZT missing or changed");
    wallet("sync","-s",env("BNZ_LWD_URL"));
    const known=JSON.parse(wallet("list-tx","--json")).find((t:any)=>t.txid===staged.txid);
    if(!known?.mined_height) {
      const metadata=inspect(staged.pczt_path!),tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
      requireThat(metadata.expiry_height>tip&&Math.abs(tip-4465026)>40,"expired PCZT or NU7 window; refusing broadcast");
      const sent=pczt("send","-s",env("BNZ_LWD_URL"),staged.pczt_path!).trim().split("\n").at(-1);
      requireThat(sent===staged.txid,"broadcast returned a different txid");console.log(`settlement broadcast ${sent}`);
    }
    const height=await mined(staged.txid!,Date.now()+30*60_000);
    for(const endpoint of [env("BNZ_LWD_URL"),env("BNZ_LWD_URL_ALT")]) {
      const observed=chainTx(staged.txid!,endpoint);requireThat(Number(observed.height)===height,"settlement height differs across endpoints");
    }
    const i=inspect(staged.pczt_path!),expected=destinations(batch.outputs,"alice");
    const receipt=expected.map(e=>{const o=i.outputs.find((o:any)=>o.recipient===e.recipient&&!o.is_change);return {party:e.party,amount_zats:o.amount_zats,index:o.index,pool:o.pool}});
    ledger.confirm(batch.id,staged.txid!,height,receipt);
    writeFileSync(base+".inspect.json",jsonBytes(i),{mode:0o600});
  }
  writeFileSync(file("receipts.json"),jsonBytes(ledger.receipts()),{mode:0o600});
  writeFileSync(file("summary.json"),jsonBytes({auction_id:id,rows:ledger.rows(),batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height FROM batches ORDER BY id").all(),signoffs,plan,offline_signer:"carol"}),{mode:0o600});
  process.stdout.write(jsonBytes({auction_id:id,settled:ledger.receipts().length}));
}
try {
  requireThat(/^[0-9a-f]{64}$/.test(id),"settlement auction id");mkdirSync(dir,{recursive:true,mode:0o700});
  if(command==="init") {
    requireThat(auction().state==="OPEN","routing intake must precede funding/clearing");
    const routing=JSON.parse(readFileSync(0,"utf8")),{manifest:m}=client(auction().manifest,auction().signer);
    requireThat(routing.bidders.length===m.deposit_addresses.length&&routing.bidders.every((b:any)=>m.deposit_addresses.includes(b.deposit_ua))&&new Set(routing.bidders.map((b:any)=>b.deposit_ua)).size===m.deposit_addresses.length,"routing deposit set");
    requireThat(new Set([...routing.bidders.map((b:any)=>b.refund_ua),routing.seller_ua]).size===routing.bidders.length+1,"unique party destinations");
    requireThat(!existsSync(file("routing-commitment.json")),"routing already pinned");
    for(const n of ["alice","bob","carol"])writeFileSync(file(`routing-${n}.json`),jsonBytes(routing),{mode:0o600});
    writeFileSync(file("routing-commitment.json"),jsonBytes({sha256:hash(jsonBytes(routing)),pinned_at:Date.now()}),{mode:0o600});
    process.stdout.write(jsonBytes(read("routing-commitment.json")));
  } else {
    const ledger=new Ledger(STATE,id);
    try {
      if(command==="run")await worker(ledger);
      else if(command==="check")process.stdout.write(jsonBytes(check(ledger,Number(arg1),arg2,arg3,arg4)));
      else if(command==="status")process.stdout.write(jsonBytes({rows:ledger.rows(),receipts:ledger.receipts(),batches:ledger.db.prepare("SELECT id,pczt_hash,txid,height FROM batches ORDER BY id").all()}));
      else throw Error("usage: init | run | status <auction> | check <auction> <batch> <PCZT> <signer>");
    } finally {ledger.close()}
  }
} catch(e) {process.stderr.write(`ERROR settle ${(e as Error).message}\n`);process.exitCode=1}
