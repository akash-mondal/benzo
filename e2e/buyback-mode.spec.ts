// 1. Protects PHASE-5 §6 V1/V2/W1/W2/X1/Y1 and design phase5-part1-live §6.1: one Mode B buyback on testnet whose
//    custody lives on the three OrbStack signer hosts (fresh DKG, host envelope and witness keys, host-built and
//    host-approved batches, the kill drill), with the treasury leg funded at the signed funding_ua.
// 2. Mutations 5M1 (asks sorted descending) break V1; 5M2 (signer accepts any recipient) breaks W2; 5M3 (one witness
//    signature counted twice) breaks X1; 5M4 (settlement logs the opened envelope) breaks W1; 5M5 (DKG reuses an
//    earlier auction's key) breaks Y1.
// 3. The other specs run Mode A on the Mac's global signers; none clears a buyback or settles under host custody.
// 4. No seam: shipped commands on the Mac and on the hosts, real testnet/drand/tle/PCZT/FROST, a stopped real host.
import {expect,test} from '@playwright/test';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT,STATE,env,DRAND} from './lib/env';
import {jsonBytes,signRecord} from '../manifest/schema';
import {witnessSetHash} from '../witness';
import {clearForMode} from '../clear/registry';
import {sealBlob} from '../envelope';
import {redactCandidate} from '../cli/host-derive';
import {Run} from './lib/run';
import {H,NAMES,benzoBin,dkgOnHosts,hostEnvelopeKeys,hostEnvelopeOpens,hostTry,hostWitnessCerts,hostWitnessKeys,push,sh} from './lib/hosts';
import * as z from './lib/zcash';

const IDS=['Y1a','V1a','X1a','V1b','W2','Y1b','V2','W1','X1b','Y1c'],C=Number(env('BNZ_COLLATERAL_ZATS'));
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const benzo=(args:string[],input?:any)=>{const out=sh(benzoBin,args,input===undefined?undefined:JSON.stringify(input));return out.startsWith('{')||out.startsWith('[')?JSON.parse(out.split('\n').filter(l=>l.startsWith('{')||l.startsWith('[')).at(-1)!):out};
const cli=(args:string[])=>spawnSync(benzoBin,args,{encoding:'utf8',maxBuffer:64<<20});
const latestRound=async()=>(await (await fetch(`${DRAND}/public/latest`)).json()).round as number;
const pcztBin=path.join(ROOT,'settle/target/release/benzo-pczt');
const fresh=(wallet:string)=>sh(pcztBin,['address',wallet]).split('\n').at(-1)!;

