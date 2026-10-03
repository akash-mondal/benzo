// 1. Protects DESIGN §§1/3/4/6, PHASE-4 O–T and R7 items 2–7: CLI lifecycle, public privacy, signer-derived
//    destinations (owner-signed claims, never operator routing), exception-queue correctness and recovery.
// 2. U1 wrong CLI sorting, U2 plaintext API, U3 omitted totals, U4 coordinator amounts, U5 stray guard break O2/S1/R1/T4/T1;
//    R7M1 (refunds paid to an operator routing sink instead of owner-named destinations) breaks T1.
// 3. The four earlier specs drive lower-level boundaries and never exercise this product or expired staged-batch recovery.
// 4. No seam: shipped commands, real testnet/drand/tle/PCZT/FROST, coordinator SQLite fault and a suspended real signer.
import {expect,test} from '@playwright/test';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {ROOT,STATE,env,DRAND,E2E} from './lib/env';
import {jsonBytes,signRecord} from '../manifest/schema';
import {generateWitnessKey,witnessSetHash} from '../witness';
import {Run,waitFor,write} from './lib/run';
import {startFrostd,pubkey,zcashSign} from './lib/frost';
import * as z from './lib/zcash';
const IDS=['O1','O2','P1','P2','Q1','R1','S1','T1','T2','T3','T4','T5'],C=Number(env('BNZ_COLLATERAL_ZATS')),MINE=30*60_000,NORMAL_EXPIRY=364;
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const fresh=(name:string)=>z.run(path.join(ROOT,'settle/target/release/benzo-pczt'),['address',path.join(STATE,name)]).trim();
function cli(args:string[],input?:any) {
  const p=spawnSync(path.join(ROOT,'bin/benzo'),args,{input:input===undefined?undefined:(typeof input==='string'?input:JSON.stringify(input)),encoding:'utf8',maxBuffer:64<<20});
  if(p.error)throw p.error;return {code:p.status,error:p.stderr,value:p.status===0?(p.stdout.trim().startsWith('{')||p.stdout.trim().startsWith('[')?JSON.parse(p.stdout):p.stdout):null};
}
function good(args:string[],input?:any) {const r=cli(args,input);if(r.code)throw Error(r.error);return r.value}
async function mature(txid:string) {
  const h=await waitFor({height:1,tip:()=>{z.sync('vault');return JSON.parse(z.wallet('vault','list-tx','--json')).find((t:any)=>t.txid===txid)?.mined_height??0}},Date.now()+MINE);
  for(const endpoint of [env('BNZ_LWD_URL'),env('BNZ_LWD_URL_ALT')])if(z.getTransaction(txid,endpoint).height!==h)throw Error('deposit mined heights differ across endpoints');
  await waitFor({height:h+9,tip:()=>{z.sync('vault');z.sync('bidder');return Math.min(z.balance('vault').chain_tip_height,z.balance('bidder').chain_tip_height)}},Date.now()+MINE);z.enhance('vault');return h;
}
function worker(id:string,allocatedKill=false) {
  const p=spawn(path.join(ROOT,'bin/benzo'),['settle','--id',id],{detached:true});let out='',err='',allocated=0;
  const pidfile=path.join(STATE,'run',`cli-worker-${id}.pid`);writeFileSync(pidfile,String(p.pid));
  const timer=setTimeout(()=>process.kill(-p.pid!,'SIGKILL'),MINE);
  p.stdout.on('data',d=>{out+=d;writeFileSync(path.join(E2E,'cli-worker.log'),out);for(const line of out.split('\n'))try{allocated=JSON.parse(line).allocated??allocated}catch{}if(allocatedKill&&allocated)process.kill(-p.pid!,'SIGKILL')});
  p.stderr.on('data',d=>{err+=d;writeFileSync(path.join(E2E,'cli-worker.err'),err)});
  const done=new Promise<any>((resolve,reject)=>{p.on('error',reject);p.on('close',(code,signal)=>{clearTimeout(timer);rmSync(pidfile,{force:true});resolve({code,signal,allocated,out,err})})});return {p,done};
}
async function cleanup() {
  z.sync('vault');z.enhance('vault');if(!z.scanVault().some(n=>n.height&&!n.spent_in_txid&&n.value_zats>0))return;
  const dir=path.join(STATE,'run',`cli-cleanup-${Date.now()}`);mkdirSync(dir,{recursive:true});
  z.pczt('vault','create-max','--address',fresh('bidder'),'--output',path.join(dir,'created.pczt'));
  z.pczt('vault','prove',path.join(dir,'created.pczt'),'--output',path.join(dir,'proven.pczt'));
  await zcashSign(path.join(dir,'proven.pczt'),path.join(dir,'signed.pczt'));const txid=z.send(path.join(dir,'signed.pczt'));
  await waitFor({height:1,tip:()=>{z.sync('vault');return JSON.parse(z.wallet('vault','list-tx','--json')).find((t:any)=>t.txid===txid)?.mined_height??0}},Date.now()+MINE);console.log(`development cleanup ${txid}`);
}
test('CLI auction settles with stray deposits, signer-derived amounts and expired-batch recovery',async()=> {
  test.setTimeout(90*60_000);const run=new Run('cli-auction');
  const pins=Object.fromEntries(readFileSync(path.join(ROOT,'tools/pins.env'),'utf8').split('\n').map(l=>l.match(/^([A-Z0-9_]+)=(\S*)$/)).filter(Boolean).map(m=>[m![1],m![2]]));
  const installed=execFileSync('cargo',['install','--list','--root',STATE],{encoding:'utf8'});
  for(const name of ['zcash-devtool','frostd','frost-client','zcash-sign'])if(!installed.split('\n').some(l=>l.startsWith(name+' v')&&l.includes('?rev='+pins[name==='zcash-devtool'?'DEVTOOL_REV':'FROST_TOOLS_REV']+'#')))run.notRun(IDS,'pinned '+name+' does not match tools/pins.env');
  for(const [name,module,tag] of [['tle','github.com/drand/tlock',pins.TLE_TAG],['grpcurl','github.com/fullstorydev/grpcurl',pins.GRPCURL_TAG]])if(!execFileSync('go',['version','-m',path.join(STATE,'bin',name)],{encoding:'utf8'}).includes('\tmod\t'+module+'\t'+tag+'\t'))run.notRun(IDS,'pinned '+name+' does not match tools/pins.env');
  for(const file of ['vault/data.sqlite','frost/alice.toml','frost/bob.toml','frost/carol.toml','ufvk.txt'])if(!existsSync(path.join(STATE,file)))run.notRun(IDS,`missing ${file}`);
  try {const info=await fetch(`${DRAND}/info`);if(!info.ok)throw Error(`drand HTTP ${info.status}`);for(const e of [env('BNZ_LWD_URL'),env('BNZ_LWD_URL_ALT')])z.tip(e)}catch(e){run.notRun(IDS,String(e))}
  z.sync('vault');z.enhance('vault');z.sync('bidder');if(z.scanVault().some(n=>n.height&&!n.spent_in_txid&&n.value_zats>0))run.notRun(IDS,'vault not empty; reconcile before funding');
  if(z.spendable(z.balance('bidder'))-12*C-200000<3*C+40000)run.notRun(IDS,'drill would cross bidder floor; Needs user funds');
  const stop=await startFrostd();let active:ReturnType<typeof worker>|undefined,paused:number|undefined,api:any,apiData:any;
  try {
    const id=randomBytes(32).toString('hex'),now=Math.ceil(Date.now()/1000),release=now+24*60,R=1+Math.ceil((release-Number(env('BNZ_DRAND_GENESIS')))/3);
    const deposit=Array.from({length:10},()=>fresh('vault')),refund=Array.from({length:11},()=>fresh('bidder')),reserve=fresh('vault');
    const privateDir=path.join(STATE,'run',`cli-${id}`),publicDir=path.join(ROOT,'tmp/e2e/public',id);mkdirSync(privateDir,{recursive:true});
    // R7 items 2/6/7 (R F-6 = G G8): each signer's envelope key is pinned in the signed manifest; the operator
    // routing carries NO bidder destination at all and its only destination (the seller UA) differs from every
    // envelope/claim destination, so a regression that pays routing instead of the owner-named destination is
    // caught by the per-destination receiving sums in T1.
    const envelopeKeys=['alice','bob','carol'].map(name=>{const r=cli(['sign','envelope-key','--name',name]);return r.code===0?r.value.public_hex:JSON.parse(readFileSync(path.join(STATE,'signers',name,'envelope-key.json'),'utf8')).public_hex});
    const operator={settlement:{signers:['bob','carol'],batch_cap:13,pczt_expiry_blocks:4},routing:{bidders:deposit.map(deposit_ua=>({deposit_ua})),seller_ua:refund[10],fee_reserve_ua:reserve}};
    const operatorFile=path.join(privateDir,'operator.json');writeFileSync(operatorFile,JSON.stringify(operator));
    // R8 G10 + R17 item 3: gate X cannot be opted out — the fixture creates the signed witness set, and two
    // witness certificates are collected before open (design §5).
    const witnessKeys=[0,1,2].map(i=>{const f=path.join(STATE,'witness',`w${i}.json`);if(!existsSync(f)){mkdirSync(path.dirname(f),{recursive:true,mode:0o700});writeFileSync(f,JSON.stringify(generateWitnessKey()),{mode:0o600})}for(const ext of ['key'])writeFileSync(path.join(STATE,'witness',`w${i}.${ext}`),JSON.parse(readFileSync(f,'utf8')).private_hex,{mode:0o600});return JSON.parse(readFileSync(f,'utf8'))});
    const witnessSet=signRecord({version:1,auction_id:id,q_w:2,keys:witnessKeys.map(k=>k.public_hex)},readFileSync(path.join(STATE,'auction','manifest-signing.pem'),'utf8'));
    const witnessSetFile=path.join(privateDir,'witness-set.json');writeFileSync(witnessSetFile,JSON.stringify(witnessSet));
    const manifest={version:1,network:'test',auction_id:id,escrow_ua:deposit[0],frost_group_key:readFileSync(path.join(STATE,'group-key.txt'),'utf8').trim(),lot:'CLI testnet auction',supply:3,reserve_zats:'10',tick_zats:'10',B_max_zats:'3000',q_max:1,C_zats:String(C),fee_zats:'0',deposit_addresses:deposit,envelope_keys:envelopeKeys,witness_set_hash:witnessSetHash(witnessSet),drand:{chain_hash:env('BNZ_DRAND_CHAIN_HASH'),public_key:env('BNZ_DRAND_PUBLIC_KEY'),scheme:'bls-unchained-g1-rfc9380',genesis:Number(env('BNZ_DRAND_GENESIS')),period:3,R},T_submit:now+5*60,T_freeze:now+22*60,confirmations:10,clearing:{mode:'uniform',band:'floor_pro_rata_units',dust:'ascending_leaf_index',tie:'ascending_leaf_index',minimum_fill:1},refund:{invalid:'full_C',reorg:'C_minus_fee_remove_leaf',cancel:'full_C'},freeze:'merkle_root_v1'};
    const draft=good(['auction','create','--witness-set',witnessSetFile],manifest),draftStatus=good(['auction','status','--id',id]),packet=good(['auction','sign','--id',id]);
    const published=good(['auction','publish','--id',id,'--dir',publicDir,'--config',operatorFile]),status=good(['auction','status','--id',id]);
    const manifestFile=path.join(publicDir,'manifest.json'),signer=packet.signer;
    await run.check('O1','CLI persists signed DRAFT to OPEN',()=>{expect.soft(draft.state).toBe('DRAFT');expect.soft(draftStatus.state).toBe('DRAFT');expect.soft(status.state).toBe('OPEN');expect.soft(published.manifest.sha256).toBe(packet.sha256);expect.soft(sha(Buffer.from(packet.bytes,'base64'))).toBe(packet.sha256)});
    const corrupted={...packet,bytes:Buffer.from(Buffer.from(packet.bytes,'base64').map((v:number,i:number)=>i===1?v^1:v)).toString('base64')};const corruptFile=path.join(privateDir,'flipped.json');writeFileSync(corruptFile,JSON.stringify(corrupted));
    const refused=cli(['bid','prepare','--manifest',corruptFile,'--signer',signer]);
    const prepared=good(['bid','prepare','--manifest',manifestFile,'--signer',signer]);
    // R7 items 2/6/7: bids 0–7 seal their own refund destination to a manifest-pinned signer envelope key;
    // bids 8–9 carry no destination and no envelope (bid 8 is claimed later via its owner key, bid 9 stays a
    // correct exception row). The destinations travel owner-signed inside envelopes/claims, never operator routing.
    const price=100+10*randomBytes(1)[0],bids=deposit.map((address,i)=>({...good(['bid','seal','--manifest',manifestFile,'--signer',signer],i<8?{price_zats:String(price+(i<4?20:i<6?10:0)),quantity:1,address,refund_ua:refund[i],envelope_pubkey:envelopeKeys[0]}:{price_zats:String(price+(i<4?20:i<6?10:0)),quantity:1,address}),address}));
    // A stray whose memo holds a valid sealed bid (claimable through its owner key) plus a memo-less stray.
    const strayMemoBid=good(['bid','seal','--manifest',manifestFile,'--signer',signer],{price_zats:String(price+5),quantity:1,address:deposit[0]});
    const paid=good(['bid','deposit','--id',id,'--pay'],{bids,reserve:{address:reserve,amount_zats:'70000'}});console.log(`CLI funding ${paid.txid}`);
    await waitFor({round:1+Math.ceil((manifest.T_submit+1-Number(env('BNZ_DRAND_GENESIS')))/3)},(manifest.T_submit+60)*1000);
    // Real boundary fault: a non-C deposit carrying a sealed-bid memo and a late unadmitted memo-less transfer.
    const strayUri='zcash:?'+new URLSearchParams({address:deposit[0],amount:((C+1)/1e8).toFixed(8),memo:Buffer.from(strayMemoBid.envelope_hex,'hex').toString('base64url'),'address.1':deposit[1],'amount.1':(C/1e8).toFixed(8)});
    const strayTx=z.pay(strayUri);console.log(`CLI stray funding ${strayTx}`);
    await mature(paid.txid);await mature(strayTx);
    const included=bids.map(b=>good(['bid','deposit','--id',id],{txid:paid.txid,address:b.address,envelope_hex:b.envelope_hex,envelope_ct_hex:b.envelope_ct_hex,owner_sig_hex:b.owner_sig_hex}));
    await run.check('P1','manifest flip refused, sealed bid framing and fixed collateral tracked',()=>{expect.soft(refused.code).not.toBe(0);expect.soft(refused.error).toContain('manifest byte hash');expect.soft(prepared.manifest_hash).toBe(packet.sha256);for(const b of bids){const memo=Buffer.from(b.envelope_hex,'hex');expect.soft(memo.length).toBe(512);expect.soft(memo.subarray(0,5).toString('hex')).toBe('ff424e5a02');expect.soft(b.round).toBe(R)}for(const r of included)expect.soft(r.C_zats).toBe(String(C));const notes=z.scanVault().filter(n=>n.txid===paid.txid&&deposit.includes(n.address!));expect.soft(notes.length).toBe(10);for(const n of notes)expect.soft(n.value_zats).toBe(C)});

    const frozen=good(['freeze','--id',id]);
    // R8 G10 (design §5): two witness certificates over the frozen statement before open.
    for(const i of [0,1])good(['witness','sign','--dir',publicDir,'--signer',signer,'--key',path.join(STATE,'witness',`w${i}.key`)]);
    await waitFor({round:R},(release+60)*1000);
    good(['open','--id',id]);const result=good(['clear','--id',id]);
    const referenceOpened=frozen.leaves.map((leaf:any)=>{const p=spawnSync(path.join(STATE,'bin/tle'),['-d','-c',env('BNZ_DRAND_CHAIN_HASH')],{input:Buffer.from(leaf.ciphertext_hex,'hex')});if(p.error)throw p.error;if(p.status!==0)throw Error(p.stderr.toString());return {leaf_index:leaf.leaf_index,plaintext_hex:p.stdout.toString('hex')}});
    const pure=z.run(process.execPath,[path.join(ROOT,'clear/dist/cli.mjs')],{input:JSON.stringify({manifest:packet,signer,frozen,opened:referenceOpened})});
    write('cli/clear-reference.json',pure);
    // R7 items 4/6/7: refunds complete through owner-signed claim requests naming shielded destinations — the
    // same destinations sealed in the bids' envelopes — recorded before settlement (first claim per party).
    // Leaf 9 and the memo-less stray have no owner-authenticated destination: they stay correct exception rows.
    const strayNotes=z.scanVault().filter(n=>n.txid===strayTx);
    const memoStray=strayNotes.find(n=>n.address===deposit[0])!,garbageStray=strayNotes.find(n=>n.address===deposit[1])!;
    const memoStrayParty=`deposit:${memoStray.txid}:${memoStray.diversifier_index}`,garbageStrayParty=`deposit:${garbageStray.txid}:${garbageStray.diversifier_index}`;
    const claimDest:Record<string,string>={};
    const ownerOf=(ct:string)=>JSON.parse(readFileSync(path.join(STATE,'bids',id,ct+'.json'),'utf8')).owner_private_hex;
    const claims:[string,string,string][]=[...bids.slice(0,9).map((b,i)=>[`leaf:${i}`,b.ciphertext_hash,refund[i]] as [string,string,string]),[memoStrayParty,strayMemoBid.ciphertext_hash,refund[9]] as [string,string,string]];
    // R17 item 2 drill: a forged claim is refused at record time (the owner's valid claim for leaf:0 below
    // must still be accepted and paid).
    writeFileSync(path.join(privateDir,'claim-junk.json'),JSON.stringify({kind:'claim-refund',auction_id:id,party:'leaf:0',destination_ua:refund[0],destination_commit:sha(Buffer.concat([Buffer.alloc(32,0x11),Buffer.from(refund[0],'utf8')])),salt:'11'.repeat(32),owner_sig:'22'.repeat(64)}));
    const junk=cli(['claim-refund','--id',id,'--file',path.join(privateDir,'claim-junk.json'),'--defer']);
    for(const [party,ct,dest] of claims) {
      const request=good(['claim-refund','--id',id,'--party',party,'--destination',dest,'--owner-key-stdin'],ownerOf(ct));
      const file=path.join(privateDir,`claim-${party.replace(/[^a-z0-9]/gi,'_')}.json`);writeFileSync(file,JSON.stringify(request));
      good(['claim-refund','--id',id,'--file',file,'--defer']);claimDest[party]=dest;
    }
    // Allocate through the real worker then kill before PCZT creation, as the production resume boundary.
    active=worker(id,true);const killed=await active.done;active=undefined;
    if(killed.code!==null){await run.check('T1','admitted and stray notes do not block allocation',()=>{throw Error(killed.err)});return}
    const ledgerFile=path.join(STATE,'settle',id,'ledger.sqlite'),db=new DatabaseSync(ledgerFile),rows=db.prepare('SELECT * FROM obligations ORDER BY party').all() as any[];
    // The amount fault targets payable batch rows only (R7: unclaimed exception rows are not batch rows).
    const batchRows=rows.filter(r=>r.batch===1);
    const amounts=batchRows.map(r=>r.amount_zats),faulted=batchRows.map((r,i)=>({...r,amount_zats:String(BigInt(r.amount_zats)+(i===0?1n:i===1?-1n:0n))}));
    for(const r of faulted)db.prepare('UPDATE obligations SET amount_zats=? WHERE party=?').run(r.amount_zats,r.party);
    const destination=(r:any)=>r.party==='seller'?refund[10]:claimDest[r.party]??refund[10];
    const wrong=path.join(privateDir,'wrong.pczt');z.run(path.join(ROOT,'settle/target/release/benzo-pczt'),['create',path.join(STATE,'vault'),wrong],{input:JSON.stringify(faulted.map(r=>({recipient:destination(r),amount_zats:r.amount_zats})))});
    const rejected=cli(['sign','inspect','--id',id,'--batch','1','--candidate',wrong,'--name','bob']);
    for(let i=0;i<batchRows.length;i++)db.prepare('UPDATE obligations SET amount_zats=? WHERE party=?').run(amounts[i],batchRows[i].party);db.close();
    await run.check('T4','signer refuses coordinator rows and a matching wrong-amount real PCZT',()=>{expect.soft(rejected.code).not.toBe(0);expect.soft(rejected.error).toContain('batch row differs from fresh signer clearing')});
    active=worker(id);const productConfig=path.join(STATE,'product',id+'.json');
    let delay:any=null;
    // Suspend Carol at the real process boundary, allowing the signed candidate to expire before mining.
    await new Promise<void>((resolve,reject)=> {
      const deadline=Date.now()+MINE;let finished=false;
      const poll=()=> {
        if(finished)return;
        const processes=execFileSync('ps',['-axo','pid=,pgid=,command='],{encoding:'utf8'}).split('\n');
        const line=processes.find(l=>l.includes('frost-client participant')&&l.includes('carol.toml')&&Number(l.trim().split(/\s+/)[1])===active!.p.pid);
        if(line){finished=true;paused=Number(line.trim().split(/\s+/)[0]);process.kill(paused,'SIGSTOP');resolve();return}
        if(Date.now()>deadline){finished=true;reject(Error('deadline waiting for real Carol process'));return}
        setTimeout(poll,100);
      };
      active!.done.then(v=>{if(!finished){finished=true;reject(Error(`worker exited before signer delay: ${v.err}`))}});poll();
    });
    const candidate=path.join(STATE,'settle',id,'batch-1.proven.pczt');const metadata=JSON.parse(z.run(path.join(ROOT,'settle/target/release/benzo-pczt'),['inspect',candidate,path.join(STATE,'ufvk.txt')],{quietArgs:true}));
    const pausedAt=z.tip();await waitFor({height:metadata.expiry_height+1,tip:()=>z.tip()},Date.now()+MINE);
    const cfg=json(productConfig);cfg.settlement.pczt_expiry_blocks=NORMAL_EXPIRY;writeFileSync(productConfig,JSON.stringify(cfg));delay={signer:'carol',paused_height:pausedAt,expiry_height:metadata.expiry_height,resumed_height:z.tip()};process.kill(paused!,'SIGCONT');paused=undefined;
    const completed=await active.done;active=undefined;
    if(completed.code!==0)console.log(`ERROR T3 worker ${completed.err.slice(-500)}`);
    const doc=json(path.join(publicDir,'auction.json')),settlement=doc.settlement??{rows:[],receipts:[],batches:[]};
    z.sync('bidder');z.enhance('bidder');const receiving=z.run(z.scanner,['scan','test',path.join(STATE,'bidder')]).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
    // R7 items 4/6/7: every claim-named refund lands at its owner-named destination (the destination sealed in
    // that bid's envelope), none at an operator routing sink; leaf 9 and the memo-less stray are correct
    // exception rows, never paid.
    const expected=result.allocations.map((a:any)=>({party:`leaf:${a.leaf_index}`,amount_zats:a.refund_zats})).filter((e:any)=>claimDest[e.party]);expected.push({party:'seller',amount_zats:result.conservation.payout_zats});expected.push({party:memoStrayParty,amount_zats:String(memoStray.value_zats)});
    await run.check('O2','CLI lifecycle clear produces the published result.json of the Phase 2 pure clear',()=>{expect.soft(sha(JSON.stringify(doc.result)+'\n')).toBe(sha(pure));expect.soft(sha(readFileSync(path.join(publicDir,'result.json')))).toBe(sha(pure));expect.soft(doc.state).toBe('SETTLING');expect.soft(doc.result.freeze_root).toBe(frozen.root)});
    await run.check('T1','claimed refunds land at owner-named destinations, never operator routing; unclaimable rows stay exceptions',()=>{
      expect.soft(junk.code).not.toBe(0);expect.soft(junk.error).toContain('claim owner signature');
      expect.soft(completed.code).toBe(0);
      for(const e of expected)expect.soft(settlement.receipts.find((r:any)=>r.party===e.party)?.amount_zats).toBe(e.amount_zats);
      for(const e of expected){const total=expected.filter((x:any)=>destination(x)===destination(e)).reduce((n:number,x:any)=>n+Number(x.amount_zats),0);expect.soft(receiving.filter((n:any)=>n.address===destination(e)).reduce((s:number,n:any)=>s+n.value_zats,0)).toBe(total)}
      for(const e of expected)if(e.party!=='seller'){expect.soft(destination(e)).not.toBe(refund[10]);expect.soft(destination(e)).not.toBe(reserve)}
      const rowsByParty=new Map<string,any>(settlement.rows.map((r:any)=>[r.party,r]));
      expect.soft(rowsByParty.get('leaf:9')?.state).toBe('exception');
      expect.soft(rowsByParty.get(garbageStrayParty)?.state).toBe('exception');
      expect.soft(settlement.receipts.some((r:any)=>r.party==='leaf:9'||r.party===garbageStrayParty)).toBe(false);
    });
    await run.check('T3','expired staged batch becomes exception and replans without duplicate receipts',()=>{expect.soft(delay.resumed_height).toBeGreaterThan(delay.expiry_height);expect.soft(settlement.batches.filter((b:any)=>b.state==='exception').length).toBe(1);expect.soft(settlement.batches.filter((b:any)=>b.state==='mined').length).toBe(1);expect.soft(new Set(settlement.receipts.map((r:any)=>r.party)).size).toBe(expected.length);expect.soft(settlement.receipts.reduce((n:number,r:any)=>n+Number(r.amount_zats),0)).toBe(expected.reduce((n:number,r:any)=>n+Number(r.amount_zats),0));expect.soft(killed.signal).toBe('SIGKILL')});
    const sessions=settlement.batches.filter((b:any)=>b.state==='mined').flatMap((b:any)=>b.signing.sessions);
    await run.check('Q1','two inspected signers join through CLI and complete FROST',()=>{expect.soft(sessions.length).toBeGreaterThan(0);for(const s of sessions){expect.soft(s.signature).toMatch(/^[0-9a-f]{128}$/);expect.soft(s.participantsSaw).toEqual([s.sighash,s.sighash]);expect.soft(s.signers).toHaveLength(2)}});
    await run.check('T5','Bob and Carol are the configured pair; Alice is not selected (not an offline drill)',()=>{expect.soft(settlement.offline_signer).toBe('alice');for(const s of sessions){expect.soft(s.signers).toEqual([pubkey('bob'),pubkey('carol')]);expect.soft(s.signers).not.toContain(pubkey('alice'))}});
    const cold=path.join(ROOT,'tmp/e2e/cold',id);cpSync(publicDir,cold,{recursive:true});
    const verified=cli(['verify','--dir',cold,'--signer',signer]);
    const shown=cli(['receipt','show','--dir',cold,'--ciphertext-hash',frozen.leaves[0].ciphertext_hash]);
    // F3 (R28): pass the bidder's own signed admission receipt for leaf:0, and compare the settlement
    // receipt fields against result.json.
    const bidderReceipt=included.find((x:any)=>JSON.parse(Buffer.from(x.receipt.bytes,'base64').toString('utf8')).leaf_index===0)!.receipt;
    const receiptFile=path.join(privateDir,'receipt-leaf0.json');writeFileSync(receiptFile,jsonBytes(bidderReceipt));
    const signed=cli(['receipt','show','--dir',cold,'--ciphertext-hash',frozen.leaves[0].ciphertext_hash,'--receipt',receiptFile]);
    await run.check('P2','receipt show and verify agree on inclusion and settlement fields',()=>{
      expect.soft(shown.code).toBe(0);expect.soft(verified.code).toBe(0);
      expect.soft(shown.value.inclusion.included).toBe(true);
      expect.soft(signed.code).toBe(0);expect.soft(signed.value.inclusion.receipt_signed).toBe(true);
      const allocation=result.allocations.find((a:any)=>a.leaf_index===0),receipt=shown.value.settlement;
      expect.soft(receipt.auction_id).toBe(result.auction_id);
      expect.soft(receipt.party).toBe(`leaf:${allocation.leaf_index}`);
      expect.soft(receipt.amount_zats).toBe(allocation.refund_zats);
      expect.soft(signed.value.settlement).toEqual(receipt)});
    const corruptDir=path.join(ROOT,'tmp/e2e/corrupt',id);cpSync(cold,corruptDir,{recursive:true});
    const corrupt=(mutate:(d:any)=>void)=>{const d=json(path.join(cold,'auction.json'));mutate(d);writeFileSync(path.join(corruptDir,'auction.json'),jsonBytes(d));return cli(['verify','--dir',corruptDir,'--signer',signer])};
    // F1 (R28): each amount class is corrupted on its own — a leaf row+receipt, the seller row+receipt, and a
    // stray row — and each asserts its specific accounting / accounting-strays refusal.
    const badLeaf=corrupt(d=>{for(const r of [d.settlement.rows.find((x:any)=>x.party==='leaf:0'),d.settlement.receipts.find((x:any)=>x.party==='leaf:0')])r.amount_zats=String(BigInt(r.amount_zats)+1n)});
    const badSeller=corrupt(d=>{for(const r of [d.settlement.rows.find((x:any)=>x.party==='seller'),d.settlement.receipts.find((x:any)=>x.party==='seller')])r.amount_zats=String(BigInt(r.amount_zats)+1n)});
    const badStray=corrupt(d=>{const r=d.settlement.rows.find((x:any)=>x.party===memoStrayParty);r.amount_zats=String(BigInt(r.amount_zats)+1n)});
    // F2 (R28): flip one byte inside the frozen.root field, keeping canonical JSON in auction.json and the
    // frozen.json projection, so the refusal is specifically the freeze root check.
    const rootRefusal=corrupt(d=>{const b=Buffer.from(d.frozen.root,'hex');b[0]^=1;d.frozen.root=b.toString('hex');writeFileSync(path.join(corruptDir,'frozen.json'),jsonBytes(d.frozen))});
    await run.check('R1','cold public verification passes and corrupt amounts/root fail specifically',()=>{expect.soft(verified.code).toBe(0);
      expect.soft(badLeaf.code).not.toBe(0);expect.soft(badLeaf.error).toContain('ERROR accounting refused: settlement leaf:0 amount');
      expect.soft(badSeller.code).not.toBe(0);expect.soft(badSeller.error).toContain('ERROR accounting refused: settlement seller amount');
      expect.soft(badStray.code).not.toBe(0);expect.soft(badStray.error).toMatch(/ERROR accounting-strays refused: stray deposit:[0-9a-f]{64}:\S+ amount/);
      expect.soft(rootRefusal.code).not.toBe(0);expect.soft(rootRefusal.error).toContain('ERROR freeze refused: freeze root')});
    await run.check('S1','read API returns opaque operator data, exact result and rejects manifest flip',async()=> {
      api=spawn(process.execPath,[path.join(ROOT,'api/dist/server.mjs'),'--dir',publicDir,'--port','8787'],{stdio:['ignore','pipe','pipe']});
      let ready=false;await new Promise<void>((resolve,reject)=>{api.on('error',reject);api.stdout.on('data',()=>{ready=true;resolve()});api.on('close',()=>{if(!ready)reject(Error('API exited before ready'))})});
      const root='http://127.0.0.1:8787',base=root+`/auction/${id}`;const operator=await fetch(root+'/operator').then(r=>r.json());const apiResult=await fetch(root+'/result').then(r=>r.json());
      apiData={operator,result:apiResult,auction:await fetch(base).then(r=>r.json()),freeze:await fetch(root+'/freeze').then(r=>r.json()),receipt:await fetch(root+'/receipt/'+frozen.leaves[0].ciphertext_hash).then(r=>r.json())};
      expect.soft(JSON.stringify(operator)).not.toMatch(/price_zats|quantity|plaintext_hex/);expect.soft(JSON.stringify(operator)).toContain(String(C));expect.soft(apiResult).toEqual(result);
      // F2 (R28): flip one byte inside the manifest's lot field of the canonical auction.json — canonical JSON
      // is kept, and the API must refuse with the same specific manifest byte hash error as the CLI.
      const auctionFile=path.join(publicDir,'auction.json'),auctionBytes=readFileSync(auctionFile);
      const flipped=Buffer.from(doc.manifest.bytes,'base64');const at=flipped.indexOf('CLI testnet auction');flipped[at]^=1;
      writeFileSync(auctionFile,jsonBytes({...doc,manifest:{...doc.manifest,bytes:flipped.toString('base64')}}));
      const response=await fetch(base),body=await response.json();expect.soft(response.status).toBe(400);expect.soft(body.error).toContain('manifest byte hash');
      writeFileSync(auctionFile,auctionBytes);write('cli/api.json',JSON.stringify(apiData)+'\n');
    });
    await run.check('T2','public document, evidence and API expose no recipient-derived values',()=>{expect.soft(apiData).toBeDefined();const serialized=JSON.stringify({doc,api:apiData});expect.soft(serialized).not.toMatch(/recipient_hash|routing_hash|refund_ua|seller_ua|destination_sha256|destination_ua/);for(const address of refund){expect.soft(serialized).not.toContain(address);expect.soft(serialized).not.toContain(sha(address))}for(const r of settlement.receipts)expect.soft(Object.keys(r).sort()).toEqual(['auction_id','party','txid','pool','output_index','amount_zats'].sort())});
    write('cli/auction.json',readFileSync(path.join(publicDir,'auction.json')));for(const n of ['manifest.json','frozen.json','result.json','opened.json','beacon.json','signer.json','receipts.json','summary.json'])write('cli/'+n,readFileSync(path.join(publicDir,n)));
    write('cli/drill.json',JSON.stringify({deposit_txid:paid.txid,stray_txid:strayTx,delay,recipients:expected.length,signing_ms:sessions.map((s:any)=>s.duration_ms),total_signing_ms:sessions.reduce((n:number,s:any)=>n+s.duration_ms,0),batches:settlement.batches.map((b:any)=>({id:b.id,state:b.state,actions:b.inspect.actions,fee_zats:b.inspect.fee_zats,starting_height:b.inspect.expiry_height-(b.state==='exception'?4:NORMAL_EXPIRY),mined_height:b.height,signing_ms:b.signing.sessions.map((s:any)=>s.duration_ms)})),start_height:metadata.expiry_height-4,end_height:z.tip()})+'\n');
  } finally {if(paused)process.kill(paused,'SIGCONT');if(active){process.kill(-active.p.pid!,'SIGKILL');await active.done}if(api)api.kill();try{await cleanup()}finally{stop()}}
});
