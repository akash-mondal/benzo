// 1. Protects DESIGN §3–5, §6 cancellation and threats 001/003/013/021/036/057: signed parameters,
//    sealed-set inclusion, deterministic clearing and exact-C cancellation on real testnet.
// 2. N1–N7 break signed round binding, cutoff, ciphertext commitment, leaf ties, amount admission,
//    replay uniqueness or cancellation without opening; each has its contracted assertion ID.
// 3. Phase 1's two regression specs prove primitives, not an auction manifest, accepted set or clearing.
// 4. No test-only production seam: built CLI entry points, browser sealer, real wallets/scanner, Go tle and FROST.
//
// R35 fold (run 33), g7-* IDs (folded from tools/repro/g7-network-repro.mjs, which is deleted at gate RG):
// 1. Behaviour: G-7 network-aware address checks — official mainnet-format UAs are accepted only on their own
//    network, `benzo-pczt` network commands refuse without --network and decode a UFVK only under its own network,
//    and the manifest's network:"test" lock stays (PHASE-5 R28 open item, closed run 30; kept by R33 P2-1).
// 2. Regression: uaShape/isUnifiedOn/classify-address accepting a mainnet UA under test (or the mirror), or a
//    network-dependent benzo-pczt command silently defaulting — the cross-network confusion G-7 guards.
// 3. No existing test feeds official mainnet-format vectors (tools/repro/fixtures/zcash-address-cases.json) or the
//    classifier cross-network; every other check runs on testnet-format data only.
// 4. Seam: none needed — the shipped benzo-pczt and the pinned zcash-sign, over official zcash-test-vectors rows
//    (expected values come from the vectors' own labels, never from our code).
// IDs: g7-classifier-network-labels, g7-mainnet-ua-on-main, g7-mainnet-ua-refused-on-test, g7-testnet-ua-on-test,
// g7-testnet-ua-refused-on-main, g7-ufvk-fixture-shape, g7-ufvk-network-main, g7-ufvk-network-test,
// g7-missing-network-refused, g7-manifest-lock-stays, g7-main-address-checks-ready.
import {expect,test} from "@playwright/test";
import {createHash,randomBytes} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import path from "node:path";
import {bin,DRAND,env,LWD,LWD_ALT,ROOT,STATE} from "./lib/env";
import {pinsMismatch} from "./lib/pins";
import {startFrostd,zcashSign} from "./lib/frost";
import {Run,waitFor,write} from "./lib/run";
import {serveSealer,sealBid} from "./lib/sealer";
import {tleDecrypt} from "./lib/tools";
import * as z from "./lib/zcash";
import {uaShape,validateManifest} from "../manifest/schema";
import {isUnifiedOn} from "../envelope/destination";

const IDS=["E1","E2","F1","F2","G1","G2","G3","H1","H2","H3","H4","I1"];
const C=Number(env("BNZ_COLLATERAL_ZATS")), MINE=30*60_000, ALT=LWD_ALT;
const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const canonical=(v:any):string=>Array.isArray(v)?`[${v.map(canonical).join(",")}]`:v!==null&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")}}`:JSON.stringify(v);
const bytes=(v:any)=>Buffer.from(canonical(v)+"\n");
function cli(file:string,args:string[],input:any) {
  const r=spawnSync(process.execPath,[path.join(ROOT,file),...args],{input:JSON.stringify(input),encoding:"utf8",maxBuffer:64<<20});
  if(r.error)throw r.error; return {code:r.status,out:r.stdout,error:r.stderr,value:r.status===0?JSON.parse(r.stdout):null};
}
// Independent published Merkle protocol, not an import from production: raw ciphertext hash + deposit reference.
function included(r:any,f:any,ctHash=r.ciphertext_hash) {
  let node=sha(Buffer.concat([Buffer.from([0]),Buffer.from(ctHash,"hex"),bytes(r.deposit)]));
  for(const p of f.paths[r.leaf_index]??[])node=sha(Buffer.concat([Buffer.from([1]),... (p.side==="left"?[p.hash,node]:[node,p.hash]).map(h=>Buffer.from(h,"hex"))]));
  return node===f.root;
}

