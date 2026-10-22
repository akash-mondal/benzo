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
// Batch B51 (docs/design/phase7-b51-review-fixes.md, P3-3) extends section I with the reserve_return
// self-consistency tie (the fee must be the ZIP-317 fee for the PUBLISHED source count — the paying batch's
// published inspect inputs), red on the B51 base commit a107447 bundles via
// BNZ_B46_BENZO=tmp/b51/base-src/cli/dist/benzo.mjs BNZ_B46_PLAN=tmp/b51/base-src/settle/dist/plan.mjs
// (the whole green suite then runs against base: its only reds are the behaviour B51 changes) and green after.
//
// Batch B52 (docs/design/phase7-b52-return-fee.md) adds the tool-quote cases, red on the B52 base commit
// 59c863c (bundles under tmp/b52/base-src/, the same git-archive recipe) via the `before52` part and green
// after:
//   red/green (b): the candidate a wallet proposal with change produces — the reviewer's "nothing pins
//     fee_zats or no change output" class — is APPROVED by the base hosts and refused typedly (exit 3,
//     ["reserve-return"]) before signing after B52;
//   red/green (c): a vault holding a note the tool cannot spend (a Sapling note) — the base plan plans the
//     return anyway (its prediction counts the note) and every host build then dies; after, the plan
//     prints the typed waits line with the tool's own reason, plans no row, exit 0;
//   red/green (d): a published accounting doctored against the WRONG basis (fee +5,000 with a fifth
//     "source" and remaining +5,000) verifies on the base (B51's inputs.length tie) and is refused after
//     B52 (the fee must be the ZIP-317 fee of the paying inspect's ACTIONS, remaining its input_zats);
//   green: the plan quotes the cross-pool sweep at the real per-pool action count (3 Orchard sources +
//     1 Ironwood output = 3 + 2 padded actions), never the predicted 5,000 x max(2, 3) — the wrong
//     prediction the design's P2-1 removed (the design text says "20,000" for this shape; see the
//     case's note and STATUS-B Q1 — with each bundle padded to its 2-action floor it is 25,000).
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
//   B52's red legs (`node tmp/b46.mjs before52`) run the tool-quote cases against base bundles from the
//   B52 base commit 59c863c:
//     mkdir -p tmp/b52/base-src && git archive 59c863c | tar -x -C tmp/b52/base-src && ln -s $PWD/node_modules tmp/b52/base-src/node_modules
//     (cd tmp/b52/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild clear/cli.ts ... --outfile=clear/dist/cli.mjs)
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment, validateManifest } from "../../manifest/schema";
import { depositParty, reserveUnspent, reserveReturnOutstanding } from "../../settle/deposits";
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
if (part !== "before" && part !== "after" && part !== "before52") { console.error("usage: node tmp/b46.mjs before|after|before52"); process.exit(2); }
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
const GREEN_PLAN = process.env.BNZ_B46_PLAN ?? path.join(ROOT, "settle", "dist", "plan.mjs"),
  GREEN_BENZO = process.env.BNZ_B46_BENZO ?? path.join(ROOT, "cli", "dist", "benzo.mjs"); // B51: the red leg overrides these with the base a107447 bundles
// B52 (docs/design/phase7-b52-return-fee.md): the batch's own red base — 59c863c bundles (tmp/b52/base-src,
// the same git-archive recipe), driven by the `before52` part.
const BASE52 = path.join(ROOT, "tmp", "b52", "base-src");
const BASE52_PLAN = path.join(BASE52, "settle", "dist", "plan.mjs"),
  BASE52_BENZO = path.join(BASE52, "cli", "dist", "benzo.mjs");
