// Signer-side monetary plan: fresh chain observations and offline tlock openings from the one verified beacon,
// then the shipped pure clearing CLI (which dispatches through clear/registry.ts). F8 (R28): in the product
// flow the signer recomputes from the PUBLISHED auction.json (manifest, frozen, opened, beacon) and refuses if
// the coordinator's private result or batch plan differs from that recomputation. Recipient authorization is a
// separate prerequisite; this entry point never signs or broadcasts.
import {execFileSync,spawnSync} from "node:child_process";
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {hash,jsonBytes,QUICKNET,requireThat,verifyRecord,reserveReturnUaCommitment} from "../manifest/schema";
import {checkCertificates,freezeStatement,validateWitnessSet,witnessSetHash,type WitnessSet} from "../witness";
import {requireReserveOpening} from "../manifest/reserve";
import {openSealedBid} from "../envelope/opening";
import {decryptPublished,publishedClient,fetchVerifiedBeacon} from "../cli/published-beacon";
import type {ChainClient} from "tlock-js";
import {sealedBidPlaintext,validEnvelope,memoSealedBid,requireOwnEnvelopeKey,authenticatedMemoEnvelope,agreedDestinations} from "./envelopes";
import {depositParty,partyNote,isDepositParty,refundable,strayNotes,isSlotCollision,reserveReturnOutstanding,paidByOwnLedger,reserveUnspent} from "./deposits";
import {quoteSweep} from "./quote";
import {verifyStatement,envelopeRecordValid} from "../envelope";
import {requireShieldedDestination} from "../envelope/destination";
import {checkFrozen} from "../clear/merkle";
import {balanceAddressMap,balanceDefaults,balanceWindow,balanceSettlement,bondVoidAt,isRefundRowParty,refundRowLeafIndex,type BalanceRefund} from "../clear/features";
import {modeEntry,clientCommon as client} from "../clear/registry"; // design §6.1: every registry mode
import {treasuryBlock,treasuryFunded,treasuryReturn} from "../clear/mode-b";
import type {Obligation} from "./ledger";
import { repoRoot } from "../manifest/root";
import { vaultDir, scanBin, pcztBin } from "../manifest/paths";
import { endpointKey, lwdBound, lwdTimedOut } from "./bounded";
import { minedHeight } from "../cli/host-chain";
const root=repoRoot();
for(const line of (existsSync(path.join(root,".env"))?readFileSync(path.join(root,".env"),"utf8"):"").split("\n")) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];
}
const state=path.resolve(root,process.env.BNZ_STATE_DIR!);
function execute(cmd:string,args:string[],input?:string):string {
  const r=spawnSync(cmd,args,{input,encoding:"utf8",maxBuffer:64<<20,...lwdBound(cmd,args)});
  appendFileSync(path.join(state,"run","settle-plan.log"),`\n${path.basename(cmd)}\n${r.stderr??""}`);
  const stalled=lwdTimedOut(cmd,r);if(stalled)throw stalled;
  if(r.error)throw r.error;
  requireThat(r.status===0,`${path.basename(cmd)} failed: ${(r.stderr||r.stdout).trim().slice(-250)}`);return r.stdout;
}
try {
  const [id]=process.argv.slice(2);requireThat(/^[0-9a-f]{64}$/.test(id),"settlement auction id");
  const auction=JSON.parse(readFileSync(path.join(state,"auction",`${id}.json`),"utf8"));
  // The published document is the signer's source of truth when a product config exists; the coordinator's
  // private copy is then only cross-checked against the recomputation, never trusted on its own.
  const config=path.join(state,"product",`${id}.json`);
  const productConfig=existsSync(config)?JSON.parse(readFileSync(config,"utf8")):null;
  const published=productConfig?JSON.parse(readFileSync(path.join(path.resolve(productConfig.public_dir),"auction.json"),"utf8")):null;
  const src=published??auction;
  const {manifest:m,manifest_hash}=client(src.manifest,src.signer);
  // R10 item 3: each signer requires the manifest to pin ITS OWN envelope key at its own index.
  // R16 item 5: a signer whose key file is missing cannot act at all.
  let signerKeysPresent=0;
  // §11: under host custody the signers' envelope keys live on their hosts and each host checks its own pin in
  // `benzo sign approve`; this coordinator-side plan holds none.
  const hostCustody=existsSync(path.join(state,"vaults",id,"keys.json"));
  if(!hostCustody) {
    for(const name of ["alice","bob","carol"]) {requireOwnEnvelopeKey(m,name,state);if(existsSync(path.join(state,"signers",name,"envelope-key.json")))signerKeysPresent++}
    requireThat(signerKeysPresent>0,"signer envelope key missing");
  }
  // R8 G10 (design §5): a manifest carrying witness_set_hash refuses without a valid q_w certificate over the
  // frozen statement — a refusal on the signer path, never a WARN. A cancelled-before-freeze auction has no
  // frozen root to witness (benzo verify's witness rule is the same: no root, no witness material), so the
  // gate applies exactly where a frozen statement exists.
  if(published&&m.witness_set_hash!==undefined&&src.frozen) {
    requireThat((published as any).witness_set,"missing witness set");
    const spec=validateWitnessSet(verifyRecord<WitnessSet>((published as any).witness_set,src.signer),id);
    requireThat(witnessSetHash((published as any).witness_set)===m.witness_set_hash,"witness set hash mismatch");
    checkCertificates((published as any).witness_cert??[],spec,freezeStatement(m,src.frozen!));
  }
  requireThat(m.auction_id===id&&m.fee_zats==="0","settlement requires zero auction fee; network fee comes from reserve");
  const wallet=(...args:string[])=>execute(path.join(state,"bin","zcash-devtool"),["wallet","-w",vaultDir(state,id),...args]);
  wallet("sync","-s",process.env.BNZ_LWD_URL!);wallet("enhance","-s",process.env.BNZ_LWD_URL!);
  const notes=execute(scanBin(root,state),["scan",m.network,vaultDir(state,id)]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
  let tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
  const ledgerFile=path.join(state,"settle",id,"ledger.sqlite"),owned=new Set<string>();
  let pendingBatches=0;
  // B49 (P0-1, docs/design/phase7-b49-paid-means-mined.md): this coordinator's own ledger of PAID rows —
  // the batches it staged and confirmed — is what a published receipt must match before it counts as paid
  // (settle/deposits.ts paidByOwnLedger, the one shared rule the hosts run too).
  const ownPaid:{txid:string;party:string;output_index:number;amount_zats:string}[]=[];
  if(existsSync(ledgerFile)) {
    const db=new DatabaseSync(ledgerFile,{readOnly:true});
    // B53 (P2-2): a mined batch parked for manual reconciliation (state 'exception' WITH its height) still
    // holds its rows and its spent notes are still spent by a real transaction — it counts as `owned` here.
    // An expired batch (never mined, height null) does not: its rows were released and re-derive.
    try {for(const b of db.prepare("SELECT txid,pczt_path,pczt_hash FROM batches WHERE txid IS NOT NULL AND (state!='exception' OR height IS NOT NULL)").all()) {
      requireThat(hash(readFileSync(String(b.pczt_path)))===b.pczt_hash,"staged PCZT changed on resume");owned.add(String(b.txid));
    }
    for(const r of db.prepare("SELECT party,amount_zats,txid,output_index FROM obligations WHERE state IN ('paid','refunded') AND txid IS NOT NULL AND output_index IS NOT NULL").all() as any[])
      ownPaid.push({txid:String(r.txid),party:String(r.party),output_index:Number(r.output_index),amount_zats:String(r.amount_zats)});
    // B46 (H15): the reserve-return row is planned only when no batch is pending (every staged transaction has
    // mined), so its sources can never race a batch that still holds a note.
    // R107b: the return's own batch is not a pending batch for the return's gate, or allocating it would cancel it.
    pendingBatches=Number((db.prepare("SELECT COUNT(*) AS c FROM batches WHERE txid IS NULL AND state!='exception' AND id NOT IN (SELECT batch FROM obligations WHERE party='reserve-return' AND batch IS NOT NULL)").get() as {c:number}).c);
    } finally {db.close()}
  }
  const depositNotes=notes.filter(n=>m.deposit_addresses.includes(n.address)&&(!n.spent_in_txid||owned.has(n.spent_in_txid)));
  // R26 item 1: each note is its own party (`deposit:<txid>:<pool>:<action_index>`) and a zero-value note
  // is never an obligation — it is ignored and counted in verify's accounting.
  const {payable:payNotes,ignored}=refundable(depositNotes);
  const confirmed=(n:any)=>n.height&&tip-n.height+1>=m.confirmations;
  const stray=strayNotes(payNotes,m,src.frozen); // R40 item 1 (F1): a slot collision is a stray too
  const exceptions:{party:string;kind:string;amount_zats:string;reason?:string}[]=[];
  const obligations:Obligation[]=[],checks:{operation:string;ciphertext_hash?:string}[]=[],refusals:{party:string;reason:string}[]=[],claimEnvelopes:Record<string,string>={},claimsUsed:any[]=[];
  let result_hash:string|null=null,opened:any[]|null=null,result:any=null,defaults:number[]=[],balance_refunds:BalanceRefund[]=[],balNotes:any[]=[],bondVoid=false;
  const released=Date.now()/1000>=QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period;
  const dir=path.join(state,"settle",id,"check",String(process.pid));mkdirSync(dir,{recursive:true,mode:0o700});
  // B43 (H13/H14 items 2-3): every opening derives OFFLINE from the ONE BLS-verified beacon through the one
  // opener (envelope/opening.ts openSealedBid) — no Go tle and no drand call per leaf. The beacon is the
  // published one (checked below when a product config exists) or the private ledger's; an auction carrying
  // neither (cancelled before open) fetches it through the shared failover-plus-verify loop, lazily so a
  // cancelled-before-R plan never touches the network.
  let beaconClient:ChainClient|null=null;
  const beacon=async():Promise<ChainClient>=>beaconClient??=publishedClient((src as any).beacon??await fetchVerifiedBeacon(m.drand.R));
  if(["CANCELLED","REFUNDING"].includes(src.state)) {
    requireThat(!src.opened,"cancelled plan has opened bids");
  } else {
    requireThat(["CLEARED","SETTLING","SETTLED"].includes(src.state)&&src.result&&src.frozen,"settlement requires cleared result");
    if(published)requireThat(published.beacon&&published.beacon.round===m.drand.R&&published.beacon.chain_hash===m.drand.chain_hash,"published beacon missing or unbound");
    checkFrozen(src.frozen,id,manifest_hash);
    requireThat(released,"settlement before release");
    opened=[];
    for(const leaf of src.frozen.leaves) {
      requireThat(depositNotes.some(n=>n.txid===leaf.deposit.txid&&n.address===leaf.deposit.address&&confirmed(n)&&String(n.value_zats)===m.C_zats),"frozen deposit missing or spent; resume needs mined-batch reconciliation");
      const ct=path.join(dir,`${leaf.leaf_index}.age`),pt=path.join(dir,`${leaf.leaf_index}.bin`);
      writeFileSync(ct,Buffer.from(leaf.ciphertext_hex,"hex"),{mode:0o600});
      checks.push({operation:"tlock open",ciphertext_hash:hash(Buffer.from(leaf.ciphertext_hex,"hex"))});
      appendFileSync(path.join(state,"run","settle-tle.jsonl"),JSON.stringify({auction_id:id,operation:"tlock open",time:Date.now()})+"\n");
      // The one opener's contract (B44): bad shape (a wrong round included), any tlock/age/IBE failure or a
      // non-128-byte plaintext is this leaf's fault (undecryptable); only an unusable beacon client throws
      // and stops the plan.
      const decrypted=await openSealedBid(leaf.ciphertext_hex,await beacon());
      if(decrypted===null){opened.push({leaf_index:leaf.leaf_index,plaintext_hex:null,error:"undecryptable"});continue}
      writeFileSync(pt,Buffer.from(decrypted,"hex"),{mode:0o600});
      opened.push({leaf_index:leaf.leaf_index,plaintext_hex:readFileSync(pt).toString("hex")});
    }
    if(published) {
      requireThat(jsonBytes(opened).equals(jsonBytes(published.opened)),"published opening differs from fresh decryption");
      // R7 (Reviewer R F-3 = Reviewer G G1): the coordinator's private ledger is never a source — it is only
      // cross-checked against the signer's own fresh tle openings and the published envelope records, and any
      // difference refuses settlement before any destination is resolved or signature is asked for.
      requireThat(jsonBytes(auction.opened??null).equals(jsonBytes(opened)),"private ledger opening differs from signer-derived opening");
      requireThat(jsonBytes(auction.envelopes??[]).equals(jsonBytes(published.envelopes??[])),"private ledger envelope records differ from published records");
    }
    // R6 (F2) + R7 item 5: the sealed reserve is re-derived here from its own ciphertext and the one verified
    // beacon and must equal the published opening; a forged opening is refused before any signature. (Live run
    // correction: this call must take the DECODED manifest from client() — the signed packet has no manifest
    // fields.) A reserve is not a sealed bid, so it keeps the raw tlock decrypt without the bid shape rule.
    const derivedReserve=m.sealed_reserve!==undefined?await decryptPublished(m.sealed_reserve,await beacon()):null;
    const reserve_opening=requireReserveOpening(m,published?(published.reserve_opening?.plaintext_hex??null):(auction.reserve_opening??null),derivedReserve);
    result=JSON.parse(execute(process.execPath,[path.join(root,"clear/dist/cli.mjs")],JSON.stringify({manifest:src.manifest,signer:src.signer,frozen:src.frozen,opened,reserve_opening,serial_beacon:src.serial_beacon??null,launch:src.launch_input})));
    const fresh=jsonBytes(result);
    if(published) {
      requireThat(fresh.equals(jsonBytes(published.result)),"published result differs from signer recomputation");
      requireThat(fresh.equals(jsonBytes(auction.result)),"fresh signer clearing differs from result.json");
    } else requireThat(fresh.equals(jsonBytes(auction.result)),"fresh signer clearing differs from result.json");
    result_hash=hash(fresh);
    // Part 2, collection drop (bond-then-pay, R33 item 2): the balance window is the manifest-fixed
    // (balance_window_start_height, … + balance_window_blocks] — clear_height no longer enters it. Settlement
    // waits until tip > start + window, then derives the defaults from its own scan with the shared rule
    // (clear/features.ts balanceDefaults) — never operator input.
    if(m.bond!==undefined) {
      const {start,end}=balanceWindow(m as any);
      const deadline=Date.now()+Math.max(1,end-tip+30)*75_000;
      while(tip<=end) {
        requireThat(Date.now()<deadline,"balance window did not pass");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30_000);
        wallet("sync","-s",process.env.BNZ_LWD_URL!);tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
      }
      // Fresh scan after the window: a balance payment that mined at the window's end must count.
      balNotes=execute(scanBin(root,state),["scan",m.network,vaultDir(state,id)]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
      // Ruling R38 item 5 (N5): a batch can SPEND a balance payment only when the wallet counts it spendable —
      // ZIP 315 requires 10 confirmations for a note sent by an external party (benzo-pczt create calls
      // propose_transfer with ConfirmationsPolicy::default()). The plan counts the payment by mined height the
      // moment the window closes, so a payment mined near the window's end must mature before the batch is
      // built: otherwise every host's build refuses it with InsufficientFunds (live: drop-r33 attempt 1 —
      // ac51f698 mined in-window at 4469388 but had 9 confirmations when the window closed at 4469396).
      // Waiting for maturity is bounded (a mined note always matures); it never refuses chain state.
      const bUas=new Set([...balanceAddressMap(result,src.frozen!.leaves as any,m as any).values()]),bondBlocks=m.bond.balance_window_blocks;
      for(;;) {
        const immature=balNotes.filter((n:any)=>bUas.has(n.address)&&n.height&&n.height>start&&n.height<=start+bondBlocks&&tip-n.height+1<10);
        if(!immature.length)break;
        requireThat(Date.now()<deadline,"balance payment never became spendable");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30_000);
        wallet("sync","-s",process.env.BNZ_LWD_URL!);tip=JSON.parse(wallet("balance","--json")).chain_tip_height;
      }
      // Ruling R61: the start block's header time, from this coordinator's own lightwalletd — before R's release
      // the bond is void (nobody defaults; every deposit and balance note refunds in full). The hosts decide the
      // same from their own chain views and sign it; only their agreed value is ever published.
      // R64 (Reviewer R P2-3 on R63): the same header rule as the hosts — every configured endpoint, all agreeing.
      const single=process.env.BNZ_LWD_SINGLE==="1";requireThat(!single||m.network==="test","BNZ_LWD_SINGLE is testnet-only");
      const endpoints=[process.env.BNZ_LWD_URL!,...(single?[]:[process.env.BNZ_LWD_URL_ALT??""])];
      requireThat(endpoints.every(e=>!!e)&&new Set(endpoints.map(endpointKey)).size===endpoints.length,"two distinct lightwalletd endpoints (BNZ_LWD_URL, BNZ_LWD_URL_ALT) are required");
      const headers=endpoints.map((e:string)=>JSON.parse(execute(path.join(state,"bin","grpcurl"),["-import-path",path.join(state,"proto"),"-proto","service.proto","-d",JSON.stringify({height:start}),e,"cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlock"])));
      // R65 (P2-2): the header must be the start height's, with a hash and a time, and agree across endpoints.
      requireThat(headers.every((h:any)=>Number(h.height)===start&&typeof h.hash==="string"&&h.hash.length>0&&Number.isSafeInteger(Number(h.time))&&Number(h.time)>0),`block ${start} header`);
      requireThat(headers.every((h:any)=>h.hash===headers[0].hash&&h.time===headers[0].time),`block ${start} header differs across lightwalletd endpoints`);
      bondVoid=bondVoidAt(m as any,Number(headers[0].time));
      defaults=bondVoid?[]:balanceDefaults(m as any,result,src.frozen!.leaves as any,balNotes,tip);
      // Ruling R38 item 4 (N4) + Ruling R40 item 2 (F2): out-of-window balance notes are never settlement
      // sources and never count as payment — each note gets its own immutable `balance-late:…` row to that
      // slot's own leaf (host-derived counts, published without addresses), parked as an exception row and
      // claimable through the existing claim path. A newly seen note adds a new row and never grows one.
      balance_refunds=balanceSettlement(m as any,result,src.frozen!.leaves as any,balNotes,tip,bondVoid).refunds;
    }
  }
  // R16 item 1 (Reviewer R F4): the CANCELLED/REFUNDING branch resolves each deposit exactly like the cleared
  // path, through its envelope or its claim, with no published opening needed. The memo- and claim-bound
  // machinery below is shared by both branches; a leaf party opens from the signer's own fresh tle openings
  // (cleared path), a deposit party from its on-chain memo ciphertext.
  // R7 item 4 (R F-5 = G5): owner-signed claim requests complete exception-queue refunds. Each request
  // names a shielded destination and is checked here against the one-time owner key inside the signer's own
  // fresh tle opening (a leaf) or the stray deposit's memo opening (a stray) — never against the private
  // ledger or any operator input. The first recorded claim per party wins (cli/product.ts claim-refund).
  const bidPlaintextFor=async(party:string):Promise<Buffer|null>=>{
    if(party.startsWith("leaf:")) {
      const o=opened?.find(x=>x.leaf_index===Number(party.slice(5)));
      return o&&o.plaintext_hex?Buffer.from(o.plaintext_hex,"hex"):null;
    }
    // Ruling R40 items 2/5 + Ruling R41 item 4 (F10): a refund row refunds to the deposit slot's own leaf
    // (`balance-late:`: the note's slot; `balance-excess:<leaf>`: its own key), so the claim's one-time owner
    // key is that leaf's key, from the signer's own fresh tlock opening — the shared rule
    // (clear/features.ts refundRowLeafIndex), never operator input.
    if(isRefundRowParty(party)) {
      const leaf=refundRowLeafIndex(m as any,(src.frozen?.leaves??[]) as any,party,balNotes.length?balNotes:notes);
      const o=leaf!==null?opened?.find(x=>x.leaf_index===leaf):undefined;
      return o&&o.plaintext_hex?Buffer.from(o.plaintext_hex,"hex"):null;
    }
    const note=partyNote(depositNotes,party);
    const ct=note?.memo_hex?memoSealedBid(note.memo_hex)?.ciphertext_hex??null:null;
    if(!ct)return null;
    const base=path.join(dir,party.replace(/[^a-z0-9]/gi,"_")),memoCt=base+".age",memoPt=base+".bin";
    writeFileSync(memoCt,Buffer.from(ct,"hex"),{mode:0o600});
    checks.push({operation:"tlock open",ciphertext_hash:hash(Buffer.from(ct,"hex"))});
    // B43 (H14 item 2): the one opener over the one verified beacon; a memo that does not open (bad shape —
    // a wrong round included — any tlock/age/IBE failure, or not a 128-byte plaintext) holds no owner key
    // (B44: the opener never throws on a memo), and only an unusable beacon client throws instead of
    // silently classifying the stray as ownerless. R7 item 6: a memo that does not open to this auction's
    // 128-byte sealed-bid layout holds no owner key.
    const memoOpened=await openSealedBid(ct,await beacon());
    if(memoOpened===null)return null;
    writeFileSync(memoPt,Buffer.from(memoOpened,"hex"),{mode:0o600});
    const pt=Buffer.from(memoOpened,"hex");
    return sealedBidPlaintext(pt,src.manifest)?pt:null;
  };
  const ownerKeyFor=async(party:string):Promise<string|null>=>{const pt=await bidPlaintextFor(party);return pt?pt.subarray(61,93).toString("hex"):null};
  // R7 item 6 + R20: a stray/cancelled deposit with a valid sealed-bid memo resolves through its own
  // owner-signed settlement envelope, keyed by its memo's ciphertext hash and AUTHENTICATED against the
  // memo's own tlock opening (R20 (b): owner signature plus settlement commitment over the record); an
  // operator-inserted record for a memo-less or v1 stray is never paid. Memo v2's tag binding (R20 (a))
  // lands with Track B's memo v2 merge.
  // R127: the beacon is passed lazily (null before R), so a framing-v2 memo whose tag binds its record
  // authenticates before R with no beacon, as it did before B43; a memo that must be opened waits for R.
  const strayEnvelope=async(party:string):Promise<boolean>=>(await authenticatedMemoEnvelope(depositNotes,party,src.manifest,src.envelopes,released?beacon:null))!==null;
  const claimFile=path.join(state,"settle",id,"claims.json"),claimFailures:Record<string,string>={};
  if(existsSync(claimFile))for(const request of JSON.parse(readFileSync(claimFile,"utf8"))) {
    try {
      requireThat(request.auction_id===id&&typeof request.party==="string"&&typeof request.claim_envelope_ct==="string"&&/^[0-9a-f]{128}$/.test(request.owner_sig),"claim request shape");
      requireThat(envelopeRecordValid({envelope_ct:request.claim_envelope_ct,owner_sig:request.owner_sig},JSON.parse(Buffer.from(src.manifest.bytes,"base64").toString("utf8")).envelope_keys),"claim envelope format");
      // R15 item 3: the claim's destination is SEALED in its v2 envelope; the owner-signed body carries only
      // the envelope's hash — no plaintext destination and no destination hash an address could be matched to.
      const body={kind:"claim-refund",auction_id:id,party:request.party,claim_envelope_sha256:hash(Buffer.from(request.claim_envelope_ct,"hex"))};
      // B55 (M1, docs/design/phase7-b55-cancel-before-r-and-rg-harness.md §1): a claim before R cannot verify —
      // its owner key lives in a memo opening that needs the round-R beacon, which no endpoint has produced yet —
      // so it fails per request with its reason inside this try and NEVER fetches (the rule: before R, the
      // plan.ts `released` predicate, no path touches drand). The run continues and the deposit stays in the
      // exception queue; the owner claims it after R.
      requireThat(released||!isDepositParty(request.party),"claim before release; the owner key is derivable only after R");
      const owner=await ownerKeyFor(request.party);
      requireThat(owner&&verifyStatement(owner!,body,request.owner_sig),"claim owner signature");
      // R11/R13/R15.3: the first claim whose owner signature verifies is the one used — its sealed
      // destination is opened per signer with R10 item 4's two-signer agreement (gateEnvelope below), and
      // only the envelope's hash is published.
      if(!claimEnvelopes[request.party]) {
        claimEnvelopes[request.party]=request.claim_envelope_ct;
        const cm=isDepositParty(request.party);
        const note=cm?partyNote(depositNotes,request.party):undefined;
        // R16 item 4: a stray claim publishes the scanned deposit's memo (memo_hex must match the scanned
        // deposit) so every verifier can derive the owner key itself from it and the published beacon.
        requireThat(!cm||!!note?.memo_hex,"claim memo matches the scanned deposit");
        claimsUsed.push({party:request.party,claim_envelope_sha256:body.claim_envelope_sha256,owner_sig:request.owner_sig,...(cm?{memo_hex:note!.memo_hex}:{})});
      }
    } catch(e) {claimFailures[request.party]=(e as Error).message}
  }
  for(const [party,message] of Object.entries(claimFailures))if(!claimEnvelopes[party]) {
    refusals.push({party,reason:`claim refused: ${message}`});process.stderr.write(`ERROR claim ${party} refused: ${message}\n`);
  }
  // R10 item 4: an envelope-paid refund is payable only when at least 2 signers' envelope-opens reports
  // (each signer's own opening report, written before any batch is planned and never carrying the
  // destination) report ok with the same dest_sha256 for the row. Otherwise the row waits in the exception
  // queue with the ruling's reason, claimable through benzo claim-refund.
  // R23 item 2 (Reviewer G G3): each envelope-opens report is signed by that signer's witness key (the
  // same pinned witness set) and the gate counts only reports whose signature verifies — one per witness
  // key. An unsigned or forged report is ignored, so a fabricated pair can never satisfy the two-signer rule.
  const reports:any[]=["alice","bob","carol"].flatMap(n=>{try{const r=JSON.parse(readFileSync(path.join(state,"settle",id,`envelope-opens-${n}.json`),"utf8"));return r&&r.signer===n?[r]:[]}catch{return []}});
  const witnessKeys=published&&m.witness_set_hash!==undefined&&published.witness_set
    ? validateWitnessSet(verifyRecord<WitnessSet>(published.witness_set,src.signer),id).keys
    : null;
  const agreed=agreedDestinations(reports,witnessKeys);
  const envelope_agreed:Record<string,string>={};
  const agreedDestination=(party:string):string|null=>agreed.get(party)??null;
  const gateEnvelope=(row:{party:string;kind:"refund"|"payout";amount_zats:string}):void=>{
    const agreed=agreedDestination(row.party);
    if(agreed){envelope_agreed[row.party]=agreed;obligations.push(row);return}
    const reason="signers could not agree on the envelope destination";
    refusals.push({party:row.party,reason});process.stderr.write(`ERROR refund ${row.party} to the exception queue: ${reason}\n`);
    exceptions.push({...row,reason});
  };
  if(["CANCELLED","REFUNDING"].includes(src.state)) {
    // R16 item 1 (Reviewer R F4): a cancelled product auction refunds exactly like the cleared path — through
    // the deposit's own owner-signed claim or its envelope. Anything else is an exception row, claimable after
    // R. Before R (and until Track B's memo-bound envelope tag, R16.2/R18, lands with memo v2) no owner key or
    // envelope authentication exists for a cancelled-before-R deposit, so it waits in the exception queue —
    // never a wedge for the other rows.
    for(const n of payNotes) {
      const party=depositParty(n),row:{party:string;kind:"refund";amount_zats:string}={party,kind:"refund",amount_zats:String(n.value_zats)};
      if(!confirmed(n)) {exceptions.push({...row,reason:"deposit not confirmed; claimable after confirmation"});continue}
      if(claimEnvelopes[party]) {gateEnvelope(row);continue}
      // R127 (replaces B55's gate): strayEnvelope passes no beacon before R, so only a framing-v2 tag-bound
      // record can authenticate then; every other deposit parks with the reason below, and nothing fetches drand.
      if(await strayEnvelope(party)) {gateEnvelope(row);continue}
      const reason=!released?"cancelled before release; refund is claimable after R":
        !(await bidPlaintextFor(party))?"deposit memo is not an openable sealed bid; no owner key claims it":
        "no valid owner-signed settlement envelope";
      refusals.push({party,reason});process.stderr.write(`ERROR refund ${party} to the exception queue: ${reason}\n`);
      exceptions.push({...row,reason});
    }
  } else {
    for(const n of stray.filter(n=>!confirmed(n)))exceptions.push({party:depositParty(n),kind:"refund",amount_zats:String(n.value_zats)});
    for(const [party,amount] of modeEntry(src.manifest).obligations(result!,m.bond!==undefined?{defaults,balance_refunds,...(bondVoid?{bond_void:true}:{})}:null)) {
      const row:{party:string;kind:"refund"|"payout";amount_zats:string}={party,kind:party==="seller"?"payout":"refund",amount_zats:amount};
      // R6 (W) + R7 items 2/3: a product-mode bid's refund destination comes only from its owner-signed
      // settlement envelope. With no valid record the row goes to the exception queue; while Track B's
      // multi-recipient envelope format is unmerged, even a valid envelope destination is refused with a clear
      // error — never paid from an operator-held key — and waits in the queue for an owner-signed claim.
      if(published&&isRefundRowParty(party)) {
        // Ruling R40 item 2 (F2): a per-note late-refund row is parked as an exception row — never auto-paid
        // (the payer is unknowable) — unless its owner already claimed it; the claim path pays it with the
        // slot leaf's owner key (bidPlaintextFor above).
        // Ruling R41 item 3 (F9): a late or excess refund row is PAYABLE only from notes with the same
        // confirmations rule as strays and sources (m.confirmations / ZIP-315's 10). Until its backing note
        // matures it stays PENDING even when claimed — a reorg must never make the vault refund money it
        // never received.
        const derived=balance_refunds.find(r=>r.party===party);
        if(claimEnvelopes[party]&&derived?.matured===true) {gateEnvelope(row);continue}
        const reason=derived?.matured!==true?"refund note not confirmed; the row stays pending until the confirmations rule (R41.3)":
          "out-of-window balance payment refunds to this leaf; claimable through benzo claim-refund";
        refusals.push({party,reason});
        exceptions.push({...row,reason});continue
      }
      if(published&&party.startsWith("leaf:")) {
        // R15 item 3: a claim pays on its own owner signature over the sealed destination's hash — with the
        // same two-signer opening agreement as an envelope refund (gateEnvelope).
        if(claimEnvelopes[party]) {gateEnvelope(row);continue}
        if(validEnvelope(src,Number(party.slice(5)))) {gateEnvelope(row);continue}
        const reason="no valid owner-signed settlement envelope";
        refusals.push({party,reason});process.stderr.write(`ERROR refund ${party} to the exception queue: ${reason}\n`);
        exceptions.push({...row,reason});
      } else obligations.push(row);
    }
    for(const n of stray.filter(confirmed)) {
      const party=depositParty(n),row:{party:string;kind:"refund";amount_zats:string}={party,kind:"refund",amount_zats:String(n.value_zats)};
      // R7 item 6 (Reviewer G G6): a stray refund never goes to an operator-chosen destination. A stray whose
      // memo holds a valid sealed bid is refunded through its own envelope like any bid; anything else goes to
      // the exception queue, claimable only when its memo holds an owner key (benzo claim-refund).
      if(!published) {obligations.push(row);continue}
      if(claimEnvelopes[party]) {gateEnvelope(row);continue}
      // Ruling R40 item 1 (F1): a slot collision (the later note at a used deposit slot) is refunded through the
      // stray CLAIM path only. Its published envelope record belongs to the frozen LEAF's ciphertext and the
      // note's memo-to-record binding is not publicly checkable for a stray row (benzo verify requires a
      // published claim for every paid deposit row), so no auto-pay leg applies; the memo's own owner key claims
      // the refund and the depositor loses only the fee.
      if(await strayEnvelope(party)&&!isSlotCollision(n,m,src.frozen)) {gateEnvelope(row);continue}
      const reason=isSlotCollision(n,m,src.frozen)?"deposit slot collision with an earlier bid; the refund is claimable through benzo claim-refund":
        !(await bidPlaintextFor(party))?"deposit memo is not an openable sealed bid; no owner key claims it":"no valid owner-signed settlement envelope";
      refusals.push({party,reason});process.stderr.write(`ERROR refund ${party} to the exception queue: ${reason}\n`);
      exceptions.push({...row,reason});
    }
  }
  // Design §6.1: a buyback returns what the treasury funded minus the cleared spend (everything when cancelled) to the
  // signed treasury_ua. funded = every mined note at the signed funding_ua (spent ones too, so later batches agree).
  if(treasuryBlock(m)) {
    const back=treasuryReturn(m as any,["CANCELLED","REFUNDING"].includes(src.state)?null:result,treasuryFunded(m as any,notes,tip)); // R28 item 7 (G-8): confirmed funding only
    if(back>0n)obligations.push({party:"treasury",kind:"payout",amount_zats:back.toString()} as any);
  }
  obligations.sort((a,b)=>a.party.localeCompare(b.party));
  requireThat(obligations.length+exceptions.length>0,"no confirmed settlement obligations");
  // B46 (H15, docs/design/phase7-b46-reserve-return.md, Revision R103): the one final `reserve-return` row —
  // planned as the last batch, alone, and ONLY when the auction owes NOTHING (settle/deposits.ts
  // reserveReturnOutstanding — the one shared gate, judged from this signer's own derivation plus the published
  // accounting). Vault value is FUNGIBLE (the wallet picks every batch's inputs), so the row's amount is
  // value-based: it pays the vault's WHOLE unspent value minus the fee the TOOL quotes for the one-row sweep
  // that spends every unspent note (B52, P2-1: `benzo-pczt quote-sweep`, never a predicted fee). A legacy
  // manifest plans no row and says
  // so with one line; while anything is owed, one waits line names the outstanding count — an unclaimed stray
  // delays the return indefinitely (the conservative choice, disclosed in docs/guide-operator.md).
  // B54 (P2-1): the accounting carries the sweep's unspendable residue too — dust_notes (count) and
  // dust_zats (value) are what the wallet can never select (settle/deposits.ts walletSpendable) and what
  // therefore stays in the vault after the sweep; verify shape-checks them in the published accounting.
  let reserve_return:{party:string;kind:"payout";amount_zats:string;remaining_zats:string;fee_zats:string;dust_notes:number;dust_zats:string}|null=null;
  const receipts:{party:string;amount_zats:string;txid:string;output_index:number}[]=(published?.settlement?.receipts??[]) as any;
  // The owed set, from our own derivation, run WITHOUT requiring a destination (R103): every row this plan
  // owes or parks is owed whether or not anyone claimed it, and every stray deposit note of our own scan is
  // owed the same way — spent or not, since a note a batch swept into change is still an unpaid stray until
  // its receipt exists (the fungibility case R103 was written for). The same strayNotes/refundable rules
  // deriveRows uses; a zero-value note is never owed (refundable).
  const allDepositNotes=notes.filter((n:any)=>m.deposit_addresses.includes(n.address));
  const cancelledPlan=["CANCELLED","REFUNDING"].includes(src.state);
  const strayOwed=refundable((cancelledPlan?allDepositNotes:strayNotes(allDepositNotes,m,src.frozen)) as any).payable
    .map((n:any)=>({party:depositParty(n),amount_zats:String(n.value_zats)}));
  const owed=[...obligations,...exceptions].map(r=>({party:r.party,amount_zats:r.amount_zats})).concat(strayOwed);
  // B49 (P0-1/P2-2): a published receipt counts only when THIS coordinator's own ledger approved the row at
  // that amount AND its own scan shows the paying transaction mined 10 deep (the one shared rule) — packet
  // receipts alone are never trusted. The scan is the freshest one (the post-window scan when a bond ran).
  // B53 (P3-1): the scan's own note is the mined-height evidence when it has one; a zero-change paying
  // batch leaves none, so this host's own chain lookup (cli/host-chain.ts minedHeight) stands in at the
  // same rule — at least 10 deep at or below our own tip (the predicate stays pure; an unreachable
  // lightwalletd reads as not-yet-counted, the conservative direction).
  const paid=paidByOwnLedger(receipts,ownPaid,balNotes.length?balNotes:notes,tip,(txid)=>{try{return minedHeight(state,txid)}catch{return 0}});
  const outstanding=reserveReturnOutstanding({owed,rows:(published?.settlement?.rows??[]) as any,receipts:paid,
    balance_refunds:(published?.settlement?.balance_refunds??[]) as any,pending_batches:pendingBatches});
  if(m.reserve_return_ua_commitment===undefined) {
    process.stderr.write("WARN the reserve stays in the vault (legacy, H15): this manifest commits no reserve_return_ua_commitment\n");
  } else if(outstanding.length>0) {
    process.stderr.write(`reserve return waits: ${outstanding.length} outstanding (strays/balances/exceptions)\n`);
  } else {
    // B52 (Reviewer R round 4, P2-1, docs/design/phase7-b52-return-fee.md item 1): the row's amount and fee
    // come from the TOOL's own quote of the sweep — `benzo-pczt quote-sweep` (settle/quote.ts), the same
    // wallet and fee rule `create` uses — never from a prediction over the source count (the real fee is
    // the ZIP-317 fee of the transaction's real per-pool action counts; a cross-pool vault's prediction was
    // wrong and every host's build then died). The sweep's SOURCES are the vault's scanned unspent notes —
    // whatever their address, vault value is fungible — and the quote sweeps every spendable one with no
    // change output. B52 item 3 (Sapling): no vault address can receive Sapling (the deposit, fee-reserve,
    // balance and change UAs are `benzo-pczt address`'s UnifiedAddressRequest::ORCHARD addresses, which
    // carry no Sapling receiver); if a vault ever held a note the tool cannot spend, the quote refuses it
    // and the waits line below names that true reason.
    // When there is no quote (insufficient value, a note the tool cannot spend, or no pinned return UA) the
    // row is NOT planned and one typed waits line names the true reason — the run still completes, exit 0,
    // nothing broadcast. Never a crash.
    // B54 (P2-1): the swept total is the sum of the notes the WALLET can spend (settle/deposits.ts
    // walletSpendable — the same rule `quote-sweep` and `create` share), never every positive note. The
    // quote must spend exactly that total (nothing spendable left behind), or the typed waits line names
    // the divergence and the row is not planned this run — the same comparison the signer hosts hold the
    // candidate to (cli/host-derive.ts deriveReserveReturn). A dust note can no longer wall the return:
    // it is simply outside both sides of the comparison and is published as the residue.
    const ua=typeof productConfig?.routing?.reserve_return_ua==="string"?productConfig.routing.reserve_return_ua as string:"";
    const reason=!ua?"no reserve_return_ua is pinned in the operator config"
      :reserveReturnUaCommitment(ua)!==m.reserve_return_ua_commitment?"the operator config's reserve_return_ua does not match the manifest reserve_return_ua_commitment"
      :null;
    const quote=reason!==null?{error:reason}:quoteSweep(pcztBin(root,state),vaultDir(state,id),ua,m.network);
    const scanned=reserveUnspent(notes as any);
    if("error" in quote)process.stderr.write(`reserve return waits: the vault's value cannot be swept in one transaction (${quote.error})\n`);
    else if(quote.input_zats!==scanned.total_zats)
      process.stderr.write(`reserve return waits: the vault's value cannot be swept in one transaction (the tool's quote spends ${quote.input_zats} zats of the scanned unspent total ${scanned.total_zats})\n`);
    else reserve_return={party:"reserve-return",kind:"payout",amount_zats:quote.amount_zats,remaining_zats:scanned.total_zats,fee_zats:quote.fee_zats,dust_notes:scanned.dust_notes,dust_zats:scanned.dust_zats};
  }
  process.stdout.write(jsonBytes({auction_id:id,manifest_hash,network:m.network,result_hash,opened,obligations,exceptions,refusals,ignored,claim_envelopes:claimEnvelopes,claims_used:claimsUsed,envelope_agreed,...(reserve_return?{reserve_return}:{}),...(m.bond!==undefined?{defaults,balance_refunds,...(bondVoid?{bond_void:true}:{})}:{}),checks,checked_at:Math.floor(Date.now()/1000),chain_tip:tip}));
} catch(e) {process.stderr.write(`ERROR settle ${(e as Error).message}\n`);process.exitCode=1}