test('Mode B buyback settles under host custody with the treasury leg',async()=> {
  test.setTimeout(110*60_000);const run=new Run('buyback-mode');
  for(const n of NAMES)if(spawnSync('orb',['start',`benzo-${n}`]).status!==0)run.notRun(IDS,`signer host benzo-${n} not available`);
  z.sync('bidder');if(z.spendable(z.balance('bidder'))-3*C-200000<3*C+40000)run.notRun(IDS,'bidder floor; Needs user funds');
  const frostd=spawn(path.join(STATE,'bin/frostd'),['-i','127.0.0.1','-p',env('BNZ_FROSTD_ADDR').split(':').at(-1)!,'-c',path.join(STATE,'tls/frostd.pem'),'-k',path.join(STATE,'tls/frostd.key')],{stdio:'ignore'});
  await sleep(2000);
  try {
    const id=randomBytes(32).toString('hex');console.log(`auction ${id}`);
    // Y1: a fresh 2-of-3 group key for this auction, from DKG run ON the three hosts.
    const k=await dkgOnHosts(id,benzo);
    await run.check('Y1a','fresh per-auction group key from three hosts',()=> {
      expect(new Set(k.keys).size).toBe(1);expect(k.group_key).toBe(k.keys[0]);
      expect(k.group_key).not.toBe(readFileSync(path.join(STATE,'group-key.txt'),'utf8').trim());
    });
    const envelopeKeys=hostEnvelopeKeys(),witnessPubs=hostWitnessKeys();
    const vault=path.join(STATE,'vaults',id,'wallet'),addr=()=>fresh(vault),bidderAddr=()=>fresh(path.join(STATE,'bidder'));
    const deposits=[k.escrow_ua,addr(),addr()],fundingUa=addr(),reserveUa=addr();
    const refunds=deposits.map(()=>bidderAddr()),treasuryUa=bidderAddr(),sellerUa=bidderAddr(),attacker=bidderAddr();
    const privateDir=path.join(STATE,'run',`buyback-${id}`),publicDir=path.join(ROOT,'tmp/e2e/public',id);mkdirSync(privateDir,{recursive:true});
    const witnessSet=signRecord({version:1,auction_id:id,q_w:2,keys:witnessPubs},readFileSync(path.join(STATE,'auction','manifest-signing.pem'),'utf8'));
    writeFileSync(path.join(privateDir,'witness-set.json'),JSON.stringify(witnessSet));
    const operator={settlement:{signers:['alice','bob'],batch_cap:13,pczt_expiry_blocks:364},routing:{bidders:deposits.map(deposit_ua=>({deposit_ua})),seller_ua:sellerUa,fee_reserve_ua:reserveUa}};
    writeFileSync(path.join(privateDir,'operator.json'),JSON.stringify(operator));
    // Budget 430 at asks 200/210/220 (q=1): two units fit at 210, so leaves 0 and 1 win at the uniform price 210,
    // leaf 2 is unfilled and refunds exact C, and 430 − 420 = 10 returns to the treasury.
    const now=Math.ceil(Date.now()/1000),release=now+33*60,R=1+Math.ceil((release-Number(env('BNZ_DRAND_GENESIS')))/3);
    const manifest={version:1,network:'test',auction_id:id,escrow_ua:k.escrow_ua,frost_group_key:k.group_key,lot:'Buyback round',supply:2,reserve_zats:'10',tick_zats:'10',B_max_zats:'3000',q_max:1,C_zats:String(C),fee_zats:'0',deposit_addresses:deposits,envelope_keys:envelopeKeys,witness_set_hash:witnessSetHash(witnessSet),drand:{chain_hash:env('BNZ_DRAND_CHAIN_HASH'),public_key:env('BNZ_DRAND_PUBLIC_KEY'),scheme:'bls-unchained-g1-rfc9380',genesis:Number(env('BNZ_DRAND_GENESIS')),period:3,R},T_submit:now+4*60,T_freeze:now+30*60,confirmations:10,clearing:{mode:'buyback',band:'floor_pro_rata_units',dust:'ascending_leaf_index',tie:'ascending_leaf_index',minimum_fill:1},buyback:{budget_zats:'430',max_price_zats:'300',treasury_ua:treasuryUa,funding_ua:fundingUa},refund:{invalid:'full_C',reorg:'C_minus_fee_remove_leaf',cancel:'full_C'},freeze:'merkle_root_v1'};
    benzo(['auction','create','--witness-set',path.join(privateDir,'witness-set.json')],manifest);
    const packet=benzo(['auction','sign','--id',id]);
    benzo(['auction','publish','--id',id,'--dir',publicDir,'--config',path.join(privateDir,'operator.json')]);
    const signer=packet.signer,manifestFile=path.join(publicDir,'manifest.json');
    await run.check('V1a','Mode B manifest signs and publishes with its treasury block',()=> {
      const m=JSON.parse(Buffer.from(json(manifestFile).bytes,'base64').toString('utf8'));
      expect(m.clearing.mode).toBe('buyback');expect(m.buyback).toEqual(manifest.buyback);
      expect(cli(['verify','--dir',publicDir,'--signer',signer]).status).toBe(0);
    });
    // Three sealed asks, the fee reserve and the treasury leg (to the signed funding_ua) in one funding transaction.
    const asks=deposits.map((address,i)=>({...benzo(['bid','seal','--manifest',manifestFile,'--signer',signer],{price_zats:String(200+10*i),quantity:1,address,refund_ua:refunds[i]}),address}));
    const paid=benzo(['bid','deposit','--id',id,'--pay'],{bids:asks,reserve:{address:reserveUa,amount_zats:'70000'},treasury:{amount_zats:manifest.buyback.budget_zats}});
    console.log(`funding ${paid.txid}`);
    for(let h=0;;await sleep(30_000)) {
      for(const v of ['sync','enhance'])z.run(path.join(STATE,'bin/zcash-devtool'),['wallet','-w',vault,v,'-s',env('BNZ_LWD_URL')]);
      const t=JSON.parse(z.run(path.join(STATE,'bin/zcash-devtool'),['wallet','-w',vault,'list-tx','--json'])).find((t:any)=>t.txid===paid.txid);
      const tip=JSON.parse(z.run(path.join(STATE,'bin/zcash-devtool'),['wallet','-w',vault,'balance','--json'])).chain_tip_height;
      if(t?.mined_height&&tip>=t.mined_height+9)break;
      if(++h>80)throw Error('funding did not mature');
    }
    for(const a of asks)benzo(['bid','deposit','--id',id],{txid:paid.txid,address:a.address,envelope_hex:a.envelope_hex,envelope_ct_hex:a.envelope_ct_hex,owner_sig_hex:a.owner_sig_hex});
    while(Date.now()/1000<manifest.T_submit+2)await sleep(5_000);
    if(Date.now()/1000>=manifest.T_freeze)throw Error('deposits matured after T_freeze');
    benzo(['freeze','--id',id]);
    while((await latestRound())<R)await sleep(10_000);
    // X1: open refuses without a q_w certificate; then two hosts certify after recomputing the root themselves.
    await run.check('X1a','open refuses a root without q_w witness certificates',()=> {
      const r=cli(['open','--id',id]);expect(r.status).not.toBe(0);expect(r.stderr).toMatch(/witness|certificate/i);
    });
    hostWitnessCerts(id,publicDir,signer,['alice','bob']);
    benzo(['open','--id',id]);benzo(['clear','--id',id]);
    const doc=()=>json(path.join(publicDir,'auction.json'));
    await run.check('V1b','CLI clear equals the pure Mode B clear on the same opened set',()=> {
      const d=doc(),pure=clearForMode({manifest:d.manifest,signer,frozen:d.frozen,opened:d.opened,reserve_opening:d.reserve_opening??null});
      expect(jsonBytes(d.result.allocations).equals(jsonBytes(pure.allocations))).toBe(true);
      expect(d.result.conservation).toEqual(pure.conservation);expect(d.result.mode).toBe('buyback');
      expect(d.result.clearing_price_zats).toBe('210');
      expect(d.result.allocations.map((a:any)=>a.outcome)).toEqual(['winner','winner','unfilled']);
      expect(d.result.conservation.treasury_zats).toBe('420');
    });
    hostEnvelopeOpens(id,publicDir);
    // W2: the coordinator builds its own candidate paying leaf 0's amount to a substituted recipient, redacts it and
    // seals the full copy to the hosts exactly as a building host would; both hosts refuse it before any FROST round.
    await run.check('W2','a coordinator-substituted recipient is refused by both signers before FROST',()=> {
      const w=path.join(STATE,'settle',id,'w2');rmSync(w,{recursive:true,force:true});mkdirSync(w,{recursive:true});
      const owed=String(C+210),created=path.join(w,'created.pczt'),proven=path.join(w,'proven.pczt'),redacted=path.join(w,'candidate.pczt');
      sh(pcztBin,['create',vault,created,'364'],JSON.stringify([{recipient:attacker,amount_zats:owed}]));
      sh(path.join(STATE,'bin/zcash-devtool'),['pczt','-w',vault,'prove',created,'--output',proven]);
      redactCandidate(STATE,proven,redacted,JSON.parse(sh(pcztBin,['inspect',proven,path.join(STATE,'vaults',id,'ufvk.txt')])));
      envelopeKeys.forEach((pub,i)=>writeFileSync(path.join(w,`sealed-${NAMES[i]}.bin`),sealBlob(readFileSync(proven),pub)));
      rmSync(proven);rmSync(created);cpSync(publicDir,path.join(w,'public'),{recursive:true});
      writeFileSync(path.join(w,'packet.json'),JSON.stringify({auction_id:id,batch:99,plan_version:sha(readFileSync(redacted)),signer}));
      for(const n of ['alice','carol']) {
        push(n,w,`w2-${id.slice(0,12)}`);
        const r=hostTry(n,[`${H}/bin/benzo`,'sign','approve','--id',id,'--batch','99','--packet',`/home/benzo/w2-${id.slice(0,12)}`,'--name',n]);
        expect(r.status,`${n} approved a substituted recipient`).not.toBe(0);expect(r.stderr).toMatch(/is not a row this signer derived/);
        expect(hostTry(n,['test','-f',`${H}/approvals/${id}/batch-99.json`]).status).not.toBe(0);
      }
    });
    // Y1: settlement with the kill drill — bob's host is stopped mid-session; the batch completes with alice + carol.
    const settle=spawnSync(benzoBin,['settle','--id',id],{encoding:'utf8',env:{...process.env,BNZ_DRILL_STOP:'bob'},maxBuffer:64<<20});
    writeFileSync(path.join(privateDir,'settle.log'),(settle.stdout||'')+'\n----\n'+(settle.stderr||''));
    spawnSync('orb',['start','benzo-bob']);
    await run.check('Y1b','settlement completes with alice + carol while bob is stopped',()=> {
      expect(settle.status,(settle.stderr||'').split('\n').filter(l=>/^ERROR/.test(l)).slice(-3).join(' | ')).toBe(0);
      const custody=json(path.join(STATE,'settle',id,'batch-1.custody.json'));
      expect(custody.events.some((e:any)=>e.abandoned_session?.failed?.includes('bob'))).toBe(true);
      expect(custody.pair).toEqual(['alice','carol']);
    });
    await run.check('V2','winners get C + the uniform price, the loser exact C, the treasury the unspent budget',()=> {
      const receipts=Object.fromEntries((doc().settlement?.receipts??[]).map((r:any)=>[r.party,r.amount_zats]));
      expect(receipts).toEqual({'leaf:0':String(C+210),'leaf:1':String(C+210),'leaf:2':String(C),treasury:'10'});
      z.sync('bidder');z.enhance('bidder');
      const got=z.run(z.scanner,['scan','test',path.join(STATE,'bidder')]).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
      const at=(a:string)=>got.filter((n:any)=>n.address===a).reduce((s:number,n:any)=>s+n.value_zats,0);
      expect([at(refunds[0]),at(refunds[1]),at(refunds[2]),at(treasuryUa)]).toEqual([C+210,C+210,C,10]);
      expect(at(attacker)).toBe(0);
    });
    await run.check('W1','no refund destination in any operator file, public file or log; coordinator saw only the redacted candidate',()=> {
      const places=[publicDir,path.join(STATE,'settle',id),path.join(STATE,'product'),path.join(STATE,'auction'),path.join(STATE,'run','auction-cli.log'),path.join(privateDir,'settle.log')];
      for(const a of refunds)for(const p of places)expect(existsSync(p)&&spawnSync('grep',['-rqa',a,p]).status===0,`${a.slice(0,12)}… in ${p}`).toBe(false);
      const insp=json(path.join(STATE,'settle',id,'batch-1.inspect.json'));
      expect(insp.outputs.filter((o:any)=>!o.is_change).every((o:any)=>o.recipient===null&&o.redacted===true)).toBe(true);
    });
    await run.check('X1b','cold verify passes; a second certificate over a different root is refused',()=> {
      const cold=path.join(ROOT,'tmp/e2e/cold',id);rmSync(cold,{recursive:true,force:true});cpSync(publicDir,cold,{recursive:true});
      const v=cli(['verify','--dir',cold,'--signer',signer]);expect(v.status,(v.stdout+v.stderr).split('\n').filter(l=>/^ERROR/.test(l)).slice(0,2).join(' | ')).toBe(0);
      const d=json(path.join(cold,'auction.json')),c=d.witness_cert[0];
      d.witness_cert.push({...c,statement:{...c.statement,frozen_root:'00'.repeat(32)}});writeFileSync(path.join(cold,'auction.json'),JSON.stringify(d));
      expect(cli(['verify','--dir',cold,'--signer',signer]).status).not.toBe(0);
    });
    await run.check('Y1c','no FROST share for this auction on the Mac',()=>expect(existsSync(path.join(STATE,'auctions',id))).toBe(false));
  } finally {frostd.kill();for(const n of NAMES)spawnSync('orb',['start',`benzo-${n}`])}
});
