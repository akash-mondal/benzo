// B46 (docs/design/phase7-b46-reserve-return.md): return the unused fee reserve (H15, the mainnet blocker).
// Red on the BASE commit's bundles under tmp/b46/base-src/ (built ONCE from the pristine base commit before any
// B46 edit), green after, for each of the design's proof cases — all offline on the h-fixtures machinery (a small
// but REAL auction document: real tlock ciphertexts to quicknet round 32704232, a signed manifest, the frozen
// set, witness certificates, envelope records and a cleared result `benzo verify` re-derives; the offline
// externals are stubbed, every product decision runs the real shipped code):
//   red (base): the plan on a settled fixture whose vault holds the fee-reserve change plans NO row — the
//     change is stranded (and the base manifest schema cannot even represent reserve_return_ua_commitment);
//   green: the plan has exactly one `reserve-return` row whose sources are the reserve change ONLY (the stray
//     deposit and the unclaimed late-balance note are untouched);
//   green: the hosts approve it (`sign build`, `sign derivable`, `sign approve`);
//   green: the hosts refuse typedly (exit 3, named rows) a packet with a different return UA, a packet that
//     adds the stray as a source, a return planned before all obligation receipts exist, and a legacy packet;
//   green: a legacy manifest plans no row and prints the one "the reserve stays in the vault (legacy, H15)" line;
//   green: `auction create --config` sets the commitment from routing.reserve_return_ua (H4's receiver rule)
//     and mainnet create refuses a manifest without it;
//   green: `benzo verify` accepts the published result and refuses a forged second `reserve-return` receipt.
//
// Build+run:
//   npx esbuild tools/repro/b46-reserve-return.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b46.mjs
//   (base bundles under tmp/b46/base-src/, built ONCE from the pristine base commit before any B46 edit:
//     mkdir -p tmp/b46/base-src && git archive 8e39c14 | tar -x -C tmp/b46/base-src && ln -s $PWD/node_modules tmp/b46/base-src/node_modules
//     (cd tmp/b46/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild clear/cli.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=clear/dist/cli.mjs)
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli)
//   node tmp/b46.mjs before && node tmp/b46.mjs after
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment, validateManifest } from "../../manifest/schema";
import { depositParty, reserveReturnFee, reserveReturnSources, reserveSourceId } from "../../settle/deposits";
import { modeEntry } from "../../clear/registry";
import { signApprovalMap, signOpensReport } from "../../witness";
import { sealBlob } from "../../envelope";
import { buildAuction, fetchBeacon, needRealPczt, witnessPrivate, UA_ORCHARD, UA_SAPLING_ONLY, writeHostState, type Fixture } from "./h-fixtures";

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
const GREEN_PLAN = path.join(ROOT, "settle", "dist", "plan.mjs"), GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
for (const f of [BASE_PLAN, BASE_BENZO, path.join(BASE, "clear", "dist", "cli.mjs")]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
for (const f of [GREEN_PLAN, GREEN_BENZO]) if (part === "after" && !existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);

// ---- the fixture: a settled uniform auction whose vault holds the fee-reserve change, a stray deposit and an
// unclaimed late-balance note (the R42 note-class owners may still claim; there is no claim deadline). The
// late note sits at its own vault address (this fixture has no bond block; the unit rule case below covers the
// bond balance-address exclusion literally).
const R = 32704232;
const FEE_RESERVE_UA = "utest1b46feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b46internalchangeaddress00000000000000000000000000000000000";
const LATE_ADDR = "utest1b46latebalanceaddress00000000000000000000000000000000000000";
const STRAY_TXID = hash("b46-stray-deposit"), CHANGE_TXID = hash("b46-reserve-change"), LATE_TXID = hash("b46-late-balance");
const STRAY_ID = `${STRAY_TXID}:ironwood:0`, CHANGE_ID = `${CHANGE_TXID}:ironwood:0`, LATE_ID = `${LATE_TXID}:ironwood:0`;
const RESERVE_AMOUNT = "25000", RESERVE_ELIGIBLE = "35000", RESERVE_FEE = "10000";
const TX_OBLIG = hash("b46-batch-obligations"), TX_RESERVE = hash("b46-batch-reserve-return"), TX_FORGED = hash("b46-batch-forged");
const vaultNotes = (fx: Fixture) => [...fx.notes,
  { txid: STRAY_TXID, height: 99100, pool: "ironwood", address: fx.manifest.deposit_addresses[0], diversifier_index: "7", action_index: 0, value_zats: 500000, memo_hex: null, spent_in_txid: null },
  { txid: CHANGE_TXID, height: 99200, pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "8", action_index: 0, value_zats: 35000, memo_hex: null, spent_in_txid: null },
  { txid: LATE_TXID, height: 99300, pool: "ironwood", address: LATE_ADDR, diversifier_index: "9", action_index: 0, value_zats: 499999, memo_hex: null, spent_in_txid: null }];
const obligationRows = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)].map(([party, amount_zats]) => ({ party, amount_zats }));

