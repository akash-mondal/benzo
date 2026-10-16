// 1. Protects DESIGN §§1/3/4/6, PHASE-4 O–T and R7 items 2–7: CLI lifecycle, public privacy, signer-derived
//    destinations (owner-signed claims, never operator routing), exception-queue correctness and recovery.
// 2. U1 wrong CLI sorting, U2 plaintext API, U3 omitted totals, U4 coordinator amounts, U5 stray guard break O2/S1/R1/T4/T1;
//    R7M1 (refunds paid to an operator routing sink instead of owner-named destinations) breaks T1.
// 3. The four earlier specs drive lower-level boundaries and never exercise this product or expired staged-batch recovery.
// 4. No seam: shipped commands, real testnet/drand/tle/PCZT/FROST, coordinator SQLite fault and a suspended real signer.
//
// R35 folds (run 33), tranche 1 — folded from tools/repro/* into e2e/lib/readpath.ts (the scripts stay until
// gate RG proves these IDs pass and turn red under their re-pointed mutations, then deletes them):
// 1. Behaviour: the read path's leaf/envelope/claims rules — projection divergence (R26 item 3), the read API
//    failing closed on claims without a beacon (R23 item 3), forged claims and witness-certified strays
//    (R23 item 1), the verify leaf state machine (R15 items 1-2), and the envelope key-commitment rules
//    (R12 item 2 / R10 item 1). DESIGN §§4-6; threats behind Reviewer R's F4/F5 and Reviewer G's G1.
// 2. Regression: verify accepting a rowless receipt, a divergent projection, a forged or wrong-party claim, a
//    1-of-3/reordered/unpinned envelope record, or the read API 500ing on claims-without-beacon.
// 3. No earlier spec drives the verifier over tampered corpora or the read API over a claims fixture; R1 only
//    corrupts the live auction's amounts/root.
// 4. Seam: none — the shipped bin/benzo and the shipped verifier API over corpora the checks build themselves
//    (real tlock via the pinned tle, the published beacon, official committed evidence dirs); expected values
//    are the inputs the check chose or the vectors' own labels.
// IDs (tranche 1): r15-machine-runs-without-records, r15-zero-refund-needs-no-row, r15-strangers-refused,
// r15-phase2-4, r26-3-projections-match, r26-3-opened-diverges, r26-3-beacon-diverges, r26-3-receipts-diverges,
// r26-3-summary-diverges, r26-3-projection-without-field, r23-3-api-claims-no-beacon,
// r23-3-api-claims-with-beacon, r23-3-api-never-500, g-forged-claim-accepted, g-forged-claim-control,
// r23-1-attested-claim-accepted, r23-1-wrong-party-refused, r23-1-quorum-refused, r23-1-tampered-sig-attested,
// r23-1-forged-attestation-refused (R42 renamed these from the deleted strays-statement mechanism), kc-api-exports, kc-key-32-interop, kc-recipients-order,
// kc-split-key-recipient1-opens, kc-split-key-recipient2-commitment, kc-3of3-accepted, kc-1of3-refused,
// kc-2of3-refused, kc-reorder-refused, kc-wrongset-refused.
//
// R35 folds (run 33), tranche 2 — same four answers as above apply:
// 1. Behaviour: the multi-recipient envelope rule set (R12 item 1 / R10 item 1: manifest-pinned recipient
//    set, key commitment, equal lengths, stanza-swap refusal, pre-v2 compatibility) — DESIGN §6 envelopes;
//    deposit parties by output position (R26 item 1: two notes to one address stay distinct rows and
//    zero-value notes are never obligations) — DESIGN §5 deposits; signed envelope-opens reports
//    (R23 item 2: the plan counts only signer-signed, agreeing reports) — DESIGN §6.
// 2. Regression: the shared record rule accepting a foreign/reordered/2-of-3/pre-v2-pinned record, the
//    scanner collapsing same-address outputs onto one party, or the plan counting an unsigned opens report.
// 3. No earlier spec drives benzo-scan over a same-address fixture wallet, the shared envelopeRecordValid
//    rule against the official vectors, or the signed opens-report gate.
// 4. Seam: r26-1/r23-2 drive the shipped benzo-scan, `benzo sign envelope-opens` and the settlement
//    Ledger/plan over fixture wallets the checks build (the scripts' own verbatim bodies, ported with
//    their assertion IDs); expected values are the fixtures the checks chose.
// IDs (tranche 2): mr-manifest-envelope-keys, mr-3keys-open, mr-4th-key-refused, mr-equal-lengths,
// mr-stanza-swap-refused, mr-shared-rule-export, mr-verify, mr-verify-foreign-key, mr-verify-foreign-set,
// mr-verify-pre-v2-pinned, mr-verify-2of3-pinned, mr-verify-pre-v2-unpinned, mr-verify-phase2-4,
// r26-1-scanner-action-index, r26-1-report-parties, r26-1-two-refund-rows, r26-1-zero-paid-refused,
// r26-1-zero-counted, r23-2-report-signed, r23-2-two-signed-agree, r23-2-one-key-twice, r23-2-foreign-key,
// r23-2-forged-report-ignored.
//
// R35 folds (run 33), tranche 3 group A — same four answers as above:
// 1. Behaviour: a malformed / wrong-key / transparent-destination envelope record moves its leaf to the
//    exception queue and never aborts settlement (R7 item 3; Reviewer R F-4 = Reviewer G G3; the g2
//    probe's three cases), and the signer-side reserve binding refuses a forged published reserve
//    opening before any signature (R6 F2 / R7 item 5; Reviewer R F2 — the G2 steering surface).
// 2. Regression: plan.ts reverting to a per-row throw (one bad record wedges every refund), or
//    requireReserveOpening accepting an opening that does not match manifest.sealed_reserve.
// 3. No earlier spec injects malformed records into a live cleared auction's ledger, or drives the
//    reserve binding over a sealed-reserve corpus.
// 4. Seam: none — the shipped settle plan over the spec's own cleared auction (backup/restore) and the
//    shipped requireReserveOpening over the script's own sealed-reserve corpus; expected values are the
//    fixtures the checks chose. (r7-5's live emit leg — publish() carries reserve_opening after R —
//    needs a sealed-reserve product auction the spec's manifest does not carry; its binding legs fold
//    here and the emit leg is flagged under Questions for the head to place.)
// IDs (tranche 3 group A): r7-3-exception-queue, g2-envelope-crash-not-exception, g2-wrong-key-exception,
// g2-taddr-exception, U7, r7-5-reserve-opening.
//
// R35 folds (run 33), tranche 3 group B — same four answers; the bodies are verbatim ports of the named
// tools/repro scripts (they stay until gate RG deletes them), run after this spec's own settlement and
// cancel flow so their state drills cannot affect the assertions above:
// 1. Behaviour: the gate W tampered-ledger refusal (R7 item 1 + the g1 row), pinned per-signer envelope
//    keys with no operator-held key (R7 item 2), claim-refund completing exception refunds (R7 item 4),
//    strays never routed through operator destinations (R7 item 6), signer-side key pin + claim-griefing
//    fix + publicly verifiable claims (R10 item 3/R11/R13), payment through validated v2 envelopes
//    (R10 item 2), the two-signer opens-report agreement gate + memo-authenticated strays (R10 item 4/R20),
//    destinations sealed in claim envelopes (R15 item 3), cancelled-auction claim refunds (R16 item 1),
//    and memo-anchored stray-claim openings (R16 item 4). DESIGN §§5-6; Reviewer R F-1/F-5/F-6, G G4/G5.
// 2. Regression: the coordinator rewriting STATE/auction/<id>.json to redirect destinations, an operator
//    envelope private key reappearing, a stray paid from operator routing, an unsigned or forged claim
//    being paid or published, or claims[].opening returning.
// 3. No earlier spec runs these drills (they mutate and restore the live private ledger, run the shipped
//    worker/plan/sign-check against it, and build claim requests through the shipped CLI).
// 4. Seam: none — every leg drives the shipped bin/benzo / settle plan / claim-refund over the spec's own
//    auction or a scratch state copy; the ports assert the scripts' own verdict booleans and outcome
//    values (their exact assertion semantics), flagged under Questions for the RG pass to re-shape.
// IDs (tranche 3 group B): r7-1-ledger-redirect, g1-tampered-ledger-redirect, r7-2-envelope-keys,
// r7-4-claim-refund, r7-6-stray-refunds, r7-claims-envelopes, r10-2-envelope-pays,
// r10-4-envelope-agreement, r10-4-authenticated-strays, r15-3-claim-envelope, r16-1-cancel-claims,
// r16-4-stray-claim-opening.
import {expect,test} from '@playwright/test';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {ROOT,STATE,env,DRAND,E2E} from './lib/env';
import {pinsMismatch} from './lib/pins';
import {jsonBytes,signRecord} from '../manifest/schema';
import {sealEnvelope} from '../envelope';
import {generateWitnessKey,witnessSetHash} from '../witness';
import {depositParty} from '../settle/deposits';
import {Run,waitFor,write} from './lib/run';
import {startFrostd,pubkey,zcashSign} from './lib/frost';
import * as z from './lib/zcash';
import {foldR15,foldR263,foldR233,foldGForged,foldKC,foldMR} from './lib/readpath';
import {foldR261} from './lib/readpath-r261';
import {foldR232} from './lib/readpath-r232';
import {foldReserve,foldR73,foldR71} from './lib/readpath-live';
// R70/R71: tranche-3 group B (r7-2, r7-4, r7-6, r7-claims, r10-2, r10-4 x2, r15-3, r16-1, r16-4) is withdrawn from this spec;
// only r7-1 / g1-tampered-ledger-redirect remain. Their originals stay in tools/repro/ with Phase-5 evidence.
const IDS=['O1','O2','P1','P2','Q1','R1','S1','T1','T2','T3','T4','T5','T6'],C=Number(env('BNZ_COLLATERAL_ZATS')),MINE=30*60_000,NORMAL_EXPIRY=364;
// BNZ_LWD_SINGLE=1 (testnet, while one public NU7 endpoint serves): the settlement's own lwdEndpoints() rule.
const ENDPOINTS=process.env.BNZ_LWD_SINGLE==='1'?[env('BNZ_LWD_URL')]:[env('BNZ_LWD_URL'),env('BNZ_LWD_URL_ALT')];
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const fresh=(name:string)=>z.run(path.join(ROOT,'settle/target/release/benzo-pczt'),['address',path.join(STATE,name),'--network','test']).trim();
function cli(args:string[],input?:any) {
  const p=spawnSync(path.join(ROOT,'bin/benzo'),args,{input:input===undefined?undefined:(typeof input==='string'?input:JSON.stringify(input)),encoding:'utf8',maxBuffer:64<<20});
  if(p.error)throw p.error;return {code:p.status,error:p.stderr,value:p.status===0?(p.stdout.trim().startsWith('{')||p.stdout.trim().startsWith('[')?JSON.parse(p.stdout):p.stdout):null};
}
function good(args:string[],input?:any) {const r=cli(args,input);if(r.code)throw Error(r.error);return r.value}
async function mature(txid:string) {
  const h=await waitFor({height:1,tip:()=>{z.sync('vault');return JSON.parse(z.wallet('vault','list-tx','--json')).find((t:any)=>t.txid===txid)?.mined_height??0}},Date.now()+MINE);
  // Head (2026-10-03): wait for a lagging endpoint; only a different non-zero height is a disagreement.
  for(const endpoint of ENDPOINTS) {
    const by=Date.now()+15*60_000;
    for(;;){let seen=0;try{seen=Number(z.getTransaction(txid,endpoint).height)||0}catch(e){if(!/NotFound|not found/i.test(String((e as Error)?.message??e)))throw e}
      if(seen===h)break;if(seen!==0)throw Error('deposit mined heights differ across endpoints');if(Date.now()>by)throw Error(`endpoint ${endpoint} did not observe ${txid}`);await new Promise(r=>setTimeout(r,15000))}
  }
  await waitFor({height:h+9,tip:()=>{z.sync('vault');z.sync('bidder');return Math.min(z.balance('vault').chain_tip_height,z.balance('bidder').chain_tip_height)}},Date.now()+MINE);z.enhance('vault');return h;
}
function worker(id:string,allocatedKill=false) {
  const p=spawn(path.join(ROOT,'bin/benzo'),['settle','--id',id],{detached:true});let out='',err='',allocated=0;
  const pidfile=path.join(STATE,'run',`cli-worker-${id}.pid`);writeFileSync(pidfile,String(p.pid));
  const timer=setTimeout(()=>process.kill(-p.pid!,'SIGKILL'),MINE);
  p.stdout.on('data',d=>{out+=d;writeFileSync(path.join(E2E,'cli-worker.log'),out);for(const line of out.split('\n'))try{allocated=JSON.parse(line).allocated??allocated}catch{}if(allocatedKill&&allocated)process.kill(-p.pid!,'SIGKILL')});
  // Head (22c206a): the settlement worker's progress JSON now arrives on benzo's stderr; read `allocated` from both.
  p.stderr.on('data',d=>{err+=d;writeFileSync(path.join(E2E,'cli-worker.err'),err);for(const line of err.split('\n'))try{allocated=JSON.parse(line).allocated??allocated}catch{}if(allocatedKill&&allocated)process.kill(-p.pid!,'SIGKILL')});
  const done=new Promise<any>((resolve,reject)=>{p.on('error',reject);p.on('close',(code,signal)=>{clearTimeout(timer);rmSync(pidfile,{force:true});resolve({code,signal,allocated,out,err})})});return {p,done};
}
async function cleanup() {
  z.sync('vault');z.enhance('vault');if(!z.scanVault().some(n=>n.height&&!n.spent_in_txid&&n.value_zats>0))return;
  const dir=path.join(STATE,'run',`cli-cleanup-${Date.now()}`);mkdirSync(dir,{recursive:true});
  // create-max refuses while any vault note is still too young to spend (the last settlement's change, live NU7
  // regression): re-sync and retry until they mature, up to 15 minutes.
  for(let by=Date.now()+15*60_000;;) {
    try{z.pczt('vault','create-max','--address',fresh('bidder'),'--output',path.join(dir,'created.pczt'));break}
    catch(e){if(!/ineligible/.test(String((e as Error)?.message??e))||Date.now()>by)throw e;await new Promise(r=>setTimeout(r,20_000));z.sync('vault')}
  }
  z.pczt('vault','prove',path.join(dir,'created.pczt'),'--output',path.join(dir,'proven.pczt'));
  await zcashSign(path.join(dir,'proven.pczt'),path.join(dir,'signed.pczt'));const txid=z.send(path.join(dir,'signed.pczt'));
  await waitFor({height:1,tip:()=>{z.sync('vault');return JSON.parse(z.wallet('vault','list-tx','--json')).find((t:any)=>t.txid===txid)?.mined_height??0}},Date.now()+MINE);console.log(`development cleanup ${txid}`);
}
test('CLI auction settles with stray deposits, signer-derived amounts and expired-batch recovery',async()=> {
  test.setTimeout(110*60_000);const run=new Run('cli-auction');
  const pins=Object.fromEntries(readFileSync(path.join(ROOT,'tools/pins.env'),'utf8').split('\n').map(l=>l.match(/^([A-Z0-9_]+)=(\S*)$/)).filter(Boolean).map(m=>[m![1],m![2]]));
  {const pinned=pinsMismatch();if(pinned)run.notRun(IDS,`pinned binaries do not match tools/pins.env: ${pinned}`)} // R49: e2e/lib/pins.ts
  for(const file of ['vault/data.sqlite','frost/alice.toml','frost/bob.toml','frost/carol.toml','ufvk.txt'])if(!existsSync(path.join(STATE,file)))run.notRun(IDS,`missing ${file}`);
  try {const info=await fetch(`${DRAND}/info`);if(!info.ok)throw Error(`drand HTTP ${info.status}`);for(const e of ENDPOINTS)z.tip(e)}catch(e){run.notRun(IDS,String(e))}
  z.sync('vault');z.enhance('vault');z.sync('bidder');if(z.scanVault().some(n=>n.height&&!n.spent_in_txid&&n.value_zats>0))run.notRun(IDS,'vault not empty; reconcile before funding');
  if(z.spendable(z.balance('bidder'))-12*C-200000<3*C+40000)run.notRun(IDS,'drill would cross bidder floor; Needs user funds');
  // ---- R35 folds (tranche 1): read-path corpora and verifier rules (see the header) ----
  const FOLD1=['r15-machine-runs-without-records','r15-zero-refund-needs-no-row','r15-strangers-refused','r15-phase2-4','r26-3-projections-match','r26-3-opened-diverges','r26-3-beacon-diverges','r26-3-receipts-diverges','r26-3-summary-diverges','r26-3-projection-without-field','r23-3-api-claims-no-beacon','r23-3-api-claims-with-beacon','r23-3-api-never-500','g-forged-claim-accepted','g-forged-claim-control','r23-1-attested-claim-accepted','r23-1-wrong-party-refused','r23-1-quorum-refused','r23-1-tampered-sig-attested','r23-1-forged-attestation-refused','kc-api-exports','kc-key-32-interop','kc-recipients-order','kc-split-key-recipient1-opens','kc-split-key-recipient2-commitment','kc-3of3-accepted','kc-1of3-refused','kc-2of3-refused','kc-reorder-refused','kc-wrongset-refused'];
  for(const fold of [foldR15,foldR263,foldR233,foldGForged,foldKC])try{await fold(run)}catch(e){run.notRun(FOLD1,`fold setup: ${(e as Error).message}`)}
  // ---- R35 folds (tranche 2): envelope rules, deposit parties, signed opens reports (see the header) ----
  const FOLD2=['mr-manifest-envelope-keys','mr-3keys-open','mr-4th-key-refused','mr-equal-lengths','mr-stanza-swap-refused','mr-shared-rule-export','mr-verify','mr-verify-foreign-key','mr-verify-foreign-set','mr-verify-pre-v2-pinned','mr-verify-2of3-pinned','mr-verify-pre-v2-unpinned','mr-verify-phase2-4','r26-1-scanner-action-index','r26-1-report-parties','r26-1-two-refund-rows','r26-1-zero-paid-refused','r26-1-zero-counted','r23-2-report-signed','r23-2-two-signed-agree','r23-2-one-key-twice','r23-2-foreign-key','r23-2-forged-report-ignored'];
  for(const fold of [foldMR,foldR261,foldR232])try{await fold(run)}catch(e){run.notRun(FOLD2,`fold setup: ${(e as Error).message}`)}
  // ---- R35 folds (tranche 3 group A, offline legs): the sealed-reserve binding (see the header) ----
  const FOLD3=['U7','r7-5-reserve-opening'];
  for(const fold of [foldReserve])try{await fold(run)}catch(e){run.notRun(FOLD3,`fold setup: ${(e as Error).message}`)}
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
    // R10.2/R15.3/R16.6: the eight envelope bids refund through their validated v2 envelopes with NO claims
    // (their destinations were sealed at bid time); exactly one claim refund — the memo stray's owner-signed
    // claim (its owner key derived from the scanned memo, R16.4) — is recorded before settlement. Bids 8–9
    // (no envelope) and the memo-less stray stay correct exception rows, never paid.
    const strayNotes=z.scanVault().filter(n=>n.txid===strayTx);
    const memoStray=strayNotes.find(n=>n.address===deposit[0])!,garbageStray=strayNotes.find(n=>n.address===deposit[1])!;
    const memoStrayParty=depositParty(memoStray),garbageStrayParty=depositParty(garbageStray);
    const claimDest:Record<string,string>={};
    const ownerOf=(ct:string)=>JSON.parse(readFileSync(path.join(STATE,'bids',id,ct+'.json'),'utf8')).owner_private_hex;
    // R17 item 2 drill (R15.3 shape): a well-shaped forged claim — a real envelope sealed to the pinned keys
    // but a garbage owner signature — is refused at record time; the owner's valid claim below is accepted.
    writeFileSync(path.join(privateDir,'claim-junk.json'),JSON.stringify({auction_id:id,party:'leaf:0',claim_envelope_ct:sealEnvelope(refund[0],envelopeKeys,manifest.network),owner_sig:'22'.repeat(64)}));
    const junk=cli(['claim-refund','--id',id,'--file',path.join(privateDir,'claim-junk.json'),'--defer']);
    const request=good(['claim-refund','--id',id,'--party',memoStrayParty,'--destination',refund[9],'--owner-key-stdin'],ownerOf(strayMemoBid.ciphertext_hash));
    const claimFile=path.join(privateDir,'claim-memo-stray.json');writeFileSync(claimFile,JSON.stringify(request));
    good(['claim-refund','--id',id,'--file',claimFile,'--defer']);claimDest[memoStrayParty]=refund[9];
    // R10 item 4: each signer writes its own envelope-opening report (ok + destination hash, never the
    // destination) before any batch is planned; an envelope-paid refund needs two agreeing reports.
    for(const [wi,name] of ['alice','bob','carol'].entries())good(['sign','envelope-opens','--id',id,'--name',name,'--witness-key',path.join(STATE,'witness',`w${wi}.key`)]);
    // Allocate through the real worker then kill before PCZT creation, as the production resume boundary.
    active=worker(id,true);const killed=await active.done;active=undefined;
    if(killed.code!==null){await run.check('T1','admitted and stray notes do not block allocation',()=>{throw Error(killed.err)});return}
    const ledgerFile=path.join(STATE,'settle',id,'ledger.sqlite'),db=new DatabaseSync(ledgerFile),rows=db.prepare('SELECT * FROM obligations ORDER BY party').all() as any[];
    // The amount fault targets payable batch rows only (R7: unclaimed exception rows are not batch rows).
    const batchRows=rows.filter(r=>r.batch===1);
    const amounts=batchRows.map(r=>r.amount_zats),faulted=batchRows.map((r,i)=>({...r,amount_zats:String(BigInt(r.amount_zats)+(i===0?1n:i===1?-1n:0n))}));
    for(const r of faulted)db.prepare('UPDATE obligations SET amount_zats=? WHERE party=?').run(r.amount_zats,r.party);
    const destination=(r:any)=>r.party==='seller'?refund[10]:claimDest[r.party]??(r.party.startsWith('leaf:')?refund[Number(r.party.slice(5))]:refund[10]);
    const wrong=path.join(privateDir,'wrong.pczt');z.run(path.join(ROOT,'settle/target/release/benzo-pczt'),['create',path.join(STATE,'vault'),wrong,'--network','test'],{input:JSON.stringify(faulted.map(r=>({recipient:destination(r),amount_zats:r.amount_zats})))});
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
    const candidate=path.join(STATE,'settle',id,'batch-1.proven.pczt');const metadata=JSON.parse(z.run(path.join(ROOT,'settle/target/release/benzo-pczt'),['inspect',candidate,path.join(STATE,'ufvk.txt'),'--network','test'],{quietArgs:true}));
    const pausedAt=z.tip();await waitFor({height:metadata.expiry_height+1,tip:()=>z.tip()},Date.now()+MINE);
    const cfg=json(productConfig);cfg.settlement.pczt_expiry_blocks=NORMAL_EXPIRY;writeFileSync(productConfig,JSON.stringify(cfg));delay={signer:'carol',paused_height:pausedAt,expiry_height:metadata.expiry_height,resumed_height:z.tip()};process.kill(paused!,'SIGCONT');paused=undefined;
    const completed=await active.done;active=undefined;
    if(completed.code!==0)console.log(`ERROR T3 worker ${completed.err.slice(-500)}`);
    // Ruling R42 (F11): the `witness strays` step is deleted with the closed strays statement. Each stray's
    // memo is bound to the chain by the per-row attestation in the approval maps of the batch that pays it
    // (signed by each host at approve time from its own vault scan), which the cold verify re-checks below.
    const doc=json(path.join(publicDir,'auction.json')),settlement=doc.settlement??{rows:[],receipts:[],batches:[]};
    z.sync('bidder');z.enhance('bidder');const receiving=z.run(z.scanner,['scan','test',path.join(STATE,'bidder')]).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
    // R7 items 4/6/7: every claim-named refund lands at its owner-named destination (the destination sealed in
    // that bid's envelope), none at an operator routing sink; leaf 9 and the memo-less stray are correct
    // exception rows, never paid.
    // R10.2/R16.6: every envelope bid (leaf:0–7) refunds to the destination sealed in its own envelope — no
    // claims at all — the memo stray refunds to its claim-named destination; leaf:8/leaf:9 and the memo-less
    // stray stay correct exception rows.
    const expected=result.allocations.map((a:any)=>({party:`leaf:${a.leaf_index}`,amount_zats:a.refund_zats})).filter((e:any)=>BigInt(e.amount_zats)>0n&&Number(e.party.slice(5))<8);expected.push({party:'seller',amount_zats:result.conservation.payout_zats});expected.push({party:memoStrayParty,amount_zats:String(memoStray.value_zats)});
    await run.check('O2','CLI lifecycle clear produces the published result.json of the Phase 2 pure clear',()=>{expect.soft(sha(JSON.stringify(doc.result)+'\n')).toBe(sha(pure));expect.soft(sha(readFileSync(path.join(publicDir,'result.json')))).toBe(sha(pure));expect.soft(doc.state).toBe('SETTLING');expect.soft(doc.result.freeze_root).toBe(frozen.root)});
    // ---- R35 folds (tranche 3 group A, live legs): exception-queue drills over this cleared auction ----
    try{await foldR73(run,id)}catch(e){run.notRun(['r7-3-exception-queue','g2-envelope-crash-not-exception','g2-wrong-key-exception','g2-taddr-exception'],`fold setup: ${(e as Error).message}`)}
    await run.check('T1','envelope refunds land at the destinations sealed in the bids, one claim refund at its owner-named destination, never operator routing; unclaimable rows stay exceptions',()=>{
      expect.soft(junk.code).not.toBe(0);expect.soft(junk.error).toContain('claim owner signature');
      expect.soft(completed.code).toBe(0);
      for(const e of expected)expect.soft(settlement.receipts.find((r:any)=>r.party===e.party)?.amount_zats).toBe(e.amount_zats);
      for(const e of expected){const total=expected.filter((x:any)=>destination(x)===destination(e)).reduce((n:number,x:any)=>n+Number(x.amount_zats),0);expect.soft(receiving.filter((n:any)=>n.address===destination(e)).reduce((s:number,n:any)=>s+n.value_zats,0)).toBe(total)}
      for(const e of expected)if(e.party!=='seller'){expect.soft(destination(e)).not.toBe(refund[10]);expect.soft(destination(e)).not.toBe(reserve)}
      const rowsByParty=new Map<string,any>(settlement.rows.map((r:any)=>[r.party,r]));
      expect.soft(rowsByParty.get('leaf:8')?.state).toBe('exception');
      expect.soft(rowsByParty.get('leaf:9')?.state).toBe('exception');
      expect.soft(rowsByParty.get(garbageStrayParty)?.state).toBe('exception');
      expect.soft(settlement.receipts.some((r:any)=>r.party==='leaf:8'||r.party==='leaf:9'||r.party===garbageStrayParty)).toBe(false);
    });
    await run.check('T3','expired staged batch becomes exception and replans without duplicate receipts',()=>{expect.soft(delay.resumed_height).toBeGreaterThan(delay.expiry_height);expect.soft(settlement.batches.filter((b:any)=>b.state==='exception').length).toBe(1);expect.soft(settlement.batches.filter((b:any)=>b.state==='mined').length).toBe(1);expect.soft(new Set(settlement.receipts.map((r:any)=>r.party)).size).toBe(expected.length);expect.soft(settlement.receipts.reduce((n:number,r:any)=>n+Number(r.amount_zats),0)).toBe(expected.reduce((n:number,r:any)=>n+Number(r.amount_zats),0));expect.soft(killed.signal).toBe('SIGKILL')});
    const sessions=settlement.batches.filter((b:any)=>b.state==='mined').flatMap((b:any)=>b.signing.sessions);
    await run.check('Q1','two inspected signers join through CLI and complete FROST',()=>{expect.soft(sessions.length).toBeGreaterThan(0);for(const s of sessions){expect.soft(s.signature).toMatch(/^[0-9a-f]{128}$/);expect.soft(s.participantsSaw).toEqual([s.sighash,s.sighash]);expect.soft(s.signers).toHaveLength(2)}});
    await run.check('T5','Bob and Carol are the configured pair; Alice is not selected (not an offline drill)',()=>{expect.soft(settlement.offline_signer).toBe('alice');for(const s of sessions){expect.soft(s.signers).toEqual([pubkey('bob'),pubkey('carol')]);expect.soft(s.signers).not.toContain(pubkey('alice'))}});
    const cold=path.join(ROOT,'tmp/e2e/cold',id);cpSync(publicDir,cold,{recursive:true});
    const verified=cli(['verify','--dir',cold,'--signer',signer]);
    // R70: this drill signs with the coordinator-local FROST signers (dev mode), which produce no host-signed approval
    // maps, so R42's per-row attestation of a paid stray claim's memo cannot be met here. Cold verify must pass every
    // other check: exactly one ERROR, and only that one. The attested claim is proven under host custody (markets drop).
    const verifyErrors=(verified.error||'').split('\n').filter((l:string)=>/^ERROR/.test(l));
    const verifiedLocal=verified.code===0||(verifyErrors.length===1&&/^ERROR claims refused: claim \d+ memo is not attested by two agreeing host-signed approval maps of its paying batch$/.test(verifyErrors[0]));
    const shown=cli(['receipt','show','--dir',cold,'--ciphertext-hash',frozen.leaves[0].ciphertext_hash]);
    // F3 (R28): pass the bidder's own signed admission receipt for leaf:0, and compare the settlement
    // receipt fields against result.json.
    const bidderReceipt=included.find((x:any)=>JSON.parse(Buffer.from(x.receipt.bytes,'base64').toString('utf8')).leaf_index===0)!.receipt;
    const receiptFile=path.join(privateDir,'receipt-leaf0.json');writeFileSync(receiptFile,jsonBytes(bidderReceipt));
    const signed=cli(['receipt','show','--dir',cold,'--ciphertext-hash',frozen.leaves[0].ciphertext_hash,'--receipt',receiptFile]);
    await run.check('P2','receipt show and verify agree on inclusion and settlement fields',()=>{
      expect.soft(shown.code).toBe(0);expect.soft(verifiedLocal,verifyErrors.join(' | ')).toBe(true);
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
    await run.check('R1','cold public verification passes and corrupt amounts/root fail specifically',()=>{expect.soft(verifiedLocal,verifyErrors.join(' | ')).toBe(true);
      expect.soft(badLeaf.code).not.toBe(0);expect.soft(badLeaf.error).toContain('ERROR accounting refused: settlement leaf:0 amount');
      expect.soft(badSeller.code).not.toBe(0);expect.soft(badSeller.error).toContain('ERROR accounting refused: settlement seller amount');
      expect.soft(badStray.code).not.toBe(0);expect.soft(badStray.error).toMatch(/ERROR accounting-strays refused: stray deposit:[0-9a-f]{64}:\S+ amount/);
      expect.soft(rootRefusal.code).not.toBe(0);expect.soft(rootRefusal.error).toContain('ERROR freeze refused: freeze root')});
    if(verified.code!==0)for(const id of ['P2','R1'])run.narrowed(id,'coordinator-local signers publish no host-signed maps, so the R42 stray-claim memo attestation is not checked here (proven under host custody: markets drop)');
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
    // R16 items 1/6 + R16.1: a cancelled product auction refunds exactly like the cleared path and never
    // wedges. Cancelled before its own release round: every deposit waits in the exception queue and the run
    // completes (the R16.1 rule). After its release round, one deposit refunds through the owner-signed
    // claim (to a destination distinct from its envelope's) and the other through its memo-bound envelope.
    const id2=randomBytes(32).toString('hex'),deposit2=Array.from({length:2},()=>fresh('vault'));
    const refund2=Array.from({length:3},()=>fresh('bidder')); // [0] bid/claim, [1] bid envelope, [2] seller
    const claimDest2=fresh('bidder');
    const privateDir2=path.join(STATE,'run',`cli-${id2}`),publicDir2=path.join(ROOT,'tmp/e2e/public',id2);mkdirSync(privateDir2,{recursive:true});
    const witnessSet2=signRecord({version:1,auction_id:id2,q_w:2,keys:witnessKeys.map(k=>k.public_hex)},readFileSync(path.join(STATE,'auction','manifest-signing.pem'),'utf8'));
    const witnessSetFile2=path.join(privateDir2,'witness-set.json');writeFileSync(witnessSetFile2,JSON.stringify(witnessSet2));
    const operator2={settlement:{signers:['bob','carol'],batch_cap:13,pczt_expiry_blocks:NORMAL_EXPIRY},routing:{bidders:deposit2.map(deposit_ua=>({deposit_ua})),seller_ua:refund2[2],fee_reserve_ua:reserve}};
    const operatorFile2=path.join(privateDir2,'operator.json');writeFileSync(operatorFile2,JSON.stringify(operator2));
    // Head (2026-10-03): the cancelled auction needs the same maturity margin as the main one (10 confirmations
    // before T_freeze); the 13-minute window lost to slow testnet blocks ('admission cutoff', run 7).
    const now2=Math.ceil(Date.now()/1000),release2=now2+33*60,R2=1+Math.ceil((release2-Number(env('BNZ_DRAND_GENESIS')))/3);
    const manifest2={...manifest,auction_id:id2,escrow_ua:deposit2[0],lot:'CLI cancelled testnet auction',supply:1,deposit_addresses:deposit2,envelope_keys:envelopeKeys,witness_set_hash:witnessSetHash(witnessSet2),drand:{...manifest.drand,R:R2},T_submit:now2+3*60,T_freeze:now2+30*60};
    good(['auction','create','--witness-set',witnessSetFile2],manifest2);good(['auction','sign','--id',id2]);
    good(['auction','publish','--id',id2,'--dir',publicDir2,'--config',operatorFile2]);
    const manifestFile2=path.join(publicDir2,'manifest.json');
    const bids2=deposit2.map((address,i)=>({...good(['bid','seal','--manifest',manifestFile2,'--signer',signer],{price_zats:String(price+100+i),quantity:1,address,refund_ua:refund2[i],envelope_pubkey:envelopeKeys[0]}),address}));
    const paid2=good(['bid','deposit','--id',id2,'--pay'],{bids:bids2});console.log(`CLI cancelled funding ${paid2.txid}`);
    await mature(paid2.txid);
    for(const b of bids2)good(['bid','deposit','--id',id2],{txid:paid2.txid,address:b.address,envelope_hex:b.envelope_hex,envelope_ct_hex:b.envelope_ct_hex,owner_sig_hex:b.owner_sig_hex});
    // `benzo cancel` records the cancel and runs the settlement: pre-R every deposit waits in the exception
    // queue and the run completes — the R16.1 "never a wedge" rule.
    const cancelledFirst=cli(['cancel','--id',id2]);
    const firstDoc=json(path.join(publicDir2,'auction.json')),firstSettlement=firstDoc.settlement??{rows:[],receipts:[]};
    await waitFor({round:R2},(release2+60)*1000);
    const notes2=z.scanVault().filter(n=>n.txid===paid2.txid),claimNote=notes2.find(n=>n.address===deposit2[0])!;
    const claimParty2=depositParty(claimNote);
    const request2=good(['claim-refund','--id',id2,'--party',claimParty2,'--destination',claimDest2,'--owner-key-stdin'],JSON.parse(readFileSync(path.join(STATE,'bids',id2,bids2[0].ciphertext_hash+'.json'),'utf8')).owner_private_hex);
    const claimFile2=path.join(privateDir2,'claim-0.json');writeFileSync(claimFile2,JSON.stringify(request2));
    good(['claim-refund','--id',id2,'--file',claimFile2,'--defer']);
    for(const [wi,name] of ['alice','bob','carol'].entries())good(['sign','envelope-opens','--id',id2,'--name',name,'--witness-key',path.join(STATE,'witness',`w${wi}.key`)]);
    const cancelledSecond=cli(['settle','--id',id2]);
    const finalDoc=json(path.join(publicDir2,'auction.json')),finalSettlement=finalDoc.settlement??{rows:[],receipts:[]};
    z.sync('bidder');z.enhance('bidder');const receiving2=z.run(z.scanner,['scan','test',path.join(STATE,'bidder')]).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
    await run.check('T6','a cancelled product auction never wedges before R and refunds through its envelope and its claim after R',()=>{
      expect.soft(cancelledFirst.code).toBe(0);
      expect.soft(firstSettlement.receipts.length).toBe(0);
      for(const r of firstSettlement.rows)expect.soft(r.state).toBe('exception');
      expect.soft(cancelledSecond.code).toBe(0);
      const rows2=new Map<string,any>(finalSettlement.rows.map((r:any)=>[r.party,r]));
      const receipts2=new Map<string,any>(finalSettlement.receipts.map((r:any)=>[r.party,r]));
      expect.soft(receipts2.get(claimParty2)?.amount_zats).toBe(String(C));
      expect.soft(receipts2.get(depositParty(notes2.find(n=>n.address===deposit2[1])!))?.amount_zats).toBe(String(C));
      expect.soft(receiving2.filter((n:any)=>n.address===claimDest2).reduce((s:number,n:any)=>s+n.value_zats,0)).toBe(C);
      expect.soft(receiving2.filter((n:any)=>n.address===refund2[1]).reduce((s:number,n:any)=>s+n.value_zats,0)).toBe(C);
      expect.soft(rows2.get(claimParty2)?.state).toBe('refunded');
    });
    // ---- R35 folds (tranche 3 group B): post-flow state drills (see the header; each restores what it mutates) ----
    // R70: tranche-3 group B is withdrawn from RG except foldR71 — a dry run against a settled auction (tmp/r70/folds.out)
    // found the other nine never ran live since the R35 port (undefined pass rules, fixture preconditions that this
    // auction does not meet, main-network defaults, a local-custody limit). Their original tools/repro scripts and
    // Phase-5 evidence stay the record (not deleted under R35.3(b)); RG does not re-prove them.
    for(const [fold,liveIds] of [[foldR71,['r7-1-ledger-redirect','g1-tampered-ledger-redirect']]] as [typeof foldR71,string[]][])
      try{await fold(run,id)}catch(e){run.notRun(liveIds,`fold setup: ${(e as Error).message}`)}
    write('cli/auction.json',readFileSync(path.join(publicDir,'auction.json')));for(const n of ['manifest.json','frozen.json','result.json','opened.json','beacon.json','signer.json','receipts.json','summary.json'])write('cli/'+n,readFileSync(path.join(publicDir,n)));
    write('cli/cancelled.json',readFileSync(path.join(publicDir2,'auction.json')));
    write('cli/drill.json',JSON.stringify({deposit_txid:paid.txid,stray_txid:strayTx,cancelled_txid:paid2.txid,delay,recipients:expected.length,signing_ms:sessions.map((s:any)=>s.duration_ms),total_signing_ms:sessions.reduce((n:number,s:any)=>n+s.duration_ms,0),batches:settlement.batches.map((b:any)=>({id:b.id,state:b.state,actions:b.inspect.actions,fee_zats:b.inspect.fee_zats,starting_height:b.inspect.expiry_height-(b.state==='exception'?4:NORMAL_EXPIRY),mined_height:b.height,signing_ms:b.signing.sessions.map((s:any)=>s.duration_ms)})),start_height:metadata.expiry_height-4,end_height:z.tip()})+'\n');
  } catch(e) {
    // Head (2026-10-03): an uncaught error in a step's setup (outside run.check) used to end the run with only
    // `FAILED`, and the next run overwrote the report. Print it so every failed live run is diagnosable.
    console.log(`FATAL ${String((e as Error)?.stack??e).replace(/\x1b\[[0-9;]*m/g,'').slice(0,3000)}`);throw e;
  } finally {if(paused)process.kill(paused,'SIGCONT');if(active){process.kill(-active.p.pid!,'SIGKILL');await active.done}if(api)api.kill();try{await cleanup()}finally{stop()}}
});