if (part === "before52") for (const f of [BASE52_PLAN, BASE52_BENZO, path.join(BASE52, "clear", "dist", "cli.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the B52 base bundles first (see the header)`);
// B52: the base commit's prediction this batch REMOVES (5,000 x max(2, sourceCount) over the scanned
// unspent notes, settle/deposits.ts on the base) — kept here only to describe BASE behaviour in the red
// legs and to name the wrong number the tool's own quote replaces. The product no longer contains it.
const reserveBase = (notes: { txid: string; pool: string; action_index: number; value_zats: number | string; spent_in_txid?: string | null }[]) => {
  const unspent = notes.filter(n => (n.spent_in_txid ?? null) == null && BigInt(n.value_zats) > 0n);
  const total = unspent.reduce((s, n) => s + BigInt(n.value_zats), 0n);
  const fee = 5000n * BigInt(Math.max(2, unspent.length));
  return { total_zats: total.toString(), fee_zats: fee.toString(), amount_zats: total > fee ? (total - fee).toString() : null,
    ids: unspent.map(n => `${n.txid}:${n.pool}:${n.action_index}`).sort() };
};
// B52 (P3-8c): the fee rule the stub tool computes — per pool, max(spends, outputs), each bundle padded to
// at least 2 actions; fee 5,000 x max(2, total actions). Written here too so the cases can state the
// expected numbers independently of the stub.
const feeRule = (spendPools: string[], outPools: string[]): { actions: number; fee: number } => {
  const counts: Record<string, { s: number; o: number }> = {};
  for (const p of spendPools) { counts[p] ??= { s: 0, o: 0 }; counts[p].s++; }
  for (const p of outPools) { counts[p] ??= { s: 0, o: 0 }; counts[p].o++; }
  const actions = Object.values(counts).reduce((s, c) => s + (c.s + c.o > 0 ? Math.max(2, Math.max(c.s, c.o)) : 0), 0);
  return { actions, fee: 5000 * Math.max(2, actions) };
};
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
// B54 (Reviewer R round 5, P2-1): the wallet's note-selection rule. The vault's two 1,000-zat change
// notes are DUST — the pinned wallet never selects a note of 5,000 zats or less — so the sweep spends
// only the two spendable notes (20,000 + 35,000) and the residue (2 notes / 2,000 zats) stays in the
// vault, reported as dust_notes/dust_zats. The sweep's own figures: 55,000 swept at the 10,000 fee of
// its real shape (2 spends + 1 output, one pool = 2 actions) = 45,000 returned. The four-source figures
// above stay as the historical published accounting the verify cases replay (its pre-B54 two-key shape
// is still accepted, the R26 legacy rule).
const SPENDABLE = "55000", SWEEP_FEE = "10000", SWEEP_AMOUNT = "45000", DUST_NOTES = 2, DUST_ZATS = "2000";
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
// B52 (P2-1): the reviewer's cross-pool vault — the settled vault's unspent value is THREE ORCHARD notes
// (each paying batch's change landed in Orchard, so their txids are also the scan's mined evidence for the
// paid rule) and the committed return UA receives in Ironwood. The sweep then carries 3 Orchard + 1
// Ironwood bundle, each padded to its 2-action floor: 3 + 2 = 5 actions, 25,000 zats — where the base's
// prediction (5,000 x max(2, 3)) says 15,000.
const crossNotes = (fx: Fixture) => [
  ...fx.notes.map(n => ({ ...n, spent_in_txid: TX_OBLIG })),
  { txid: STRAY_TXID, height: 99100, pool: "ironwood", address: fx.manifest.deposit_addresses[0], diversifier_index: "7", action_index: 0, value_zats: 500000, memo_hex: STRAY_MEMO, spent_in_txid: TX_REFUND_S },
  { txid: RES_TXID, height: 99050, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: 20000, memo_hex: null, spent_in_txid: TX_REFUND_S },
  { txid: LATE_TXID, height: 99300, pool: "ironwood", address: BAL_ADDR, diversifier_index: "10", action_index: 0, value_zats: 499999, memo_hex: null, spent_in_txid: TX_REFUND_L },
  { txid: TX_OBLIG, height: 99600, pool: "orchard", address: CHANGE_ADDR, diversifier_index: "8", action_index: 0, value_zats: 50000, memo_hex: null, spent_in_txid: null },
  { txid: TX_REFUND_S, height: 99601, pool: "orchard", address: CHANGE_ADDR, diversifier_index: "8", action_index: 0, value_zats: 30000, memo_hex: null, spent_in_txid: null },
  { txid: TX_REFUND_L, height: 99602, pool: "orchard", address: CHANGE_ADDR, diversifier_index: "8", action_index: 0, value_zats: 15000, memo_hex: null, spent_in_txid: null }];

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
  // B51 (P3-3): every receipt's paying batch publishes its inspect — the real product's `settlement.batches`
  // shape — so `benzo verify` can tie the reserve_return fee to the published source count. The return
  // sweeps the vault's four unspent notes (20,000 + 35,000 + 1,000 + 1,000 = 57,000) and pays the ZIP-317
  // fee of a four-source transaction (5,000 x 4 = 20,000) — exactly the honest REMAINING/RESERVE_FEE.
  // B50 (H5) checks the published inspect against the real benzo-pczt shape, so the fixture carries
  // its fixed fields too. B52 (item 4): the inspect carries its `actions` — the real basis the fee is
  // tied to (per pool, max(spends, outputs), each bundle padded to at least 2): the sweep is 4 spends
  // and 1 output in one bundle = 4 actions = 20,000 zats.
  const realInspect = (txid: string) => ({ consensus_branch_id: "37a5165b", tx_version: 6, expiry_height: 100500, shielded_sighash: hash(jsonBytes("sighash:" + txid)) });
  const swept = [{ index: 0, pool: "ironwood", value_zats: 20000 }, { index: 1, pool: "ironwood", value_zats: 35000 },
    { index: 2, pool: "ironwood", value_zats: 1000 }, { index: 3, pool: "ironwood", value_zats: 1000 }];
  settlement.batches = [...new Set(receipts.map((r: any) => String(r.txid)))].map((txid, i) => ({ id: i + 1, pczt_hash: hash(jsonBytes(txid)), txid, height: 99500, state: "mined",
    inspect: { ...realInspect(txid), ...(txid === TX_RESERVE ? { inputs: swept, input_zats: 57000, output_zats: 37000, fee_zats: 20000, actions: 4, outputs: [{ index: 0, pool: "ironwood", is_change: false, amount_zats: String(RESERVE_AMOUNT) }] }
      : { inputs: [{ index: 0, pool: "ironwood", value_zats: 100000 }], input_zats: 100000, output_zats: 90000, fee_zats: 10000, actions: 2, outputs: [] }) } }));
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
const writePacket = (label: string, fx: Fixture, settlement: any, meta: any, rows?: any[], candidate?: { pays: string; amount: string; input_zats?: string; change_zats?: string; spends?: string[] }, opts: { claims?: any[]; cancelled?: boolean } = {}) => {
  const dir = path.join(WORK, "packet-" + label);
  writeSettledDir(path.join(dir, "public"), fx, settlement, opts);
  const full: any = { auction_id: fx.id, signer: fx.signer, seller_ua: UA_ORCHARD, reserve_return_ua: UA_ORCHARD, ...meta };
  if (rows) writeFileSync(path.join(dir, "rows.json"), jsonBytes(rows));
  // The recorded claim requests travel in the PACKET (deriveRows opens packet/claims.json); the published
  // doc carries the same claims (writeSettledDir). `opts.claims` overrides both (the crafted envelopes).
  writeFileSync(path.join(dir, "claims.json"), jsonBytes(opts.claims ?? claimsFor(settlement)));
  if (candidate) {
    // B52: a candidate may pin the wallet's change output (change_zats — the reviewer's "proposal with
    // change" class) and the notes it spends (spends), so a repro can hand a host any candidate shape.
    const content = JSON.stringify({ rows: [{ recipient: candidate.pays, amount_zats: candidate.amount }],
      ...(candidate.input_zats !== undefined ? { input_zats: candidate.input_zats } : {}),
      ...(candidate.change_zats !== undefined ? { change_zats: candidate.change_zats } : {}),
      ...(candidate.spends !== undefined ? { spends: candidate.spends } : {}) });
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
  const amount = reserveBase(notes as any);
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
    const amount = reserveBase(notes as any);
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
    // B54 (P2-1's stub rule): no dust note in this red world — the 1,000-zat change notes are never
    // wallet-selectable, and a dust note walls even the base toolchain on the total mismatch (the P2-1
    // wall, proven in tools/repro/b54-dust-and-sweep.ts). This leg is about the receipt hole.
    const deadNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, changes: [TX_OBLIG] });
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
    // B54: no dust note in this red world either (see (b)'s note).
    const reorgNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, changes: [TX_OBLIG] });
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
    // B54: no dust note in this red world either (see (b)'s note).
    const fNotes = vaultNotes(bound, { straySpent: null, lateSpent: TX_REFUND_L, strayInput: true, changes: [TX_OBLIG] });
    const fSettlement = settlementFor(bound, { strayPaid: true, latePaid: true });
    const amount = reserveBase(fNotes as any);
    const state = writeHostFixture("f-cross-base", bound, fNotes, { settlement: fSettlement });
    const dir = writePacket("f-cross-base", bound, fSettlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } }, undefined, { pays: UA_ORCHARD, amount: amount.amount_zats! });
    const r = sh(BASE49_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const recorded = existsSync(path.join(state, "approvals", bound.id, "batch-1.json"));
    check("f-red-cross-kind-respend-approved", r.code === 0 && recorded,
      `the base hosts approve the sweep that re-spends a note a live ordinary batch already sources (the two namespaces never collide): exit ${r.code}, approval ${recorded ? "recorded" : "missing"}`);
  }
  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
} else if (part === "before52") {
  console.log("=== B52 red on the base bundles (59c863c): the return's fee is PREDICTED, the hosts pin no shape, and the doc verifies on the wrong basis");
  const settled = settlementFor(bound, { strayPaid: true, latePaid: true });
  const settledNotes = vaultNotes(bound, { straySpent: TX_REFUND_S, lateSpent: TX_REFUND_L });
  const pubSettled = path.join(WORK, "public-settled52");
  writeSettledDir(pubSettled, bound, settled);
  {
    const cross = crossNotes(bound);
    const p = runPlan("cross-base", BASE52_PLAN, bound, cross, pubSettled, BASE52);
    const rr = p.parsed?.reserve_return ?? null;
    check("k1-red-predicted-fee", p.code === 0 && !!rr && rr.fee_zats === "15000" && rr.amount_zats === "80000",
      `the base plan predicts the fee from the source count (5,000 x max(2, 3) = 15,000) and pays ${rr?.amount_zats} of ${rr?.remaining_zats} — the tool's real fee for the cross-pool sweep is 25,000, so every host's build then dies untyped (P2-1's wall): ${p.code === 0 ? JSON.stringify(rr) : (p.err || p.out).trim().split("\n").at(-1)}`);
  }
  {
    const state = writeHostFixture("k2-change-base", bound, settledNotes, { settlement: settled });
    const dir = writePacket("k2-change-base", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT } }, undefined,
      { pays: UA_ORCHARD, amount: RESERVE_AMOUNT, change_zats: "5000", input_zats: REMAINING });
    const r = sh(BASE52_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const recorded = existsSync(path.join(state, "approvals", bound.id, "batch-1.json"));
    check("k2-red-change-candidate-approved", r.code === 0 && recorded,
      `the base hosts APPROVE the candidate that leaves 5,000 zats behind as change (the only shape check is input_zats) — the money would move and the kept accounting then throws post-broadcast: exit ${r.code}, approval ${recorded ? "recorded" : "missing"}`);
  }
  {
    const saplingNotes = settledNotes.map(n => n.txid === RES_TXID ? { ...n, pool: "sapling" } : n);
    const p = runPlan("unsweepable-base", BASE52_PLAN, bound, saplingNotes, pubSettled, BASE52);
    check("k3-red-plans-the-unsweepable-sweep", p.code === 0 && !!p.parsed?.reserve_return && p.parsed.reserve_return.amount_zats === "37000",
      `the base plan PLANS the return over the note the tool cannot spend (its prediction counts the Sapling note): ${p.code === 0 ? JSON.stringify(p.parsed?.reserve_return ?? null) : (p.err || p.out).trim().split("\n").at(-1)} — every host's build then dies untyped`);
  }  {
    const s = settlementFor(bound, { strayPaid: true, latePaid: true, returned: true });
    s.reserve_return = { remaining_zats: "62000", fee_zats: "25000" };
    const b = s.batches.find((x: any) => x.txid === TX_RESERVE);
    b.inspect.inputs.push({ index: 4, pool: "ironwood", value_zats: 5000 });
    const dir = path.join(WORK, "verify-doctored-base"), stateDir = path.join(WORK, "verify-state-doctored-base");
    writeSettledDir(dir, bound, s); mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const r = sh(BASE52_BENZO, ["verify", "--dir", dir, "--signer", bound.signer], { BNZ_STATE_DIR: stateDir });
    check("k4-red-doctored-verifies", r.code === 0 && !/^ERROR/m.test(r.err),
      `the base verifies a doctored accounting ((remaining, fee) +5,000 with a fifth "source") — B51's inputs.length tie locks in the wrong basis: exit ${r.code}`);
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

  // ---- A2. the scanned unspent value and the "nothing is owed" gate (settle/deposits.ts) ----------------
  {
    const notes = [
      { name: "reserve", txid: "aa".repeat(32), pool: "ironwood", action_index: 0, value_zats: 20000, spent_in_txid: null },
      { name: "change", txid: "bb".repeat(32), pool: "ironwood", action_index: 1, value_zats: 35000, spent_in_txid: null },
      { name: "spent-change", txid: "cc".repeat(32), pool: "ironwood", action_index: 0, value_zats: 40000, spent_in_txid: "dd".repeat(32) },
      { name: "zero", txid: "ee".repeat(32), pool: "ironwood", action_index: 2, value_zats: 0, spent_in_txid: null }];
    const unspent = reserveUnspent(notes as any);
    check("rule-whole-unspent-value", unspent.total_zats === "55000",
      `the vault's scanned unspent value is ${unspent.total_zats} (spent and zero-value notes stay behind: none exist — every unspent note is swept)`);
    check("rule-amount-inputs-are-every-unspent-note", JSON.stringify(unspent.ids) === JSON.stringify(["bb".repeat(32) + ":ironwood:1", "aa".repeat(32) + ":ironwood:0"].sort()),
      `the transaction must spend every unspent note: ${JSON.stringify(unspent.ids)}`);
    // B52 (P2-1): the fee is the TOOL's own (`benzo-pczt quote-sweep`), never the removed prediction
    // 5,000 x max(2, sourceCount) — reserveBase here is the BASE's behaviour only. The real rule (and the
    // stub's, P3-8c): per pool, max(spends, outputs), each bundle padded to at least 2 actions.
    const cross = feeRule(["orchard", "orchard", "orchard"], ["ironwood"]);
    check("rule-fee-is-the-tools-own", cross.actions === 5 && cross.fee === 25000 && reserveBase(notes as any).fee_zats === "10000",
      `the cross-pool sweep (3 Orchard sources + 1 Ironwood output) carries ${cross.actions} actions (${cross.fee} zats) against the base's prediction ${reserveBase(notes.map(n => ({ ...n, action_index: 0 }))).fee_zats} for 3 sources — the prediction is removed from the product`);
    check("rule-no-row-below-the-fee", reserveBase([{ txid: "ff".repeat(32), pool: "ironwood", action_index: 0, value_zats: 9999, spent_in_txid: null }] as any).amount_zats === null,
      "a vault worth less than its fee plans no row (base behaviour; the green plan gets the typed waits line from the tool's own quote)");
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
    // B57 (H22): no row is skipped by its name. A published row named `reserve-return` that is not paid and
    // receipted is outstanding like any other (before B57 the name alone hid it); a paid, receipted one is settled.
    const named = reserveReturnOutstanding({ owed, rows: [...rows, { party: "reserve-return", amount_zats: "500", state: "exception" }], receipts });
    check("gate-h22-named-row-not-skipped", named.length === 1 && named[0] === "reserve-return",
      `a published unpaid row named reserve-return — outstanding: ${JSON.stringify(named)}`);
    const paidReturn = reserveReturnOutstanding({ owed, rows: [...rows, { party: "reserve-return", amount_zats: "500", state: "paid" }], receipts: [...receipts, { party: "reserve-return", amount_zats: "500" }] });
    check("gate-h22-paid-return-settled", paidReturn.length === 0, `a paid, receipted return row is settled — outstanding: ${JSON.stringify(paidReturn)}`);
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
  check("plan-amount-whole-value-minus-fee", !!rr && rr.amount_zats === SWEEP_AMOUNT && rr.remaining_zats === SPENDABLE && rr.fee_zats === SWEEP_FEE && rr.dust_notes === DUST_NOTES && rr.dust_zats === DUST_ZATS,
    `whole SPENDABLE value ${rr?.remaining_zats} minus the ZIP-317 fee ${rr?.fee_zats} = ${rr?.amount_zats} zats to the committed return UA (every note the wallet can spend; the ${rr?.dust_notes} dust notes / ${rr?.dust_zats} zats stay in the vault and are reported as the residue)`);
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
  const reserveRow = { party: "reserve-return", kind: "payout", amount_zats: SWEEP_AMOUNT };
  const reserveMeta = { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: SWEEP_AMOUNT } };
  {
    const state = writeHostFixture("honest-build", bound, settledNotes, { settlement: settled });
    const dir = writePacket("honest-build", bound, settled, reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const built = existsSync(path.join(dir, "build.json")) ? JSON.parse(readFileSync(path.join(dir, "build.json"), "utf8")) : null;
    const out = (built?.outputs ?? []).find((o: any) => o.party === "reserve-return");
    const paid = createdRows(state).map(x => x.recipient);
    check("sign-build-honest-passes", r.code === 0 && out && out.amount_zats === SWEEP_AMOUNT && paid.includes(UA_ORCHARD),
      `${r.code === 0 ? `built the reserve-return row (${out?.amount_zats} zats to the committed return UA; inspect input_zats = the scanned spendable ${SPENDABLE})` : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }
  {
    const state = writeHostFixture("honest-derivable", bound, settledNotes, { settlement: settled });
    const dir = writePacket("honest-derivable", bound, settled, {});
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    let listed = false;
    try { listed = (JSON.parse(r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!).rows ?? []).some((x: any) => x.party === "reserve-return" && x.amount_zats === SWEEP_AMOUNT); } catch {}
    check("sign-derivable-honest-lists-row", r.code === 0 && listed,
      `${r.code === 0 && listed ? "lists the reserve-return row at the plan's amount" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }
  {
    const state = writeHostFixture("honest-approve", bound, settledNotes, { settlement: settled });
    const dir = writePacket("honest-approve", bound, settled, { reserve_row: { amount_zats: SWEEP_AMOUNT } }, undefined, { pays: UA_ORCHARD, amount: SWEEP_AMOUNT });
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
      candidate ? { pays: UA_SAPLING_ONLY, amount: SWEEP_AMOUNT } : undefined);
    const meta = JSON.parse(readFileSync(path.join(dir, "packet.json"), "utf8"));
    meta.reserve_return_ua = UA_SAPLING_ONLY;
    writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
    const r = sh(GREEN_BENZO, [...args, "--packet", dir, "--name", "alice"], hostEnv(state));
    check(`sign-${name}-wrong-return-ua-refused`, r.code === 3 && typedRefusal(r.err),
      `${r.code === 3 && typedRefusal(r.err) ? "typed refusal" : `exit ${r.code}, no typed refusal`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
    if (name === "build" && existsSync(path.join(dir, "build.json"))) fail(`sign-${name}-wrong-return-ua-no-build`, "build.json was written for a refused packet");
  }
  {
    // B51 (P2-1b, R107's rule re-aims this case): a derivable packet WITHOUT the declared return row is
    // never walled by the mismatch — every row is listed minus the return row, tagged refused_rows (before
    // B51 this case expected the wholesale refusal the P2-1b removed). A packet that DECLARES the return
    // row with the mismatched UA is still refused typedly.
    const state = writeHostFixture("wrong-ua-derivable", bound, settledNotes, { settlement: settled });
    const dir = writePacket("wrong-ua-derivable", bound, settled, {});
    const meta = JSON.parse(readFileSync(path.join(dir, "packet.json"), "utf8"));
    meta.reserve_return_ua = UA_SAPLING_ONLY;
    writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    let listed: any[] = [], refused: string[] = [];
    try { const doc = JSON.parse(r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!); listed = doc.rows ?? []; refused = doc.refused_rows ?? []; } catch {}
    check("sign-derivable-wrong-return-ua-lists-without-row", r.code === 0 && listed.length > 0 && !listed.some((x: any) => x.party === "reserve-return") && refused.includes("reserve-return"),
      `${r.code === 0 ? `lists ${listed.length} rows minus the reserve-return row, tagged refused_rows ${JSON.stringify(refused)}` : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
    const dir2 = writePacket("wrong-ua-derivable-row", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT } });
    const meta2 = JSON.parse(readFileSync(path.join(dir2, "packet.json"), "utf8"));
    meta2.reserve_return_ua = UA_SAPLING_ONLY;
    writeFileSync(path.join(dir2, "packet.json"), jsonBytes(meta2));
    const r2 = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir2, "--name", "alice"], hostEnv(state));
    check("sign-derivable-wrong-return-ua-refused", r2.code === 3 && typedRefusal(r2.err),
      `the packet that DECLARES the return row: ${r2.code === 3 && typedRefusal(r2.err) ? "typed refusal" : `exit ${r2.code}, no typed refusal`}: ${(r2.err || r2.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    // R103's input check: a candidate whose inspect input_zats is below this signer's scanned unspent total
    // leaves notes behind (someone else can sweep them) — refused typedly.
    const state = writeHostFixture("low-input", bound, settledNotes, { settlement: settled });
    const dir = writePacket("low-input", bound, settled, { reserve_row: { amount_zats: SWEEP_AMOUNT } }, undefined, { pays: UA_ORCHARD, amount: SWEEP_AMOUNT, input_zats: "100" });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /input_zats 100 differs from this signer's scanned unspent total 55000/.test(r.err);
    check("sign-approve-input-below-scanned-total-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: input_zats below the scanned unspent total" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    // B52 (item 2): the declared row amount must equal the candidate's single output (which equals input
    // minus the tool's fee) — a candidate paying anything else is refused typedly (the amount is the ONLY
    // thing that can protect unclaimed value; R103).
    const state = writeHostFixture("wrong-amount", bound, settledNotes, { settlement: settled });
    const dir = writePacket("wrong-amount", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT } }, undefined, { pays: UA_ORCHARD, amount: "44999" });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /the declared reserve-return amount 37000 differs from the candidate's single output 44999/.test(r.err);
    check("sign-approve-output-not-total-minus-fee-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: the candidate's output is not the declared sweep amount" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
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
  {
    // B51 (P3-3): the self-consistency tie — fee_zats must be the ZIP-317 fee for the PUBLISHED source count
    // (the paying batch's inspect inputs). The reviewer's doctored pair (remaining and fee both +5,000: the
    // difference preserved, the fee still merely ZIP-317-shaped) is refused; on base a107447 it verifies.
    const doctored = verifyRun("doctored", bound, (() => { const s = settlementFor(bound, { strayPaid: true, latePaid: true, returned: true });
      s.reserve_return = { remaining_zats: String(BigInt(REMAINING) + 5000n), fee_zats: String(BigInt(RESERVE_FEE) + 5000n) }; return s; })());
    check("verify-refuses-doctored-accounting", doctored.code !== 0 && /not the ZIP-317 fee for the paying batch's published action count/.test(doctored.err),
      `a (remaining+5000, fee+5000) accounting is refused against the paying batch's published action count (4 actions, fee ${RESERVE_FEE}; B52 moved the tie from the source count to the real basis): ${(doctored.err || doctored.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
    const noCount = verifyRun("no-source-count", bound, (() => { const s = settlementFor(bound, { strayPaid: true, latePaid: true, returned: true }); delete s.batches; return s; })());
    check("verify-refuses-return-without-source-count", noCount.code !== 0 && /no published source count/.test(noCount.err),
      `a reserve_return accounting with no published source count is refused (fail-closed): ${(noCount.err || noCount.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
  }

  // ---- J. B49: "paid" means this host approved it AND its own scan shows it mined 10 deep -----------
  console.log("=== B49 (a): a cancelled auction with unclaimed strays and FABRICATED receipts — the hosts refuse");
  {
    const notes = vaultNotes(bound, { depositsUnspent: true, changes: [], straySpent: null, lateSpent: null });
    const fabricated = { rows: [], ignored: [], defaults: [], balance_refunds: [], approval_maps: [],
      receipts: [
        { auction_id: bound.id, party: depositParty(bound.notes[0]), txid: hash("b46-fabricated-1"), pool: "ironwood", output_index: 0, amount_zats: String(bound.notes[0].value_zats) },
        { auction_id: bound.id, party: strayParty(), txid: hash("b46-fabricated-2"), pool: "ironwood", output_index: 0, amount_zats: STRAY_VALUE }] };
    const amount = reserveBase(notes as any);
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
    const amount = reserveBase(deadNotes as any);
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
    const amount = reserveBase(reorgNotes as any);
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
    const amount = reserveBase(shallowNotes as any);
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
    const amount = reserveBase(fNotes as any);
    const state = writeHostFixture("f-cross", bound, fNotes, { settlement: fSettlement });
    const dir = writePacket("f-cross", bound, fSettlement, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: amount.amount_zats } }, undefined, { pays: UA_ORCHARD, amount: amount.amount_zats! });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const src = `${STRAY_TXID}:ironwood:0`;
    const named = r.err.includes(src) && /can still mine until/.test(r.err);
    check("f-cross-kind-respend-refused", r.code === 1 && named && !existsSync(path.join(state, "approvals", bound.id, "batch-1.json")),
      `${r.code === 1 && named ? `the sweep re-spending ${src} (the live ordinary batch's source, migrated from its pre-B49 namespace) is refused` : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 200) ?? ""}`);
  }

  // ---- K. B52: the tool's own quote and the candidate checks (docs/design/phase7-b52-return-fee.md) ------
  console.log("=== B52 (k1): the plan quotes the cross-pool sweep at the tool's own fee (P2-1)");
  {
    // The reviewer's cross-pool vault: THREE ORCHARD unspent notes, the committed return UA receives in
    // Ironwood. The sweep carries 3 Orchard + 1 Ironwood bundle, each padded to its 2-action floor:
    // 3 + 2 = 5 actions, 25,000 zats. NOTE (STATUS-B Q1): the design text says "20,000" for this shape
    // (the reviewer's unpadded arithmetic 3 + 1); with "each bundle padded to at least 2" — the rule P3-8c
    // spells and the pinned builder enforces (the H15 live inspect shows a 1-spend 1-output sweep at
    // actions 2) — it is 25,000. The mismatch the batch fixes (the prediction 15,000 vs the tool's fee) is
    // the same either way.
    const cross = crossNotes(bound);
    const p = runPlan("cross", GREEN_PLAN, bound, cross, pubSettled, ROOT);
    const rr = p.parsed?.reserve_return ?? null;
    check("k1-plan-quotes-the-tools-fee", p.code === 0 && !!rr && rr.fee_zats === "25000" && rr.amount_zats === "70000" && rr.remaining_zats === "95000",
      `the plan quotes the sweep at ${rr?.fee_zats} zats (3 Orchard spends + 1 Ironwood output = 3 + 2 padded actions), paying ${rr?.amount_zats} of ${rr?.remaining_zats} — not the predicted ${reserveBase(cross as any).fee_zats}`);
    check("k1-prediction-differs", reserveBase(cross as any).fee_zats === "15000" && rr?.fee_zats !== "15000",
      "the removed prediction would have said 15,000 zats — the cross-pool mismatch P2-1 is about");
    console.log(`OBSERVE k1-quote ${JSON.stringify(rr)} (the design text says 20,000 for this shape; see STATUS-B Q1)`);
  }
  console.log("=== B52 (b/k2): a wallet proposal with change is refused typedly before signing");
  {
    // The candidate a wallet proposal with change produces — the reviewer's "nothing pins fee_zats or no
    // change output" class (the base hosts approve it; the before52 leg shows that). The change output
    // reports is_change true with no recipient, exactly like the real inspect's owned-change shape.
    const state = writeHostFixture("k2-change", bound, settledNotes, { settlement: settled });
    const dir = writePacket("k2-change", bound, settled, { reserve_row: { amount_zats: SWEEP_AMOUNT } }, undefined,
      { pays: UA_ORCHARD, amount: SWEEP_AMOUNT, change_zats: "5000", input_zats: SPENDABLE });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /must pay exactly one output, not change/.test(r.err);
    check("k2-change-candidate-refused", r.code === 3 && typedRefusal(r.err) && named && !existsSync(path.join(state, "approvals", bound.id, "batch-1.json")),
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal before signing: the candidate would leave value behind as change" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    // The same wall through `sign build`: the packet declares 1 zat below the quote, the wallet's proposal
    // adds 1 zat of change, and the build refuses typedly before anything is signed.
    const state = writeHostFixture("k2-build-change", bound, settledNotes, { settlement: settled });
    const dir = writePacket("k2-build-change", bound, settled, { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: "36999" } },
      [{ party: "reserve-return", kind: "payout", amount_zats: "36999" }]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /must pay exactly one output, not change/.test(r.err);
    check("k2-build-change-refused", r.code === 3 && typedRefusal(r.err) && named && !existsSync(path.join(dir, "build.json")),
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal before signing: the wallet's proposal would add change at a declared amount below the quote" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  console.log("=== B52 (c/k3): a vault the tool cannot sweep — the typed waits line, no row, exit 0");
  {
    const saplingNotes = settledNotes.map(n => n.txid === RES_TXID ? { ...n, pool: "sapling" } : n);
    const p = runPlan("unsweepable", GREEN_PLAN, bound, saplingNotes, pubSettled, ROOT);
    const waits = (p.err.match(/^reserve return waits: the vault's value cannot be swept in one transaction \(.*\)$/m) ?? []);
    check("k3-unsweepable-waits-line", p.code === 0 && !!p.parsed && p.parsed.reserve_return === undefined && waits.length === 1 && /sapling note/.test(waits[0]),
      `the tool refuses the note it cannot spend and the plan prints the typed waits line — no row, exit 0: ${waits[0] ?? "(nothing)"}`);
    // B54 (P2-1): the tiny world's one note is 6,000 zats — spendable (> 5,000) but below its 10,000 fee,
    // so the tool's own InsufficientFunds class is what the waits line carries (a note of 5,000 zats or
    // less would read "no spendable note" instead: it is dust, never selected).
    const tinyNotes = settledNotes.map(n => (n.spent_in_txid ?? null) === null ? { ...n, value_zats: n.txid === RES_TXID ? 6000 : 0 } : n);
    const t = runPlan("tiny", GREEN_PLAN, bound, tinyNotes, pubSettled, ROOT);
    const waits2 = (t.err.match(/^reserve return waits: the vault's value cannot be swept in one transaction \(.*\)$/m) ?? []);
    check("k3-below-fee-waits-line", t.code === 0 && !!t.parsed && t.parsed.reserve_return === undefined && waits2.length === 1 && /InsufficientFunds/.test(waits2[0]),
      `a vault whose value cannot cover the fee also plans no row and prints the waits line: ${waits2[0] ?? "(nothing)"}`);
  }
  console.log("=== B52 (d/k4): a doctored published fee_zats or remaining_zats is refused");
  {
    const doctorRun = (id: string, doctor: (s: any) => void, want: RegExp) => {
      const s = settlementFor(bound, { strayPaid: true, latePaid: true, returned: true });
      doctor(s);
      const dir = path.join(WORK, "verify-" + id), stateDir = path.join(WORK, "verify-state-" + id);
      writeSettledDir(dir, bound, s); mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      const r = sh(GREEN_BENZO, ["verify", "--dir", dir, "--signer", bound.signer], { BNZ_STATE_DIR: stateDir });
      const line = (r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? "";
      check(id, r.code !== 0 && want.test(r.err), `verify refuses: ${line}`);
    };
    doctorRun("k4-fee-doctored", s => { s.reserve_return.fee_zats = "25000"; }, /not the ZIP-317 fee for the paying batch's published action count/);
    doctorRun("k4-remaining-doctored", s => { s.reserve_return.remaining_zats = "62000"; }, /remaining value differs from the paying batch's published input_zats/);
    const honest = verifyRun("k4-honest", bound, settlementFor(bound, { strayPaid: true, latePaid: true, returned: true }));
    check("k4-honest-still-verifies", honest.code === 0 && /^OK accounting-strays$/m.test(honest.out),
      `the honest published result still verifies (exit ${honest.code})`);
  }
  console.log("=== B52 (k5): the real benzo-pczt quote-sweep — a fixture wallet cannot exist offline (STATUS-B)");
  {
    // The design asks for one real-tool case "if the real benzo-pczt can run quote-sweep offline against a
    // fixture wallet". It cannot: a zcash_client_sqlite wallet only holds notes after a lightwalletd sync,
    // which is forbidden offline. What CAN be pinned offline is the shipped binary itself: the command
    // exists at the design's flags and surfaces the tool's own error (the typed waits line's reason source).
    const r = spawnSync(REAL_PCZT, ["quote-sweep", "--wallet", path.join(WORK, "no-such-wallet"), "--to", UA_ORCHARD, "--network", "test"], { encoding: "utf8" });
    check("k5-real-tool-surface", r.status === 1 && /unable to open database file/.test(String(r.stderr ?? "")),
      `the real quote-sweep (settle/target/release/benzo-pczt) refuses a wallet it cannot open with its own error (exit ${r.status}): ${String(r.stderr ?? "").trim().split("\n").at(-1)?.slice(0, 120)}`);
  }
  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}
