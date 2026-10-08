// 1. Protects DESIGN §6: exact settlement outputs, local signer checks, durable crash-resume and unopened cancel.
// 2. P1 premature paid state, P2 omitted amount guard, and P3 opening on cancel break L1/J1/M1 respectively.
// 3. Existing specs end with one MAX refund; none protects multi-output settlement or a worker restart.
// 4. No test seam: shipped CLIs, real PCZTs, killed worker process group, closed drand port and two real FROST signers.
import {expect,test} from "@playwright/test";
import {createHash,randomBytes} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {appendFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import http from "node:http";
import path from "node:path";
import {bin,DRAND,E2E,ROOT,STATE,env,LWD,LWD_ALT} from "./lib/env";
import {Run,waitFor,write} from "./lib/run";
import {serveSealer,sealBid} from "./lib/sealer";
import {pubkey,startFrostd,zcashSign} from "./lib/frost";
import * as z from "./lib/zcash";
const IDS=["J1","J2","K1","L1","M1","N1"],C=Number(env("BNZ_COLLATERAL_ZATS")),ALT=LWD_ALT,MINE=30*60_000;
const freshAddress=(wallet:string)=>z.run(path.join(ROOT,"settle/target/release/benzo-pczt"),["address",path.join(STATE,wallet),"--network","test"]).trim();
// Wallet CLI total excludes uneconomic notes; measure all mined unspent notes through the shipped chain scanner.
const observedBalance=(wallet:string)=> {
  z.enhance(wallet);
  return z.run(z.scanner,["scan","test",path.join(STATE,wallet)]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(n=>n.height&&!n.spent_in_txid).reduce((sum,n)=>sum+n.value_zats,0);
};
const sha=(v:Buffer|string)=>createHash("sha256").update(v).digest("hex");
const bytes=(v:any)=>JSON.stringify(v)+"\n";
function cli(file:string,args:string[],input:any={},extra:any={}) {
  const r=spawnSync(process.execPath,[path.join(ROOT,file),...args],{input:JSON.stringify(input),encoding:"utf8",env:{...process.env,...extra},maxBuffer:64<<20});
  if(r.error)throw r.error;return {code:r.status,value:r.status===0?JSON.parse(r.stdout):null,error:r.stderr};
}
const ac=(cmd:string,id:string,input:any={})=>cli("clear/dist/auction.mjs",[cmd,id],input);
const sc=(cmd:string,id:string,args:string[]=[],input:any={},extra:any={})=>cli("settle/dist/cli.mjs",[cmd,id,...args],input,extra);
function worker(id:string,crash=false,extra:any={}) {
  return new Promise<{code:number|null;signal:string|null;allocated:number;error:string}>((resolve,reject)=> {
    const p=spawn(process.execPath,[path.join(ROOT,"settle/dist/cli.mjs"),"run",id],{detached:true,env:{...process.env,...extra}});
    const pidfile=path.join(STATE,"run",`settle-worker-${id}.pid`);writeFileSync(pidfile,String(p.pid));
    let out="",error="",allocated=0,killed=false;
    const deadline=setTimeout(()=>{process.kill(-p.pid!,"SIGKILL")},MINE);
    p.stdout.on("data",d=> {
      out+=d;appendFileSync(path.join(E2E,"settle-worker.log"),d);
      for(const line of out.split("\n"))try{const v=JSON.parse(line);if(v.allocated)allocated=v.allocated}catch{}
      if(crash&&allocated&&!killed){killed=true;process.kill(-p.pid!,"SIGKILL")}
    });
    p.stderr.on("data",d=>{error+=d;appendFileSync(path.join(E2E,"settle-worker.log"),d)});
    p.on("error",reject);p.on("close",(code,signal)=>{clearTimeout(deadline);rmSync(pidfile,{force:true});resolve({code,signal,allocated,error})});
  });
}
function batchUri(addresses:string[],memos:string[],reserveAddress:string,reserve:number) {
  const params=new URLSearchParams();
  [...addresses,reserveAddress].forEach((address,i)=> {
    const suffix=i?`.${i}`:"";params.set("address"+suffix,address);params.set("amount"+suffix,((i<addresses.length?C:reserve)/1e8).toFixed(8));
    if(i<addresses.length)params.set("memo"+suffix,Buffer.from(memos[i],"hex").toString("base64url"));
  });return "zcash:?"+params;
}
async function mature(txid:string) {
  const height=await waitFor({height:1,tip:()=>z.minedHeight(txid)},Date.now()+MINE);
  await waitFor({height:height+9,tip:()=>{z.sync("vault");z.sync("bidder");return Math.min(z.balance("vault").chain_tip_height,z.balance("bidder").chain_tip_height)}},Date.now()+MINE);
  z.enhance("vault");return height;
}
async function recovery() {
  z.sync("vault");if(!observedBalance("vault"))return;
  const dir=path.join(STATE,"run",`settle-recovery-${Date.now()}`);mkdirSync(dir,{recursive:true,mode:0o700});
  const created=path.join(dir,"created.pczt"),proven=path.join(dir,"proven.pczt"),signed=path.join(dir,"signed.pczt");
  z.pczt("vault","create-max","--address",freshAddress("bidder"),"--output",created);z.pczt("vault","prove",created,"--output",proven);
  await zcashSign(proven,signed);const txid=z.send(signed);
  await waitFor({height:1,tip:()=>{z.sync("vault");return JSON.parse(z.wallet("vault","list-tx","--json")).find((t:any)=>t.txid===txid)?.mined_height??0}},Date.now()+MINE);
  z.sync("bidder");z.sync("vault");console.log(`development-only fund recovery ${txid}`);
}
function capture(id:string,label:string) {
  const dir=path.join(STATE,"settle",id),status=sc("status",id).value;
  const summary=existsSync(path.join(dir,"summary.json"))?JSON.parse(readFileSync(path.join(dir,"summary.json"),"utf8")):null;
  const batches=status.batches.map((b:any)=> {
    const base=path.join(dir,`batch-${b.id}`),i=existsSync(base+".inspect.json")?JSON.parse(readFileSync(base+".inspect.json","utf8")):null;
    const signing=existsSync(base+".signatures.json")?JSON.parse(readFileSync(base+".signatures.json","utf8")):null;
    const proofs=b.height?[z.getTransaction(b.txid),...(ALT?[z.getTransaction(b.txid,ALT)]:[])]:[];
    return {...b,pczt_path:undefined,inspect:i?{...i,outputs:i.outputs.map(({recipient,...o}:any)=>o)}:null,signing,proofs:proofs.map(p=>({height:p.height,raw_hash:sha(p.raw)}))};
  });
  // F4 (R28): the member who never submitted a signoff is computed from the recorded signoffs, not a constant.
  const artifact={auction_id:id,rows:status.rows,receipts:status.receipts,batches,signoffs:summary?.signoffs??[],plan:summary?.plan??null,offline_signer:["alice","bob","carol"].find(n=>!(summary?.signoffs??[]).some((c:any)=>c.participant===n))};
  write(`settle/${label}/summary.json`,bytes(artifact));return artifact;
}

test("settlement survives a worker crash and drand outage with one signer not selected",async({page})=> {
  test.setTimeout(80*60_000);const run=new Run("settle-crash");
  for(const file of ["vault/data.sqlite","frost/alice.toml","frost/bob.toml","frost/carol.toml","ufvk.txt"])
    if(!existsSync(path.join(STATE,file)))run.notRun(IDS,`missing ${file}`);
  try{await fetch(`${DRAND}/info`).then(r=>{if(!r.ok)throw Error(`drand HTTP ${r.status}`)});for(const e of LWD)if(Math.abs(z.tip(e)-4465026)<=40)throw Error("NU7 window")}catch(e){run.notRun(IDS,(e as Error).message)}
  z.sync("bidder");z.sync("vault");z.enhance("vault");
  if(observedBalance("vault")!==0)run.notRun(IDS,"vault not empty; reconcile before new deposits");
  if(z.spendable(z.balance("bidder"))-4*C-100_000<3*C+40_000)run.notRun(IDS,"main drill would cross bidder floor; ask before spending");
  const stop=await startFrostd();
  try {
    const now=Math.ceil(Date.now()/1000),release=now+22*60,R=1+Math.ceil((release-Number(env("BNZ_DRAND_GENESIS")))/3);
    const id=randomBytes(32).toString("hex"),cancel=randomBytes(32).toString("hex"),price=100+10*randomBytes(1)[0],clearPrice=price+10;
    const addresses=Array.from({length:8},()=>freshAddress("vault")),refunds=Array.from({length:8},()=>freshAddress("bidder"));
    const key=path.join(STATE,"auction/manifest-signing.pem"),signer=cli("manifest/dist/cli.mjs",["public",key]).value.signer;
    const manifest=(auction_id:string,addrs:string[],cancelled=false)=>({version:1,network:"test",auction_id,escrow_ua:addrs[0],frost_group_key:readFileSync(path.join(STATE,"group-key.txt"),"utf8").trim(),lot:"settlement testnet drill",supply:2,reserve_zats:"10",tick_zats:"10",B_max_zats:"3000",q_max:1,C_zats:String(C),fee_zats:"0",deposit_addresses:addrs,drand:{chain_hash:env("BNZ_DRAND_CHAIN_HASH"),public_key:env("BNZ_DRAND_PUBLIC_KEY"),scheme:"bls-unchained-g1-rfc9380",genesis:Number(env("BNZ_DRAND_GENESIS")),period:3,R:cancelled?R+1960:R},T_submit:now+(cancelled?90:4)*60,T_freeze:now+(cancelled?106:20)*60,confirmations:10,clearing:{mode:"uniform",band:"floor_pro_rata_units",dust:"ascending_leaf_index",tie:"ascending_leaf_index",minimum_fill:1},refund:{invalid:"full_C",reorg:"C_minus_fee_remove_leaf",cancel:"full_C"},freeze:"merkle_root_v1"});
    const packets=[cli("manifest/dist/cli.mjs",["sign",key],manifest(id,addresses.slice(0,4))).value,cli("manifest/dist/cli.mjs",["sign",key],manifest(cancel,addresses.slice(4,6),true)).value];
    for(const [n,auction] of [id,cancel].entries()) {
      const initialized=ac("init",auction,{manifest:packets[n],signer});if(initialized.code)throw Error(initialized.error);
      const bidders=addresses.slice(n?4:0,n?6:4).map((deposit_ua,i)=>({deposit_ua,refund_ua:refunds[i+(n?4:0)]}));
      const pinned=sc("init",auction,[],{bidders,seller_ua:refunds[n?7:6],fee_reserve_ua:addresses[n?7:6]});if(pinned.code)throw Error(pinned.error);
      write(`settle/${n?"cancel":"main"}/manifest.json`,bytes(packets[n]));write(`settle/${n?"cancel":"main"}/routing-commitment.json`,bytes(pinned.value));
    }
    write("settle/signer.json",bytes({signer}));
    const server=await serveSealer(),sealed:any[]=[];
    try{await page.goto(server.url);for(let i=0;i<6;i++)sealed.push(await sealBid(page,{opening:new Date((i<4?release:release+5880)*1000).toISOString(),auction:i<4?id:cancel,price:String(i<4?[price+20,price+10,price,3010][i]:price),quantity:"1",collateral:String(C),address:addresses[i]}))}finally{server.close()}
    if(sealed.some(s=>!s.envelope))throw Error(sealed.find(s=>!s.envelope).error);
    const mainTx=z.pay(batchUri(addresses.slice(0,4),sealed.slice(0,4).map(s=>s.envelope),addresses[6],30000));console.log(`main deposits broadcast ${mainTx}`);await mature(mainTx);
    for(let i=0;i<4;i++){const r=ac("admit",id,{txid:mainTx,address:addresses[i],envelope_hex:sealed[i].envelope});if(r.code)throw Error(r.error)}
    await waitFor({round:1+Math.ceil((now+4*60-Number(env("BNZ_DRAND_GENESIS")))/3)},(now+5*60)*1000);
    const freeze=ac("freeze",id);if(freeze.code)throw Error(freeze.error);write("settle/main/frozen.json",bytes(freeze.value));
    await waitFor({round:R},(release+60)*1000);
    for(const op of ["open","clear"]){const r=ac(op,id);if(r.code)throw Error(r.error);if(op==="clear")write("settle/main/result.json",bytes(r.value))}
    const before=observedBalance("bidder"),killed=await worker(id,true),allocated=sc("status",id).value;
    write("settle/main/crash.json",bytes({signal:killed.signal,allocated:killed.allocated,rows:allocated.rows,batches:allocated.batches,at_utc:new Date().toISOString()}));
    const badFile=path.join(STATE,"settle",id,"wrong-amount.pczt"),expected=[C-clearPrice,C-clearPrice,C,C,2*clearPrice];
    z.run(path.join(ROOT,"settle/target/release/benzo-pczt"),["create",path.join(STATE,"vault"),badFile,"--network","test"],{input:JSON.stringify([refunds[0],refunds[1],refunds[2],refunds[3],refunds[6]].map((recipient,i)=>({recipient,amount_zats:String(expected[i]+(i===0?1:i===1?-1:0))})))});
    const bad=sc("check",id,["1",badFile,"alice"]),resumed=await worker(id);
    z.sync("bidder");z.enhance("bidder");z.sync("vault");const main=capture(id,"main"),after=observedBalance("bidder");
    await run.check("J1","correct amounts at real checker, PCZT and receiving-wallet boundaries",()=> {
      expect.soft(bad.code).not.toBe(0);expect.soft(bad.error).toContain("PCZT amount differs from result.json");
      expect.soft(resumed.code).toBe(0);expect.soft(main.receipts.map((r:any)=>Number(r.amount_zats)).sort((a:number,b:number)=>a-b)).toEqual([...expected].sort((a,b)=>a-b));
      const got=z.run(z.scanner,["scan","test",path.join(STATE,"bidder")]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
      [refunds[0],refunds[1],refunds[2],refunds[3],refunds[6]].forEach((address,i)=>expect.soft(got.filter(n=>n.address===address).reduce((n,l)=>n+l.value_zats,0)).toBe(expected[i]));
      for(const b of main.batches){expect.soft(b.inspect?.input_zats).toBe(4*C+30000);expect.soft(b.inspect?.output_zats).toBe(4*C);expect.soft(b.inspect?.fee_zats).toBe(30000);expect.soft(b.proofs.length).toBe(LWD.length);if(ALT)expect.soft(b.proofs[0]).toEqual(b.proofs[1])}
      expect.soft(after-before).toBe(4*C);expect.soft(observedBalance("vault")).toBe(0);
      write("settle/main/balances.json",bytes({before,after,vault:observedBalance("vault"),deposit_txid:mainTx,collateral_zats:C,fee_reserve_zats:30000,expected_output_zats:expected}));
    });
    await run.check("L1","real kill and resume produce one final receipt per obligation",()=> {
      expect.soft(killed.signal).toBe("SIGKILL");expect.soft(killed.allocated).toBe(5);expect.soft(allocated.rows.filter((r:any)=>r.state==="allocated").length).toBe(5);
      expect.soft(new Set(main.rows.map((r:any)=>r.party)).size).toBe(5);expect.soft(main.rows.filter((r:any)=>["paid","refunded"].includes(r.state)).length).toBe(5);
      expect.soft(new Set(main.receipts.map((r:any)=>`${r.txid}:${r.pool}:${r.output_index}`)).size).toBe(5);expect.soft(after-before).toBe(4*C);
    });
    await run.check("J2","private receipts have only settlement fields",()=> {
      expect.soft(main.receipts.length).toBe(5);for(const r of main.receipts){expect.soft(Object.keys(r).sort()).toEqual(["auction_id","party","txid","pool","output_index","amount_zats"].sort());expect.soft(r.txid).toMatch(/^[0-9a-f]{64}$/);expect.soft(r.auction_id).toBe(id)}
    });
    await run.check("K1","each participant checked result before each FROST session",()=> {
      const sessions=main.batches.flatMap((b:any)=>b.signing?.sessions??[]);expect.soft(sessions.length).toBeGreaterThan(0);
      expect.soft(new Set(sessions.map((s:any)=>s.randomizer)).size).toBe(sessions.length);
      for(const s of sessions){expect.soft(s.signature).toMatch(/^[0-9a-f]{128}$/);for(const name of ["alice","bob"]){const checks=main.signoffs.filter((c:any)=>c.randomizer===s.randomizer&&c.participant===name);expect.soft(checks.length).toBe(1);expect.soft(checks[0]?.pubkey).toBe(pubkey(name));expect.soft(checks[0]?.checked_at).toBeLessThanOrEqual(s.coordinator_started_at);expect.soft(checks[0]?.result_hash).toBe(sha(readFileSync(path.join(ROOT,"tmp/e2e/out/settle/main/result.json"))));expect.soft(checks[0]?.checks.length).toBe(4)}}
    });
    await run.check("N1","Alice and Bob are the configured pair; Carol is not selected (not an offline drill)",()=> {expect.soft(main.batches.flatMap((b:any)=>b.signing?.sessions??[]).length).toBeGreaterThan(0);for(const b of main.batches)for(const s of b.signing?.sessions??[]){expect.soft(s.signers).toEqual([pubkey("alice"),pubkey("bob")]);expect.soft(s.signers).not.toContain(pubkey("carol"));expect.soft(s.participantsSaw).toEqual([s.sighash,s.sighash])}expect.soft(main.offline_signer).toBe("carol")});
    await recovery();
    z.sync("bidder");if(z.spendable(z.balance("bidder"))-2*C-100000<3*C+40000)throw Error("ask before cancel spend below bidder floor");
    const cancelTx=z.pay(batchUri(addresses.slice(4,6),sealed.slice(4,6).map(s=>s.envelope),addresses[7],15000));console.log(`cancel deposits broadcast ${cancelTx}`);await mature(cancelTx);
    for(let i=4;i<6;i++){const r=ac("admit",cancel,{txid:cancelTx,address:addresses[i],envelope_hex:sealed[i].envelope});if(r.code)throw Error(r.error)}
    const cancelled=ac("cancel",cancel);if(cancelled.code)throw Error(cancelled.error);
    const closed=http.createServer();await new Promise<void>(r=>closed.listen(0,"127.0.0.1",r));const port=(closed.address() as any).port;await new Promise<void>(r=>closed.close(()=>r()));
    const dead=`http://127.0.0.1:${port}`,cancelBefore=observedBalance("bidder");
    const outage=await fetch(dead).then(()=>"unexpected response").catch((e:any)=>e.cause?.code);
    const cancelledRun=await worker(cancel,false,{BNZ_DRAND_URLS:dead});z.sync("bidder");z.sync("vault");const c=capture(cancel,"cancel"),cancelAfter=observedBalance("bidder");
    const trace=existsSync(path.join(STATE,"run","settle-tle.jsonl"))?readFileSync(path.join(STATE,"run","settle-tle.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(l=>l.auction_id===cancel):[];
    write("settle/cancel/outage.json",bytes({outage,opening_calls:trace.length,worker_code:cancelledRun.code,worker_error:cancelledRun.error,deposit_txid:cancelTx,before:cancelBefore,after:cancelAfter,collateral_zats:C,fee_reserve_zats:15000}));
    await run.check("M1","closed drand endpoint cannot impede exact-C unopened refunds",()=> {
      expect.soft(outage).toBe("ECONNREFUSED");expect.soft(cancelledRun.code).toBe(0);expect.soft(trace.length).toBe(0);expect.soft(cancelled.value.trace.filter((r:any)=>r.operation==="tle -d").length).toBe(0);
      expect.soft(c.receipts.map((r:any)=>r.amount_zats)).toEqual([String(C),String(C)]);expect.soft(cancelAfter-cancelBefore).toBe(2*C);expect.soft(observedBalance("vault")).toBe(0);
      for(const b of c.batches){expect.soft(b.inspect?.input_zats).toBe(2*C+15000);expect.soft(b.inspect?.output_zats).toBe(2*C);expect.soft(b.proofs.length).toBe(LWD.length);if(ALT)expect.soft(b.proofs[0]).toEqual(b.proofs[1])}
    });
  } finally {try{await recovery()}finally{stop()}}
});
