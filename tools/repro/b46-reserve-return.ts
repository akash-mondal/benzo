// B46 (docs/design/phase7-b46-reserve-return.md, Revision R103): return the unused fee reserve (H15, the
// mainnet blocker). Red on the BASE commit's bundles under tmp/b46/base-src/ (built ONCE from the pristine
// base commit before any B46 edit), green after, for each of the design's proof cases — all offline on the
// h-fixtures machinery (a small but REAL auction document: real tlock ciphertexts to quicknet round 32704232,
// a signed manifest, the frozen set, witness certificates, envelope records and a cleared result `benzo
// verify` re-derives; the offline externals are stubbed, every product decision runs the real shipped code):
//   red (base): the plan on a settled fixture with NOTHING owed plans NO row — the reserve is stranded (and
//     the base manifest schema cannot even represent reserve_return_ua_commitment);
//   green: the stray + unclaimed late-balance fixture plans NO return (one `reserve return waits: 2
//     outstanding (strays/balances/exceptions)` line) — the conservative choice R103 requires;
//   green: after the stray is refunded and the late balance paid, the plan returns the vault's WHOLE
//     unspent value minus the ZIP-317 fee, in exactly one row (value-based: vault value is fungible, so
//     only the amount can protect a bidder's unclaimed money);
//   green: a prior batch spent the stray's note (its value now sits in internal change) — the return is
//     still refused while the stray is unpaid, even though every published row is receipted and the fresh
//     derivation is clean (the own-scan stray rule runs without requiring a destination, claimed or not);
//   green: the hosts approve the honest return (`sign build`, `sign derivable`, `sign approve`) and refuse
//     typedly (exit 3, named rows) a packet with a different return UA, a candidate whose inspect
//     `input_zats` is below their scanned unspent total, a candidate whose output differs from the scanned
//     total minus the fee, a return planned while something is still outstanding, and a legacy packet;
//   green: a legacy manifest plans no row and prints the one "the reserve stays in the vault (legacy, H15)" line;
//   green: `auction create --config` sets the commitment from routing.reserve_return_ua (H4's receiver rule)
//     and mainnet create refuses a manifest without it;
//   green: `benzo verify` accepts the published result and refuses a forged second `reserve-return` receipt
//     and a return with something still outstanding.
//
// Batch B49 (docs/design/phase7-b49-paid-means-mined.md) extends this proof with the "paid means approved
// and mined" cases, red on the B49 base commit 7c4e661 (bundles under tmp/b46/base49-src/) and green after:
//   red/green (a): a cancelled auction with unclaimed strays plus fabricated packet receipts — on the base the
//     hosts BUILD the sweeping return; after, they refuse it typedly (the strays stay outstanding);
//   red/green (b): a cleared auction plus receipts of an approved but never-broadcast batch — on the base the
//     hosts build the return and the plan plans it; after, both refuse (the receipt is not mined);
//   red/green (c): a receipt whose transaction was mined and then reorged out (stub scan) — on the base the
//     return proceeds; after, the row is outstanding again and the return is refused;
//   green (d): honest receipts — approved, mined and 10 deep — so the return proceeds (the F section), and
//     a 9-deep variant is refused (the depth boundary);
//   red/green (e): the reviewer's two crafted envelopes (empty refund; NUL and newline) in the packet's
//     claims — on the base the classify prefetch throws and freezes `sign derivable` for every host; after,
//     the run completes and each crafted row is underivable while the batch proceeds;
//   red/green (f): a cross-kind re-spend — a reserve-return candidate whose sweep re-spends a note an
//     approved ordinary batch already sources (and whose ledger entry is pre-B49 namespaced) is refused
//     after the namespace migration; on the base both candidates are approved.
//
// Build+run:
//   npx esbuild tools/repro/b46-reserve-return.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b46.mjs
//   (base bundles under tmp/b46/base-src/, built ONCE from the pristine base commit before any B46 edit:
//     mkdir -p tmp/b46/base-src && git archive a81e826 | tar -x -C tmp/b46/base-src && ln -s $PWD/node_modules tmp/b46/base-src/node_modules
//     (cd tmp/b46/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild clear/cli.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=clear/dist/cli.mjs))
//   (B49 base bundles under tmp/b46/base49-src/, from the B49 base commit 7c4e661:
//     mkdir -p tmp/b46/base49-src && git archive 7c4e661 | tar -x -C tmp/b46/base49-src && ln -s $PWD/node_modules tmp/b46/base49-src/node_modules
//     (cd tmp/b46/base49-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild clear/cli.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=clear/dist/cli.mjs))
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli)
//   node tmp/b46.mjs before && node tmp/b46.mjs after
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment, validateManifest } from "../../manifest/schema";
import { depositParty, reserveReturnAmount, reserveReturnFee, reserveReturnOutstanding } from "../../settle/deposits";
import { balanceLateParty } from "../../clear/features";
import { modeEntry } from "../../clear/registry";
import { Ledger } from "../../settle/ledger";
import { ownerPublic, sealBlob, sealEnvelope, settlementCommitment, signStatement } from "../../envelope";
import { signApprovalMap, signOpensReport } from "../../witness";
import { publishedClient } from "../../cli/published-beacon";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import { buildAuction, craftedEnvelope, fetchBeacon, needRealPczt, ownerPrivate, witnessPrivate, UA_ORCHARD, UA_SAPLING_ONLY, writeHostState, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b46.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b46.mjs ${part} (tools/repro/b46-reserve-return.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const WORK = path.join(ROOT, "tmp", "b46", "run");
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;
const BASE = path.join(ROOT, "tmp", "b46", "base-src");
const BASE_PLAN = path.join(BASE, "settle", "dist", "plan.mjs"), BASE_BENZO = path.join(BASE, "cli", "dist", "benzo.mjs");
// B49: the B49 base commit's bundles (7c4e661 — the P0/P1 holes present) for the B49 red legs.
const BASE49 = path.join(ROOT, "tmp", "b46", "base49-src");
const BASE49_PLAN = path.join(BASE49, "settle", "dist", "plan.mjs"), BASE49_BENZO = path.join(BASE49, "cli", "dist", "benzo.mjs");
const GREEN_PLAN = path.join(ROOT, "settle", "dist", "plan.mjs"), GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
for (const f of [BASE_PLAN, BASE_BENZO, path.join(BASE, "clear", "dist", "cli.mjs")]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
for (const f of [BASE49_PLAN, BASE49_BENZO, path.join(BASE49, "clear", "dist", "cli.mjs")]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the B49 base bundles first (see the header)`);
for (const f of [GREEN_PLAN, GREEN_BENZO]) if (part === "after" && !existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);

// ---- the fixture: a settled BOND-then-pay auction (so the late-balance note is a REAL balance note the
// clear/features.ts rules derive) whose vault holds the fee-reserve note, internal change, a stray deposit
// and an unclaimed late-balance note (the R42 note classes owners may still claim; there is no claim
// deadline). One bid, one deposit slot, one balance address; C is the bond (bond_bps 1000 of the 100,000 cap).
const R = 32704232;
const FEE_RESERVE_UA = "utest1b46feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b46internalchangeaddress00000000000000000000000000000000000";
const CHANGE2_ADDR = "utest1b46internalchangetwoaddress000000000000000000000000000000000";
const BAL_ADDR = "utest1b46latebalanceaddress00000000000000000000000000000000000000";
const BOND = { bond_bps: 1000, balance_window_start_height: 95000, balance_window_blocks: 1000, balance_addresses: [BAL_ADDR] };
const STRAY_TXID = hash("b46-stray-deposit"), CHANGE2_TXID = hash("b46-stray-change"),
  RES_TXID = hash("b46-fee-reserve-note"), LATE_TXID = hash("b46-late-balance"), PRIOR_TXID = hash("b46-prior-sweep"),
  INPUT_TXID = hash("b46-stray-refund-input"), DEAD_TXID = hash("b46-dead-batch");
const TX_OBLIG = hash("b46-batch-obligations"), TX_REFUND_S = hash("b46-batch-stray-refund"), TX_REFUND_L = hash("b46-batch-late-refund"),
  TX_RESERVE = hash("b46-batch-reserve-return"), TX_FORGED = hash("b46-batch-forged");
const STRAY_VALUE = "500000", LATE_VALUE = "499999";
// B49: the vault's unspent value once the strays and balances are settled — the fee-reserve note (20,000),
// the obligations batch's change (35,000) and the two refund batches' change (1,000 + 1,000). The return
// sweeps 4 notes, so its ZIP-317 fee is 5,000 x 4 = 20,000 and it pays 57,000 − 20,000.
const REMAINING = "57000", RESERVE_FEE = "20000", RESERVE_AMOUNT = "37000";
const strayParty = () => depositParty({ txid: STRAY_TXID, pool: "ironwood", action_index: 0 });
const lateParty = () => balanceLateParty({ txid: LATE_TXID, pool: "ironwood", action_index: 0 });
// R13: a claim-paid row carries a published, owner-signed claim — checkable against the opening its owner key
// lives in. The stray's claim publishes its own sealed-bid memo (a real tlock ciphertext to the pinned round,
// its memo hash attested by the two agreeing maps of the paying batch — R42's per-row attestation); the late
// row's claim signs with the deposit slot's own leaf owner key. Both bodies are what `benzo claim-refund`
// records and `benzo verify` re-checks.
const claimBody = (party: string, envelopeCt: string) => ({ kind: "claim-refund", auction_id: bound.id, party, claim_envelope_sha256: hash(Buffer.from(envelopeCt, "hex")) });
const strayOwner = (privateHex: string) => ({ private_hex: privateHex, public_hex: ownerPublic(privateHex) });
let STRAY_CLAIM: any = null, LATE_CLAIM: any = null, STRAY_MEMO = "";
// The PACKET's claim request carries the sealed box itself (deriveRows opens packet/claims.json); the
// published doc carries only its hash (benzo verify's claim shape).
const claimsFor = (settlement: any) => [STRAY_CLAIM, LATE_CLAIM].filter(c => c && (settlement.rows ?? []).some((r: any) => r.party === c.party && r.state === "paid"));
const publishedClaims = (claims: any[]) => claims.map(({ claim_envelope_ct: _ct, ...rest }) => rest);
const claimFor = (party: string, owner: { private_hex: string; public_hex: string }, memoHex?: string, sealed?: string) => {
  // B49: `sealed` overrides the claim's sealed refund box — the crafted-envelope fixtures of proof case (e)
  // carry an arbitrary plaintext the classifier must never crash on.
  const envelopeCt = sealed ?? sealEnvelope(UA_ORCHARD, bound.envelopeKeys.map(k => k.public_hex), "test");
  const body = claimBody(party, envelopeCt);
  return { party, claim_envelope_sha256: body.claim_envelope_sha256, claim_envelope_ct: envelopeCt, owner_sig: signStatement(owner, body), ...(memoHex ? { memo_hex: memoHex } : {}) };
};
// The scan notes. The bid deposit is spent by the obligations batch (recorded in the plan's ledger); the
// stray and late notes are unspent (case 1) or spent by their refund batches (case 2) or — the R103
// fungibility case — the stray's note was swept into change by a prior batch while its row is still unpaid.
// B49 ("paid" means approved AND mined): every mined batch's CHANGE note is the scan's own evidence that the
// batch's txid mined at that height (settle/deposits.ts paidByOwnLedger) — `changes` names the mined batches
// whose change is in the vault (the honest world: the obligations batch and both refund batches),
// `strayInput` adds the note the stray refund batch really spent while the stray's own note stayed unspent
// (the wallet picks the inputs — fungibility), and `depositsUnspent` leaves the bid deposits unclaimed
// (the cancelled world).
const CHANGE_OF: Record<string, [number, number]> = { [TX_OBLIG]: [99200, 35000], [TX_REFUND_S]: [99600, 1000], [TX_REFUND_L]: [99610, 1000] };
const vaultNotes = (fx: Fixture, opts: { straySpent?: string | null; lateSpent?: string | null; strayChange?: boolean; changes?: string[]; changesHeight?: number; strayInput?: boolean; depositsUnspent?: boolean } = {}) => [...fx.notes.map(n => ({ ...n, spent_in_txid: opts.depositsUnspent ? null : TX_OBLIG })),
  // B49: the stray carries its own sealed-bid memo (STRAY_MEMO, set in the setup block) — a real stray
  // deposit does — so its claim-based row derives exactly like the live flow's (proof case (e) then shows
  // the crafted claim taking that row away).
  { txid: STRAY_TXID, height: 99100, pool: "ironwood", address: fx.manifest.deposit_addresses[0], diversifier_index: "7", action_index: 0, value_zats: 500000, memo_hex: STRAY_MEMO, spent_in_txid: opts.straySpent ?? null },
  { txid: RES_TXID, height: 99050, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: 20000, memo_hex: null, spent_in_txid: null },
  { txid: LATE_TXID, height: 99300, pool: "ironwood", address: BAL_ADDR, diversifier_index: "10", action_index: 0, value_zats: 499999, memo_hex: null, spent_in_txid: opts.lateSpent ?? null },
  ...(opts.strayInput ? [{ txid: INPUT_TXID, height: 99040, pool: "ironwood", address: CHANGE2_ADDR, diversifier_index: "12", action_index: 0, value_zats: 600000, memo_hex: null, spent_in_txid: TX_REFUND_S }] : []),
  ...(opts.changes ?? [TX_OBLIG, TX_REFUND_S, TX_REFUND_L]).map(txid => ({ txid, height: opts.changesHeight ?? CHANGE_OF[txid][0], pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "8", action_index: 0, value_zats: CHANGE_OF[txid][1], memo_hex: null, spent_in_txid: null })),
  ...(opts.strayChange ? [{ txid: CHANGE2_TXID, height: 99400, pool: "ironwood", address: CHANGE2_ADDR, diversifier_index: "11", action_index: 0, value_zats: 500000, memo_hex: null, spent_in_txid: null }] : [])];
const obligationRows = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, { defaults: [], balance_refunds: [] })].map(([party, amount_zats]) => ({ party, amount_zats }));

// The settled settlement the fixture's public dir carries: every obligation row receipted (batch 1), the
// stray deposit as its exception row until refunded, the late balance as its published balance-refund entry
// (`pending` until paid; a paid entry carries its row, receipt and the two agreeing host-signed maps of the
// batch that paid it, exactly as `benzo verify`'s balance-refs rule requires), and — for the returned
// variant — the one `reserve-return` row, receipt and published accounting (the vault's whole unspent value
// and the fee; the destination itself is never published, only the manifest commitment). Every paying
// txid carries its two agreeing maps (verify's defaults tie-break refuses an unattested paying batch).
const settlementFor = (fx: Fixture, opts: { strayPaid?: boolean; latePaid?: boolean; hideStrayRow?: boolean; returned?: boolean; forged?: boolean; dropReceiptOf?: string; strayTxid?: string } = {}) => {
  // B49: `strayTxid` names the batch that (claims to have) paid the stray — the honest refund txid, or a
  // DEAD_TXID for the "approved but never-broadcast batch" receipts of proof case (b).
  const strayTx = opts.strayTxid ?? TX_REFUND_S;
  const obs = obligationRows(fx);
  const rows: any[] = obs.map((o, i) => ({ party: o.party, kind: o.party === "seller" ? "payout" : "refund", amount_zats: o.amount_zats, state: "paid", batch: 1, txid: TX_OBLIG, output_index: i, pool: "ironwood" }));
  const receipts: any[] = obs.map((o, i) => ({ auction_id: fx.id, party: o.party, txid: TX_OBLIG, pool: "ironwood", output_index: i, amount_zats: o.amount_zats }));
  const maps: any[] = [0, 1].map(w => signApprovalMap({ auction_id: fx.id, batch: 1, txid: TX_OBLIG, outputs: obs.map((o, i) => ({ party: o.party, output_index: i })), defaults: [], balance_refunds: [] }, witnessPrivate(String(w))));
  const pair = (batch: number, txid: string, outputs: any[], balance_refunds: any[], strays?: any[]) =>
    maps.push(...[0, 1].map(w => signApprovalMap({ auction_id: fx.id, batch, txid, outputs, defaults: [], balance_refunds, ...(strays ? { strays } : {}) }, witnessPrivate(String(w)))));
  if (!opts.hideStrayRow) {
    rows.push({ party: strayParty(), kind: "refund", amount_zats: STRAY_VALUE, state: opts.strayPaid ? "paid" : "exception", ...(opts.strayPaid ? { batch: 2, txid: strayTx, output_index: 0 } : {}), pool: "ironwood" });
    if (opts.strayPaid) { receipts.push({ auction_id: fx.id, party: strayParty(), txid: strayTx, pool: "ironwood", output_index: 0, amount_zats: STRAY_VALUE }); pair(2, strayTx, [{ party: strayParty(), output_index: 0 }], [], [{ party: strayParty(), memo_sha256: hash(Buffer.from(STRAY_MEMO, "hex")) }]); }
  }
  const balances: any[] = [];
  if (opts.latePaid) {
    rows.push({ party: lateParty(), kind: "refund", amount_zats: LATE_VALUE, state: "paid", batch: 3, txid: TX_REFUND_L, output_index: 0, pool: "ironwood" });
    receipts.push({ auction_id: fx.id, party: lateParty(), txid: TX_REFUND_L, pool: "ironwood", output_index: 0, amount_zats: LATE_VALUE });
    balances.push({ party: lateParty(), leaf_index: 0, amount_zats: LATE_VALUE, state: "paid" });
    pair(3, TX_REFUND_L, [{ party: lateParty(), output_index: 0 }], [{ party: lateParty(), leaf_index: 0, amount_zats: LATE_VALUE }]);
  } else {
    rows.push({ party: lateParty(), kind: "refund", amount_zats: LATE_VALUE, state: "exception", pool: "ironwood" });
    balances.push({ party: lateParty(), leaf_index: 0, amount_zats: LATE_VALUE, state: "pending" });
  }
  const settlement: any = { rows, receipts, ignored: [], defaults: [], balance_refunds: balances, approval_maps: maps };
  if (opts.returned) {
    rows.push({ party: "reserve-return", kind: "payout", amount_zats: RESERVE_AMOUNT, state: "paid", batch: 4, txid: TX_RESERVE, output_index: 0, pool: "ironwood" });
    receipts.push({ auction_id: fx.id, party: "reserve-return", txid: TX_RESERVE, pool: "ironwood", output_index: 0, amount_zats: RESERVE_AMOUNT });
    pair(4, TX_RESERVE, [{ party: "reserve-return", output_index: 0 }], []);
    settlement.reserve_return = { remaining_zats: REMAINING, fee_zats: RESERVE_FEE };
  }
  if (opts.forged) {
    receipts.push({ auction_id: fx.id, party: "reserve-return", txid: TX_FORGED, pool: "ironwood", output_index: 0, amount_zats: RESERVE_AMOUNT });
    pair(5, TX_FORGED, [{ party: "reserve-return", output_index: 0 }], []);
  }
  if (opts.dropReceiptOf) { const at = receipts.findIndex(r => r.party === opts.dropReceiptOf); if (at >= 0) receipts.splice(at, 1); }
  return settlement;
};
const writeSettledDir = (dir: string, fx: Fixture, settlement: any, opts: { claims?: any[]; cancelled?: boolean } = {}) => {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  // B49: `cancelled` writes the CANCELLED public doc (no frozen set, no result — the packet shape proof case
  // (a) runs, where deriveRows runs no benzo verify); `claims` overrides the published claims (the crafted
  // envelope fixtures of proof case (e)).
  const claims = opts.claims ?? claimsFor(settlement);
  writeFileSync(path.join(dir, "auction.json"), jsonBytes({ version: 1, auction_id: fx.id, signer: fx.signer, manifest: fx.manifestPacket, state: opts.cancelled ? "CANCELLED" : "SETTLED",
    receipts: opts.cancelled ? [] : fx.receipts, ...(opts.cancelled ? { beacon: fx.beacon } : { frozen: fx.frozen, result: fx.result, opened: fx.opened, beacon: fx.beacon, witness_set: fx.witnessSet, witness_cert: fx.witnessCert }), envelopes: fx.envelopes,
    // R13: every claim-paid row carries its published claim (only the paid ones publish — the publisher
    // never publishes a pending row's claim).
    ...(claims.length ? { claims: publishedClaims(claims) } : {}),
    settlement }));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(fx.manifestPacket));
};

// ---- plan harness: the signer's own state dir (stub externals), the private ledger and the product config
// pointing at the published document (the plan then cross-checks its fresh openings and clearing against it).
// Two agreeing signed envelope-opens reports gate the leaf refunds exactly like a live settle. The ledger
// records the obligations batch as a mined batch, so the bid deposit shows spent and `no batch is pending`.
const writePlanState = (state: string, fx: Fixture, notes: any[], publicDir: string, opts: { confirmed?: string[] } = {}) => {
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, { ...fx, notes }, REAL_PCZT);
  const fixFile = path.join(state, "fixture.json");
  writeFileSync(fixFile, JSON.stringify({ ...JSON.parse(readFileSync(fixFile, "utf8")), internal_addresses: [CHANGE_ADDR, CHANGE2_ADDR] }));
  mkdirSync(path.join(state, "auction"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "auction", `${fx.id}.json`), jsonBytes({ manifest: fx.manifestPacket, signer: fx.signer, state: "SETTLED",
    leaves: fx.leaves, receipts: fx.receipts, frozen: fx.frozen, opened: fx.opened, result: fx.result, trace: [], beacon: fx.beacon, envelopes: fx.envelopes }));
  mkdirSync(path.join(state, "product"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "product", `${fx.id}.json`), jsonBytes({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 },
    routing: { bidders: [], seller_ua: UA_ORCHARD, fee_reserve_ua: FEE_RESERVE_UA, reserve_return_ua: UA_ORCHARD }, public_dir: publicDir }));
  const dest = hash(Buffer.from(UA_ORCHARD, "utf8"));
  mkdirSync(path.join(state, "settle", fx.id), { recursive: true, mode: 0o700 });
  for (const [n, w] of [["alice", "0"], ["bob", "1"]] as const) {
    const body = { signer: n, opens: fx.leaves.map((l: any) => ({ leaf: l.leaf_index, party: `leaf:${l.leaf_index}`, ok: true, dest_sha256: dest })) };
    writeFileSync(path.join(state, "settle", fx.id, `envelope-opens-${n}.json`), jsonBytes({ ...body, ...signOpensReport(body, witnessPrivate(w)) }));
  }
  // B49 ("paid" means approved AND mined): the coordinator's own settle ledger of PAID rows — one batch per
  // receipted txid, its rows confirmed exactly as the real worker confirms them. `confirmed` names the txids
  // its ledger actually confirmed; a receipted txid outside it (proof case (b): approved but never
  // broadcast) is only a staged batch, and its receipt must never count as paid.
  const receipts: any[] = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8")).settlement?.receipts ?? [];
  const confirmed = opts.confirmed ?? [...new Set(receipts.map((r: any) => r.txid))];
  const ledger = new Ledger(state, fx.id);
  for (const [i, txid] of confirmed.entries()) {
    const pczt = path.join(state, "settle", fx.id, `batch-${i + 1}.pczt`);
    writeFileSync(pczt, `b46 fixture batch ${txid}\n`);
    ledger.db.prepare("INSERT INTO batches(id,pczt_path,pczt_hash,txid,height,state) VALUES(?,?,?,?,'99500','staged')")
      .run(i + 1, pczt, createHash("sha256").update(readFileSync(pczt)).digest("hex"), txid);
    for (const r of receipts.filter((r: any) => r.txid === txid))
      ledger.db.prepare("INSERT INTO obligations(party,kind,amount_zats,state,batch,txid,output_index,pool) VALUES(?,?,?,?,?,?,?,?)")
        .run(r.party, r.party === "seller" || r.party === "reserve-return" ? "payout" : "refund", String(r.amount_zats), r.party === "seller" || r.party === "reserve-return" ? "paid" : "refunded", i + 1, txid, Number(r.output_index), String(r.pool ?? "ironwood"));
  }
  for (const [i, txid] of receipts.map((r: any) => r.txid).filter((t: string) => !confirmed.includes(t)).entries()) {
    const pczt = path.join(state, "settle", fx.id, `batch-dead-${i}.pczt`);
    writeFileSync(pczt, `b46 fixture staged-but-unmined batch ${txid}\n`);
    ledger.db.prepare("INSERT INTO batches(id,pczt_path,pczt_hash,txid,height,state) VALUES(?,?,?,?,NULL,'staged')")
      .run(100 + i, pczt, createHash("sha256").update(readFileSync(pczt)).digest("hex"), txid);
  }
  ledger.db.close();
};
const runPlan = (label: string, planBundle: string, fx: Fixture, notes: any[], publicDir: string, bnzRoot: string, opts: { confirmed?: string[] } = {}) => {
  const state = path.join(WORK, "state-plan-" + label);
  writePlanState(state, fx, notes, publicDir, opts);
  const r = spawnSync(process.execPath, [planBundle, fx.id], { input: "{}", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/", BNZ_ROOT: bnzRoot } });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed };
};

// ---- host-command harness (the real `sign build` / `sign approve` / `sign derivable` against the stub externals).
const hostEnv = (state: string) => ({ BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/" });
// B49 ("paid" means approved AND mined): this host's own approval ledger (approvals/<id>/ledger.json) —
// one entry per approved batch with its mapped outputs at their amounts. `approved` names the txids this
// host approved (empty for the fabricated-receipt world of proof case (a)); every source is written in the
// PRE-B49 namespaces exactly as an old ledger file has them, so a refusal against these entries is the
// migrate-on-read proof too.
const sourceFor = (fx: Fixture, party: string): string => {
  if (party === "seller" || party === "treasury") return party;
  if (party.startsWith("leaf:")) { const n = fx.notes[Number(party.slice(5))]; return `deposit:${n.txid}:ironwood:${n.action_index}`; }
  return party;
};
const seedApprovalLedger = (state: string, fx: Fixture, settlement: any, approved: string[] | null) => {
  const byTxid = new Map<string, any[]>();
  for (const r of (settlement?.receipts ?? []) as any[]) {
    if (approved && !approved.includes(r.txid)) continue;
    if (!byTxid.has(r.txid)) byTxid.set(r.txid, []);
    byTxid.get(r.txid)!.push(r);
  }
  const entries = [...byTxid].map(([txid, rs], i) => ({ batch: i + 1, txid, expiry_height: 100500, approved_tip: 99000,
    sources: [...new Set(rs.map(r => sourceFor(fx, r.party)))],
    mapped: rs.map(r => ({ party: r.party, output_index: Number(r.output_index), amount_zats: String(r.amount_zats) })) }));
  mkdirSync(path.join(state, "approvals", fx.id), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "approvals", fx.id, "ledger.json"), JSON.stringify(entries) + "\n", { mode: 0o600 });
};
const writeHostFixture = (label: string, fx: Fixture, notes: any[], opts: { settlement?: any; approved?: string[] } = {}) => {
  const state = path.join(WORK, "state-" + label);
  writeHostState(state, { ...fx, notes }, REAL_PCZT);
  const fixFile = path.join(state, "fixture.json");
  writeFileSync(fixFile, JSON.stringify({ ...JSON.parse(readFileSync(fixFile, "utf8")), internal_addresses: [CHANGE_ADDR, CHANGE2_ADDR] }));
  mkdirSync(path.join(state, "witness"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "witness", "alice.key"), witnessPrivate("0"), { mode: 0o600 });
  if (opts.settlement) seedApprovalLedger(state, fx, opts.settlement, opts.approved ?? null);
  return state;
};
const writePacket = (label: string, fx: Fixture, settlement: any, meta: any, rows?: any[], candidate?: { pays: string; amount: string; input_zats?: string }, opts: { claims?: any[]; cancelled?: boolean } = {}) => {
  const dir = path.join(WORK, "packet-" + label);
  writeSettledDir(path.join(dir, "public"), fx, settlement, opts);
  const full: any = { auction_id: fx.id, signer: fx.signer, seller_ua: UA_ORCHARD, reserve_return_ua: UA_ORCHARD, ...meta };
  if (rows) writeFileSync(path.join(dir, "rows.json"), jsonBytes(rows));
  // The recorded claim requests travel in the PACKET (deriveRows opens packet/claims.json); the published
  // doc carries the same claims (writeSettledDir). `opts.claims` overrides both (the crafted envelopes).
  writeFileSync(path.join(dir, "claims.json"), jsonBytes(opts.claims ?? claimsFor(settlement)));
  if (candidate) {
    const content = JSON.stringify({ rows: [{ recipient: candidate.pays, amount_zats: candidate.amount }], ...(candidate.input_zats !== undefined ? { input_zats: candidate.input_zats } : {}) });
    writeFileSync(path.join(dir, "candidate.pczt"), content);
    writeFileSync(path.join(dir, "sealed-alice.bin"), sealBlob(Buffer.from(content), fx.envelopeKeys[0].public_hex), { mode: 0o600 });
    full.batch = 1;
    full.plan_version = createHash("sha256").update(readFileSync(path.join(dir, "candidate.pczt"))).digest("hex");
  }
  writeFileSync(path.join(dir, "packet.json"), jsonBytes(full));
  return dir;
};
const sh = (benzo: string, args: string[], env: Record<string, string>) => {
  const r = spawnSync(process.execPath, [benzo, ...args], { input: "", encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const typedRefusal = (err: string) => /refused-rows \["reserve-return"\]/.test(err);
const createdRows = (state: string) => existsSync(path.join(state, "create-log.jsonl"))
  ? readFileSync(path.join(state, "create-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];

const beacon = await fetchBeacon(R);
const bound: Fixture = await buildAuction({ beacon, count: 1, fee_zats: "0", c_zats: "10000", bond: BOND, commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
const legacy: Fixture = await buildAuction({ beacon, count: 1, fee_zats: "0", c_zats: "10000", bond: BOND });
// The no-bond variant `auction create` consumes (a draft carrying balance addresses is refused — create
// generates them), for the commitment/create/mainnet rule cases only.
const plain: Fixture = await buildAuction({ beacon, count: 1, fee_zats: "0" });
// The stray deposit's own sealed-bid memo (a REAL tlock ciphertext to the pinned round) and the two owner-
// signed claims the refund batches were paid from (see claimFor above).
{
  const owner = strayOwner(createHash("sha256").update("b46-stray-depositor").digest("hex"));
  const envelopeCt = sealEnvelope(UA_ORCHARD, bound.envelopeKeys.map(k => k.public_hex), "test");
  const nonce = createHash("sha256").update("b46-stray-nonce").digest().subarray(0, 16).toString("hex");
  const pt = Buffer.alloc(128);
  Buffer.from(bound.id, "hex").copy(pt, 1); pt.writeBigUInt64BE(4000n, 33); pt.writeUInt32BE(1, 41);
  Buffer.from(nonce, "hex").copy(pt, 45); Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  Buffer.from(settlementCommitment(nonce, envelopeCt), "hex").copy(pt, 93);
  const armored = await timelockEncrypt(R, pt, publishedClient(beacon));
  const ct = Buffer.from(decodeArmor(armored), "binary");
  const memo = Buffer.alloc(512); Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
  STRAY_MEMO = memo.toString("hex");
  STRAY_CLAIM = claimFor(strayParty(), owner, STRAY_MEMO);
  LATE_CLAIM = claimFor(lateParty(), strayOwner(ownerPrivate("0")));
}

if (part === "before") {
  console.log("=== red on the BASE commit: the unused fee reserve is stranded (no command returns it)");
  // The base manifest schema refuses reserve_return_ua_commitment outright, so the red-before runs on the only
  // manifest the base can read — the pre-B46 legacy manifest (exactly what every earlier auction is), on the
  // settled world where the stray is refunded and the late balance paid: NOTHING is owed, yet no row returns
  // the vault's unspent value.
  const settled = settlementFor(legacy, { strayPaid: true, latePaid: true });
  const pubLegacy = path.join(WORK, "public-legacy");
  writeSettledDir(pubLegacy, legacy, settled);
  const notes = vaultNotes(legacy, { straySpent: TX_REFUND_S, lateSpent: TX_REFUND_L });
  const p = runPlan("red-legacy", BASE_PLAN, legacy, notes, pubLegacy, BASE);
  const amount = reserveReturnAmount(notes as any);
  check("red-plan-no-row-change-stranded", p.code === 0 && !!p.parsed && p.parsed.reserve_return === undefined,
    `the base plan settles everything and plans NO reserve-return row: ${amount.total_zats} zats of unspent vault value stay in the vault (${amount.ids.join(",")})`);
  const pubBound = path.join(WORK, "public-bound");
  writeSettledDir(pubBound, bound, settled);
  const b = runPlan("red-bound", BASE_PLAN, bound, vaultNotes(bound, { straySpent: TX_REFUND_S, lateSpent: TX_REFUND_L }), pubBound, BASE);
  check("red-plan-bound-manifest-unreadable", b.code !== 0 && /unknown or missing manifest field/.test(b.err),
    `the base manifest schema cannot even represent reserve_return_ua_commitment: ${(b.err || b.out).trim().split("\n").at(-1)?.slice(0, 120)}`);

  console.log("=== B49 red on the base commit 7c4e661: a published receipt is trusted as paid (P0-1/P2-2), and the prefetch throws (P1-1)");
  const settledB49 = settlementFor(bound, { strayPaid: true, latePaid: true });
  const settledNotesB49 = vaultNotes(bound, { straySpent: TX_REFUND_S, lateSpent: TX_REFUND_L });
  const buildReturn = (label: string, benzo: string, settlement: any, notes: any[], opts: { claims?: any[]; cancelled?: boolean; approved?: string[] } = {}) => {
    const amount = reserveReturnAmount(notes as any);
    const state = writeHostFixture(label, bound, notes, { settlement, ...(opts.approved !== undefined ? { approved: opts.approved } : {}) });
    const dir = writePacket(label, bound, settlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } },
      [{ party: "reserve-return", kind: "payout", amount_zats: amount.amount_zats }], undefined, { ...(opts.claims ? { claims: opts.claims } : {}), ...(opts.cancelled ? { cancelled: true } : {}) });
    const r = sh(benzo, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const built = existsSync(path.join(dir, "build.json")) ? JSON.parse(readFileSync(path.join(dir, "build.json"), "utf8")) : null;
    return { r, dir, amount, out: (built?.outputs ?? []).find((o: any) => o.party === "reserve-return") ?? null };
  };
  // (a) a CANCELLED auction with unclaimed strays plus FABRICATED packet receipts — no rows, no approval
  // maps, no chain reality needed. The base hosts build the sweeping return.
  {
    const notes = vaultNotes(bound, { depositsUnspent: true, changes: [], straySpent: null, lateSpent: null });
    const fabricated = { rows: [], ignored: [], defaults: [], balance_refunds: [], approval_maps: [],
      receipts: [
        { auction_id: bound.id, party: depositParty(bound.notes[0]), txid: hash("b46-fabricated-1"), pool: "ironwood", output_index: 0, amount_zats: String(bound.notes[0].value_zats) },
        { auction_id: bound.id, party: strayParty(), txid: hash("b46-fabricated-2"), pool: "ironwood", output_index: 0, amount_zats: STRAY_VALUE }] };
    const { r, out, amount } = buildReturn("a-fabricated-base", BASE49_BENZO, fabricated, notes, { cancelled: true, approved: [] });
    check("a-red-fabricated-receipts-build-the-sweep", r.code === 0 && !!out && out.amount_zats === amount.amount_zats,
      `the base hosts BUILD the return that sweeps the unclaimed strays (${out?.amount_zats} zats) on coordinator-fabricated receipts: exit ${r.code}, ${(r.err || r.out).trim().split("\n").filter((l: string) => /^ERROR/.test(l)).at(-1)?.slice(0, 160) ?? ""}`);
  }
  // (b) a cleared auction plus receipts of an approved but never-broadcast batch: the base hosts build and
  // the base plan plans the return on the dead batch's receipt.
  {
    const deadSettlement = settlementFor(bound, { strayPaid: true, strayTxid: DEAD_TXID, latePaid: true });
    const deadNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, changes: [TX_OBLIG, TX_REFUND_L] });
    const { r, out, amount } = buildReturn("b-dead-base", BASE49_BENZO, deadSettlement, deadNotes);
    check("b-red-dead-batch-receipt-builds-the-sweep", r.code === 0 && !!out && out.amount_zats === amount.amount_zats,
      `the base hosts BUILD the return on the never-broadcast batch's receipt (exit ${r.code}, ${out?.amount_zats} zats)`);
    const pubDead = path.join(WORK, "public-dead-base"); writeSettledDir(pubDead, bound, deadSettlement);
    const p = runPlan("dead-base", BASE49_PLAN, bound, deadNotes, pubDead, BASE49, { confirmed: [TX_OBLIG, TX_REFUND_L] });
    check("b-red-dead-batch-receipt-plans-the-return", p.code === 0 && !!p.parsed && !!p.parsed.reserve_return,
      `the base plan PLANS the return on the dead batch's receipt (${JSON.stringify(p.parsed?.reserve_return ?? null)})`);
  }
  // (c) a receipt whose transaction was mined and then reorged out (the stub scan drops its traces): the
  // base hosts still treat the row as paid and build the return.
  {
    const reorgSettlement = settlementFor(bound, { strayPaid: true, latePaid: true });
    const reorgNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, changes: [TX_OBLIG, TX_REFUND_L] });
    const { r, out } = buildReturn("c-reorg-base", BASE49_BENZO, reorgSettlement, reorgNotes);
    check("c-red-reorged-receipt-builds-the-sweep", r.code === 0 && !!out,
      `the base hosts BUILD the return although the refund's transaction was reorged out (exit ${r.code})`);
  }
  // (e) the reviewer's two crafted envelopes (empty refund; NUL and newline) in the packet's claims freeze
  // every host's sign derivable on the base.
  {
    const emptyRefund = await craftedEnvelope('{"v":2,"refund":""}', bound.envelopeKeys.map(k => k.public_hex));
    const nulRefund = await craftedEnvelope("a\u0000b\nc", bound.envelopeKeys.map(k => k.public_hex));
    const craftedClaims = [
      claimFor(strayParty(), strayOwner(createHash("sha256").update("b46-stray-depositor").digest("hex")), STRAY_MEMO, emptyRefund),
      claimFor(lateParty(), strayOwner(ownerPrivate("0")), undefined, nulRefund)];
    const state = writeHostFixture("e-crafted-base", bound, settledNotesB49, { settlement: settledB49 });
    const dir = writePacket("e-crafted-base", bound, settledB49, {}, undefined, undefined, { claims: craftedClaims });
    const r = sh(BASE49_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    check("e-red-crafted-envelopes-freeze-derivable", r.code !== 0 && /refused: destination|null bytes/.test(r.err),
      `one crafted record freezes sign derivable for every host: exit ${r.code}, ${(r.err || r.out).trim().split("\n").filter(l => /^ERROR/.test(l)).at(-1)?.slice(0, 140) ?? ""}`);
  }
  // (f) a cross-kind re-spend: the reserve sweep re-spends a note a live approved ordinary batch already
  // sources — the two source namespaces never collide on the base, so both candidates are approved.
  {
    const fNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, strayInput: true });
    const fSettlement = settlementFor(bound, { strayPaid: true, latePaid: true });
    const amount = reserveReturnAmount(fNotes as any);
    const state = writeHostFixture("f-cross-base", bound, fNotes, { settlement: fSettlement });
    const dir = writePacket("f-cross-base", bound, fSettlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } }, undefined, { pays: UA_ORCHARD, amount: amount.amount_zats! });
    const r = sh(BASE49_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const recorded = existsSync(path.join(state, "approvals", bound.id, "batch-1.json"));
    check("f-red-cross-kind-respend-approved", r.code === 0 && recorded,
      `the base hosts approve the sweep that re-spends a note a live ordinary batch already sources (the two namespaces never collide): exit ${r.code}, approval ${recorded ? "recorded" : "missing"}`);
  }
  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
} else {
  // ---- A. the commitment function and the manifest schema shape (unit) --------------------------------------
  {
    const independent = createHash("sha256").update("benzo-reserve-return-ua-v1\0" + UA_ORCHARD, "binary").digest("hex");
    const mine = reserveReturnUaCommitment(UA_ORCHARD);
    check("unit-commitment-known-answer", mine === independent && /^[0-9a-f]{64}$/.test(mine),
      `reserveReturnUaCommitment = ${mine} (independent sha256 over "benzo-reserve-return-ua-v1\\0" || utf8(ua) = ${independent})`);
    check("unit-commitment-domain-separated", mine !== sellerUaCommitment(UA_ORCHARD) && mine !== hash(UA_ORCHARD),
      "the return commitment is its own domain, distinct from the seller commitment and a bare address hash");
  }
  {
    const shapeCase = (id: string, patch: (m: any) => any, mustPass: boolean) => {
      const m = patch(JSON.parse(JSON.stringify(bound.manifest)));
      let verdict: string | null = null;
      try { validateManifest(m); } catch (e) { verdict = (e as Error).message; }
      check(id, mustPass ? verdict === null : verdict !== null && /reserve_return_ua_commitment|unknown or missing manifest field/.test(verdict),
        mustPass ? (verdict === null ? "accepted" : `unexpectedly refused: ${verdict}`) : `refused: ${verdict}`);
    };
    shapeCase("unit-shape-good", m => m, true);
    shapeCase("unit-shape-bad-length", m => ({ ...m, reserve_return_ua_commitment: "ab".repeat(31) }), false);
    shapeCase("unit-shape-uppercase-hex", m => ({ ...m, reserve_return_ua_commitment: "AB".repeat(32) }), false);
    shapeCase("unit-shape-extra-field", m => ({ ...m, reserve_return_ua: UA_ORCHARD }), false);
    shapeCase("unit-shape-legacy-omits", m => { delete m.reserve_return_ua_commitment; return m; }, true);
  }

  // ---- A2. the value-based amount and the "nothing is owed" gate (settle/deposits.ts) ----------------------
  {
    const notes = [
      { name: "reserve", txid: "aa".repeat(32), pool: "ironwood", action_index: 0, value_zats: 20000, spent_in_txid: null },
      { name: "change", txid: "bb".repeat(32), pool: "ironwood", action_index: 1, value_zats: 35000, spent_in_txid: null },
      { name: "spent-change", txid: "cc".repeat(32), pool: "ironwood", action_index: 0, value_zats: 40000, spent_in_txid: "dd".repeat(32) },
      { name: "zero", txid: "ee".repeat(32), pool: "ironwood", action_index: 2, value_zats: 0, spent_in_txid: null }];
    const amount = reserveReturnAmount(notes as any);
    check("rule-whole-unspent-value-minus-fee", amount.total_zats === "55000" && amount.fee_zats === "10000" && amount.amount_zats === "45000",
      `whole unspent value ${amount.total_zats} minus the ZIP-317 fee ${amount.fee_zats} = ${amount.amount_zats} (spent and zero-value notes stay behind: none exist — every unspent note is swept)`);
    check("rule-amount-inputs-are-every-unspent-note", JSON.stringify(amount.ids) === JSON.stringify(["bb".repeat(32) + ":ironwood:1", "aa".repeat(32) + ":ironwood:0"].sort()),
      `the transaction must spend every unspent note: ${JSON.stringify(amount.ids)}`);
    check("rule-fee-formula", reserveReturnFee(0) === 10000n && reserveReturnFee(1) === 10000n && reserveReturnFee(2) === 10000n && reserveReturnFee(3) === 15000n,
      "ZIP-317 fee of the one-row transaction: 5,000 x max(2, notes)");
    const tiny = reserveReturnAmount([{ txid: "ff".repeat(32), pool: "ironwood", action_index: 0, value_zats: 9999, spent_in_txid: null }] as any);
    check("rule-no-row-below-the-fee", tiny.amount_zats === null, "a vault worth less than its fee plans no row");
  }
  {
    const owed = [{ party: "leaf:0", amount_zats: "7000" }, { party: "seller", amount_zats: "3000" }];
    const rows = [{ party: "leaf:0", amount_zats: "7000", state: "paid" }, { party: "seller", amount_zats: "3000", state: "paid" }];
    const receipts = [{ party: "leaf:0", amount_zats: "7000" }, { party: "seller", amount_zats: "3000" }];
    check("gate-clean-accounting-passes", reserveReturnOutstanding({ owed, rows, receipts }).length === 0,
      "every owed row receipted, no exception rows, no pending balances: nothing outstanding");
    // The R103 property: an OWN-derived unpaid stray blocks the return even when the published accounting is
    // spotless (the coordinator hid the row) and even when its note is already spent (its value now in
    // internal change) — the receipt is what settles a stray, not the note's presence.
    const hidden = reserveReturnOutstanding({ owed: [...owed, { party: "deposit:" + STRAY_TXID + ":ironwood:0", amount_zats: STRAY_VALUE }], rows, receipts });
    check("gate-unclaimed-stray-blocks", hidden.length === 1 && hidden[0] === "deposit:" + STRAY_TXID + ":ironwood:0",
      `an unpaid stray blocks the return whether claimed or not — outstanding: ${JSON.stringify(hidden)}`);
    const exception = reserveReturnOutstanding({ owed, rows: [...rows, { party: "deposit:x", amount_zats: "1", state: "exception" }], receipts });
    check("gate-exception-row-blocks", exception.length === 1, "an unresolved exception row blocks the return");
    const pendingBalance = reserveReturnOutstanding({ owed, rows, receipts, balance_refunds: [{ party: "balance-late:0", amount_zats: "1", state: "pending" }] });
    check("gate-pending-balance-blocks", pendingBalance.length === 1, "a published unpaid balance refund blocks the return");
    const unReceipted = reserveReturnOutstanding({ owed, rows, receipts: receipts.slice(0, 1) });
    check("gate-unreceipted-row-blocks", unReceipted.length === 1 && unReceipted[0] === "seller", "a row without its receipt blocks the return");
    const pendingBatch = reserveReturnOutstanding({ owed, rows, receipts, pending_batches: 1 });
    check("gate-pending-batch-blocks", pendingBatch.length === 1, "a pending batch blocks the return");
  }

  // ---- B. green plan on the stray + unclaimed late-balance fixture: NO row, the waits line -----------------
  console.log("=== green plan on the stray + unclaimed late-balance fixture: the return waits");
  const outstanding = settlementFor(bound);
  const pubOutstanding = path.join(WORK, "public-outstanding");
  writeSettledDir(pubOutstanding, bound, outstanding);
  const p1 = runPlan("outstanding", GREEN_PLAN, bound, vaultNotes(bound), pubOutstanding, ROOT);
  check("plan-waits-no-row", p1.code === 0 && !!p1.parsed && p1.parsed.reserve_return === undefined,
    "the unclaimed stray and the unclaimed late-balance note plan NO reserve-return row");
  const waits = (p1.err.match(/^reserve return waits: \d+ outstanding \(strays\/balances\/exceptions\)$/m) ?? []);
  check("plan-waits-line", waits.length === 1 && /^reserve return waits: 2 outstanding/.test(waits[0]),
    `printed once: ${waits[0] ?? "(nothing)"}`);

  // ---- C. green plan: the stray refunded and the late balance paid → one return of the whole value − fee ---
  console.log("=== green plan: nothing owed → exactly one return of the whole unspent value minus the fee");
  const settled = settlementFor(bound, { strayPaid: true, latePaid: true });
  const pubSettled = path.join(WORK, "public-settled");
  writeSettledDir(pubSettled, bound, settled);
  const settledNotes = vaultNotes(bound, { straySpent: TX_REFUND_S, lateSpent: TX_REFUND_L });
  const p2 = runPlan("green", GREEN_PLAN, bound, settledNotes, pubSettled, ROOT);
  const rr = p2.parsed?.reserve_return ?? null;
  check("plan-completes", p2.code === 0 && !!p2.parsed, `the plan completed (exit ${p2.code})`);
  check("plan-one-reserve-return-row", !!rr && rr.party === "reserve-return" && rr.kind === "payout",
    `the plan has exactly one reserve-return row: ${rr ? JSON.stringify({ party: rr.party, kind: rr.kind }) : "(none)"}`);
  check("plan-amount-whole-value-minus-fee", !!rr && rr.amount_zats === RESERVE_AMOUNT && rr.remaining_zats === REMAINING && rr.fee_zats === RESERVE_FEE,
    `whole remaining value ${rr?.remaining_zats} minus the ZIP-317 fee ${rr?.fee_zats} = ${rr?.amount_zats} zats to the committed return UA (every unspent note, whatever its address)`);
  console.log(`OBSERVE plan-reserve-return ${JSON.stringify(rr)}`);

  // ---- D. green plan: a prior batch spent the stray's note (value in internal change) — still refused -----
  console.log("=== green plan: the stray's note swept into change is still an unpaid stray (R103's fungibility case)");
  // Every published row is receipted and the late balance is paid — the coordinator hid the stray row
  // entirely — and the stray's note is gone from the unspent set (a prior batch swept its 500,000 into
  // internal change). Only the own-scan stray rule (run without requiring a destination) still sees it.
  const sweptSettlement = settlementFor(bound, { hideStrayRow: true, latePaid: true });
  const pubSwept = path.join(WORK, "public-swept");
  writeSettledDir(pubSwept, bound, sweptSettlement);
  const p3 = runPlan("swept", GREEN_PLAN, bound, vaultNotes(bound, { straySpent: PRIOR_TXID, lateSpent: TX_REFUND_L, strayChange: true }), pubSwept, ROOT);
  check("plan-swept-stray-still-refused", p3.code === 0 && !!p3.parsed && p3.parsed.reserve_return === undefined,
    "the return is still refused while the stray is unpaid, although its note is spent and its value sits in internal change");
  const waits3 = (p3.err.match(/^reserve return waits: 1 outstanding \(strays\/balances\/exceptions\)$/m) ?? []);
  check("plan-swept-waits-line", waits3.length === 1, `printed once: ${waits3[0] ?? "(nothing)"}`);

  // ---- E. green plan on the legacy manifest: no row, one line ----------------------------------------------
  console.log("=== green plan on the legacy manifest: the reserve stays in the vault");
  const pubLegacy = path.join(WORK, "public-legacy-green");
  writeSettledDir(pubLegacy, legacy, settlementFor(legacy));
  const lp = runPlan("legacy", GREEN_PLAN, legacy, vaultNotes(legacy), pubLegacy, ROOT);
  check("plan-legacy-no-row", lp.code === 0 && !!lp.parsed && lp.parsed.reserve_return === undefined,
    "a legacy manifest (no reserve_return_ua_commitment) plans no reserve-return row");
  const legacyLine = (lp.err.match(/^WARN the reserve stays in the vault \(legacy, H15\).*$/m) ?? []);
  check("plan-legacy-line", legacyLine.length === 1, `printed once: ${legacyLine[0] ?? "(nothing)"}`);

  // ---- F. green: the hosts approve the planned row ----------------------------------------------------------
  console.log("=== green hosts: approve the reserve-return row the plan derived");
  const reserveRow = { party: "reserve-return", kind: "payout", amount_zats: RESERVE_AMOUNT };
  const reserveMeta = { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: RESERVE_AMOUNT } };
  {
    const state = writeHostFixture("honest-build", bound, settledNotes, { settlement: settled });
    const dir = writePacket("honest-build", bound, settled, reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const built = existsSync(path.join(dir, "build.json")) ? JSON.parse(readFileSync(path.join(dir, "build.json"), "utf8")) : null;
    const out = (built?.outputs ?? []).find((o: any) => o.party === "reserve-return");
    const paid = createdRows(state).map(x => x.recipient);
    check("sign-build-honest-passes", r.code === 0 && out && out.amount_zats === RESERVE_AMOUNT && paid.includes(UA_ORCHARD),
      `${r.code === 0 ? `built the reserve-return row (${out?.amount_zats} zats to the committed return UA; inspect input_zats = the scanned ${REMAINING})` : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }
  {
    const state = writeHostFixture("honest-derivable", bound, settledNotes, { settlement: settled });
    const dir = writePacket("honest-derivable", bound, settled, {});
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    let listed = false;
    try { listed = (JSON.parse(r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!).rows ?? []).some((x: any) => x.party === "reserve-return" && x.amount_zats === RESERVE_AMOUNT); } catch {}
    check("sign-derivable-honest-lists-row", r.code === 0 && listed,
      `${r.code === 0 && listed ? "lists the reserve-return row at the plan's amount" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }
  {
    const state = writeHostFixture("honest-approve", bound, settledNotes, { settlement: settled });
    const dir = writePacket("honest-approve", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT } }, undefined, { pays: UA_ORCHARD, amount: RESERVE_AMOUNT });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const recorded = existsSync(path.join(state, "approvals", bound.id, "batch-1.json"));
    check("sign-approve-honest-passes", r.code === 0 && recorded,
      `${r.code === 0 && recorded ? "recorded the approval of the single output to the committed return UA (input_zats = the scanned unspent total)" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }

  // ---- G. green: the hosts refuse the tampered candidates typedly -------------------------------------------
  console.log("=== green hosts: typed refusals (exit 3, named rows)");
  for (const [name, args, candidate] of [["build", ["sign", "build", "--id", bound.id, "--batch", "1"], false],
    ["approve", ["sign", "approve", "--id", bound.id, "--batch", "1"], true]] as [string, string[], boolean][]) {
    const state = writeHostFixture(`wrong-ua-${name}`, bound, settledNotes, { settlement: settled });
    const dir = writePacket(`wrong-ua-${name}`, bound, settled, reserveMeta, name === "build" ? [reserveRow] : undefined,
      candidate ? { pays: UA_SAPLING_ONLY, amount: RESERVE_AMOUNT } : undefined);
    const meta = JSON.parse(readFileSync(path.join(dir, "packet.json"), "utf8"));
    meta.reserve_return_ua = UA_SAPLING_ONLY;
    writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
    const r = sh(GREEN_BENZO, [...args, "--packet", dir, "--name", "alice"], hostEnv(state));
    check(`sign-${name}-wrong-return-ua-refused`, r.code === 3 && typedRefusal(r.err),
      `${r.code === 3 && typedRefusal(r.err) ? "typed refusal" : `exit ${r.code}, no typed refusal`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
    if (name === "build" && existsSync(path.join(dir, "build.json"))) fail(`sign-${name}-wrong-return-ua-no-build`, "build.json was written for a refused packet");
  }
  {
    const state = writeHostFixture("wrong-ua-derivable", bound, settledNotes, { settlement: settled });
    const dir = writePacket("wrong-ua-derivable", bound, settled, {});
    const meta = JSON.parse(readFileSync(path.join(dir, "packet.json"), "utf8"));
    meta.reserve_return_ua = UA_SAPLING_ONLY;
    writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    check("sign-derivable-wrong-return-ua-refused", r.code === 3 && typedRefusal(r.err),
      `${r.code === 3 && typedRefusal(r.err) ? "typed refusal" : `exit ${r.code}, no typed refusal`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    // R103's input check: a candidate whose inspect input_zats is below this signer's scanned unspent total
    // leaves notes behind (someone else can sweep them) — refused typedly.
    const state = writeHostFixture("low-input", bound, settledNotes, { settlement: settled });
    const dir = writePacket("low-input", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT } }, undefined, { pays: UA_ORCHARD, amount: RESERVE_AMOUNT, input_zats: "100" });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /input_zats 100 differs from this signer's scanned unspent total 57000/.test(r.err);
    check("sign-approve-input-below-scanned-total-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: input_zats below the scanned unspent total" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    // The output must be exactly the scanned total minus the fee — a candidate paying anything else is
    // refused typedly (the amount is the ONLY thing that can protect unclaimed value; R103).
    const state = writeHostFixture("wrong-amount", bound, settledNotes, { settlement: settled });
    const dir = writePacket("wrong-amount", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT } }, undefined, { pays: UA_ORCHARD, amount: "44999" });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /is not this signer's unspent total minus the fee/.test(r.err);
    check("sign-approve-output-not-total-minus-fee-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: the output differs from the scanned total minus the fee" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    // A return planned while something is still outstanding (the unclaimed stray + late balance world).
    const state = writeHostFixture("before-receipts", bound, vaultNotes(bound), { settlement: outstanding });
    const dir = writePacket("before-receipts", bound, outstanding, reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /still owes 2 outstanding \(strays\/balances\/exceptions\)/.test(r.err);
    check("sign-build-return-before-receipts-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: the auction still owes the unclaimed stray and late balance" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    const state = writeHostFixture("legacy-packet", legacy, vaultNotes(legacy));
    const dir = writePacket("legacy-packet", legacy, settlementFor(legacy), reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", legacy.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /legacy manifest/.test(r.err);
    check("sign-build-legacy-packet-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: a legacy manifest never plans the row" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }

  // ---- H. `auction create`: the commitment from routing, H4's receiver rule, the mainnet rule ----------------
  console.log("=== green auction create: the commitment and the mainnet rule");
  const createRun = (name: string, manifest: any, config: any) => {
    const state = path.join(WORK, "create-" + name);
    rmSync(state, { recursive: true, force: true });
    for (const d of [state, path.join(state, "product")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(state, "witness-set.json"), jsonBytes(bound.witnessSet));
    if (config) writeFileSync(path.join(state, "operator.json"), JSON.stringify(config));
    writeFileSync(path.join(state, "unsigned.json"), JSON.stringify(manifest));
    const r = sh(GREEN_BENZO, ["auction", "create", "--file", path.join(state, "unsigned.json"), "--witness-set", path.join(state, "witness-set.json"),
      ...(config ? ["--config", path.join(state, "operator.json")] : [])], { BNZ_STATE_DIR: state, BNZ_PCZT_BIN: REAL_PCZT });
    return { state, r };
  };
  const draftOf = (state: string) => JSON.parse(readFileSync(path.join(state, "product", `${bound.id}.draft.json`), "utf8")).manifest;
  const unbound = (m: any) => { const x = { ...m }; delete x.reserve_return_ua_commitment; return x; };
  const mainnet = (withCommitment: boolean) => ({ ...(withCommitment ? { ...plain.manifest, seller_ua_commitment: sellerUaCommitment(UA_ORCHARD), reserve_return_ua_commitment: reserveReturnUaCommitment(UA_ORCHARD) } : plain.manifest), network: "main",
    escrow_ua: "u1fixtureescrow000000000000000000000000000000000000000000000000000000",
    deposit_addresses: ["u1fixturedeposit00000000000000000000000000000000000000000000000000000"] });
  {
    const { state, r } = createRun("routing", unbound(plain.manifest), { settlement: {}, routing: { seller_ua: UA_ORCHARD, reserve_return_ua: UA_ORCHARD } });
    const committed = r.code === 0 ? draftOf(state).reserve_return_ua_commitment : null;
    check("create-sets-commitment-from-routing", r.code === 0 && committed === reserveReturnUaCommitment(UA_ORCHARD),
      `${r.code === 0 ? "set" : "did not set"} reserve_return_ua_commitment ${committed ?? "(none)"} (${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 100)})`);
  }
  {
    const { r } = createRun("sapling", unbound(plain.manifest), { settlement: {}, routing: { seller_ua: UA_ORCHARD, reserve_return_ua: UA_SAPLING_ONLY } });
    check("create-refuses-sapling-only-reserve-return-ua", r.code !== 0 && /Orchard\/Ironwood receiver \(H4\)/.test(r.err),
      `refused a Sapling-only reserve_return_ua (H4): ${(r.err || r.out).trim().split("\n").at(-1)}`);
  }
  {
    const { r } = createRun("main-unbound", mainnet(false), null);
    check("create-mainnet-requires-reserve-commitment", r.code !== 0 && /mainnet manifest must carry reserve_return_ua_commitment \(H15\)/.test(r.err),
      `mainnet create without reserve_return_ua_commitment refused: ${(r.err || r.out).trim().split("\n").at(-1)}`);
  }
  {
    const { r } = createRun("main-bound", mainnet(true), null);
    check("create-mainnet-with-commitment-passes-h15-rule", r.code !== 0 && !/reserve_return_ua_commitment \(H15\)/.test(r.err) && /manifest version\/network/.test(r.err),
      `passes the H15 rule, refused later by the network lock: ${(r.err || r.out).trim().split("\n").at(-1)}`);
  }

  // ---- I. `benzo verify`: the published result, the forged receipt, a return with something outstanding -----
  console.log("=== green verify: the published result, the forged receipt and the premature return");
  const verifyRun = (label: string, fx: Fixture, settlement: any) => {
    const dir = path.join(WORK, "verify-" + label), state = path.join(WORK, "verify-state-" + label);
    writeSettledDir(dir, fx, settlement);
    mkdirSync(state, { recursive: true, mode: 0o700 });
    return sh(GREEN_BENZO, ["verify", "--dir", dir, "--signer", fx.signer], { BNZ_STATE_DIR: state });
  };
  {
    const r = verifyRun("settled", bound, settled);
    check("verify-accepts-settled", r.code === 0 && !/^ERROR/m.test(r.err),
      `verify accepts the settled document (exit ${r.code})`);
    const rr = verifyRun("returned", bound, settlementFor(bound, { strayPaid: true, latePaid: true, returned: true }));
    check("verify-accepts-returned", rr.code === 0 && /^OK accounting-strays$/m.test(rr.out),
      `verify accepts the published reserve-return result (exit ${rr.code}); ${rr.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);
  }
  {
    const r = verifyRun("forged", bound, settlementFor(bound, { strayPaid: true, latePaid: true, returned: true, forged: true }));
    check("verify-refuses-forged-second-receipt", r.code !== 0 && /duplicate reserve-return receipt/.test(r.err),
      `a forged second reserve-return receipt is refused: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
    const early = verifyRun("early-return", bound, settlementFor(bound, { returned: true }));
    check("verify-refuses-return-with-outstanding", early.code !== 0 && /the reserve-return receipt while row .+ is still outstanding/.test(early.err),
      `a return with the unclaimed stray and late balance still outstanding is refused: ${(early.err || early.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
    const miss = verifyRun("missing-accounting", bound, (() => { const s = settlementFor(bound, { strayPaid: true, latePaid: true, returned: true }); delete s.reserve_return; return s; })());
    check("verify-refuses-receipt-without-accounting", miss.code !== 0 && /reserve-return row or receipt without the published reserve_return accounting/.test(miss.err),
      `a reserve-return receipt without its published accounting is refused: ${(miss.err || miss.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
  }

  // ---- J. B49: "paid" means this host approved it AND its own scan shows it mined 10 deep -----------
  console.log("=== B49 (a): a cancelled auction with unclaimed strays and FABRICATED receipts — the hosts refuse");
  {
    const notes = vaultNotes(bound, { depositsUnspent: true, changes: [], straySpent: null, lateSpent: null });
    const fabricated = { rows: [], ignored: [], defaults: [], balance_refunds: [], approval_maps: [],
      receipts: [
        { auction_id: bound.id, party: depositParty(bound.notes[0]), txid: hash("b46-fabricated-1"), pool: "ironwood", output_index: 0, amount_zats: String(bound.notes[0].value_zats) },
        { auction_id: bound.id, party: strayParty(), txid: hash("b46-fabricated-2"), pool: "ironwood", output_index: 0, amount_zats: STRAY_VALUE }] };
    const amount = reserveReturnAmount(notes as any);
    const state = writeHostFixture("a-fabricated", bound, notes, { settlement: fabricated, approved: [] });
    const dir = writePacket("a-fabricated", bound, fabricated, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } },
      [{ party: "reserve-return", kind: "payout", amount_zats: amount.amount_zats }], undefined, { cancelled: true });
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /still owes 2 outstanding/.test(r.err) && r.err.includes(strayParty()) && r.err.includes(depositParty(bound.notes[0]));
    check("a-fabricated-receipts-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal naming both unclaimed strays" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 200) ?? ""}`);
    if (existsSync(path.join(dir, "build.json"))) fail("a-fabricated-no-build", "build.json was written for the fabricated-receipt packet");
  }
  console.log("=== B49 (b): receipts of an approved but never-broadcast batch — the plan and the hosts refuse");
  {
    const deadSettlement = settlementFor(bound, { strayPaid: true, strayTxid: DEAD_TXID, latePaid: true });
    const deadNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, changes: [TX_OBLIG, TX_REFUND_L] });
    const amount = reserveReturnAmount(deadNotes as any);
    const state = writeHostFixture("b-dead", bound, deadNotes, { settlement: deadSettlement });
    const dir = writePacket("b-dead", bound, deadSettlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } },
      [{ party: "reserve-return", kind: "payout", amount_zats: amount.amount_zats }]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /still owes 1 outstanding/.test(r.err) && r.err.includes(strayParty());
    check("b-dead-batch-receipt-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal naming the stray the dead batch was to refund" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 200) ?? ""}`);
    const pubDead = path.join(WORK, "public-dead"); writeSettledDir(pubDead, bound, deadSettlement);
    const p = runPlan("dead", GREEN_PLAN, bound, deadNotes, pubDead, ROOT, { confirmed: [TX_OBLIG, TX_REFUND_L] });
    const waits = (p.err.match(/^reserve return waits: 1 outstanding \(strays\/balances\/exceptions\)$/m) ?? []);
    check("b-dead-batch-plan-waits", p.code === 0 && !!p.parsed && p.parsed.reserve_return === undefined && waits.length === 1,
      `the plan plans NO return on the dead batch's receipt (the coordinator's own ledger never confirmed it): ${waits[0] ?? "(no waits line)"}`);
  }
  console.log("=== B49 (c): a receipt whose transaction was reorged out — the row is outstanding again");
  {
    const reorgSettlement = settlementFor(bound, { strayPaid: true, latePaid: true });
    const reorgNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, changes: [TX_OBLIG, TX_REFUND_L] });
    const amount = reserveReturnAmount(reorgNotes as any);
    const state = writeHostFixture("c-reorg", bound, reorgNotes, { settlement: reorgSettlement });
    const dir = writePacket("c-reorg", bound, reorgSettlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } },
      [{ party: "reserve-return", kind: "payout", amount_zats: amount.amount_zats }]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /still owes 1 outstanding/.test(r.err) && r.err.includes(strayParty());
    check("c-reorged-receipt-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "the reorged refund's row is outstanding again and the return is refused" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 200) ?? ""}`);
  }
  console.log("=== B49 (d): honest receipts mined 10 deep proceed (the F section) — 9 deep refuses");
  {
    const shallowNotes = vaultNotes(bound, { straySpent: TX_REFUND_S, lateSpent: TX_REFUND_L, changesHeight: 99992 });
    const amount = reserveReturnAmount(shallowNotes as any);
    const state = writeHostFixture("d-shallow", bound, shallowNotes, { settlement: settled });
    const dir = writePacket("d-shallow", bound, settled, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } },
      [{ party: "reserve-return", kind: "payout", amount_zats: amount.amount_zats }]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    check("d-nine-deep-refused", r.code === 3 && typedRefusal(r.err) && /still owes 4 outstanding/.test(r.err),
      `a paying transaction 9 confirmations deep does not count yet (exit ${r.code}): ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  console.log("=== B49 (e): the two crafted envelopes never crash the prefetch; each crafted row is underivable");
  {
    const emptyRefund = await craftedEnvelope('{"v":2,"refund":""}', bound.envelopeKeys.map(k => k.public_hex));
    const nulRefund = await craftedEnvelope("a\u0000b\nc", bound.envelopeKeys.map(k => k.public_hex));
    const craftedClaims = [
      claimFor(strayParty(), strayOwner(createHash("sha256").update("b46-stray-depositor").digest("hex")), STRAY_MEMO, emptyRefund),
      claimFor(lateParty(), strayOwner(ownerPrivate("0")), undefined, nulRefund)];
    const rowsOf = (out: string) => { try { return (JSON.parse(out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!).rows ?? []) as any[]; } catch { return []; } };
    const stateClean = writeHostFixture("e-clean", bound, settledNotes, { settlement: settled });
    const dirClean = writePacket("e-clean", bound, settled, {});
    const clean = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dirClean, "--name", "alice"], hostEnv(stateClean));
    const state = writeHostFixture("e-crafted", bound, settledNotes, { settlement: settled });
    const dir = writePacket("e-crafted", bound, settled, {}, undefined, undefined, { claims: craftedClaims });
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    const cleanRows = rowsOf(clean.out), craftedRows = rowsOf(r.out);
    const proceeds = craftedRows.some((x: any) => x.party === "leaf:0") && craftedRows.some((x: any) => x.party === "reserve-return");
    const underivable = !craftedRows.some((x: any) => x.party === strayParty() || x.party === lateParty()) && cleanRows.some((x: any) => x.party === strayParty()) && cleanRows.some((x: any) => x.party === lateParty());
    check("e-crafted-envelopes-never-crash", r.code === 0 && clean.code === 0,
      `sign derivable completes on the crafted packet (exit ${r.code}) exactly like the clean one (exit ${clean.code})`);
    check("e-crafted-rows-underivable-batch-proceeds", proceeds && underivable,
      `each crafted row is underivable (${craftedRows.map((x: any) => x.party).join(", ") || "none"} listed) while the batch proceeds (the clean run lists ${cleanRows.map((x: any) => x.party).join(", ")})`);
  }
  console.log("=== B49 (f): a cross-kind re-spend is refused — the reserve sweep vs the ordinary batch's source note");
  {
    const fNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, strayInput: true });
    const fSettlement = settlementFor(bound, { strayPaid: true, latePaid: true });
    const amount = reserveReturnAmount(fNotes as any);
    const state = writeHostFixture("f-cross", bound, fNotes, { settlement: fSettlement });
    const dir = writePacket("f-cross", bound, fSettlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } }, undefined, { pays: UA_ORCHARD, amount: amount.amount_zats! });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const src = `${STRAY_TXID}:ironwood:0`;
    const named = r.err.includes(src) && /can still mine until/.test(r.err);
    check("f-cross-kind-respend-refused", r.code === 1 && named && !existsSync(path.join(state, "approvals", bound.id, "batch-1.json")),
      `${r.code === 1 && named ? `the sweep re-spending ${src} (the live ordinary batch's source, migrated from its pre-B49 namespace) is refused` : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 200) ?? ""}`);
  }
  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}