// The settled settlement the fixture's public dir carries: every obligation row receipted (one batch), the
// stray deposit parked as its exception row, and — for the returned variant — the one `reserve-return` row,
// receipt and published accounting (counts and amounts only; the destination itself is never published).
const settlementFor = (fx: Fixture, opts: { returned?: boolean; forged?: boolean; dropReceiptOf?: string } = {}) => {
  const obs = obligationRows(fx);
  const rows: any[] = obs.map((o, i) => ({ party: o.party, kind: o.party === "seller" ? "payout" : "refund", amount_zats: o.amount_zats, state: "paid", batch: 1, txid: TX_OBLIG, output_index: i, pool: "ironwood" }));
  const receipts: any[] = obs.map((o, i) => ({ auction_id: fx.id, party: o.party, txid: TX_OBLIG, pool: "ironwood", output_index: i, amount_zats: o.amount_zats }));
  rows.push({ party: depositParty(vaultNotes(fx)[3] as any), kind: "refund", amount_zats: "500000", state: "exception" });
  const maps: any[] = [0, 1].map(w => signApprovalMap({ auction_id: fx.id, batch: 1, txid: TX_OBLIG, outputs: obs.map((o, i) => ({ party: o.party, output_index: i })), defaults: [], balance_refunds: [] }, witnessPrivate(String(w))));
  const settlement: any = { rows, receipts, ignored: [], approval_maps: maps };
  if (opts.dropReceiptOf) { const at = receipts.findIndex(r => r.party === opts.dropReceiptOf); if (at >= 0) receipts.splice(at, 1); }
  if (opts.returned) {
    rows.push({ party: "reserve-return", kind: "payout", amount_zats: RESERVE_AMOUNT, state: "paid", batch: 2, txid: TX_RESERVE, output_index: 0, pool: "ironwood" });
    receipts.push({ auction_id: fx.id, party: "reserve-return", txid: TX_RESERVE, pool: "ironwood", output_index: 0, amount_zats: RESERVE_AMOUNT });
    maps.push(...[0, 1].map(w => signApprovalMap({ auction_id: fx.id, batch: 2, txid: TX_RESERVE, outputs: [{ party: "reserve-return", output_index: 0 }], defaults: [], balance_refunds: [] }, witnessPrivate(String(w)))));
    settlement.reserve_return = { sources: 1, eligible_zats: RESERVE_ELIGIBLE, fee_zats: RESERVE_FEE };
  }
  if (opts.forged) {
    receipts.push({ auction_id: fx.id, party: "reserve-return", txid: TX_FORGED, pool: "ironwood", output_index: 0, amount_zats: RESERVE_AMOUNT });
    maps.push(...[0, 1].map(w => signApprovalMap({ auction_id: fx.id, batch: 3, txid: TX_FORGED, outputs: [{ party: "reserve-return", output_index: 0 }], defaults: [], balance_refunds: [] }, witnessPrivate(String(w)))));
  }
  return settlement;
};
const writeSettledDir = (dir: string, fx: Fixture, settlement: any) => {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "auction.json"), jsonBytes({ version: 1, auction_id: fx.id, signer: fx.signer, manifest: fx.manifestPacket, state: "SETTLED",
    receipts: fx.receipts, frozen: fx.frozen, result: fx.result, opened: fx.opened, beacon: fx.beacon,
    witness_set: fx.witnessSet, witness_cert: fx.witnessCert, envelopes: fx.envelopes, settlement }));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(fx.manifestPacket));
};

