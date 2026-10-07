// Track A product state and CLI boundaries. Auction and settlement algorithms stay in their existing entry points.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {createPublicKey,generateKeyPairSync,randomBytes} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '@playwright/test';
import {hash,jsonBytes,requireThat,signRecord,validateManifest,verifyRecord,QUICKNET} from '../manifest/schema';
import {prepareBid,bindSealedBid} from '../envelope/bid';
import {ownerPublic,signStatement,sealEnvelope,envelopeRecordValid,sealDelivery} from '../envelope';
import {requireShieldedDestination} from '../envelope/destination';
import {ROOT,STATE,bin,run as execute,inspect,chainTx,notes,syncRetry,wallet} from '../settle/io';
import {pcztBin,vaultDir} from '../manifest/paths';
// Design §6.1: manifests are read through the mode registry (its launch -> zilkroad -> public-auction cycle, which
// deadlocked this lazily loaded bundle on envelope's top-level await, is broken by adapters/holders.ts).
import {treasuryBlock,treasuryFunded,treasuryRequired} from '../clear/mode-b';
import {clientCommon as client,modeEntry} from '../clear/registry';
import {isBalanceLateParty,balanceLateNote,balanceLateLeafIndex} from '../clear/features';
import {launchWinners} from '../clear/launch';
import {requireOwnEnvelopeKey,memoSealedBid,ownEnvelopePrivate,openDestination,authenticatedMemoEnvelope} from '../settle/envelopes';
import {depositParty,partyNote,isDepositParty,refundable} from '../settle/deposits';
import {checkCertificates,freezeStatement,signOpensReport,validateWitnessSet,verifyApprovalMap,verifyDeliveryListSig,witnessSetHash,type WitnessSet} from '../witness';
import {verifyStatement} from '../envelope';
export const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const save=(p:string,v:any)=>{mkdirSync(path.dirname(p),{recursive:true,mode:0o700});writeFileSync(p+'.new',jsonBytes(v),{mode:0o600});renameSync(p+'.new',p)};
const key=path.join(STATE,'auction/manifest-signing.pem');
const config=(id:string)=>path.join(STATE,'product',id+'.json');
const ledger=(id:string)=>path.join(STATE,'auction',id+'.json');
const draft=(id:string)=>path.join(STATE,'product',id+'.draft.json');
function options(args:string[]) {
  const result:Record<string,string>={};
  for(let i=0;i<args.length;i++){requireThat(/^--[a-z-]+$/.test(args[i]),'expected named option');const k=args[i].slice(2);requireThat(!result[k],'duplicate option');result[k]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:'true'}return result;
}
const input=(o:Record<string,string>)=>read(o.file??'/dev/stdin');
const ac=(verb:string,id:string,v:any={})=> {const p=spawnSync(process.execPath,[path.join(ROOT,'clear/dist/auction.mjs'),verb,id],{input:JSON.stringify(v),encoding:'utf8',maxBuffer:64<<20});if(p.error)throw p.error;requireThat(p.status===0,p.stderr.trim().slice(-300));return JSON.parse(p.stdout)};
const sc=(verb:string,id:string,args:string[]=[],v:any={})=>execute(process.execPath,[path.join(ROOT,'settle/dist/cli.mjs'),verb,id,...args],JSON.stringify(v));
function privatePath(p:string) {const resolved=path.resolve(p);requireThat(resolved.startsWith(STATE+path.sep),'private file must live under BNZ_STATE_DIR');return resolved}
export function publish(id:string) {
  const a=read(ledger(id)),cfg=read(config(id)),dir=path.resolve(cfg.public_dir);
  const doc:any={version:1,auction_id:id,signer:a.signer,manifest:a.manifest,state:a.state,receipts:a.receipts};
  if(a.frozen)doc.frozen=a.frozen;if(a.result)doc.result=a.result;if(a.opened)doc.opened=a.opened;if(a.beacon)doc.beacon=a.beacon;
  // Part 2, collection drop: the serial shuffle's drand beacon (a) publishes with the round; the bond-then-pay
  // window and balance addresses are fixed in the signed manifest before bidding (R33), so no post-clear binding
  // is recorded or published.
  if(a.serial_beacon)doc.serial_beacon=a.serial_beacon;
  // R7 item 5 (Reviewer G G2): the reserve opening is published after R alongside the openings, so
  // sealed-reserve product auctions can settle and verify — both re-derive it from manifest.sealed_reserve
  // and refuse any mismatch (manifest/reserve.ts requireReserveOpening).
  if(a.reserve_opening!==undefined)doc.reserve_opening={plaintext_hex:a.reserve_opening};
  // R8 G10 (design §5): the signed witness set travels with every rebuilt document, and the witness-signed
  // certificates placed in the public dir by `benzo witness sign` are carried over instead of clobbered.
  if(a.witness_set)doc.witness_set=a.witness_set;
  if(a.launch_input){const {delivery,...rest}=a.launch_input;
    // Ruling R40 item 3 (F4): the launch DELIVERY records stay private (the ledger only) — the published doc
    // never carries the leaf<->destination join. The rest of launch_input (holder receipts, mined heights, the
    // previous result) is public clear input and publishes as before.
    if(Object.keys(rest).length)doc.launch_input=rest}
  const previous=existsSync(path.join(dir,'auction.json'))?JSON.parse(readFileSync(path.join(dir,'auction.json'),'utf8')):{};
  if(previous.witness_cert)doc.witness_cert=previous.witness_cert;
  // R23 item 1: witness-certified strays statements survive every rebuild of the document.
  if(previous.strays_cert)doc.strays_cert=previous.strays_cert;
  const sd=path.join(STATE,'settle',id),summary=path.join(sd,'summary.json');
  if(existsSync(summary)) {
    const s=read(summary);
    // R13: the claims the signers actually used for paid rows are published (party, destination hash, owner
    // signature — never the destination) so anyone can check them against the openings.
    const paid=new Set<any>(read(path.join(sd,'receipts.json')).map((r:any)=>r.party));
    const used=(s.plan?.claims_used??[]).filter((c:any)=>paid.has(c.party)).map((c:any)=>({party:c.party,claim_envelope_sha256:c.claim_envelope_sha256,owner_sig:c.owner_sig,...(c.memo_hex?{memo_hex:c.memo_hex}:{})}));
    if(used.length)doc.claims=used;
    // R33 item 3 (P1-3): `settlement.defaults` is published only when two agreeing host-signed approval maps
    // (the G-4 maps, verified against the pinned witness set) carry the same list; the maps themselves publish
    // with the settlement so `benzo verify` re-checks the binding. A coordinator-only list is never published.
    const maps=s.batches.flatMap((b:any)=>{try{return JSON.parse(readFileSync(path.join(sd,`batch-${b.id}.maps.json`),'utf8'))}catch{return []}});
    // R33 item 3 (P1-3): `settlement.defaults` is published only when two agreeing host-signed approval maps
    // (verified against the pinned witness set) carry the same list; the maps themselves publish with the
    // settlement so `benzo verify` re-checks the binding. A coordinator-only list is never published.
    // Ruling R41 (F7): `settlement.balance_refunds` is never gate-bound here. Refund rows are attested PER ROW
    // in the approval of the batch that PAID them (verify's balance-refs); unpaid rows publish as `pending`
    // with counts only. Comparing a live row set to any earlier signed set is exactly the F7 wedge and is gone.
    if(s.plan?.defaults!==undefined) {
      const wkeys=doc.witness_set?((verifyRecord<any>(doc.witness_set,doc.signer).keys??[])as string[]):[];
      const agreeing=(maps as any[]).filter((mp:any)=>mp&&verifyApprovalMap(mp,wkeys)&&mp.auction_id===id&&
        jsonBytes(mp.defaults??null).equals(jsonBytes(s.plan.defaults??null)));
      requireThat(new Set(agreeing.map((mp:any)=>mp.witness)).size>=2,'settlement defaults need two agreeing host-signed approval maps; refusing to publish');
    }
    doc.settlement={rows:s.rows,receipts:read(path.join(sd,'receipts.json')),offline_signer:s.offline_signer,ignored:s.plan?.ignored??[],
      // Part 2 (bond-then-pay): the defaults derived by the plan and co-signed by the signer hosts (above).
      ...(s.plan?.defaults!==undefined?{defaults:s.plan.defaults}:{}),
      // Ruling R38 item 4 (N4) + Ruling R41 (F7): the out-of-window/excess balance refunds as per-note counts
      // only, never addresses — each row marked `paid` when this settlement paid it (attested in that batch's
      // two agreeing signed maps) and `pending` otherwise (uncounted here; a later batch may pay it).
      ...(s.plan?.balance_refunds!==undefined?{balance_refunds:s.plan.balance_refunds.map((r:any)=>({...r,state:paid.has(r.party)?"paid":"pending"}))}:{}),
      ...(maps.length?{approval_maps:maps}:{}),batches:s.batches.map((b:any)=>{
      const base=path.join(sd,`batch-${b.id}`),i=existsSync(base+'.inspect.json')?read(base+'.inspect.json'):null;
      return {...b,state:b.state,inspect:i?{...i,outputs:i.outputs.map(({recipient,...o}:any)=>o)}:null,signing:existsSync(base+'.signatures.json')?read(base+'.signatures.json'):null};
    })};
  }
  requireThat(dir.startsWith(ROOT+path.sep)&&!dir.startsWith(STATE+path.sep)&&dir!==STATE,'public directory must be in repository outside private state');
  // Ruling R40 item 3 (F4): launch delivery records stay private. The published doc carries only the canonical
  // allocation.json and two host signatures (`benzo-delivery-list-v1` over allocation_file_hash) — the signing
  // hosts' merged `benzo sign delivery` output, recorded by `benzo launch deliver-list`. This gate refuses a
  // list whose file hash or host signatures do not check; verify re-checks the public invariants and the two
  // signatures against the pinned witness set.
  const dl=path.join(sd,'delivery-list.json');
  if(existsSync(dl)) {
    const list=JSON.parse(readFileSync(dl,'utf8'));
    requireThat(list&&typeof list.allocation_file_hash==='string'&&/^[0-9a-f]{64}$/.test(list.allocation_file_hash)&&list.batch&&Array.isArray(list.signatures),'launch delivery list shape');
    requireThat(hash(jsonBytes(list.batch))===list.allocation_file_hash,'launch allocation file differs from the delivery list');
    requireThat(list.batch.auction_id===id,'launch delivery list is for another auction');
    const wkeys=doc.witness_set?((verifyRecord<any>(doc.witness_set,doc.signer).keys??[])as string[]):[];
    const body={version:1 as const,auction_id:id,allocation_file_hash:list.allocation_file_hash};
    const signed=new Set<string>((list.signatures as any[]).filter((s:any)=>verifyDeliveryListSig(s,body,wkeys)).map((s:any)=>s.witness));
    requireThat(signed.size>=2,'launch delivery list is not carried by two host signatures; refusing to publish');
    writeFileSync(path.join(dir,'allocation.json'),jsonBytes(list.batch));
    doc.delivery_list={allocation_file_hash:list.allocation_file_hash,signatures:list.signatures};
  }
  save(path.join(dir,'manifest.json'),doc.manifest);if(doc.frozen)save(path.join(dir,'frozen.json'),doc.frozen);if(doc.result)save(path.join(dir,'result.json'),doc.result);
  save(path.join(dir,'signer.json'),{signer:doc.signer});save(path.join(dir,'receipts.json'),doc.receipts);if(doc.opened)save(path.join(dir,'opened.json'),doc.opened);if(doc.beacon)save(path.join(dir,'beacon.json'),doc.beacon);if(doc.settlement)save(path.join(dir,'summary.json'),doc.settlement);
  if(a.envelopes){doc.envelopes=a.envelopes;save(path.join(dir,'envelope.json'),a.envelopes)}
  save(path.join(dir,'auction.json'),doc);return doc;
}
export async function runCommand(command:string,args:string[]) {
  const o=options(args),id=o.id;
  if(id)requireThat(/^[0-9a-f]{64}$/.test(id),'auction id');
  if(id)process.env.BNZ_AUCTION_ID=id; // §11 H1: children use this auction's own vault when it ran its own DKG
  if(command==='auction create') {
    const m=input(o);requireThat(m.refund?.invalid==="full_C","invalid refund policy must say full_C");
    // R33 item 1: `auction create` generates the bond-then-pay balance addresses itself — fresh vault external
    // addresses aligned index-for-index with deposit_addresses, fixed in the signed manifest before bidding. They
    // are never operator input: a draft carrying its own balance_addresses is refused.
    // Ruling R38 item 1 (N2): the settlement-time refusal of earlier notes at a balance address is gone — any third
    // party can create one and it must never wedge settlement. The "fresh address" property is enforced HERE, where
    // the addresses are ours to enforce: a generated balance address that already holds a note is refused. The
    // wallet is synced first, so a stale wallet cannot regenerate an already-paid address unchecked.
    if(m.bond!==undefined){requireThat(m.bond.balance_addresses===undefined,'balance addresses are generated by auction create');
      process.env.BNZ_AUCTION_ID=m.auction_id;
      const vault=vaultDir(STATE,m.auction_id);
      m.bond.balance_addresses=m.deposit_addresses.map(()=>String(execute(pcztBin(ROOT,STATE),['address',vault,'--network',m.network])).trim().split('\n').at(-1));
      wallet('sync','-s',process.env.BNZ_LWD_URL??'testnet.zec.rocks:443');wallet('enhance','-s',process.env.BNZ_LWD_URL??'testnet.zec.rocks:443');
      const held=notes(m.network).filter((n:any)=>m.bond.balance_addresses.includes(n.address));
      requireThat(held.length===0,`a generated balance address already holds ${held.length} note(s); refusing`);}
    // Design §6.1: a buyback draft is held to the Mode B rules, and its treasury return must be a shielded destination.
    // Every registry mode (A13 item 3): the draft is held to its OWN mode's rules — its registry client run on a copy signed
    // with a throwaway key (the clients verify a signature first); nothing about the real signing key changes.
    {const k=generateKeyPairSync('ed25519'),probe=signRecord(m,k.privateKey.export({type:'pkcs8',format:'pem'}).toString());modeEntry(probe).client(probe,probe.signer)}
    // Part 2: an RFQ under the product carries its buyer's signed treasury block (host custody derives the return from it).
    if(m.clearing?.mode==='rfq')requireThat(m.rfq?.treasury_ua&&m.rfq?.funding_ua,'rfq needs the buyer treasury_ua and funding_ua');
    if(treasuryBlock(m)){const tb=treasuryBlock(m)!;requireShieldedDestination(tb.treasury_ua,m.network);
      // R28 item 7 (G-8): a funding address belongs to one auction only (its funded sum counts every note ever received).
      for(const f of existsSync(path.join(STATE,'product'))?readdirSync(path.join(STATE,'product')).filter(f=>f.endsWith('.json')):[]){const d=draft(f.slice(0,-5)),l=ledger(f.slice(0,-5));for(const p of [d,l])if(existsSync(p)){const x=read(p),mm=x.manifest?.bytes?JSON.parse(Buffer.from(x.manifest.bytes,'base64').toString('utf8')):x.manifest;requireThat(treasuryBlock(mm)?.funding_ua!==tb.funding_ua||mm.auction_id===m.auction_id,'funding_ua already used by auction '+String(mm?.auction_id).slice(0,8))}}
    }
    // R7 item 2: the product manifest pins the three signers' envelope public keys (generated signer-side by
    // `benzo sign envelope-key`); bidders seal to those pinned keys and never to an out-of-band value.
    requireThat(Array.isArray(m.envelope_keys)&&m.envelope_keys.length===3,'manifest must pin the three signers envelope_keys');
    // R17 item 3: gate X cannot be opted out of.
    requireThat(m.witness_set_hash!==undefined,'manifest must carry witness_set_hash');
    // R8 G10 (design §5): a manifest carrying witness_set_hash must be created together with the signed
    // witness-set side-packet it commits to.
    const witness_set=o['witness-set']?read(privatePath(o['witness-set'])):undefined;
    if(m.witness_set_hash!==undefined){requireThat(witness_set,'manifest carries witness_set_hash but no witness set supplied');requireThat(witnessSetHash(witness_set)===m.witness_set_hash,'witness set hash mismatch')}
    else requireThat(witness_set===undefined,'witness set without witness_set_hash');
    requireThat(!existsSync(draft(m.auction_id))&&!existsSync(ledger(m.auction_id)),'auction already exists');
    save(draft(m.auction_id),{manifest:m,state:'DRAFT',...(witness_set?{witness_set}:{})});return {auction_id:m.auction_id,state:'DRAFT',manifest:m};
  }
  if(command==='auction sign') {
    requireThat(id,'--id required');const d=read(draft(id));
    // R10 item 3: every signer envelope-key file present locally must match the manifest's pin at its own
    // index (alice 0, bob 1, carol 2), so an operator cannot sign a manifest pinning keys it holds.
    // §11: under host custody each host checks its own envelope-key pin in `benzo sign approve` instead.
    if(!existsSync(path.join(STATE,'vaults',id,'keys.json')))for(const name of ['alice','bob','carol'])requireOwnEnvelopeKey(d.manifest,name,STATE);
    // Phase 5 part 1 §2 (gate Y): when this auction ran its own DKG (`benzo auction keys`), the manifest must pin
    // exactly that group key and escrow UA; a manifest reusing another key is refused before signing.
    const auctionKeys=path.join(STATE,'vaults',id,'keys.json');
    if(existsSync(auctionKeys)){const k=read(auctionKeys);requireThat(d.manifest.frost_group_key===k.group_key,"manifest group key is not this auction's DKG key");requireThat(d.manifest.escrow_ua===k.escrow_ua,"manifest escrow UA is not this auction's DKG vault")}
    const k=o.key?privatePath(o.key):key;
    if(!existsSync(k)){mkdirSync(path.dirname(k),{recursive:true,mode:0o700});writeFileSync(k,generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600})}
    requireThat(path.resolve(k)===key,'auction receipt signer must match the local manifest key');
    d.signed=signRecord(d.manifest,readFileSync(k,'utf8'));save(draft(id),d);return d.signed;
  }
  if(command==='auction publish') {
    requireThat(id&&o.dir&&o.config,'--id --dir --config required');
    const d=read(draft(id));requireThat(d.signed,'sign the manifest first');
    const cfg=read(privatePath(o.config));requireThat(cfg.settlement&&cfg.routing,'operator config needs settlement and private routing');
    requireThat(Number.isInteger(cfg.settlement.batch_cap)&&cfg.settlement.batch_cap>=1&&cfg.settlement.batch_cap<=28&&Number.isInteger(cfg.settlement.pczt_expiry_blocks)&&cfg.settlement.pczt_expiry_blocks>=1&&cfg.settlement.pczt_expiry_blocks<=10000,'batch cap/expiry config');
    save(config(id),{...cfg,public_dir:path.resolve(o.dir)});
    // R7 item 2: no envelope private key is ever created or held by the operator. The signed manifest pins the
    // signers' public keys (envelope_keys); the signers keep their private halves in their own state dirs.
    ac('init',id,{manifest:d.signed,signer:d.signed.signer,...(d.witness_set?{witness_set:d.witness_set}:{})});sc('init',id,[],cfg.routing);return publish(id);
  }
  if(command==='auction status') {
    requireThat(id,'--id required');if(!existsSync(ledger(id)))return {auction_id:id,state:read(draft(id)).state};
    const a=read(ledger(id)),m=client(a.manifest,a.signer).manifest;
    const chainTip=Number(JSON.parse(execute(bin('grpcurl'),['-import-path',path.join(STATE,'proto'),'-proto','service.proto',process.env.BNZ_LWD_URL!,'cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock'])).height);
    const response=await fetch(process.env.BNZ_DRAND_URLS!.split(',')[0]+'/'+m.drand.chain_hash+'/public/latest');requireThat(response.ok,'drand status unavailable');const round=(await response.json()).round;
    requireThat(Number.isSafeInteger(chainTip)&&chainTip>0&&Number.isSafeInteger(round)&&round>0,'status tip/round');return {auction_id:id,state:a.state,accepted:a.leaves.length,manifest_hash:a.manifest.sha256,chain_tip:chainTip,drand_round:round};
  }
  // Part 2 launch flow: winners after opening (no records yet), then each winner's owner-signed delivery record.
  if(command==='launch winners'){requireThat(id,'--id required');const a=read(ledger(id));requireThat(a.state==='OPENED','launch winners after opening, before the clear');return {auction_id:id,winners:launchWinners({manifest:a.manifest,signer:a.signer,frozen:a.frozen,opened:a.opened,reserve_opening:a.reserve_opening??null,launch:a.launch_input})}}
  if(command==='launch deliver'&&o['owner-key-stdin']) {
    // Bidder side (Ruling R40 item 3, F4): the winner's token-chain destinations are SEALED to the manifest's
    // `envelope_keys` ("as claims do") and the bid's one-time owner key signs the sealed record's SHA-256 — the
    // operator records it without seeing the destinations and the published doc never carries the join.
    requireThat(id&&o['leaf-index']&&/^[0-9]+$/.test(o['leaf-index'])&&o.destinations,'--id --leaf-index --destinations --owner-key-stdin required');
    const destinations=o.destinations.split(',').filter(Boolean);
    const owner={private_hex:readFileSync(0,'utf8').trim(),public_hex:''};owner.public_hex=ownerPublic(owner.private_hex);
    const a=read(ledger(id)),{manifest:m}=client(a.manifest,a.signer);
    requireThat(Array.isArray(m.envelope_keys)&&m.envelope_keys.length===3,'manifest must pin the three signers envelope_keys');
    const delivery_envelope_ct=sealDelivery(destinations,m.envelope_keys!);
    const body={kind:'launch-deliver',auction_id:id,leaf_index:Number(o['leaf-index']),delivery_envelope_sha256:hash(Buffer.from(delivery_envelope_ct,'hex'))};
    return {leaf_index:Number(o['leaf-index']),delivery_envelope_ct,owner_sig:signStatement(owner,body)};
  }
  if(command==='launch deliver'){requireThat(id,'--id required');const r=ac('deliver',id,input(o));publish(id);return r}
  if(command==='launch deliver-list') {
    // Operator side (Ruling R40 item 3): record the signing hosts' merged delivery list (the same
    // allocation_file_hash signed by two `benzo sign delivery` runs). publish() gates the file's hash and
    // signatures again and writes the canonical allocation.json; nothing else about the delivery is published.
    requireThat(id,'--id required');const list=input(o);
    save(path.join(STATE,'settle',id,'delivery-list.json'),list);publish(id);
    return {auction_id:id,allocation_file_hash:list?.allocation_file_hash,signatures:Array.isArray(list?.signatures)?list.signatures.length:0};
  }
  if(command==='bid prepare'||command==='bid seal') {
    requireThat(o.manifest&&o.signer,'--manifest --signer required');const packet=read(o.manifest),prepared=client(packet,o.signer),m=prepared.manifest;
    if(command==='bid prepare')return prepared;
    const bid=input(o);requireThat(m.deposit_addresses.includes(bid.address),'unlisted per-bid address');
    requireThat(Date.now()/1000<m.T_submit,'submission deadline');
    // Real one-time owner key and salted settlement commitment for the 128-byte layout; the destination (if the
    // bid carries refund_ua) is sealed to a manifest-pinned signer envelope key and never leaves this process in
    // plaintext. R7 item 2: only pinned keys are accepted — an out-of-band key substitution is refused (G4).
    // Head merge (R17): the destination is sealed to ALL THREE signers' keys pinned by the verified manifest
    // (multi-recipient v2 envelope); a caller-supplied envelope_pubkey, if any, must still be one of them.
    if(bid.refund_ua!==undefined)requireThat(Array.isArray(m.envelope_keys)&&m.envelope_keys.length===3&&(bid.envelope_pubkey===undefined||m.envelope_keys.includes(bid.envelope_pubkey)),'envelope key is not pinned by the signed manifest');
    // Part 2 (every registry mode): the order uses its mode's layout version; a multi-lot round binds the lot id; a launch
    // holder-tranche order sets the holder flag; a pinned identity (OTC party, RFQ dealer) supplies its own owner key.
    const layout=modeEntry(packet).layout,lots:string[]|undefined=(m as any).lots;
    if(lots)requireThat(typeof bid.lot==='string'&&lots.includes(bid.lot),'multi-lot order needs a manifest lot id');else requireThat(bid.lot===undefined,'lot id on a single-lot round');
    requireThat(bid.holder===undefined||((m as any).clearing.mode==='launch'&&bid.holder===true),'holder flag is launch-only');
    const owner=bid.owner_private_hex!==undefined?(requireThat(/^[0-9a-f]{64}$/.test(bid.owner_private_hex),'owner_private_hex'),{private_hex:bid.owner_private_hex,public_hex:ownerPublic(bid.owner_private_hex)}):undefined;
    const prep=prepareBid({auction_id:m.auction_id,price_zats:BigInt(bid.price_zats),quantity:Number(bid.quantity),destination_ua:bid.refund_ua,deliver:bid.deliver,envelope_public_hexs:bid.refund_ua!==undefined?m.envelope_keys:undefined,owner,network:m.network});
    const server=http.createServer((req,res)=>{const n=req.url==='/main.js'?'main.js':'index.html';res.setHeader('Content-Type',n.endsWith('.js')?'text/javascript':'text/html');res.end(readFileSync(path.join(ROOT,'seal/dist',n)))});
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
    try {
      const page=await browser.newPage();await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
      const fields={opening:new Date((QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period)*1000).toISOString(),auction:m.auction_id,price:bid.price_zats,quantity:String(bid.quantity),collateral:m.C_zats,address:bid.address,owner:prep.owner.public_hex,nonce:prep.nonce_hex,commitment:prep.settlement_commitment_hex,
        // R16 item 2 (memo framing v2, R18): the memo commits to the first 18 bytes of SHA-256(envelope_ct)
        // of this bid's settlement envelope, or 18 zero bytes when the bid carries none — the sealer writes
        // it into the memo.
        envelope_tag:prep.envelope_ct_hex?hash(Buffer.from(prep.envelope_ct_hex,"hex")).slice(0,36):"00".repeat(18),
        layout_version:String(layout.version),binding:lots?bid.lot:m.auction_id,holder:bid.holder?'1':''};
      await page.route('**/*',route=>route.abort());
      for(const [k,v] of Object.entries(fields)) {
        // the owner-material inputs are hidden; Playwright fill only types into visible fields
        if(['owner','nonce','commitment','envelope_tag','layout_version','binding','holder'].includes(k))await page.locator('#'+k).evaluate((el,value)=>{(el as HTMLInputElement).value=String(value)},v);
        else await page.locator('#'+k).fill(v);
      }
      await page.locator('#seal').click();await page.waitForFunction(()=>document.getElementById('envelope')!.textContent||document.getElementById('error')!.textContent);
      const error=await page.locator('#error').innerText();requireThat(!error,error);
      const envelope_hex=await page.locator('#envelope').innerText();
      // R16 item 2 (R18): `bid seal` refuses a memo that is not framing v2 with ct_len <= 487 — the shared
      // parser is the boundary check on the browser sealer's output, and the memo's envelope tag must be the
      // one this bid committed to.
      const sealed=memoSealedBid(envelope_hex);
      requireThat(sealed&&sealed.envelope_tag!==null,'memo framing v2 refused: ct_len must be <= 487');
      requireThat(sealed!.envelope_tag===(prep.envelope_ct_hex?hash(Buffer.from(prep.envelope_ct_hex,"hex")).slice(0,36):"00".repeat(18)),'memo envelope tag mismatch');
      const bound=bindSealedBid(prep,m.auction_id,hash(Buffer.from(sealed!.ciphertext_hex,"hex")));
      save(path.join(STATE,'bids',m.auction_id,bound.ciphertext_hash_hex+'.json'),{owner_private_hex:prep.owner.private_hex,auction_id:m.auction_id,ciphertext_hash:bound.ciphertext_hash_hex});
      return {auction_id:m.auction_id,envelope_hex,uri:await page.locator('#uri').innerText(),round:Number(await page.locator('#round').innerText()),
        ciphertext_hash:bound.ciphertext_hash_hex,owner_pubkey_hex:bound.owner.public_hex,owner_sig_hex:bound.owner_sig_hex,
        nonce_hex:bound.nonce_hex,settlement_commitment_hex:bound.settlement_commitment_hex,envelope_ct_hex:bound.envelope_ct_hex};
    } finally {await browser.close();server.close()}
  }
  if(command==='bid deposit') {
    requireThat(id,'--id required');const bid=input(o),a=read(ledger(id)),m=client(a.manifest,a.signer).manifest;
    if(o.pay==='true') {
      requireThat(Date.now()/1000<m.T_submit,'submission deadline');
      const bids=bid.bids??[bid],params=new URLSearchParams();
      for(const [index,b] of bids.entries()) {
        const uri=new URL(b.uri);requireThat(uri.pathname===b.address&&m.deposit_addresses.includes(b.address)&&uri.searchParams.get('memo')===Buffer.from(b.envelope_hex,'hex').toString('base64url'),'deposit URI binding');
        requireThat(Number(uri.searchParams.get('amount'))===Number(m.C_zats)/1e8,'deposit amount differs from C');
        const suffix=index?`.${index}`:'';params.set('address'+suffix,b.address);params.set('amount'+suffix,uri.searchParams.get('amount')!);params.set('memo'+suffix,uri.searchParams.get('memo')!);
      }
      const reserve=bid.reserve;
      if(reserve) {
        requireThat(reserve.address===read(config(id)).routing.fee_reserve_ua&&/^[1-9][0-9]*$/.test(reserve.amount_zats),'reserve must match operator config');
        const suffix='.'+bids.length;params.set('address'+suffix,reserve.address);params.set('amount'+suffix,(Number(reserve.amount_zats)/1e8).toFixed(8));
      }
      // Design §6.1 (test harness): the treasury leg of a buyback, paid to the SIGNED funding_ua in the same transaction.
      const treasury=bid.treasury;
      if(treasury) {
        requireThat(treasuryBlock(m)&&/^[1-9][0-9]*$/.test(treasury.amount_zats),'treasury funding needs a treasury block and an amount');
        const suffix='.'+(bids.length+(reserve?1:0));params.set('address'+suffix,treasuryBlock(m)!.funding_ua);params.set('amount'+suffix,(Number(treasury.amount_zats)/1e8).toFixed(8));
      }
      syncRetry(()=>execute(bin('zcash-devtool'),['wallet','-w',path.join(STATE,'bidder'),'sync','-s',process.env.BNZ_LWD_URL!]));
      const balance=JSON.parse(execute(bin('zcash-devtool'),['wallet','-w',path.join(STATE,'bidder'),'balance','--json']));
      const available=balance.sapling_spendable+balance.orchard_spendable+balance.ironwood_spendable,c=Number(m.C_zats);
      requireThat(available-c*bids.length-Number(reserve?.amount_zats??0)-Number(treasury?.amount_zats??0)-5000*(bids.length+3)>=3*c+40000,'bidder floor; Needs user funds');
      const output=execute(bin('zcash-devtool'),['wallet','-w',path.join(STATE,'bidder'),'pay','-i',path.join(STATE,'bidder.age'),'--disable-confirmation','-s',process.env.BNZ_LWD_URL!,'--payment-uri','zcash:?'+params]);
      const txid=output.match(/^[0-9a-f]{64}$/gm)?.at(-1);requireThat(txid,'payment produced no txid');
      return {txid,C_zats:m.C_zats,deposits:bids.length,state:'broadcast'};
    }
    const admitted=ac('admit',id,bid);publish(id);return {...admitted,C_zats:m.C_zats};
  }
  if(['freeze','open','clear'].includes(command)) {
    requireThat(id,'--id required');
    // R8 G10 (design §5): `open` refuses without a valid q_w witness certificate when the manifest pins a
    // witness set — a refusal, never a WARN.
    if(command==='open') {
      const a=read(ledger(id)),{manifest:m}=client(a.manifest,a.signer);
      if(m.witness_set_hash!==undefined) {
        const docFile=path.join(path.resolve(read(config(id)).public_dir),'auction.json'),doc=existsSync(docFile)?JSON.parse(readFileSync(docFile,'utf8')):{};
        requireThat(doc.witness_set,'missing witness set');
        const spec=validateWitnessSet(verifyRecord<WitnessSet>(doc.witness_set,a.signer),id);
        requireThat(witnessSetHash(doc.witness_set)===m.witness_set_hash,'witness set hash mismatch');
        checkCertificates(doc.witness_cert??[],spec,freezeStatement(m,a.frozen));
      }
      // Design §6.1: a buyback opens only when the treasury has funded budget × lots, confirmed, into funding_ua.
      if(treasuryBlock(m)) {
        syncRetry(()=>wallet('sync','-s',process.env.BNZ_LWD_URL!));wallet('enhance','-s',process.env.BNZ_LWD_URL!);
        const tip=JSON.parse(wallet('balance','--json')).chain_tip_height,funded=treasuryFunded(m as any,notes(m.network),tip),need=treasuryRequired(m as any);
        requireThat(funded>=need,`treasury funded ${funded} of ${need} zats (confirmed at funding_ua); refusing to open`);
      }
    }
    const result=ac(command,id);publish(id);return command==='open'?{auction_id:id,state:'OPENED',opened:result.opened.length}:result
  }
  if(command==='sign envelope-opens') {
    // R10 item 4: each signer attests — before any batch is planned — per refund row it can resolve from an
    // envelope, to the DESTINATION HASH its own key opens (never the destination). R12 item 3: an envelope
    // this signer cannot open is reported ok:false; the report never throws and never aborts the others.
    requireThat(id&&['alice','bob','carol'].includes(o.name),'--id --name required');
    // §11 H5: on a signer host the report is computed from the pushed public dir and claims (--public/--claims).
    const doc=JSON.parse(readFileSync(path.join(o.public?path.resolve(o.public):path.resolve(read(config(id)).public_dir),'auction.json'),'utf8'));
    const {manifest:m}=client(doc.manifest,doc.signer);
    const key=ownEnvelopePrivate(STATE,o.name);requireThat(key,'signer envelope key missing');
    const opens:{leaf:number|null;party:string;ok:boolean;dest_sha256:string|null}[]=[];
    const open=(rec:any):string|null=>{try{return rec?openDestination(rec,key!,m.network):null}catch{return null}};
    // R15 item 3: a claimed row pays through its claim envelope, so the claim's opening report supersedes any
    // bid-envelope entry for the same party (the plan's two-signer gate counts one entry class per row).
    const claimed=new Set<string>();
    const claimFile=o.claims?path.resolve(o.claims):path.join(STATE,'settle',id,'claims.json');
    if(existsSync(claimFile))for(const c of JSON.parse(readFileSync(claimFile,'utf8'))) {
      claimed.add(c.party);
      const dest=open({envelope_ct:c.claim_envelope_ct});
      opens.push({leaf:null,party:c.party,ok:!!dest,dest_sha256:dest?hash(Buffer.from(dest,'utf8')):null});
    }
    for(const l of doc.frozen?.leaves??[]) {
      const party=`leaf:${l.leaf_index}`;
      if(claimed.has(party))continue;
      const dest=open((doc.envelopes??[]).find((e:any)=>e.ciphertext_hash===l.ciphertext_hash));
      opens.push({leaf:l.leaf_index,party,ok:!!dest,dest_sha256:dest?hash(Buffer.from(dest,'utf8')):null});
    }
    // R26 item 1: one entry per REFUNDABLE scanned deposit note — the report covers exactly the plan's
    // refund rows (`deposit:<txid>:<pool>:<action_index>`); a zero-value note is never an obligation and
    // gets no entry.
    for(const n of refundable(notes(m.network).filter((x:any)=>m.deposit_addresses.includes(x.address))).payable) {
      const party=depositParty(n);
      if(claimed.has(party)||(doc.frozen?.leaves??[]).some((l:any)=>l.deposit.txid===n.txid&&l.deposit.address===n.address))continue;
      // R20: only an AUTHENTICATED memo-bound record is ever opened/reported; an operator-inserted record
      // for a memo-less or v1 stray is not something this signer reports ok for.
      const dest=open(authenticatedMemoEnvelope(notes(m.network),party,doc.manifest,doc.envelopes,bin('tle')));
      opens.push({leaf:null,party,ok:!!dest,dest_sha256:dest?hash(Buffer.from(dest,'utf8')):null});
    }
    // R23 item 2 (Reviewer G G3): the report is signed by this signer's own witness key (a member of the
    // same pinned witness set); the plan counts only reports whose signature verifies.
    requireThat(o['witness-key'],'--witness-key required');
    const signed={signer:o.name,opens,...signOpensReport({signer:o.name,opens},readFileSync(privatePath(o['witness-key']),'utf8').trim())};
    save(path.join(STATE,'settle',id,`envelope-opens-${o.name}.json`),signed);
    return signed;
  }
  if(command==='claim-refund'&&o.party!==undefined) {
    // Bidder side (R7 item 4): the bid's one-time owner key signs a request naming a shielded destination.
    // The destination is chosen by the owner and never passes through operator input unsigned.
    requireThat(id&&o.party&&o.destination&&o['owner-key-stdin'],'--id --party --destination --owner-key-stdin required');
    requireThat(/^leaf:[0-9]+$/.test(o.party)||isDepositParty(o.party)||isBalanceLateParty(o.party),'claim party');
    const owner={private_hex:readFileSync(0,'utf8').trim(),public_hex:''};owner.public_hex=ownerPublic(owner.private_hex);
    // R15 item 3 (R F6 + head finding on R13): the destination is SEALED in a v2 envelope to the manifest's
    // pinned signer keys — the plaintext destination and any destination hash never enter the request or the
    // operator's view. The signed body carries only the claim envelope's hash.
    const a=read(ledger(id)),{manifest:m}=client(a.manifest,a.signer);
    requireShieldedDestination(o.destination,m.network); // R33 P2-1: the manifest's network, never a literal
    requireThat(Array.isArray(m.envelope_keys)&&m.envelope_keys.length===3,'manifest must pin the three signers envelope_keys');
    const claim_envelope_ct=sealEnvelope(o.destination,m.envelope_keys!,m.network);
    const body={kind:'claim-refund',auction_id:id,party:o.party,claim_envelope_sha256:hash(Buffer.from(claim_envelope_ct,'hex'))};
    return {...body,claim_envelope_ct,owner_sig:signStatement(owner,body)};
  }
  if(command==='claim-refund') {
    // Operator side (R7 item 4 + R11): record the owner-signed request and settle what it promotes (the signer
    // plan verifies the owner signature against its own fresh opening). --defer records without settling.
    requireThat(id,'--id required');const request=input(o);
    requireThat(request&&request.auction_id===id&&typeof request.party==='string'&&(/^leaf:[0-9]+$/.test(request.party)||isDepositParty(request.party)||isBalanceLateParty(request.party))&&typeof request.claim_envelope_ct==='string'&&/^[0-9a-f]{128}$/.test(request.owner_sig),'claim request shape');
    const a=read(ledger(id)),{manifest:m}=client(a.manifest,a.signer);
    requireThat(envelopeRecordValid({envelope_ct:request.claim_envelope_ct,owner_sig:request.owner_sig},m.envelope_keys),'claim envelope format');
    // R17 item 2: the owner signature is verified at record time with the same rule as the signer plan, and
    // only valid claims are recorded (first valid per party) — an unsigned claim can neither block the owner's
    // claim nor linger (the R11 cap is dropped).
    const ownerKeyFor=(party:string):string|null=>{
      if(party.startsWith('leaf:')) {
        const o=read(ledger(id)).opened?.find((x:any)=>x.leaf_index===Number(party.slice(5)));
        return o&&o.plaintext_hex?Buffer.from(o.plaintext_hex,'hex').subarray(61,93).toString('hex'):null;
      }
      // Ruling R40 items 2/5: a balance-late row refunds to the deposit slot's own leaf (the shared rule
      // balanceLateLeafIndex), so the owner key is that leaf's one-time key, from the operator's own opened bids.
      if(isBalanceLateParty(party)) {
        const l=read(ledger(id)),n=balanceLateNote(notes(m.network),party);
        const leaf=n?balanceLateLeafIndex(m,l.frozen?.leaves??[],n):null;
        const o=leaf!==null?l.opened?.find((x:any)=>x.leaf_index===leaf):undefined;
        return o&&o.plaintext_hex?Buffer.from(o.plaintext_hex,'hex').subarray(61,93).toString('hex'):null;
      }
      const note=party.startsWith('deposit:')?partyNote(notes(m.network),party):undefined;
      const memo=note?.memo_hex?memoSealedBid(note.memo_hex):null;
      if(!memo)return null;
      const r=spawnSync(bin('tle'),['-d','-c',QUICKNET.chain_hash],{input:Buffer.from(memo.ciphertext_hex,'hex'),maxBuffer:1<<20});
      if(r.status!==0)return null;
      const pt=r.stdout;return Buffer.isBuffer(pt)&&pt.length===128?pt.subarray(61,93).toString('hex'):null;
    };
    const owner=ownerKeyFor(request.party);
    requireThat(owner&&verifyStatement(owner!,{kind:'claim-refund',auction_id:id,party:request.party,claim_envelope_sha256:hash(Buffer.from(request.claim_envelope_ct,'hex'))},request.owner_sig),'claim owner signature');
    const file=path.join(STATE,'settle',id,'claims.json'),claims=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
    const old=claims.find((c:any)=>c.party===request.party);
    requireThat(!old||jsonBytes(old).equals(jsonBytes(request)),'a claim for this party is already recorded');
    if(!old){claims.push(request);save(file,claims)}
    if(o.defer==='true')return {recorded:true,party:request.party};
  }
  if(command==='settle'||command==='cancel'||command==='sign join'||(command==='claim-refund'&&o.defer!=='true')) {
    requireThat(id,'--id required');
    if(command==='sign join'&&o.name&&existsSync(path.join(STATE,'auctions',id,'frost.toml'))) {
      // §11 H3 (host custody): this host signs only a message equal to a sighash IT approved (`benzo sign approve`),
      // with this auction's own DKG share; the answer to frost-client's prompt is decided here, never by the caller.
      requireThat(['alice','bob','carol'].includes(o.name)&&/^[0-9a-f]{64}$/.test(o.sighash??''),'signer/sighash');
      const adir=path.join(STATE,'approvals',id);
      const approved=(existsSync(adir)?readdirSync(adir):[]).filter(f=>f.startsWith('batch-')).map(f=>read(path.join(adir,f))).filter((a:any)=>a.sighash===o.sighash&&a.name===o.name);
      requireThat(approved.length>0,'no approval of this sighash on this signer');
      const server=o.server??process.env.BNZ_FROSTD_HOST??'host.orb.internal:2744';
      const cfg=path.join(STATE,'auctions',id,'frost.toml'),group=readFileSync(path.join(STATE,'auctions',id,'group-key.txt'),'utf8').trim();
      const env={...process.env,SSL_CERT_FILE:path.join(STATE,'tls/rootCA.pem')};
      const procs:ReturnType<typeof spawn>[]=[];
      const join=(session?:string)=>new Promise<void>((resolve,reject)=>{
        const p=spawn(bin('frost-client'),['participant','-c',cfg,'-s',server,'-g',group,...(session?['-S',session]:[])],{stdio:['pipe','pipe','pipe'],env});
        let out='',answered=false;
        const watch=(d:Buffer)=>{out+=d;process.stdout.write(d);const m=out.match(/Message to be signed \(hex-encoded\):\n([0-9a-f]+)/);
          if(!answered&&m&&/Do you want to sign it\? \(y\/n\)/.test(out)){answered=true;p.stdin!.end(m[1]===o.sighash?'y\n':'n\n');if(m[1]!==o.sighash)process.stderr.write(`ERROR sign join message ${m[1].slice(0,16)}… is not the approved sighash; refused\n`)}};
        p.stdout!.on('data',watch);p.stderr!.on('data',(d:Buffer)=>{process.stderr.write(d);watch(d)});
        procs.push(p);p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(`participant exit ${c}`)))});
      if(o.count===undefined){await join();return}
      // Phase 6 (R29): one single-message session per spend, all open at once (frost-client signs only the first
      // message of a session, so a multi-message session is never used). This host joins exactly the spend count
      // of the transaction it approved — every session asks for the approved sighash, checked per session above.
      // R33 P2-4: --count must equal the length of the randomizers this host's own inspect recorded in its
      // approval (the same count as its spends) — the approval answers exactly that many prompts.
      requireThat(/^[1-9][0-9]?$/.test(o.count)&&approved.some((a:any)=>Array.isArray(a.randomizers)&&a.randomizers.length===Number(o.count)&&a.spends===Number(o.count)),'--count is not the randomizer count of the approved transaction');
      const listed=spawnSync(bin('frost-client'),['sessions','-c',cfg,'-s',server],{encoding:'utf8',env,timeout:120_000});
      const ids=[...String(listed.stderr).matchAll(/^Session with ID ([0-9a-f-]{36})$/gm)].map(m=>m[1]);
      requireThat(listed.status===0&&ids.length===Number(o.count),`${ids.length} open sessions, expected ${o.count}`);
      // One refused or failed session ends this host's part in the round: stop the other joins too.
      try{await Promise.all(ids.map(join))}catch(e){procs.forEach(p=>p.kill());throw e}
      return;
    }
    if(command==='sign join'&&o.name) {
      requireThat(['alice','bob','carol'].includes(o.name)&&/^[0-9a-f]{64}$/.test(o.randomizer),'signer/randomizer');
      requireThat(o.batch&&o.candidate&&o.randomizer&&o.sighash,'--batch --candidate --randomizer --sighash required');
      const candidate=privatePath(o.candidate),approved=read(path.join(STATE,'settle',id,'approvals',o.name+'-'+o.randomizer+'.json'));
      requireThat(approved.participant===o.name&&approved.randomizer===o.randomizer&&approved.sighash===o.sighash&&approved.pczt_hash===hash(readFileSync(candidate))&&approved.manifest_hash===read(ledger(id)).manifest.sha256,'inspect approval differs from join candidate');
      await new Promise<void>((resolve,reject)=>{const p=spawn(bin('frost-client'),['participant','-c',path.join(STATE,'frost',o.name+'.toml'),'-s',process.env.BNZ_FROSTD_ADDR!,'-g',readFileSync(path.join(STATE,'group-key.txt'),'utf8').trim()],{stdio:'inherit',env:{...process.env,SSL_CERT_FILE:path.join(STATE,'tls/rootCA.pem')}});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(`participant exit ${c}`)))});return;
    }
    if(command==='cancel'){ac('cancel',id);publish(id)}
    // Head (2026-10-03): the worker's progress goes to stderr so every command prints exactly one JSON document on
    // stdout (`benzo cancel` printed the worker's JSON plus its own, which broke JSON callers: run 8 FATAL).
    const p=spawn(process.execPath,[path.join(ROOT,'settle/dist/cli.mjs'),'run',id],{stdio:['inherit',2,'inherit']});
    await new Promise<void>((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(`settle exit ${c}`)))});
    const a=read(ledger(id)),status=JSON.parse(sc('status',id));
    // R16 item 1: a cancelled auction keeps its cancel states across repeated settles — exceptions stay
    // REFUNDING (claimable after R) and a fully paid cancelled auction is CANCELLED — so the CANCELLED/
    // REFUNDING branch keeps resolving it instead of falling into the cleared-path state machine.
    const cancelled=['CANCELLED','REFUNDING'].includes(a.state)||command==='cancel';
    a.state=cancelled?(status.rows.some((r:any)=>r.state==='exception')?'REFUNDING':'CANCELLED'):status.rows.some((r:any)=>r.state==='exception')?'SETTLING':'SETTLED';save(ledger(id),a);const pub=publish(id);return {auction_id:id,state:pub.state,settled:pub.settlement.receipts.length};
  }
  if(command==='sign inspect') {requireThat(['alice','bob','carol'].includes(o.name)&&(!o.randomizer||/^[0-9a-f]{64}$/.test(o.randomizer)),'signer/randomizer');requireThat(id&&o.batch&&o.candidate&&o.name,'--id --batch --candidate --name required');const approved=JSON.parse(sc('check',id,[o.batch,privatePath(o.candidate),o.name,o.randomizer??'',o.sighash??'']));if(o.randomizer)save(path.join(STATE,'settle',id,'approvals',o.name+'-'+o.randomizer+'.json'),approved);return approved}
  throw Error('unknown Track A command');
}