test("signed sealed auction on testnet",async({page})=> {
  test.setTimeout(75*60_000);
  const run=new Run("auction-core"), pinned=pinsMismatch();
  if(pinned)run.notRun(IDS,pinned);
  const info=await fetch(`${DRAND}/info`).then(async r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}).catch(e=>run.notRun(IDS,`drand ${e.message}`));
  for(const endpoint of LWD)try{z.tip(endpoint)}catch(e){run.notRun(IDS,`${endpoint}: ${(e as Error).message}`)}
  for(const f of ["vault/data.sqlite","frost/alice.toml","frost/bob.toml","frost/carol.toml"])
    if(!existsSync(path.join(STATE,f)))run.notRun(IDS,`missing ${f}`);
  z.sync("bidder"); if(z.spendable(z.balance("bidder"))<3*C+40_000)run.notRun(IDS,"bidder below 3C + 40000");
  z.sync("vault"); z.enhance("vault");
  const oldNotes=z.scanVault().filter(n=>n.height&&!n.spent_in_txid&&n.value_zats>0); // create-max spends positive notes only; scanner also reports zero-value dummy outputs that ZIP-317 never counts
  const reserve=5000*Math.max(2,oldNotes.length+6);
  if(z.spendable(z.balance("bidder"))-5*C-reserve-6*15_000<3*C+40_000)run.notRun(IDS,"five-note drill would cross bidder floor; ask before spending");
  const key=path.join(STATE,"auction/manifest-signing.pem");
  if(!existsSync(key)) {
    const created=cli("manifest/dist/cli.mjs",["keygen",key],{}); if(created.code!==0)run.notRun(IDS,created.error);
  }
  const signer=cli("manifest/dist/cli.mjs",["public",key],{}).value.signer;
  // ---- R35 fold: g7-network (official mainnet-format fixtures against the network-aware checks) ----
  const G7=["g7-classifier-network-labels","g7-mainnet-ua-on-main","g7-mainnet-ua-refused-on-test","g7-testnet-ua-on-test","g7-testnet-ua-refused-on-main","g7-ufvk-fixture-shape","g7-ufvk-network-main","g7-ufvk-network-test","g7-missing-network-refused","g7-manifest-lock-stays","g7-main-address-checks-ready"];
  const pcztBin=path.join(ROOT,"settle/target/release/benzo-pczt");
  const pczt=(args:string[])=>{try{return{code:0,out:execFileSync(pcztBin,args,{encoding:"utf8",maxBuffer:64<<20}),err:""}}catch(e:any){return{code:e.status??1,out:e.stdout??"",err:e.stderr??""}}};
  const need=(ok:boolean,why:string)=>{if(!ok)throw Error(why)};
  if(!existsSync(pcztBin))run.notRun(G7,"benzo-pczt missing (npm run build:settle)");
  {
    const cases=JSON.parse(readFileSync(path.join(ROOT,"tools/repro/fixtures/zcash-address-cases.json"),"utf8"));
    const labelBad:string[]=[],mainBad:string[]=[],mainRef:string[]=[],testBad:string[]=[],testRef:string[]=[];
    for(const r of cases.ua){
      const c=JSON.parse(pczt(["classify-address",r.address]).out.trim());
      if(c.kind!=="unified"||c.network!==r.network)labelBad.push(`${r.address.slice(0,12)} want unified/${r.network}`);
      const shielded=r.receivers.some((x:any)=>x.typecode===2||x.typecode===3);
      if(shielded!==r.shielded)labelBad.push(`${r.address.slice(0,12)} shielded ${shielded} want ${r.shielded}`);
      if(r.network==="main"){
        if(!uaShape(r.address,"main")||isUnifiedOn(r.address,"main")!==r.shielded)mainBad.push(r.address.slice(0,16));
        if(uaShape(r.address,"test")||isUnifiedOn(r.address,"test"))mainRef.push(r.address.slice(0,16));
      }
      if(r.network==="test"){
        if(!uaShape(r.address,"test")||isUnifiedOn(r.address,"test")!==r.shielded)testBad.push(r.address.slice(0,16));
        if(uaShape(r.address,"main")||isUnifiedOn(r.address,"main"))testRef.push(r.address.slice(0,16));
      }
    }
    await run.check("g7-classifier-network-labels","classify-address reports the vectors' own network labels",()=>need(labelBad.length===0,labelBad.slice(0,3).join(" | ")));
    await run.check("g7-mainnet-ua-on-main","mainnet UAs pass uaShape/isUnifiedOn on main exactly when shielded",()=>need(mainBad.length===0,mainBad.slice(0,3).join(" | ")));
    await run.check("g7-mainnet-ua-refused-on-test","the same mainnet UAs are refused under test",()=>need(mainRef.length===0,mainRef.slice(0,3).join(" | ")));
    await run.check("g7-testnet-ua-on-test","testnet UAs pass on test exactly when shielded",()=>need(testBad.length===0,testBad.slice(0,3).join(" | ")));
    await run.check("g7-testnet-ua-refused-on-main","the same testnet UAs are refused under main",()=>need(testRef.length===0,testRef.slice(0,3).join(" | ")));
  }
  {
    const ak="07".padStart(64,"0");
    const gen=(net:string)=>execFileSync(bin("zcash-sign"),["generate","-n",net,"--ak",ak],{encoding:"utf8",maxBuffer:64<<20}).match(/Unified Full Viewing Key: "(.*)"/)?.[1]??"";
    const ufvkMain=gen("main"),ufvkTest=gen("test");
    await run.check("g7-ufvk-fixture-shape","the pinned zcash-sign emits uview1/uviewtest1 UFVKs for the fixture ak",()=>need(ufvkMain.startsWith("uview1")&&ufvkTest.startsWith("uviewtest1"),`${ufvkMain.slice(0,10)}/${ufvkTest.slice(0,12)}`));
    const dir=path.join(STATE,"g7");mkdirSync(dir,{recursive:true});
    for(const [net,uf] of [["main",ufvkMain],["test",ufvkTest]]){
      const f=path.join(dir,`ufvk-${net}.txt`);writeFileSync(f,uf+"\n",{mode:0o600});
      const ok=pczt(["ufvk-ak",f,"--network",net]),wrong=net==="main"?"test":"main",bad=pczt(["ufvk-ak",f,"--network",wrong]);
      await run.check(`g7-ufvk-network-${net}`,"ufvk-ak decodes a UFVK only under its own network, returning the ak it was made from",()=>{need(ok.code===0&&ok.out.trim()===ak,`own ${ok.code}/${ok.out.trim().slice(0,8)}`);need(bad.code!==0&&/UFVK decode/.test(bad.err),`wrong-network accepted: ${bad.code}`)});
    }
    const none=pczt(["ufvk-ak",path.join(dir,"ufvk-test.txt")]),noneAddr=pczt(["address",path.join(dir,"no-wallet")]);
    await run.check("g7-missing-network-refused","ufvk-ak and address refuse without --network",()=>need(none.code!==0&&/missing --network/.test(none.err+none.out)&&noneAddr.code!==0&&/missing --network/.test(noneAddr.err+noneAddr.out),`ufvk-ak ${none.code}, address ${noneAddr.code}`));
    rmSync(dir,{recursive:true,force:true});
  }
  {
    const mainAddr=JSON.parse(readFileSync(path.join(ROOT,"tools/repro/fixtures/zcash-address-cases.json"),"utf8")).ua.find((r:any)=>r.network==="main"&&r.shielded).address;
    const base:any={
      version:1,network:"main",auction_id:"00".repeat(32),escrow_ua:mainAddr,frost_group_key:"11".repeat(32),
      lot:"g7",supply:1,reserve_zats:"0",tick_zats:"1",B_max_zats:"2",q_max:1,C_zats:"2",fee_zats:"0",
      deposit_addresses:[mainAddr],
      drand:{chain_hash:env("BNZ_DRAND_CHAIN_HASH"),public_key:env("BNZ_DRAND_PUBLIC_KEY"),scheme:"bls-unchained-g1-rfc9380",genesis:Number(env("BNZ_DRAND_GENESIS")),period:3,R:5},
      T_submit:1_000,T_freeze:3_000,confirmations:10,
      clearing:{mode:"uniform",band:"floor_pro_rata_units",dust:"ascending_leaf_index",tie:"ascending_leaf_index",minimum_fill:1},
      refund:{invalid:"full_C",reorg:"C_minus_fee_remove_leaf",cancel:"full_C"},freeze:"merkle_root_v1",
    };
    let lockMsg="";try{validateManifest(base)}catch(e:any){lockMsg=String(e.message)}
    await run.check("g7-manifest-lock-stays","the manifest schema still refuses network:\"main\" (version/network lock)",()=>need(/version\/network/.test(lockMsg),`a network:"main" manifest passed validateManifest (${lockMsg})`));
    await run.check("g7-main-address-checks-ready","the manifest's u1 escrow_ua passes the network-aware checks under main",()=>need(uaShape(base.escrow_ua,"main")&&isUnifiedOn(base.escrow_ua,"main"),"u1 escrow_ua not accepted under main"));
  }
  const stop=await startFrostd();
  try {
    const addresses=Array.from({length:6},()=>z.generateAddress("vault"));
    const start=Math.ceil(Date.now()/1000), T=start+45*60, R=1+Math.ceil((T-Number(env("BNZ_DRAND_GENESIS")))/3);
    const auction=randomBytes(32).toString("hex"), cancelId=randomBytes(32).toString("hex"), price=String(100+10*randomBytes(1)[0]);
    const manifest=(id:string,release:number,addrs:string[])=>({version:1,network:"test",auction_id:id,escrow_ua:addrs[0],frost_group_key:readFileSync(path.join(STATE,"group-key.txt"),"utf8").trim(),lot:"testnet auction drill",supply:3,reserve_zats:"10",tick_zats:"10",B_max_zats:"3000",q_max:3,C_zats:String(C),fee_zats:"0",deposit_addresses:addrs,drand:{chain_hash:env("BNZ_DRAND_CHAIN_HASH"),public_key:env("BNZ_DRAND_PUBLIC_KEY"),scheme:"bls-unchained-g1-rfc9380",genesis:Number(env("BNZ_DRAND_GENESIS")),period:3,R:release},T_submit:start+29*60,T_freeze:start+42*60,confirmations:10,clearing:{mode:"uniform",band:"floor_pro_rata_units",dust:"ascending_leaf_index",tie:"ascending_leaf_index",minimum_fill:1},refund:{invalid:"full_C",reorg:"C_minus_fee_remove_leaf",cancel:"full_C"},freeze:"merkle_root_v1"});
    const m=manifest(auction,R,addresses.slice(0,4)), cm={...manifest(cancelId,R+900,addresses.slice(4,5)),T_submit:start+74*60,T_freeze:start+87*60};
    const signingPacket=cli("manifest/dist/cli.mjs",["sign",key],m),cancelPacket=cli("manifest/dist/cli.mjs",["sign",key],cm);
    const signed=signingPacket.value,cancelSigned=cancelPacket.value;
    const ac=(command:string,id=auction,input:any={})=>cli("clear/dist/auction.mjs",[command,id],input);
    write("auction/manifest.json",bytes(signed)); write("auction/cancel-manifest.json",bytes(cancelSigned));write("auction/signer.json",bytes({signer}));
    await run.check("E1","signed bytes bind the exact round",()=> {
      if(signingPacket.code!==0 || cancelPacket.code!==0)throw Error(`manifest signing: ${signingPacket.error || cancelPacket.error}`);
      const display=cli("manifest/dist/cli.mjs",["client",signer],signed);
      expect.soft(display.value?.manifest_hash).toBe(sha(Buffer.from(signed.bytes,"base64")));
      const original=Buffer.from(signed.bytes,"base64"), changed=Buffer.from(original);
      const offset=original.indexOf(Buffer.from(`"R":${R}`))+4+String(R).length-1;
      changed[offset]=changed[offset]===57?56:changed[offset]+1; // one ASCII digit, still valid schema
      const r=cli("manifest/dist/cli.mjs",["client",signer],{...signed,bytes:changed.toString("base64"),sha256:sha(changed)});
      expect.soft(r.code).not.toBe(0);expect.soft(r.error).toContain("refused: manifest signature");
    });
    for(const [id,packet] of [[auction,signed],[cancelId,cancelSigned]]) {const r=ac("init",id,{manifest:packet,signer});if(r.code!==0)throw Error(r.error)}
    const server=await serveSealer(); const sealed:Awaited<ReturnType<typeof sealBid>>[]=[];
    try {
      await page.goto(server.url);
      for(let i=0;i<5;i++)sealed.push(await sealBid(page,{opening:new Date((i===4?T+2700:T)*1000).toISOString(),auction:i===4?cancelId:auction,price,quantity:String(i===1?2:3),collateral:String(C+(i===2?-1:i===3?1:0)),address:addresses[i]}));
    } finally {server.close()}
    if(sealed.some(s=>!s.envelope))throw Error(`sealer error: ${sealed.find(s=>!s.envelope)?.error}`);
    sealed.forEach((s,i)=>write(`auction/bid${i}.memo.hex`,s.envelope+"\n"));
    const txids:string[]=[], heights:number[]=[];
    const reserveUri=`zcash:${addresses[5]}?amount=${(reserve/100_000_000).toFixed(8)}`;
    for(const uri of [...sealed.map(s=>s.uri),reserveUri]) {
      z.sync("bidder");
      if(z.spendable(z.balance("bidder"))<C+15_000 && txids.length) {
        const previous=txids[txids.length-1];
        const h=await waitFor({height:1,tip:()=>z.minedHeight(previous)},Date.now()+MINE);
        await waitFor({height:h+2,tip:()=>{z.sync("bidder");return z.balance("bidder").chain_tip_height}},Date.now()+MINE);
      }
      if(z.balance("bidder").total-C-15_000<3*C+40_000)throw Error("ask before spend below bidder floor");
      const txid=z.pay(uri); txids.push(txid);console.log(`deposit ${txids.length}/6 broadcast ${txid}`);
    }
    for(const txid of txids)heights.push(await waitFor({height:1,tip:()=>z.minedHeight(txid)},Date.now()+MINE));
    const last=Math.max(...heights);
    await waitFor({height:last+9,tip:()=>{z.sync("vault");return z.balance("vault").chain_tip_height}},Date.now()+16*150_000);
    z.enhance("vault"); const notes=z.scanVault().filter(n=>txids.includes(n.txid));
    write("auction/deposits.json",bytes({txids,heights,notes,fee_reserve_zats:reserve}));
    const attempt=(i:number,id=auction,envelope=sealed[i].envelope)=>ac("admit",id,{txid:txids[i],address:addresses[i],envelope_hex:envelope});
    const admitted=[attempt(0),attempt(1)];
    const receipts=admitted.map(r=>r.value?.receipt); write("auction/receipts.json",bytes(receipts));
    await run.check("H1","truncated envelope rejected without receipt",()=> {
      const bad=attempt(0,auction,sealed[0].envelope.slice(0,-2));expect.soft(bad.code).not.toBe(0);expect.soft(bad.error).toContain("refused: envelope length");expect.soft(bad.value?.receipt??null).toBeNull();
    });
    await run.check("H2","under and over C never admitted",()=> {
      const attempts=[attempt(2),attempt(3)];
      attempts.forEach(r=>{expect.soft(r.code).not.toBe(0);expect.soft(r.error).toContain("refused: deposit amount differs from C");expect.soft(r.value?.receipt??null).toBeNull()});
      write("auction/bad-amounts.json",bytes(attempts.map((r,i)=>({txid:txids[i+2],value_zats:C+(i?-1:1)*-1,outcome:r.code===0?"accepted":"rejected",reason:r.error.trim()}))));
    });
    await run.check("H3","known pair has one idempotent receipt and leaf",()=> {
      const replay=attempt(0), status=ac("status");expect.soft(replay.value?.replay).toBe(true);expect.soft(replay.value?.receipt).toEqual(receipts[0]);expect.soft(status.value?.leaves.length).toBe(2);
    });
    const cancelledAdmission=attempt(4,cancelId); if(cancelledAdmission.code!==0)throw Error(cancelledAdmission.error);
    const submitRound=1+Math.ceil((m.T_submit-Number(env("BNZ_DRAND_GENESIS")))/3);
    await waitFor({round:submitRound},(m.T_submit+60)*1000);
    const freeze=ac("freeze"), frozen=freeze.value;
    write("auction/frozen.json",bytes(frozen));
    await run.check("F1","ordered freeze matches accepted receipts",()=> {
      expect.soft(frozen?.leaf_count).toBe(2);
      for(let i=0;i<2;i++) {const r=JSON.parse(Buffer.from(receipts[i].bytes,"base64").toString());expect.soft(r.leaf_index).toBe(i);expect.soft(frozen?.leaves[i].ciphertext_hash).toBe(sha(Buffer.from(sealed[i].envelope,"hex").subarray(7,7+Buffer.from(sealed[i].envelope,"hex").readUInt16BE(5))))}
    });
    await run.check("F2","independent Merkle inclusion and nonmember rejection",()=> {
      for(let i=0;i<2;i++) {const r=JSON.parse(Buffer.from(receipts[i].bytes,"base64").toString());expect.soft(included(r,frozen)).toBe(true);expect.soft(included(r,frozen,randomBytes(32).toString("hex"))).toBe(false);expect.soft(ac("receipt",auction,{receipt:receipts[i],frozen}).value?.included).toBe(true)}
    });
    // Use the drand round tied to the cutoff rather than a fixed sleep.
    const cutoffRound=1+Math.ceil((m.T_freeze-Number(env("BNZ_DRAND_GENESIS")))/3);
    await waitFor({round:cutoffRound},(m.T_freeze+60)*1000);
    await run.check("E2","two admitted while OPEN; cutoff attempt gets no receipt",()=> {
      admitted.forEach(r=>{expect.soft(r.code).toBe(0);expect.soft(r.value?.receipt?.signature).toMatch(/^[0-9a-f]{128}$/)});
      const late=attempt(0);expect.soft(late.code).not.toBe(0);expect.soft(late.error).toContain("refused: admission cutoff");expect.soft(late.value?.receipt??null).toBeNull();
    });
    await waitFor({round:R},(T+60)*1000);
    await run.check("H4","cutoff and past round refuse admission",()=> {
      const late=attempt(1);expect.soft(late.code).not.toBe(0);expect.soft(late.error).toContain("refused: admission cutoff");expect.soft(late.value?.receipt??null).toBeNull();
    });
    let golden:any;
    await run.check("G1","fresh Go tle clean-room input reproduces canonical result",()=> {
      const opening=ac("open");expect.soft(opening.code).toBe(0);
      const result=ac("clear"); golden=result.value;
      const independent=frozen.leaves.map((l:any)=> {
        const r=tleDecrypt(Buffer.from(l.ciphertext_hex,"hex"));expect.soft(r.code).toBe(0);return {leaf_index:l.leaf_index,plaintext_hex:r.stdout.toString("hex")};
      }).reverse();
      const input={manifest:signed,signer,frozen,opened:independent};
      const clean=cli("clear/dist/cli.mjs",[],input);expect.soft(clean.out).toBe(result.out);
      write("auction/opened.json",bytes(independent));write("auction/result.json",result.out);write("auction/clear-input.json",bytes(input));
    });
    await run.check("G2","uniform price, marginal pro-rata and leaf dust",()=> {
      const input=JSON.parse(readFileSync(path.join(ROOT,"tmp/e2e/out/auction/clear-input.json"),"utf8"));
      const result=cli("clear/dist/cli.mjs",[],input).value;
      expect.soft(result?.clearing_price_zats).toBe(price);expect.soft(result?.allocations.map((a:any)=>a.fill)).toEqual([2,1]);expect.soft(result?.allocations.map((a:any)=>a.payment_zats)).toEqual([String(2*Number(price)),price]);
    });
    await run.check("G3","single-lot winner pays second price",()=> {
      const input=JSON.parse(readFileSync(path.join(ROOT,"tmp/e2e/out/auction/clear-input.json"),"utf8"));const result=cli("clear/dist/cli.mjs",[],input).value?.comparison;
      expect.soft(result?.allocations.map((a:any)=>a.fill)).toEqual([1,0]);expect.soft(result?.allocations[0].payment_zats).toBe(price);write("auction/vickrey.json",bytes(result));
    });
    await run.check("I1","exact C cancel refund with fee-reserve and zero opening calls",async()=> {
    const cancelled=ac("cancel",cancelId);write("auction/cancel.json",bytes({code:cancelled.code,response:cancelled.value,error:cancelled.error}));
    const freshTip=Math.max(z.tip(),ALT?z.tip(ALT):0);
    await waitFor({height:freshTip,tip:()=>{z.sync("vault");z.sync("bidder");return Math.min(z.balance("vault").chain_tip_height,z.balance("bidder").chain_tip_height)}},Date.now()+MINE);
    const before={bidder:z.balance("bidder").total,vault:z.balance("vault").total};
    const refundTo=z.generateAddress("bidder"), dir=path.join(STATE,"run",`auction-pczt-${Date.now()}`);mkdirSync(dir,{recursive:true,mode:0o700});
    const [created,proven,signedPczt]=["created","proven","signed"].map(n=>path.join(dir,`${n}.pczt`));
    z.pczt("vault","create-max","--address",refundTo,"--output",created);
    const inspect=z.pczt("vault","inspect",created);z.pczt("vault","prove",created,"--output",proven);
    const signing=await zcashSign(proven,signedPczt);
    const sum=(re:RegExp)=>[...inspect.matchAll(re)].reduce((n,m)=>n+Number(m[1]),0), inputs=sum(/^ {2}- Spend: (\d+) zatoshis$/gm), outputs=sum(/^ {2}- Output: (\d+) zatoshis/gm),fee=inputs-outputs;
    if(fee!==reserve)throw Error(`fee reserve ${reserve} differs from inspected fee ${fee}; refusing refund broadcast`);
    const metadata=JSON.parse(z.run(z.scanner,["pczt",signedPczt])),broadcastTip=Math.max(z.tip(),ALT?z.tip(ALT):0);
    if(metadata.tx_version!==6 || !["37a5165b","77190ad9"].includes(metadata.consensus_branch_id) || metadata.expiry_height<=broadcastTip)throw Error(`PCZT preflight: version/branch/expiry ${JSON.stringify(metadata)} at tip ${broadcastTip}; no broadcast`);
    const refundTxid=z.send(signedPczt), sent=Date.now();console.log(`refund broadcast ${refundTxid}`);
    const walletHeight=await waitFor({height:1,tip:()=> {
      z.sync("vault");const txs=JSON.parse(z.wallet("vault","list-tx","--json"));
      const tx=txs.find((t:any)=>t.txid===refundTxid);return tx?.mined_height??0; // documented null means unmined, not invented transaction data
    }},sent+MINE);
    const height=z.getTransaction(refundTxid).height;
    if(height!==walletHeight)throw Error(`refund chain height ${height} differs from wallet-confirmed height ${walletHeight}`);
    if(ALT)await waitFor({height,tip:()=>z.tip(ALT)},sent+MINE);
    const alternate=ALT?z.getTransaction(refundTxid,ALT):null;
    await waitFor({height,tip:()=>{z.sync("bidder");z.sync("vault");return Math.min(z.balance("bidder").chain_tip_height,z.balance("vault").chain_tip_height)}},sent+MINE);
    z.enhance("vault"); const spent=z.scanVault().filter(n=>n.spent_in_txid===refundTxid),after={bidder:z.balance("bidder").total,vault:z.balance("vault").total};
    const settlement={refund_txid:refundTxid,height,alternate_height:alternate?.height??"none (BNZ_LWD_SINGLE=1, R27/R47)",fee_reserve_zats:reserve,fee_zats:fee,input_zats:inputs,output_zats:outputs,before,after,deposits:spent.filter(n=>txids.includes(n.txid)),cancel_deposit_txid:txids[4],cancel_refund_zats:C,preflight:{fresh_tip:freshTip,broadcast_tip:broadcastTip,...metadata}};
    write("auction/refund.json",bytes(settlement));write("auction/pczt-inspect.txt",inspect);write("auction/signatures.json",bytes(signing));
      expect.soft(cancelled.code).toBe(0);expect.soft(cancelled.value?.refunds.map((r:any)=>r.amount_zats)).toEqual([String(C)]);
      expect.soft(cancelled.value?.trace.filter((r:any)=>r.operation==="tle -d").length).toBe(0);
      expect.soft(spent.find(n=>n.txid===txids[4])?.value_zats).toBe(C);
      expect.soft(after.bidder-before.bidder).toBe(5*C+oldNotes.reduce((n,l)=>n+l.value_zats,0));expect.soft(after.vault).toBe(0);
      if(alternate)expect.soft(alternate.height).toBe(height);expect.soft(fee).toBe(reserve);
    });
    if(!ALT)run.narrowed("I1","single lightwalletd endpoint; second-endpoint agreement not checked (BNZ_LWD_SINGLE=1, R27/R47)");
  } finally {
    // R51: a run that throws after funding sweeps the vault back to the bidder (development-only, as cli-auction's
    // cleanup); RG attempt 5 left six deposits parked when a tip sync threw mid-run.
    try{z.sync("vault");z.enhance("vault");if(z.scanVault().some(n=>n.height&&!n.spent_in_txid&&n.value_zats>0)){
      const d=path.join(STATE,"run",`auction-core-recovery-${Date.now()}`);mkdirSync(d,{recursive:true});
      for(let by=Date.now()+15*60_000;;){try{z.pczt("vault","create-max","--address",z.generateAddress("bidder"),"--output",path.join(d,"created.pczt"));break}
        catch(e){if(!/ineligible/.test(String((e as Error)?.message??e))||Date.now()>by)throw e;await new Promise(r=>setTimeout(r,20_000));z.sync("vault")}}
      z.pczt("vault","prove",path.join(d,"created.pczt"),"--output",path.join(d,"proven.pczt"));await zcashSign(path.join(d,"proven.pczt"),path.join(d,"signed.pczt"));
      console.log(`development-only fund recovery ${z.send(path.join(d,"signed.pczt"))}`)}}catch(e){console.log(`RECOVERY FAILED ${(e as Error).message}`)}
    stop()}
});