// ---- plan harness: the signer's own state dir (stub externals), the private ledger and the product config
// pointing at the published document (the plan then cross-checks its fresh openings and clearing against it).
// Two agreeing signed envelope-opens reports gate the leaf refunds exactly like a live settle.
const writePlanState = (state: string, fx: Fixture, notes: any[], publicDir: string) => {
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, { ...fx, notes }, REAL_PCZT);
  const fixFile = path.join(state, "fixture.json");
  writeFileSync(fixFile, JSON.stringify({ ...JSON.parse(readFileSync(fixFile, "utf8")), internal_addresses: [CHANGE_ADDR] }));
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
};
const runPlan = (label: string, planBundle: string, fx: Fixture, notes: any[], publicDir: string, bnzRoot: string) => {
  const state = path.join(WORK, "state-plan-" + label);
  writePlanState(state, fx, notes, publicDir);
  const r = spawnSync(process.execPath, [planBundle, fx.id], { input: "{}", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/", BNZ_ROOT: bnzRoot } });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed };
};

// ---- host-command harness (the real `sign build` / `sign approve` / `sign derivable` against the stub externals).
const hostEnv = (state: string) => ({ BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/" });
const writeHostFixture = (label: string, fx: Fixture, notes: any[]) => {
  const state = path.join(WORK, "state-" + label);
  writeHostState(state, { ...fx, notes }, REAL_PCZT);
  const fixFile = path.join(state, "fixture.json");
  writeFileSync(fixFile, JSON.stringify({ ...JSON.parse(readFileSync(fixFile, "utf8")), internal_addresses: [CHANGE_ADDR] }));
  mkdirSync(path.join(state, "witness"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "witness", "alice.key"), witnessPrivate("0"), { mode: 0o600 });
  return state;
};
const writePacket = (label: string, fx: Fixture, settlement: any, meta: any, rows?: any[], candidate?: { pays: string; amount: string }) => {
  const dir = path.join(WORK, "packet-" + label);
  writeSettledDir(path.join(dir, "public"), fx, settlement);
  const full: any = { auction_id: fx.id, signer: fx.signer, seller_ua: UA_ORCHARD, reserve_return_ua: UA_ORCHARD, fee_reserve_ua: FEE_RESERVE_UA, ...meta };
  if (rows) writeFileSync(path.join(dir, "rows.json"), jsonBytes(rows));
  if (candidate) {
    const content = JSON.stringify({ rows: [{ recipient: candidate.pays, amount_zats: candidate.amount }] });
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
const bound: Fixture = await buildAuction({ beacon, count: 3, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
const legacy: Fixture = await buildAuction({ beacon, count: 3, fee_zats: "0" });

if (part === "before") {
  console.log("=== red on the BASE commit: the unused fee reserve is stranded (no command returns it)");
  // The base manifest schema refuses reserve_return_ua_commitment outright, so the red-before runs on the only
  // manifest the base can read — the pre-B46 legacy manifest (exactly what every earlier auction is).
  const pubLegacy = path.join(WORK, "public-legacy");
  writeSettledDir(pubLegacy, legacy, settlementFor(legacy));
  const p = runPlan("red-legacy", BASE_PLAN, legacy, vaultNotes(legacy), pubLegacy, BASE);
  const eligible = reserveReturnSources(vaultNotes(legacy) as any, legacy.manifest as any, FEE_RESERVE_UA, a => a === CHANGE_ADDR);
  const stranded = eligible.reduce((s, n) => s + BigInt((n as any).value_zats), 0n);
  check("red-plan-no-row-change-stranded", p.code === 0 && !!p.parsed && p.parsed.reserve_return === undefined,
    `the base plan settles everything and plans NO reserve-return row: ${stranded} zats of eligible notes (${eligible.map((n: any) => reserveSourceId(n)).join(",")}) stay in the vault`);
  const pubBound = path.join(WORK, "public-bound");
  writeSettledDir(pubBound, bound, settlementFor(bound));
  const b = runPlan("red-bound", BASE_PLAN, bound, vaultNotes(bound), pubBound, BASE);
  check("red-plan-bound-manifest-unreadable", b.code !== 0 && /unknown or missing manifest field/.test(b.err),
    `the base manifest schema cannot even represent reserve_return_ua_commitment: ${(b.err || b.out).trim().split("\n").at(-1)?.slice(0, 120)}`);
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

  // ---- A2. the eligible-source rule (settle/deposits.ts reserveReturnSources): the safety rule --------------
  {
    const unitM = { deposit_addresses: ["utest1deposit0"], escrow_ua: "utest1escrow", bond: { balance_addresses: ["utest1balance0"] }, buyback: { funding_ua: "utest1funding", treasury_ua: "utest1treasury" } };
    const unitNotes = [
      { name: "fee-reserve", address: "utest1feeres", value_zats: 35000, spent_in_txid: null },
      { name: "change", address: "utest1change", value_zats: 35000, spent_in_txid: null },
      { name: "stray", address: "utest1deposit0", value_zats: 500000, spent_in_txid: null },
      { name: "late-balance", address: "utest1balance0", value_zats: 499999, spent_in_txid: null },
      { name: "escrow", address: "utest1escrow", value_zats: 1000, spent_in_txid: null },
      { name: "treasury", address: "utest1funding", value_zats: 1000, spent_in_txid: null },
      { name: "spent-change", address: "utest1change", value_zats: 1000, spent_in_txid: "ab".repeat(32) },
      { name: "zero-change", address: "utest1change", value_zats: 0, spent_in_txid: null }];
    const names = (ua: string | null) => reserveReturnSources(unitNotes as any, unitM as any, ua, a => a === "utest1change").map((n: any) => n.name);
    check("rule-eligible-exactly-reserve-and-change", JSON.stringify(names("utest1feeres")) === JSON.stringify(["fee-reserve", "change"]),
      `eligible = ${JSON.stringify(names("utest1feeres"))} (the stray, late-balance, escrow, treasury, spent and zero notes are never sources)`);
    check("rule-late-balance-never-a-source", !names("utest1feeres").includes("late-balance"),
      "a balance-address note is never a source of the return (R42; owners may still claim it)");
    check("rule-stray-never-even-as-fee-reserve", JSON.stringify(names("utest1deposit0")) === JSON.stringify(["change"]) && !names("utest1deposit0").includes("stray"),
      "a lying fee_reserve_ua pointed at a deposit address never makes that deposit note eligible — the absolute exclusion wins (only the internal change remains)");
    check("rule-late-never-even-as-fee-reserve", JSON.stringify(names("utest1balance0")) === JSON.stringify(["change"]) && !names("utest1balance0").includes("late-balance"),
      "a lying fee_reserve_ua pointed at a balance address never makes that balance note eligible");
    check("rule-no-fee-reserve-internal-change-only", JSON.stringify(names(null)) === JSON.stringify(["change"]),
      "with no fee_reserve_ua configured only the internal change is eligible");
    check("rule-fee-formula", reserveReturnFee(0) === 10000n && reserveReturnFee(1) === 10000n && reserveReturnFee(2) === 10000n && reserveReturnFee(3) === 15000n,
      "ZIP-317 fee of the one-row transaction: 5,000 x max(2, sources)");
  }

  // ---- B. green plan: exactly one reserve-return row, sources = the reserve change only ---------------------
  console.log("=== green plan on the settled fixture: the one reserve-return row");
  const settled = settlementFor(bound);
  const pubSettled = path.join(WORK, "public-settled");
  writeSettledDir(pubSettled, bound, settled);
  const p = runPlan("green", GREEN_PLAN, bound, vaultNotes(bound), pubSettled, ROOT);
  const rr = p.parsed?.reserve_return ?? null;
  check("plan-completes", p.code === 0 && !!p.parsed, `the plan completed (exit ${p.code})`);
  check("plan-one-reserve-return-row", !!rr && rr.party === "reserve-return" && rr.kind === "payout",
    `the plan has exactly one reserve-return row: ${rr ? JSON.stringify({ party: rr.party, kind: rr.kind, amount_zats: rr.amount_zats }) : "(none)"}`);
  check("plan-amount-is-sum-minus-fee", !!rr && rr.amount_zats === RESERVE_AMOUNT && rr.eligible_zats === RESERVE_ELIGIBLE && rr.fee_zats === RESERVE_FEE,
    `sum ${rr?.eligible_zats} minus the ZIP-317 fee ${rr?.fee_zats} = ${rr?.amount_zats} zats to the committed return UA`);
  check("plan-sources-reserve-change-only", !!rr && JSON.stringify(rr.sources) === JSON.stringify([CHANGE_ID]),
    `sources = ${JSON.stringify(rr?.sources)} (the reserve change note only)`);
  check("plan-stray-and-late-untouched", !!rr && !rr.sources.includes(STRAY_ID) && !rr.sources.includes(LATE_ID),
    `the stray deposit (${STRAY_ID.slice(0, 20)}…) and the unclaimed late-balance note (${LATE_ID.slice(0, 20)}…) are untouched`);
  console.log(`OBSERVE plan-reserve-return ${JSON.stringify(rr)}`);

  // ---- C. green plan on the legacy manifest: no row, one line ----------------------------------------------
  console.log("=== green plan on the legacy manifest: the reserve stays in the vault");
  const pubLegacy = path.join(WORK, "public-legacy-green");
  writeSettledDir(pubLegacy, legacy, settlementFor(legacy));
  const lp = runPlan("legacy", GREEN_PLAN, legacy, vaultNotes(legacy), pubLegacy, ROOT);
  check("plan-legacy-no-row", lp.code === 0 && !!lp.parsed && lp.parsed.reserve_return === undefined,
    "a legacy manifest (no reserve_return_ua_commitment) plans no reserve-return row");
  const legacyLine = (lp.err.match(/^WARN the reserve stays in the vault \(legacy, H15\).*$/m) ?? []);
  check("plan-legacy-line", legacyLine.length === 1, `printed once: ${legacyLine[0] ?? "(nothing)"}`);

  // ---- D. green: the hosts approve the planned row ----------------------------------------------------------
  console.log("=== green hosts: approve the reserve-return row the plan derived");
  const reserveRow = { party: "reserve-return", kind: "payout", amount_zats: RESERVE_AMOUNT, sources: [CHANGE_ID] };
  const reserveMeta = { batch: 1, expiry_blocks: 100, reserve_row: { amount_zats: RESERVE_AMOUNT, sources: [CHANGE_ID] } };
  {
    const state = writeHostFixture("honest-build", bound, vaultNotes(bound));
    const dir = writePacket("honest-build", bound, settled, reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const built = existsSync(path.join(dir, "build.json")) ? JSON.parse(readFileSync(path.join(dir, "build.json"), "utf8")) : null;
    const out = (built?.outputs ?? []).find((o: any) => o.party === "reserve-return");
    const paid = createdRows(state).map(x => x.recipient);
    check("sign-build-honest-passes", r.code === 0 && out && out.amount_zats === RESERVE_AMOUNT && paid.includes(UA_ORCHARD),
      `${r.code === 0 ? `built the reserve-return row (${out?.amount_zats} zats to the committed return UA)` : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }
  {
    const state = writeHostFixture("honest-derivable", bound, vaultNotes(bound));
    const dir = writePacket("honest-derivable", bound, settled, {});
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    let listed = false;
    try { listed = (JSON.parse(r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!).rows ?? []).some((x: any) => x.party === "reserve-return" && x.amount_zats === RESERVE_AMOUNT); } catch {}
    check("sign-derivable-honest-lists-row", r.code === 0 && listed,
      `${r.code === 0 && listed ? "lists the reserve-return row at the plan's amount" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }
  {
    const state = writeHostFixture("honest-approve", bound, vaultNotes(bound));
    const dir = writePacket("honest-approve", bound, settled, { reserve_row: { amount_zats: RESERVE_AMOUNT, sources: [CHANGE_ID] } }, undefined, { pays: UA_ORCHARD, amount: RESERVE_AMOUNT });
    const r = sh(GREEN_BENZO, ["sign", "approve", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const recorded = existsSync(path.join(state, "approvals", bound.id, "batch-1.json"));
    check("sign-approve-honest-passes", r.code === 0 && recorded,
      `${r.code === 0 && recorded ? "recorded the approval of the single output to the committed return UA" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 160)}`}`);
  }

  // ---- E. green: the hosts refuse the tampered packets typedly ---------------------------------------------
  console.log("=== green hosts: typed refusals (exit 3, named rows)");
  for (const [name, args, candidate] of [["build", ["sign", "build", "--id", bound.id, "--batch", "1"], false],
    ["approve", ["sign", "approve", "--id", bound.id, "--batch", "1"], true]] as [string, string[], boolean][]) {
    const state = writeHostFixture(`wrong-ua-${name}`, bound, vaultNotes(bound));
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
    const state = writeHostFixture("wrong-ua-derivable", bound, vaultNotes(bound));
    const dir = writePacket("wrong-ua-derivable", bound, settled, {});
    const meta = JSON.parse(readFileSync(path.join(dir, "packet.json"), "utf8"));
    meta.reserve_return_ua = UA_SAPLING_ONLY;
    writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
    const r = sh(GREEN_BENZO, ["sign", "derivable", "--id", bound.id, "--packet", dir, "--name", "alice"], hostEnv(state));
    check("sign-derivable-wrong-return-ua-refused", r.code === 3 && typedRefusal(r.err),
      `${r.code === 3 && typedRefusal(r.err) ? "typed refusal" : `exit ${r.code}, no typed refusal`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  for (const [name, args, candidate] of [["build", ["sign", "build", "--id", bound.id, "--batch", "1"], false],
    ["approve", ["sign", "approve", "--id", bound.id, "--batch", "1"], true]] as [string, string[], boolean][]) {
    const state = writeHostFixture(`stray-source-${name}`, bound, vaultNotes(bound));
    const badRow = { ...reserveRow, sources: [CHANGE_ID, STRAY_ID] };
    const dir = writePacket(`stray-source-${name}`, bound, settled,
      { ...reserveMeta, reserve_row: { amount_zats: RESERVE_AMOUNT, sources: [CHANGE_ID, STRAY_ID] } },
      name === "build" ? [badRow] : undefined, candidate ? { pays: UA_ORCHARD, amount: RESERVE_AMOUNT } : undefined);
    const r = sh(GREEN_BENZO, [...args, "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = r.err.includes(STRAY_ID) && /not an eligible note/.test(r.err);
    check(`sign-${name}-stray-source-refused`, r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? `typed refusal naming the stray source` : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    const state = writeHostFixture("before-receipts", bound, vaultNotes(bound));
    const incomplete = settlementFor(bound, { dropReceiptOf: "seller" });
    const dir = writePacket("before-receipts", bound, incomplete, reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", bound.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /has no published receipt/.test(r.err);
    check("sign-build-return-before-receipts-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: an obligation row has no published receipt" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }
  {
    const state = writeHostFixture("legacy-packet", legacy, vaultNotes(legacy));
    const dir = writePacket("legacy-packet", legacy, settlementFor(legacy), reserveMeta, [reserveRow]);
    const r = sh(GREEN_BENZO, ["sign", "build", "--id", legacy.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
    const named = /legacy manifest/.test(r.err);
    check("sign-build-legacy-packet-refused", r.code === 3 && typedRefusal(r.err) && named,
      `${r.code === 3 && typedRefusal(r.err) && named ? "typed refusal: a legacy manifest never plans the row" : `exit ${r.code}`}: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 160) ?? ""}`);
  }

  // ---- F. `auction create`: the commitment from routing, H4's receiver rule, the mainnet rule ----------------
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
  const mainnet = (withCommitment: boolean) => ({ ...(withCommitment ? bound.manifest : unbound(bound.manifest)), network: "main",
    escrow_ua: "u1fixtureescrow000000000000000000000000000000000000000000000000000000",
    deposit_addresses: ["u1fixturedeposit00000000000000000000000000000000000000000000000000000"] });
  {
    const { state, r } = createRun("routing", unbound(bound.manifest), { settlement: {}, routing: { seller_ua: UA_ORCHARD, reserve_return_ua: UA_ORCHARD } });
    const committed = r.code === 0 ? draftOf(state).reserve_return_ua_commitment : null;
    check("create-sets-commitment-from-routing", r.code === 0 && committed === reserveReturnUaCommitment(UA_ORCHARD),
      `${r.code === 0 ? "set" : "did not set"} reserve_return_ua_commitment ${committed ?? "(none)"} (${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 100)})`);
  }
  {
    const { r } = createRun("sapling", unbound(bound.manifest), { settlement: {}, routing: { seller_ua: UA_ORCHARD, reserve_return_ua: UA_SAPLING_ONLY } });
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

  // ---- G. `benzo verify`: the published result, and a forged second reserve-return receipt ------------------
  console.log("=== green verify: the published result and the forged receipt");
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
    const rr = verifyRun("returned", bound, settlementFor(bound, { returned: true }));
    check("verify-accepts-returned", rr.code === 0 && /^OK accounting-strays$/m.test(rr.out),
      `verify accepts the published reserve-return result (exit ${rr.code}); ${rr.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);
  }
  {
    const r = verifyRun("forged", bound, settlementFor(bound, { returned: true, forged: true }));
    check("verify-refuses-forged-second-receipt", r.code !== 0 && /duplicate reserve-return receipt/.test(r.err),
      `a forged second reserve-return receipt is refused: ${(r.err || r.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
    const miss = verifyRun("missing-accounting", bound, (() => { const s = settlementFor(bound, { returned: true }); delete s.reserve_return; return s; })());
    check("verify-refuses-receipt-without-accounting", miss.code !== 0 && /reserve-return row or receipt without the published reserve_return accounting/.test(miss.err),
      `a reserve-return receipt without its published accounting is refused: ${(miss.err || miss.out).trim().split("\n").filter(l => l.startsWith("ERROR")).at(-1)?.slice(0, 140)}`);
  }

  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}
