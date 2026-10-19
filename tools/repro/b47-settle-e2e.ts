// Batch B47 proof (offline): the REAL `bin/benzo settle --id ID` worker, unmodified product code, run end to
// end against stub chain/wallet tools and a stub orb/orbctl — the missing test layer behind the four live-only
// settle failures (R99, R107, R107b, R108). One small REAL auction fixture (real tlock ciphertexts, signed
// manifest with the H10 seller and B46 reserve-return commitments, frozen set, envelope records, cleared
// result — tools/repro/h-fixtures.ts), three per-host state dirs whose `benzo sign build|approve|derivable|join`
// run the REAL shipped commands through the PATH orb stub, and a fake lightwalletd (zcash-devtool/grpcurl/
// benzo-scan stubs over one shared chain-state file the driver controls: it records broadcasts, answers
// "already exists in mempool" and mines on command).
//
// Green cases (this tree, `node tmp/b47.mjs after`), each one `bin/benzo settle` invocation or a sequence,
// asserting exit codes and the published dir:
//   (a) ordinary batches pay every row while the return waits (this catches R107; B49: it now waits at the
//     shared "paid" gate — the paying batch's receipts are not 10 confirmations deep yet, so no return
//     batch is allocated and the live InsufficientFunds build failure is unreachable at 0-conf);
//   (b) the return is planned after the last batch mines, built, approved, broadcast and recorded (R107b);
//   (c) the broadcast answers "already exists in mempool" and the worker continues and records the receipt
//       (H20 item 1);
//   (d) a re-run after the return exits 0 and leaves the published dir byte-identical (H20 item 2);
//   (e) an under-funded reserve stops at the fee preflight with the exact top-up line and broadcasts nothing;
//       after the stub is topped up with exactly that amount, it completes (H19);
//   (f) a legacy manifest settles with no return and its one WARN line per plan run.
//   (g) B51 (P2-2): a re-run after a crash with ONE batch already broadcast and mined on chain but not yet
//       confirmed in the ledger (the reviewer's probe world) — the preflight must not demand the total that
//       batch already paid; the run confirms it and continues to the return.
//   (h) B51 (P3): the R109 margin is pinned — a 20,000-zat shortfall asks for exactly 25,000 (the fee bound
//       counts one extra spend per remaining batch; reverting max(ceil(shortfall/10), 5000) to the pre-R109
//       ceil/10 would ask 22,000 and fail the pin), and topping up exactly 25,000 completes.
//   (i) B51 (P3): a send that lies "already exists in mempool" without recording anything is never trusted —
//       the staged txid must be known to the wallet (or the retry's real send stands), and the batch completes.
//   (j) B51 (P3): with the paid batch's inspect record gone, a re-run REFUSES — the already-published doc can
//       never feed its own accounting back (the H20.2 kept-doc fallback is gone).
//   (a2) B52 (P2-1, docs/design/phase7-b52-return-fee.md proof (a)): the reviewer's cross-pool vault — the
//       settled vault's unspent value is THREE ORCHARD notes and the committed return UA receives in
//       Ironwood. The plan quotes the sweep at the tool's own fee (3 Orchard + 1 Ironwood bundle, each
//       padded to its 2-action floor: 5 actions, 25,000 zats — the design text's "20,000" is the reviewer's
//       unpadded arithmetic, see STATUS-B Q1), the hosts approve, `benzo settle` completes and `benzo
//       verify` accepts the published dir. The base's prediction (5,000 x max(2, 3) = 15,000) cannot even
//       build it.
//   (e) B52 (H23): a pending MIXED batch (the return row allocated with the ordinary rows — the pre-B52
//       wedge) is set aside as an exception with the reason `reserve-return mixed with rows (H23)`, its
//       rows re-plan in the same run, exit 0 — and the next settle completes the return. The base throws
//       mid-loop (`the reserve-return row must be its own batch, alone`) and crash-loops.
//
// Red (`node tmp/b47.mjs before`) against BASE bundles built from pristine 8a9f638 (pre-R107) sources:
//   (a)-red: the first settle refuses before paying anything — the exact R107 signature of the h15-live
//     transcript (`refused-rows ["reserve-return"]` on every host, `no signer host could list its derivable
//     rows`);
//   (b)-red: the return pass on the world the live run was in at the R107b crash (batch 1 paid and published,
//     the return batch left allocated after its failed build attempt — seeded through the real Ledger class)
//     crashes with the exact live line `Cannot read properties of null (reading 'amount_zats')`.
// The green tree must turn both red legs green: (a) green on the same fixture, (b) green on the same seeded
// world shape (the case-(b) run continues the case-(a) world, whose failed return pass leaves exactly that
// state).
//
// Build+run:
//   npx esbuild tools/repro/b47-settle-e2e.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b47.mjs
//   npx esbuild tools/repro/b47-republish.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b47-republish.mjs
//   node tmp/b47.mjs after        (green cases)
//   node tmp/b47.mjs before       (red legs; needs the base bundles below)
//   base bundles, built ONCE from the pristine base commit (like tools/repro/b46-reserve-return.ts):
//     mkdir -p tmp/b47/base-src && git archive 8a9f638 | tar -x -C tmp/b47/base-src && ln -s $PWD/node_modules tmp/b47/base-src/node_modules
//     (cd tmp/b47/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild settle/cli.ts ... --outfile=settle/dist/cli.mjs && npx esbuild clear/cli.ts ... --outfile=clear/dist/cli.mjs)
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
//   B51's red legs (`node tmp/b47.mjs before51`) run the SAME cases against base bundles from the B51 base
//   commit a107447 (the batch's own red base — B47's 8a9f638 legs above are untouched):
//     mkdir -p tmp/b51/base-src && git archive a107447 | tar -x -C tmp/b51/base-src && ln -s $PWD/node_modules tmp/b51/base-src/node_modules
//     (cd tmp/b51/base-src && node cli/build.mjs && the same three esbuild commands as above)
//   B52's red legs (`node tmp/b47.mjs before52`) run cases (a2) and (e) against base bundles from the B52
//   base commit 59c863c (tmp/b52/base-src, the same recipe — shared with tools/repro/b46-reserve-return.ts):
//     mkdir -p tmp/b52/base-src && git archive 59c863c | tar -x -C tmp/b52/base-src && ln -s $PWD/node_modules tmp/b52/base-src/node_modules
//     (cd tmp/b52/base-src && node cli/build.mjs && the same three esbuild commands as above)
//
// Test-only seams: NONE in product code. The stubs read two driver-set variables, BNZ_TEST_CHAIN (the shared
// fake chain-state file) and BNZ_TEST_STUBS (the orb stub's config); both are refused when BNZ_NETWORK=main
// and are never read by shipped code. Every product path runs through the existing seams (BNZ_STATE_DIR,
// BNZ_PCZT_BIN, BNZ_SCAN_BIN, BNZ_LWD_URL(_ALT), BNZ_DRAND_URLS, BNZ_FROSTD_HOST, PATH).
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, copyFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment } from "../../manifest/schema";
import { signApprovalMap, signOpensReport } from "../../witness";
import { modeEntry } from "../../clear/registry";
import { Ledger } from "../../settle/ledger";
import { buildAuction, fetchBeacon, needRealPczt, witnessPrivate, UA_ORCHARD, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after" && part !== "before51" && part !== "before52") { console.error("usage: node tmp/b47.mjs before|after|before51|before52"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b47.mjs ${part} (tools/repro/b47-settle-e2e.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const REAL_PCZT = needRealPczt(ROOT);
const GREEN_BENZO = path.join(ROOT, "cli/dist/benzo.mjs");
const BASE = path.join(ROOT, "tmp/b47/base-src");
const BASE_BENZO = path.join(BASE, "cli/dist/benzo.mjs");
if (part === "before") for (const f of [BASE_BENZO, path.join(BASE, "settle/dist/cli.mjs"), path.join(BASE, "settle/dist/plan.mjs"), path.join(BASE, "clear/dist/cli.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
// B51 (docs/design/phase7-b51-review-fixes.md): the batch's own red base — a107447 bundles (tmp/b51/base-src,
// the same git-archive recipe), driven by the `before51` part so B47's own 8a9f638 red legs stay untouched.
const BASE51 = path.join(ROOT, "tmp/b51/base-src");
const BASE51_BENZO = path.join(BASE51, "cli/dist/benzo.mjs");
if (part === "before51") for (const f of [BASE51_BENZO, path.join(BASE51, "settle/dist/cli.mjs"), path.join(BASE51, "settle/dist/plan.mjs"), path.join(BASE51, "clear/dist/cli.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
// B52 (docs/design/phase7-b52-return-fee.md): the batch's own red base — 59c863c bundles (tmp/b52/base-src,
// the same git-archive recipe), driven by the `before52` part.
const BASE52 = path.join(ROOT, "tmp/b52/base-src");
const BASE52_BENZO = path.join(BASE52, "cli/dist/benzo.mjs");
if (part === "before52") for (const f of [BASE52_BENZO, path.join(BASE52, "settle/dist/cli.mjs"), path.join(BASE52, "settle/dist/plan.mjs"), path.join(BASE52, "clear/dist/cli.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the B52 base bundles first (see the header)`);
if (part === "after") for (const f of [GREEN_BENZO, path.join(ROOT, "settle/dist/cli.mjs"), path.join(ROOT, "settle/dist/plan.mjs"), path.join(ROOT, "clear/dist/cli.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);

// ---- fixture constants ------------------------------------------------------
const R = 32704232; // a past quicknet round (the h-fixtures machinery fetches its authentic beacon once)
const FEE_RESERVE_UA = "utest1b47feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b47internalchangeaddress000000000000000000000000000000000000";
const CONFIRMATIONS = 10; // the wallet's spendability rule the stubs and the preflight share

// ---- the shared stub sources ----------------------------------------------
// One chain-state file drives every stub: {tip, send_mode, notes, pending, mined, broadcasts}. The create
// stub refuses with the real wallet's InsufficientFunds line when the requested rows plus the ZIP-317 fee
// exceed the MATURE spendable notes — exactly the live "the return needs the last batch's change to be
// spendable" case. `send_mode: "mempool"` makes the NEXT send answer the live resend error
// ("transaction already exists in mempool") while recording the transaction, which the next wallet sync
// mines — the H20 item 1 case. `send_mode: "lie"` answers that SAME phrase WITHOUT recording anything
// (a hostile or broken wrapper) — the B51 P3-2 case: the phrase alone must never count as broadcast.
const CHAIN_GUARD = `if (process.env.BNZ_NETWORK === "main") { process.stderr.write("test stubs refuse BNZ_NETWORK=main\\n"); process.exit(1); }
if (!process.env.BNZ_TEST_CHAIN) { process.stderr.write("test stubs need BNZ_TEST_CHAIN\\n"); process.exit(1); }
`;
const STUB_SCAN = `${CHAIN_GUARD}const fs = require("fs");
const chain = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
for (const n of chain.notes) console.log(JSON.stringify(n));
`;
const STUB_DEVTOOL = `${CHAIN_GUARD}const fs = require("fs"), crypto = require("crypto");
const chainFile = process.env.BNZ_TEST_CHAIN, a = process.argv.slice(2);
const txidOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
function mine(c, txid) {
  const p = c.pending.find(x => x.txid === txid);
  if (!p) return;
  c.pending = c.pending.filter(x => x.txid !== txid);
  c.tip += 1;
  for (const s of p.spends) { const n = c.notes.find(n => n.txid + ":" + n.pool + ":" + n.action_index === s); if (n) n.spent_in_txid = txid; }
  // B49: the change note's txid IS the transaction's txid (as on a real chain) — it is the scan's own
  // evidence that the txid mined at this height, which the reserve gate's "paid" rule reads.
  if (p.change_zats > 0) c.notes.push({ txid, height: c.tip, pool: "ironwood",
    address: p.change_address, diversifier_index: "99", action_index: 0, value_zats: p.change_zats, memo_hex: null, spent_in_txid: null });
  c.mined[txid] = { height: c.tip, rows: p.rows };
}
if (a[0] === "wallet") {
  const verb = a[3];
  if (verb === "sync" || verb === "enhance") process.exit(0);
  const c = JSON.parse(fs.readFileSync(chainFile, "utf8"));
  if (verb === "balance") { console.log(JSON.stringify({ chain_tip_height: c.tip })); process.exit(0); }
  if (verb === "list-tx") {
    for (const t of [...c.pending]) mine(c, t.txid);
    fs.writeFileSync(chainFile, JSON.stringify(c));
    console.log(JSON.stringify(Object.entries(c.mined).map(([txid, m]) => ({ txid, mined_height: m.height }))));
    process.exit(0);
  }
  process.stderr.write("zcash-devtool stub: unknown wallet verb " + verb + "\\n"); process.exit(1);
}
if (a[0] === "pczt") {
  const verb = ["extract", "prove", "redact", "send-without-storing", "send"].find(v => a.includes(v));
  if (verb === "extract") { process.stdout.write(txidOf(fs.readFileSync(0)) + "\\n"); process.exit(0); }
  if (verb === "prove") { fs.copyFileSync(a[a.indexOf("prove") + 1], a[a.indexOf("--output") + 1]); process.exit(0); }
  if (verb === "redact") { fs.copyFileSync(a[a.indexOf("--output") - 1], a[a.indexOf("--output") + 1]); process.exit(0); }
  if (verb === "send" || verb === "send-without-storing") {
    const file = a[a.length - 1], buf = fs.readFileSync(file), txid = txidOf(buf), body = JSON.parse(buf.toString("utf8"));
    const c = JSON.parse(fs.readFileSync(chainFile, "utf8"));
    const record = { txid, spends: body.spends, change_zats: body.change_zats, change_address: ${JSON.stringify(CHANGE_ADDR)}, rows: body.rows };
    if (c.send_mode === "lie") {
      c.send_mode = "ok";
      fs.writeFileSync(chainFile, JSON.stringify(c));
      process.stderr.write("Error: Send failed: (-1) transaction already exists in mempool\\n");
      process.exit(1);
    }
    if (c.send_mode === "mempool") {
      c.send_mode = "ok";
      c.pending.push(record);
      fs.writeFileSync(chainFile, JSON.stringify(c));
      process.stderr.write("Error: Send failed: (-1) transaction already exists in mempool\\n");
      process.exit(1);
    }
    if (c.send_mode === "fail") { process.stderr.write("Error: Send failed: (-1) mock node rejection\\n"); process.exit(1); }
    c.broadcasts.push(txid);
    c.pending.push(record);
    mine(c, txid);
    fs.writeFileSync(chainFile, JSON.stringify(c));
    process.stdout.write(txid + "\\n");
    process.exit(0);
  }
  process.stderr.write("zcash-devtool stub: unknown pczt verb " + verb + "\\n"); process.exit(1);
}
process.stderr.write("zcash-devtool stub: unknown " + a.join(" ") + "\\n"); process.exit(1);
`;
const STUB_GRPCURL = `${CHAIN_GUARD}const fs = require("fs");
const a = process.argv.slice(2), method = a[a.length - 1].split("/").pop();
const c = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
const body = a.includes("-d") ? JSON.parse(a[a.indexOf("-d") + 1]) : {};
if (method === "GetLatestBlock") { console.log(JSON.stringify({ height: c.tip })); process.exit(0); }
if (method === "GetTransaction") {
  const txid = Buffer.from(body.hash, "base64").reverse().toString("hex");
  const m = c.mined[txid];
  if (!m) { process.stderr.write("NotFound\\n"); process.exit(1); }
  console.log(JSON.stringify({ height: m.height })); process.exit(0);
}
if (method === "GetBlock") { console.log(JSON.stringify({ height: body.height, hash: Buffer.alloc(32, 17).toString("base64"), time: 1793600000 })); process.exit(0); }
if (method === "GetBlockRange") {
  for (let h = body.start.height; h <= body.end.height; h++) {
    const vtx = Object.entries(c.mined).filter(([, m]) => m.height === h).map(([txid]) => ({ txid: Buffer.from(txid, "hex").reverse().toString("base64") }));
    console.log(JSON.stringify({ height: h, vtx }));
  }
  process.exit(0);
}
process.stderr.write("NotFound\\n"); process.exit(1);
`;
const STUB_PCZT = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const state = path.dirname(path.dirname(process.argv[1]));
const fix = JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8"));
const a = process.argv.slice(2), cmd = a[0];
const chain = () => JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
const txidOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
// B52 (P3-8c): actions the REAL way (settle/src/main.rs inspect): per pool, max(spends, outputs), each
// bundle padded to at least 2 actions (the pinned orchard builder pads every non-empty bundle to its
// 2-action floor); one INPUT per source note; the fee is the ZIP-317 fee of that action count,
// 5,000 x max(2, actions).
const bundleActions = (s, o) => (s + o > 0 ? Math.max(2, Math.max(s, o)) : 0);
const shapeOf = (spendPools, outPools) => {
  const counts = {};
  for (const p of spendPools) { counts[p] = counts[p] || { s: 0, o: 0 }; counts[p].s++; }
  for (const p of outPools) { counts[p] = counts[p] || { s: 0, o: 0 }; counts[p].o++; }
  let actions = 0;
  for (const k of Object.keys(counts)) actions += bundleActions(counts[k].s, counts[k].o);
  return { actions, fee: 5000 * Math.max(2, actions) };
};
const outPoolOf = (recipient, amount) => (fix.pool_by_ua || {})[recipient] || (fix.pool_by_amount || {})[String(amount)] || "ironwood";
if (cmd === "classify-address") {
  if (a.includes("--stdin")) {
    const r = cp.spawnSync(${JSON.stringify(REAL_PCZT)}, ["classify-address", "--stdin"], { input: fs.readFileSync(0), maxBuffer: 1 << 28 });
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? ""); process.exit(r.status ?? 1);
  }
  process.stdout.write(cp.execFileSync(${JSON.stringify(REAL_PCZT)}, ["classify-address", a[1]])); process.exit(0);
}
if (cmd === "ufvk-ak") { console.log(fix.groupKey); process.exit(0); }
if (cmd === "owns") { console.log((fix.internal_addresses ?? []).includes(a[2]) ? "internal" : "external"); process.exit(0); }
if (cmd === "address") { console.log(${JSON.stringify(UA_ORCHARD)}); process.exit(0); }
if (cmd === "quote-sweep") {
  // B52 (item 1): the tool's own quote of the one-row sweep — every spendable note, one output, no change.
  const to = a[a.indexOf("--to") + 1], c = chain();
  const confirmed = (n) => n.height && c.tip - n.height + 1 >= ${CONFIRMATIONS};
  const spendable = c.notes.filter(n => (n.spent_in_txid ?? null) === null && Number(n.value_zats) > 0 && confirmed(n));
  const bad = spendable.find(n => !["orchard", "ironwood"].includes(String(n.pool)));
  if (bad) { process.stderr.write("the vault's value cannot be swept in one transaction: the vault holds a " + bad.pool + " note the tool cannot spend\\n"); process.exit(1); }
  if (!spendable.length) { process.stderr.write("the vault's value cannot be swept in one transaction: no spendable note\\n"); process.exit(1); }
  const shape = shapeOf(spendable.map(n => String(n.pool)), [outPoolOf(to, 0)]);
  const total = spendable.reduce((s, n) => s + Number(n.value_zats), 0);
  const amount = total - shape.fee;
  if (amount <= 0) { process.stderr.write("the vault's value cannot be swept in one transaction: proposal: InsufficientFunds { available: Zatoshis(" + total + "), required: Zatoshis(" + (total + shape.fee) + ") }\\n"); process.exit(1); }
  console.log(JSON.stringify({ amount_zats: String(amount), fee_zats: String(shape.fee), input_zats: String(total), spends: spendable.length, actions: shape.actions }));
  process.exit(0);
}
if (cmd === "create") {
  const rows = JSON.parse(fs.readFileSync(0, "utf8")), c = chain();
  const confirmed = (n) => n.height && c.tip - n.height + 1 >= ${CONFIRMATIONS};
  const spendable = c.notes.filter(n => (n.spent_in_txid ?? null) === null && Number(n.value_zats) > 0 && confirmed(n));
  const bad = spendable.find(n => !["orchard", "ironwood"].includes(String(n.pool)));
  if (bad) { process.stderr.write("Error: proposal: the vault holds a " + bad.pool + " note the tool cannot spend\\n"); process.exit(1); }
  const available = spendable.reduce((s, n) => s + Number(n.value_zats), 0);
  const rowZats = rows.reduce((s, r) => s + Number(r.amount_zats), 0);
  const outPools = rows.map(r => outPoolOf(r.recipient, r.amount_zats));
  let fee = shapeOf(spendable.map(n => String(n.pool)), outPools).fee;
  if (rowZats + fee <= available) fee = shapeOf(spendable.map(n => String(n.pool)), outPools.concat([fix.change_pool || "ironwood"])).fee;
  const required = rowZats + fee;
  if (required > available) {
    process.stderr.write("Error: proposal: InsufficientFunds { available: Zatoshis(" + available + "), required: Zatoshis(" + required + ") }\\n");
    process.exit(1);
  }
  fs.writeFileSync(a[2], JSON.stringify({ rows, input_zats: available, fee_zats: fee, change_zats: available - required,
    spends: spendable.map(n => ({ id: n.txid + ":" + n.pool + ":" + n.action_index, value: Number(n.value_zats) })).sort((x, y) => x.id < y.id ? -1 : 1).map(p => p.id),
    spend_values: spendable.map(n => ({ id: n.txid + ":" + n.pool + ":" + n.action_index, value: Number(n.value_zats) })).sort((x, y) => x.id < y.id ? -1 : 1).map(p => p.value),
    spend_pools: spendable.map(n => ({ id: n.txid + ":" + n.pool + ":" + n.action_index, pool: String(n.pool) })).sort((x, y) => x.id < y.id ? -1 : 1).map(p => p.pool),
    expiry_height: c.tip + 364 }));
  process.exit(0);
}
if (cmd === "inspect") {
  const buf = fs.readFileSync(a[1]), body = JSON.parse(buf.toString("utf8"));
  const outputs = body.rows.map((r, i) => ({ index: i, pool: outPoolOf(r.recipient, r.amount_zats), is_change: false, recipient: r.recipient, amount_zats: String(r.amount_zats) }));
  if (Number(body.change_zats ?? 0) > 0) outputs.push({ index: outputs.length, pool: fix.change_pool || "ironwood", is_change: true, recipient: null, amount_zats: String(body.change_zats) });
  const output = outputs.reduce((s, r) => s + Number(r.amount_zats), 0);
  const input = Number(body.input_zats ?? output);
  // B50 (H5): the stub models the real benzo-pczt inspect's full shape (settle/src/main.rs), which verify
  // now shape-checks. B51 P3-3: it publishes one input per spent note, read as the published source count.
  // B52 (P3-8c): each input carries its pool, the change output the wallet left behind is reported
  // (is_change true), and actions are computed the real way (per pool, max(spends, outputs), each bundle
  // padded to at least 2).
  const inputs = (body.spends ?? []).map((s, i) => ({ index: i, pool: String((body.spend_pools ?? [])[i] ?? "ironwood"), value_zats: Number((body.spend_values ?? [])[i] ?? 0) }));
  const shape = shapeOf(inputs.map(n => n.pool), outputs.map(o => o.pool));
  console.log(JSON.stringify({ outputs, consensus_branch_id: "37a5165b", tx_version: 6, actions: shape.actions,
    inputs, input_zats: input, output_zats: output, fee_zats: input - output,
    expiry_height: Number(body.expiry_height ?? chain().tip + 364), txid: txidOf(buf),
    shielded_sighash: txidOf(buf),
    randomizers: [{ pool: "ironwood", index: 0, alpha: crypto.createHash("sha256").update(Buffer.concat([buf, Buffer.from("alpha")])).digest("hex") }] }));
  process.exit(0);
}
process.stderr.write("benzo-pczt stub: unknown command " + cmd + "\\n"); process.exit(1);
`;
const STUB_SIGN = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), crypto = require("crypto");
const a = process.argv.slice(2);
const input = a[a.indexOf("-i") + 1], output = a[a.indexOf("-o") + 1];
const buf = fs.readFileSync(input);
const sighash = crypto.createHash("sha256").update(buf).digest("hex");
const alpha = crypto.createHash("sha256").update(Buffer.concat([buf, Buffer.from("alpha")])).digest("hex");
const shared = path.dirname(process.env.BNZ_TEST_CHAIN);
fs.writeFileSync(path.join(shared, "current-sign.json"), JSON.stringify({ sighash }));
console.log("SIGHASH: " + sighash);
console.log("Randomizer #0 (ironwood): " + alpha);
let acc = "";
process.stdin.on("data", (d) => {
  acc += d;
  if (/^[0-9a-f]{128}$/m.test(acc)) { fs.writeFileSync(output, buf); process.exit(0); }
});
`;
// The FROST layer is stubbed at the frost-client boundary (the h-fixtures stub class): the coordinator prints
// the session's signature once both participants joined, the participant prints the approved sighash on the
// prompts the real `benzo sign join` answers. The real join code (approval check included) runs.
const STUB_FROST = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), crypto = require("crypto");
const a = process.argv.slice(2), cmd = a[0];
const shared = path.dirname(process.env.BNZ_TEST_CHAIN);
if (cmd === "sessions") {
  if (a.includes("--close-all")) { console.log("closed"); process.exit(0); }
  process.stderr.write("Session with ID 00000000-0000-4000-8000-000000000001\\n");
  process.exit(0);
}
if (cmd === "coordinator") {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d));
  process.stdin.on("end", () => {
    process.stdout.write("Waiting for participants to send their commitments\\n");
    const joins = path.join(shared, "joins.log");
    fs.writeFileSync(joins, "");
    const deadline = Date.now() + 120000;
    const poll = setInterval(() => {
      let n = 0;
      try { n = fs.readFileSync(joins, "utf8").split("\\n").filter(Boolean).length; } catch {}
      if (n >= 2 || Date.now() > deadline) {
        clearInterval(poll);
        const body = Buffer.concat(chunks);
        process.stdout.write(crypto.createHash("sha256").update(body).digest("hex") + crypto.createHash("sha256").update("b47-signature").digest("hex") + "\\n");
        process.exit(0);
      }
    }, 50);
  });
  process.stdin.resume();
} else if (cmd === "participant") {
  const sign = JSON.parse(fs.readFileSync(path.join(shared, "current-sign.json"), "utf8"));
  process.stdout.write("Joining signing session...\\n");
  process.stdout.write("Message to be signed (hex-encoded):\\n" + sign.sighash + "\\n");
  process.stdout.write("Do you want to sign it? (y/n)\\n");
  fs.appendFileSync(path.join(shared, "joins.log"), (process.env.BNZ_TEST_HOST ?? "host") + "\\n");
  process.stdin.on("data", () => process.exit(0));
  setTimeout(() => process.exit(0), 60000);
} else { process.stderr.write("frost-client stub: unknown " + cmd + "\\n"); process.exit(1); }
`;
// The orb/orbctl PATH stub: it records nothing exotic — it maps /home/benzo/<x> onto the host's own world
// directory and runs the REAL `benzo sign …` commands (and the frost stub) against that host's state dir.
const STUB_ORB = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), cp = require("child_process");
const cmd = path.basename(process.argv[1]).replace(/\\.cjs$/, "");
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_STUBS, "utf8"));
const hostOf = (m) => m.replace(/^benzo-/, "");
const mapPath = (host, p) => p.startsWith("/home/benzo/") ? path.join(cfg.shared, "hosts", host, p.slice("/home/benzo/".length)) : p;
if (cmd === "orbctl") {
  const at = args.indexOf("-m") + 1, host = hostOf(args[at]);
  if (args[0] === "push") {
    const dst = mapPath(host, "/home/benzo/" + args[at + 2]);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(args[at + 1], dst, { recursive: true });
    process.exit(0);
  }
  if (args[0] === "pull") {
    fs.copyFileSync(mapPath(host, "/home/benzo/" + args[at + 1]), args[at + 2]);
    process.exit(0);
  }
  process.stderr.write("orbctl stub: unknown " + args.join(" ") + "\\n"); process.exit(1);
}
if (args[0] !== "run") { process.stderr.write("orb stub: unknown " + args.join(" ") + "\\n"); process.exit(1); }
const at = args.indexOf("-m") + 1, host = hostOf(args[at]);
let rest = args.slice(args.indexOf("-u") + 2);
if (rest[0] === "env") {
  rest = rest.slice(1);
  while (rest.length && rest[0].includes("=") && !rest[0].startsWith("/")) rest = rest.slice(1);
}
const env = { ...process.env, BNZ_STATE_DIR: cfg.hosts[host], BNZ_TEST_HOST: host,
  BNZ_PCZT_BIN: path.join(cfg.hosts[host], "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(cfg.hosts[host], "bin", "benzo-scan") };
const verb = rest[0].split("/").pop();
if (verb === "rm" || verb === "chown") process.exit(0);
if (verb === "cat") {
  const name = path.basename(rest[rest.length - 1]).replace(/\\.pubkey$/, "");
  console.log(require("crypto").createHash("sha256").update("b47-contact-" + name).digest("hex"));
  process.exit(0);
}
if (verb === "frost-client") {
  const argv = rest.slice(1);
  if (argv[0] === "sessions" && argv.includes("--close-all")) { console.log("closed"); process.exit(0); }
  const r = cp.spawnSync(path.join(cfg.hosts[host], "bin", "frost-client"), argv, { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}
if (verb === "benzo") {
  const argv = rest.slice(1).map(x => mapPath(host, x));
  const r = cp.spawnSync(process.execPath, [cfg.benzo, ...argv], { encoding: "utf8", maxBuffer: 64 << 20, env });
  process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
  process.exit(r.status ?? 1);
}
process.stderr.write("orb stub: unknown remote command " + rest.join(" ") + "\\n"); process.exit(1);
`;

const stub = (bin: string, name: string, source: string) => {
  const impl = path.join(bin, name + ".cjs");
  writeFileSync(impl, source); chmodSync(impl, 0o755);
  writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`); chmodSync(path.join(bin, name), 0o755);
};
const writeStateBin = (bin: string) => {
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  stub(bin, "benzo-scan", STUB_SCAN);
  stub(bin, "zcash-devtool", STUB_DEVTOOL);
  stub(bin, "grpcurl", STUB_GRPCURL);
  stub(bin, "benzo-pczt", STUB_PCZT);
  stub(bin, "zcash-sign", STUB_SIGN);
  stub(bin, "frost-client", STUB_FROST);
};

// ---- world construction -----------------------------------------------------
type World = {
  label: string; id: string; fx: Fixture; root: string; state: string; publicDir: string; shared: string;
  chainFile: string; stubBin: string; benzo: string; hosts: Record<string, string>;
  obligationRows: { party: string; kind: string; amount_zats: string }[]; obligationZats: number;
  C: number; feeReserve: number;
};
const signerNames = ["alice", "bob", "carol"];

function writeWorld(label: string, fx: Fixture, opts: { root: string; benzo: string; feeReserve: number; topUp?: number }): World {
  const id = fx.id;
  const base = path.join(opts.root, "tmp/b47-worlds", label);
  rmSync(base, { recursive: true, force: true });
  const state = path.join(base, "state"), publicDir = path.join(base, "public"), shared = path.join(base, "shared");
  const chainFile = path.join(shared, "chain-state.json"), stubBin = path.join(base, "stub-bin");
  const obligationRows = [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)].map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats }));
  const obligationZats = obligationRows.reduce((s, o) => s + Number(o.amount_zats), 0);
  for (const d of [state, path.join(state, "run"), path.join(state, "auction"), path.join(state, "product"), path.join(state, "vaults", id, "wallet"), shared, stubBin])
    mkdirSync(d, { recursive: true, mode: 0o700 });
  writeStateBin(path.join(state, "bin"));
  writeFileSync(path.join(state, "fixture.json"), JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA] }));
  // The fake chain: the fixture's deposit notes plus the fee-reserve note (and the optional top-up of case (e)).
  const notes: any[] = fx.notes.map(n => ({ ...n }));
  notes.push({ txid: hash("b47-fee-reserve-" + label), height: 90100, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: opts.feeReserve, memo_hex: null, spent_in_txid: null });
  if (opts.topUp) notes.push({ txid: hash("b47-top-up-" + label), height: 90200, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "10", action_index: 0, value_zats: opts.topUp, memo_hex: null, spent_in_txid: null });
  writeFileSync(chainFile, JSON.stringify({ tip: 100000, send_mode: "ok", notes, pending: [], mined: {}, broadcasts: [] }));
  // The operator's world: private auction ledger, product config, per-auction custody keys, the two
  // agreeing signed envelope-opens reports the plan gates the leaf refunds on (exactly the live shapes).
  writeFileSync(path.join(state, "auction", "manifest-signing.pem"), fx.manifestPem, { mode: 0o600 });
  writeFileSync(path.join(state, "auction", `${id}.json`), jsonBytes({ manifest: fx.manifestPacket, signer: fx.signer, state: "CLEARED",
    leaves: fx.leaves, receipts: fx.receipts, frozen: fx.frozen, opened: fx.opened, result: fx.result, trace: [], beacon: fx.beacon,
    envelopes: fx.envelopes, witness_set: fx.witnessSet }));
  writeFileSync(path.join(state, "product", `${id}.json`), jsonBytes({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 },
    routing: { bidders: [], seller_ua: UA_ORCHARD, fee_reserve_ua: FEE_RESERVE_UA, reserve_return_ua: UA_ORCHARD }, public_dir: publicDir }));
  writeFileSync(path.join(state, "vaults", id, "keys.json"), jsonBytes({ group_key: fx.groupKey }));
  mkdirSync(path.join(state, "settle", id), { recursive: true, mode: 0o700 });
  const dest = hash(Buffer.from(UA_ORCHARD, "utf8"));
  for (const [n, w] of [["alice", "0"], ["bob", "1"]] as const) {
    const body = { signer: n, opens: fx.leaves.map((l: any) => ({ leaf: l.leaf_index, party: `leaf:${l.leaf_index}`, ok: true, dest_sha256: dest })) };
    writeFileSync(path.join(state, "settle", id, `envelope-opens-${n}.json`), jsonBytes({ ...body, ...signOpensReport(body, witnessPrivate(w)) }));
  }
  // The three signer hosts: their own state dirs (the real `benzo sign …` commands run against these), each
  // holding its own envelope key and witness key and the same stub toolchain.
  const hosts: Record<string, string> = {};
  for (const [i, n] of signerNames.entries()) {
    const hs = path.join(base, "host-" + n);
    hosts[n] = hs;
    writeStateBin(path.join(hs, "bin"));
    writeFileSync(path.join(hs, "fixture.json"), JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA] }));
    for (const d of [hs, path.join(hs, "run"), path.join(hs, "auction"), path.join(hs, "auctions", id), path.join(hs, "signers", n), path.join(hs, "witness")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(hs, "auctions", id, "group-key.txt"), fx.groupKey + "\n");
    writeFileSync(path.join(hs, "auctions", id, "frost.toml"), "group = 0\n");
    writeFileSync(path.join(hs, "operator-signer.txt"), fx.signer + "\n");
    writeFileSync(path.join(hs, "ufvk.txt"), "uviewtest1fixture\n");
    writeFileSync(path.join(hs, "signers", n, "envelope-key.json"), JSON.stringify(fx.envelopeKeys[i]));
    writeFileSync(path.join(hs, "witness", `${n}.key`), witnessPrivate(String(i)), { mode: 0o600 });
  }
  stub(stubBin, "orb", STUB_ORB);
  stub(stubBin, "orbctl", STUB_ORB);
  writeFileSync(path.join(shared, "stub-config.json"), JSON.stringify({ shared, benzo: opts.benzo, hosts }));
  writePublicDir(publicDir, fx);
  return { label, id, fx, root: opts.root, state, publicDir, shared, chainFile, stubBin, benzo: opts.benzo, hosts,
    obligationRows, obligationZats, C: Number(fx.manifest.C_zats), feeReserve: opts.feeReserve };
}

const sh = (cmd: string, args: string[], env: Record<string, string>, timeoutMs?: number) => {
  const r = spawnSync(cmd, args, { input: "", encoding: "utf8", maxBuffer: 64 << 20,
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}), env: { ...process.env, ...env } });
  return { code: r.status ?? 1, killed: !!(r.error && (r.error as any).code === "ETIMEDOUT"), out: r.stdout ?? "", err: r.stderr ?? "" };
};
const worldEnv = (w: World): Record<string, string> => ({
  BNZ_STATE_DIR: w.state, BNZ_TEST_CHAIN: w.chainFile, BNZ_TEST_STUBS: path.join(w.shared, "stub-config.json"),
  BNZ_PCZT_BIN: path.join(w.state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(w.state, "bin", "benzo-scan"),
  BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/",
  BNZ_FROSTD_HOST: "stub-frostd:2744", BNZ_ROOT: w.root,
  PATH: `${w.stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
});
// The real `bin/benzo settle --id ID` on this tree; the base runs take the same argv through the base bundle.
// `timeoutMs` bounds a run the driver must kill (the red (i) leg: the base sits in the 30-minute mined-wait).
const runSettle = (w: World, timeoutMs?: number) => w.benzo === GREEN_BENZO
  ? sh(path.join(ROOT, "bin/benzo"), ["settle", "--id", w.id], worldEnv(w), timeoutMs)
  : sh(process.execPath, [w.benzo, "settle", "--id", w.id], worldEnv(w), timeoutMs);
// `benzo verify` on the published dir — the "verify accepts" half of B52's case (a2).
const runVerify = (w: World) => sh(process.execPath, [w.benzo, "verify", "--dir", w.publicDir, "--signer", w.fx.signer], worldEnv(w));

const chain = (w: World) => JSON.parse(readFileSync(w.chainFile, "utf8"));
const receiptsOf = (w: World) => JSON.parse(readFileSync(path.join(w.state, "settle", w.id, "receipts.json"), "utf8"));
const settlementOf = (w: World) => {
  const doc = JSON.parse(readFileSync(path.join(w.publicDir, "auction.json"), "utf8"));
  return doc.settlement ?? null;
};
const dirDigest = (dir: string) => Object.fromEntries(readdirSyncSorted(dir).map(n => [n, hash(readFileSync(path.join(dir, n)))]));
const digestDiff = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]);
const readdirSyncSorted = (dir: string) => (execFileSync("ls", ["-1", dir], { encoding: "utf8" })).split("\n").filter(Boolean).sort();
const settleLog = (w: World) => { try { return readFileSync(path.join(w.state, "run", "settle-cli.log"), "utf8"); } catch { return ""; } };
const bumpTip = (w: World, n: number) => { const c = chain(w); c.tip += n; writeFileSync(w.chainFile, JSON.stringify(c)); };
const armMempool = (w: World) => { const c = chain(w); c.send_mode = "mempool"; writeFileSync(w.chainFile, JSON.stringify(c)); };
// B51 (P3-2): the next send answers "already exists in mempool" WITHOUT recording anything — the lie.
const armLiar = (w: World) => { const c = chain(w); c.send_mode = "lie"; writeFileSync(w.chainFile, JSON.stringify(c)); };
const addTopUp = (w: World, zats: number) => {
  const c = chain(w);
  c.notes.push({ txid: hash("b47-topup-run-" + w.label), height: 90300, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "11", action_index: 0, value_zats: zats, memo_hex: null, spent_in_txid: null });
  writeFileSync(w.chainFile, JSON.stringify(c));
};

// ---- the expected arithmetic (independent of the worker's own computation) ---
const feeOf = (noteCount: number) => 5000 * Math.max(2, noteCount);
// B52: the ordinary batch's fee the wallet really charges — (fx notes + fee-reserve note) spends and
// (rows + change) outputs in one pool: max(spends, outputs) actions. The old note-count-only figure
// undercounted whenever the batch has more outputs than spends (5 rows + change = 6 outputs here).
const batchFeeOf = (w: { fx: { notes: unknown[] }; obligationRows: unknown[] }) =>
  feeRule(Array(w.fx.notes.length + 1).fill("ironwood"), Array(w.obligationRows.length + 1).fill("ironwood")).fee;
// B52 (P3-8c): the fee rule the stub tool computes and the cases pin independently — per pool,
// max(spends, outputs), each bundle padded to at least 2 actions; fee 5,000 x max(2, total actions).
const feeRule = (spendPools: string[], outPools: string[]): { actions: number; fee: number } => {
  const counts: Record<string, { s: number; o: number }> = {};
  for (const p of spendPools) { counts[p] ??= { s: 0, o: 0 }; counts[p].s++; }
  for (const p of outPools) { counts[p] ??= { s: 0, o: 0 }; counts[p].o++; }
  const actions = Object.values(counts).reduce((s, c) => s + (c.s + c.o > 0 ? Math.max(2, Math.max(c.s, c.o)) : 0), 0);
  return { actions, fee: 5000 * Math.max(2, actions) };
};
const scenario = (w: World) => {
  const spendable0 = w.obligationZats + w.feeReserve;
  const batchFee = batchFeeOf(w);
  const change = spendable0 - w.obligationZats - batchFee;
  const returnFee = feeOf(1);
  return { batchFee, change, returnFee, returnAmount: change - returnFee };
};

// ==============================================================================
// GREEN cases
// ==============================================================================
async function green() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const legacy = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD) });

  // ---- world W1: cases (a), (b), (d) ----------------------------------------
  const w1 = writeWorld("w1", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  const sc1 = scenario(w1);

  console.log("=== case (a): ordinary batches pay every row while the return waits (catches R107)");
  const a = runSettle(w1);
  console.log(`OBSERVE case-a exit=${a.code}`);
  console.log(a.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  const aReceipts = existsSync(path.join(w1.state, "settle", w1.id, "receipts.json")) ? receiptsOf(w1) : [];
  check("a-exit-0", a.code === 0, `benzo settle exits 0 (exit ${a.code}${a.err ? `; stderr ${a.err.trim().split("\n").at(-1)?.slice(0, 120)}` : ""})`);
  check("a-rows-paid", aReceipts.length === w1.obligationRows.length && w1.obligationRows.every(o => aReceipts.some((r: any) => r.party === o.party && r.amount_zats === o.amount_zats)),
    `all ${w1.obligationRows.length} ordinary rows paid (receipts: ${aReceipts.length} — ${aReceipts.map((r: any) => r.party).join(", ")})`);
  const aSettlement = settlementOf(w1);
  check("a-return-waits", !!aSettlement && (aSettlement.reserve_return === undefined) && !aReceipts.some((r: any) => r.party === "reserve-return"),
    "the return is not paid in this run (no reserve_return accounting, no receipt)");
  // B49 ("paid" means approved AND mined 10 deep): the return now waits at the shared paid gate — the
  // paying batch's receipt is not 10 confirmations deep yet, so its rows are still outstanding and no
  // return batch is even allocated (previously the return pass reached the wallet and died in the host
  // build with the live InsufficientFunds line).
  check("a-return-waits-at-the-paid-gate", /reserve return waits: 5 outstanding \(strays\/balances\/exceptions\)/.test(settleLog(w1)),
    "the return pass waits at the new paid gate: the paying batch is not 10 confirmations deep yet (B49)");
  check("a-no-return-attempt", !/InsufficientFunds/.test(a.err) && !/ERROR reserve-return pass/.test(a.err),
    "nothing of the return is attempted while the receipts are not deep (no build, no InsufficientFunds line)");
  const c1 = chain(w1);
  check("a-one-broadcast", c1.broadcasts.length === 1 && a.err.includes(`settlement broadcast ${c1.broadcasts[0]}`) && (a.err.match(/settlement broadcast /g) ?? []).length === 1,
    `exactly one transaction broadcast and mined (${c1.broadcasts[0]?.slice(0, 16)}…), the ordinary batch`);
  check("a-amounts", aReceipts.reduce((s: number, r: any) => s + Number(r.amount_zats), 0) === w1.obligationZats,
    `the rows total the obligations total (${w1.obligationZats} zats)`);
  const w1ledger = () => {
    const db = new DatabaseSync(path.join(w1.state, "settle", w1.id, "ledger.sqlite"), { readOnly: true });
    try { return db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all() as any[]; } finally { db.close(); }
  };
  const batchesAfterA = w1ledger();
  check("a-no-return-batch", batchesAfterA.length === 1,
    `no return batch exists after the run (${JSON.stringify(batchesAfterA)}) — the return waits for the paying batch's 10 confirmations`);

  console.log("=== case (b): the return is planned after the last batch mines, built, approved, broadcast, recorded (catches R107b)");
  bumpTip(w1, 12); // the last batch's change is now spendable (the wallet's 10-confirmation rule)
  const b = runSettle(w1);
  console.log(`OBSERVE case-b exit=${b.code}`);
  console.log(b.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  const bReceipts = receiptsOf(w1), bSettlement = settlementOf(w1);
  check("b-exit-0", b.code === 0, `benzo settle exits 0 (exit ${b.code}${b.err ? `; stderr ${b.err.trim().split("\n").at(-1)?.slice(0, 120)}` : ""})`);
  check("b-return-paid", bReceipts.length === w1.obligationRows.length + 1 && bReceipts.some((r: any) => r.party === "reserve-return" && r.amount_zats === String(sc1.returnAmount)),
    `the reserve-return receipt is recorded (${sc1.returnAmount} zats = ${sc1.change} − ${sc1.returnFee} fee)`);
  check("b-accounting", !!bSettlement && bSettlement.reserve_return && bSettlement.reserve_return.remaining_zats === String(sc1.change) && bSettlement.reserve_return.fee_zats === String(sc1.returnFee),
    `the published accounting {remaining_zats:${bSettlement?.reserve_return?.remaining_zats}, fee_zats:${bSettlement?.reserve_return?.fee_zats}} matches the sweep`);
  const cAfterB = chain(w1);
  check("b-broadcast", cAfterB.broadcasts.length === 2 && b.err.includes(`settlement broadcast ${cAfterB.broadcasts[1]}`),
    `the return batch was broadcast and mined (${cAfterB.broadcasts[1]?.slice(0, 16)}…)`);
  check("b-hosts-approved", signerNames.slice(0, 2).every(n => existsSync(path.join(w1.hosts[n], "approvals", w1.id, "batch-2.json"))),
    "both signing hosts recorded their approval of the return batch");
  check("b-vault-swept", chain(w1).notes.every((n: any) => (n.spent_in_txid ?? null) !== null || Number(n.value_zats) === 0),
    "the vault holds no unspent value after the sweep");

  console.log("=== case (d): a re-run after the return exits 0 and leaves the published dir byte-identical (H20 item 2)");
  const before = dirDigest(w1.publicDir);
  const d = runSettle(w1);
  const after = dirDigest(w1.publicDir);
  console.log(`OBSERVE case-d exit=${d.code}`);
  check("d-exit-0", d.code === 0, `the re-run exits 0 (exit ${d.code}${d.err ? `; stderr ${d.err.trim().split("\n").at(-1)?.slice(0, 120)}` : ""})`);
  check("d-byte-identical", JSON.stringify(before) === JSON.stringify(after),
    `the published dir is byte-identical (${Object.keys(before).length} files, unchanged: ${Object.keys(before).join(", ")})`);
  check("d-settled-unchanged", d.out.includes(`"settled":${w1.obligationRows.length + 1}`) && receiptsOf(w1).length === w1.obligationRows.length + 1,
    "the re-run changes nothing: the same receipts are recorded");

  // ---- world W2: case (c) ----------------------------------------------------
  console.log("=== case (c): the broadcast answers 'already exists in mempool' and the worker continues (H20 item 1)");
  const w2 = writeWorld("w2", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  armMempool(w2);
  const c1r = runSettle(w2);
  bumpTip(w2, 12);
  armMempool(w2);
  const c2r = runSettle(w2);
  console.log(`OBSERVE case-c exits=${c1r.code},${c2r.code}`);
  const cReceipts = receiptsOf(w2);
  const mempoolErrors = (settleLog(w2).match(/transaction already exists in mempool/g) ?? []).length;
  check("c-exit-0", c1r.code === 0 && c2r.code === 0, `both settles exit 0 despite the send errors (${c1r.code}, ${c2r.code})`);
  check("c-send-errors-seen", mempoolErrors >= 2, `the stub answered "already exists in mempool" ${mempoolErrors} times (once per armed send)`);
  check("c-continues-records", cReceipts.length === w2.obligationRows.length + 1 && c1r.err.includes("settlement broadcast") && c2r.err.includes("settlement broadcast"),
    `the worker counted each resend as broadcast and recorded every receipt (${cReceipts.length})`);
  check("c-settlement-complete", !!settlementOf(w2)?.reserve_return, "the published settlement is complete (rows, receipts and the return accounting)");

  // ---- world W3: case (e) ----------------------------------------------------
  console.log("=== case (e): an under-funded reserve stops at the preflight with the exact top-up line (H19)");
  const w3 = writeWorld("w3", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 5000 });
  const eSpendable = w3.obligationZats + 5000;
  // B51 (P3): the bound counts one extra spend per remaining batch (the change re-spend) and the top-up
  // uses R109's margin (shortfall + max(ceil(shortfall/10), 5000)) — the pre-R109 formula this case used
  // to re-derive would not fail the suite if the +5000 floor were reverted (Reviewer R P3-1's test gap).
  const eFeeBound = 5000 * (w3.fx.notes.length + 1 + w3.obligationRows.length + 2);
  const eShortfall = w3.obligationZats + eFeeBound - eSpendable;
  const eTopUp = eShortfall + Math.max(Math.ceil(eShortfall / 10), 5000);
  const e1 = runSettle(w3);
  console.log(`OBSERVE case-e preflight exit=${e1.code}`);
  const eLine = `ERROR settle fee reserve short: pay ${eTopUp} zats to ${FEE_RESERVE_UA} and run benzo settle again`;
  check("e-preflight-line", e1.err.includes(eLine), `the exact top-up line is printed: "${eLine}"`);
  check("e-nothing-broadcast", chain(w3).broadcasts.length === 0 && chain(w3).pending.length === 0, "nothing was broadcast (the stop is before the first batch)");
  const hostStubs = signerNames.map(n => {
    const dir = path.join(w3.shared, "hosts", n);
    return existsSync(dir) ? execFileSync("ls", ["-1", dir], { encoding: "utf8" }) : "";
  }).join("\n");
  check("e-no-host-build", !/build-|approvals|created\.pczt/.test(hostStubs), "no host build ran (the stop is before any host build)");
  addTopUp(w3, eTopUp);
  const e2 = runSettle(w3);
  bumpTip(w3, 12);
  const e3 = runSettle(w3);
  console.log(`OBSERVE case-e completes exits=${e2.code},${e3.code}`);
  const eSettlement = settlementOf(w3);
  check("e-completes", e2.code === 0 && e3.code === 0 && !!eSettlement?.reserve_return && receiptsOf(w3).length === w3.obligationRows.length + 1,
    `after the top-up of exactly ${eTopUp} zats the settlement completes (return accounting ${JSON.stringify(eSettlement?.reserve_return ?? null)})`);

  // ---- world W4: case (f) ----------------------------------------------------
  console.log("=== case (f): a legacy manifest settles with no return and its one WARN line");
  const w4 = writeWorld("w4", legacy, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  const f = runSettle(w4);
  console.log(`OBSERVE case-f exit=${f.code}`);
  const fSettlement = settlementOf(w4), fLog = settleLog(w4);
  const warnCount = (fLog.match(/^WARN the reserve stays in the vault \(legacy, H15\)/gm) ?? []).length;
  const planRuns = (fLog.match(/"manifest_hash":"/g) ?? []).length;
  check("f-exit-0", f.code === 0, `benzo settle exits 0 on the legacy manifest (exit ${f.code})`);
  check("f-no-return", !fSettlement?.reserve_return && !receiptsOf(w4).some((r: any) => r.party === "reserve-return") && chain(w4).broadcasts.length === 1,
    "no reserve-return row is planned, built or paid (one broadcast: the ordinary batch)");
  check("f-warn-line", warnCount >= 1 && warnCount === planRuns && !/reserve return waits/.test(fLog),
    `its one WARN line per plan run (${warnCount} lines for ${planRuns} plan runs), and no waits line`);

  // ---- world W5: case (g) ----------------------------------------------------
  console.log("=== case (g): a re-run with one batch broadcast and mined but unconfirmed confirms it and continues (B51 P2-2)");
  const w5 = writeWorld("w5", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  const g5 = seedBroadcastUnconfirmed(w5);
  const g1 = runSettle(w5);
  console.log(`OBSERVE case-g first re-run exit=${g1.code}`);
  console.log(g1.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  const gReceipts = receiptsOf(w5);
  check("g-no-preflight-refusal", !/fee reserve short/.test(g1.err) && g1.code === 0,
    `the re-run never demands the total batch 1 already paid (exit ${g1.code}${g1.err ? `; stderr ${g1.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1)?.slice(0, 120) ?? ""}` : ""})`);
  check("g-confirms-the-batch", w5.obligationRows.every(o => gReceipts.some((r: any) => r.party === o.party && r.amount_zats === o.amount_zats && r.txid === g5.tx1)),
    `the resumed batch is confirmed from its own mined height (${gReceipts.length} receipts; the ${w5.obligationRows.length} rows at ${g5.tx1.slice(0, 16)}…)`);
  check("g-never-rebroadcast", chain(w5).broadcasts.filter((t: string) => t === g5.tx1).length === 1 && chain(w5).broadcasts[0] === g5.tx1,
    "batch 1 was never re-sent: its mined transaction was read and confirmed, not re-broadcast (the only other broadcast is the return)");
  const gSettlement = settlementOf(w5);
  check("g-continues-to-the-return", g1.out.includes('"settled":6') && !!gSettlement?.reserve_return && gReceipts.some((r: any) => r.party === "reserve-return"),
    `the same benzo settle continues past the confirmation and completes the return (accounting ${JSON.stringify(gSettlement?.reserve_return ?? null)})`);
  const g2 = runSettle(w5);
  check("g-rerun-clean", g2.code === 0 && receiptsOf(w5).length === gReceipts.length,
    `a further re-run is clean and changes nothing (exit ${g2.code}, ${receiptsOf(w5).length} receipts)`);

  // ---- world W6: case (h) ----------------------------------------------------
  console.log("=== case (h): the R109 margin pinned — a 20,000-zat shortfall asks for exactly 25,000 (B51 P3)");
  const w6 = writeWorld("w6", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 40000 });
  const hShortfall = 5000 * (w6.fx.notes.length + 1 + w6.obligationRows.length + 2) - w6.feeReserve;
  const hTopUp = hShortfall + Math.max(Math.ceil(hShortfall / 10), 5000);
  const h1 = runSettle(w6);
  console.log(`OBSERVE case-h preflight exit=${h1.code}`);
  const hLine = `ERROR settle fee reserve short: pay ${hTopUp} zats to ${FEE_RESERVE_UA} and run benzo settle again`;
  check("h-shortfall-20000-asks-25000", hShortfall === 20000 && hTopUp === 25000 && h1.err.includes(hLine),
    `a ${hShortfall}-zat shortfall asks for exactly ${hTopUp} zats (the change re-spend per remaining batch counted): ${h1.err.includes(hLine) ? "the exact line is printed" : `got: ${h1.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1) ?? "(no line)"}`}`);
  check("h-margin-floor-pinned", hTopUp - hShortfall === 5000,
    "the margin is max(ceil(20000/10), 5000) = 5000 — reverting to the pre-R109 ceil/10 would ask 22000 and fail this pin");
  addTopUp(w6, hTopUp);
  const h2 = runSettle(w6);
  bumpTip(w6, 12);
  const h3 = runSettle(w6);
  const hSettlement = settlementOf(w6);
  console.log(`OBSERVE case-h completes exits=${h2.code},${h3.code}`);
  check("h-completes-after-exact-top-up", h2.code === 0 && h3.code === 0 && !!hSettlement?.reserve_return && receiptsOf(w6).length === w6.obligationRows.length + 1,
    `topping up exactly ${hTopUp} zats suffices (the equality case passes at zero): the settlement completes (return accounting ${JSON.stringify(hSettlement?.reserve_return ?? null)})`);

  // ---- world W7: case (i) ----------------------------------------------------
  console.log("=== case (i): a send that lies 'already exists in mempool' is not trusted — the staged txid must be known (B51 P3)");
  const w7 = writeWorld("w7", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  armLiar(w7);
  const i1 = runSettle(w7);
  console.log(`OBSERVE case-i exit=${i1.code}`);
  console.log(i1.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  const iLies = (settleLog(w7).match(/transaction already exists in mempool/g) ?? []).length;
  check("i-lie-never-accepted", iLies === 1 && i1.code === 0 && (i1.err.match(/settlement broadcast /g) ?? []).length === 1,
    `the lie was answered once and never counted as broadcast: the send was retried with the same bytes and really recorded (exit ${i1.code}, ${iLies} lie)`);
  check("i-really-broadcast", chain(w7).broadcasts.length === 1 && receiptsOf(w7).length === w7.obligationRows.length,
    `the transaction was really broadcast on the retry (${chain(w7).broadcasts[0]?.slice(0, 16)}…) and the ${w7.obligationRows.length} rows are receipted`);
  bumpTip(w7, 12);
  const i2 = runSettle(w7);
  check("i-completes", i2.code === 0 && !!settlementOf(w7)?.reserve_return,
    `the settlement completes after the retry (exit ${i2.code}, accounting ${JSON.stringify(settlementOf(w7)?.reserve_return ?? null)})`);

  // ---- case (j): the kept accounting comes only from the ledger's own record (B51 P3-3) --------------------
  console.log("=== case (j): with the paid batch's inspect record gone, a re-run refuses — a doc never feeds its own accounting back (B51 P3)");
  const jBefore = dirDigest(w1.publicDir);
  const jInspect = path.join(w1.state, "settle", w1.id, "batch-2.inspect.json");
  const jHadInspect = existsSync(jInspect);
  rmSync(jInspect, { force: true });
  const j1 = runSettle(w1);
  const jAfter = dirDigest(w1.publicDir);
  console.log(`OBSERVE case-j exit=${j1.code}`);
  console.log(j1.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  check("j-refuses-without-ledger-record", jHadInspect && j1.code === 1 && /a paid reserve-return receipt without its accounting in the ledger/.test(j1.err),
    `the re-run refuses instead of reading the accounting back out of the published doc (exit ${j1.code}; ${j1.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1)?.slice(0, 140) ?? "(no ERROR line)"})`);
  check("j-nothing-republished", JSON.stringify(jBefore) === JSON.stringify(jAfter),
    "the published dir is untouched — nothing was re-derived and nothing was re-fed from the doc");

  // ---- world W8: case (a2) — the cross-pool vault (B52, P2-1) ------------------------------------------
  console.log("=== case (a2): the cross-pool vault — the plan quotes the tool's fee, the hosts approve, settle completes, verify accepts (B52)");
  const w8 = writeWorld("w8", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 120000 });
  // The settled vault's unspent value is THREE ORCHARD notes (the reviewer's cross-pool vault; the
  // committed return UA receives in Ironwood).
  const a2seed = seedPostBatchOne(w8, { allocatesReturn: false, changeNotes: [{ pool: "orchard", value: 50000 }, { pool: "orchard", value: 30000 }, { pool: "orchard", value: 15000 }] });
  const a2shape = feeRule(["orchard", "orchard", "orchard"], ["ironwood"]);
  const a2Amount = a2seed.change - a2shape.fee;
  const a2 = runSettle(w8);
  console.log(`OBSERVE case-a2 exit=${a2.code}`);
  console.log(a2.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  const a2Receipts = receiptsOf(w8), a2Settlement = settlementOf(w8);
  check("a2-exit-0", a2.code === 0, `benzo settle exits 0 (exit ${a2.code}${a2.err ? `; stderr ${a2.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1)?.slice(0, 120) ?? ""}` : ""})`);
  check("a2-quote-25000", a2shape.actions === 5 && a2shape.fee === 25000 && a2Receipts.some((r: any) => r.party === "reserve-return" && r.amount_zats === String(a2Amount)),
    `the plan quotes the sweep at ${a2shape.fee} zats (3 Orchard + 1 Ironwood bundle, each padded to its 2-action floor: ${a2shape.actions} actions) and the return pays ${a2Amount} of ${a2seed.change} — the removed prediction said 15,000 (STATUS-B Q1: the design text's 20,000 is the unpadded arithmetic)`);
  check("a2-accounting", !!a2Settlement?.reserve_return && a2Settlement.reserve_return.remaining_zats === String(a2seed.change) && a2Settlement.reserve_return.fee_zats === String(a2shape.fee),
    `the published accounting ${JSON.stringify(a2Settlement?.reserve_return ?? null)} carries the tool's own fee`);
  check("a2-hosts-approved", signerNames.slice(0, 2).every(n => existsSync(path.join(w8.hosts[n], "approvals", w8.id, "batch-2.json"))),
    "both signing hosts approved the cross-pool return batch");
  const a2verify = runVerify(w8);
  check("a2-verify-accepts", a2verify.code === 0 && !/^ERROR/m.test(a2verify.err),
    `benzo verify accepts the published dir (exit ${a2verify.code}); ${a2verify.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);

  // ---- world W9: case (e) — a pending mixed return batch (H23) -----------------------------------------
  console.log("=== case (e): a pending mixed return batch is set aside as an exception, its rows re-plan (H23)");
  const w9 = writeWorld("w9", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 70000 });
  seedMixedPending(w9);
  const h23a = runSettle(w9);
  console.log(`OBSERVE case-e mixed exit=${h23a.code}`);
  console.log(h23a.err.trim().split("\n").map(l => "  | " + l).join("\n"));
  const mixedBatches = () => {
    const db = new DatabaseSync(path.join(w9.state, "settle", w9.id, "ledger.sqlite"), { readOnly: true });
    try { return db.prepare("SELECT id,pczt_hash,txid,height,state FROM batches ORDER BY id").all() as any[]; } finally { db.close(); }
  };
  const eBatches = mixedBatches();
  check("e-mixed-set-aside", h23a.code === 0 && /reserve-return mixed with rows \(H23\)/.test(h23a.err) && eBatches.some((b: any) => b.id === 1 && b.state === "exception"),
    `the mixed batch is set aside as an exception with the reason reserve-return mixed with rows (H23) and the run completes (exit ${h23a.code}): ${JSON.stringify(eBatches)}`);
  const e1Receipts = receiptsOf(w9);
  check("e-rows-replan", e1Receipts.length === w9.obligationRows.length && w9.obligationRows.every(o => e1Receipts.some((r: any) => r.party === o.party)),
    `the mixed batch's ordinary rows re-plan and settle in the same run (${e1Receipts.length} receipts)`);
  bumpTip(w9, 12);
  const h23b = runSettle(w9);
  const e2Receipts = receiptsOf(w9);
  check("e-return-completes", h23b.code === 0 && e2Receipts.some((r: any) => r.party === "reserve-return") && !!settlementOf(w9)?.reserve_return,
    `the next settle completes the return (exit ${h23b.code}, accounting ${JSON.stringify(settlementOf(w9)?.reserve_return ?? null)})`);

  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}

// ==============================================================================
// RED legs (base bundles from pristine 8a9f638)
// ==============================================================================
function seedPostBatchOne(w: World, opts: { allocatesReturn?: boolean; changeNotes?: { pool: string; value: number }[] } = {}) {
  // The exact world the live run was in at the R107b crash, written through the REAL Ledger class: batch 1
  // mined with every ordinary row receipted, the published settlement carrying those five receipts (published
  // after pass 1 — the return batch was allocated only in the failed pass 2), and the return row allocated to
  // batch 2 with no transaction. The chain shows the batch's change as spendable.
  // B52: `changeNotes` splits the batch's change into notes of chosen pools (the cross-pool world of case
  // (a2): THREE ORCHARD change notes), and `allocatesReturn: false` seeds only batch 1 — the run then plans
  // and allocates the return itself.
  const id = w.id;
  const tx1 = hash("b47-seed-batch1-" + w.label);
  const c = chain(w);
  const spends = c.notes.filter((n: any) => w.fx.notes.some((f: any) => f.txid === n.txid) || n.address === FEE_RESERVE_UA).map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`);
  for (const n of c.notes) if (spends.includes(`${n.txid}:${n.pool}:${n.action_index}`)) n.spent_in_txid = tx1;
  c.tip = 100012;
  c.mined[tx1] = { height: 100001, rows: [] };
  c.broadcasts.push(tx1);
  // B49: the batch's change note carries the batch's txid (the scan's mined-height evidence for the
  // "paid" rule) and each host's own approval ledger records that it approved batch 1's rows at their
  // amounts — exactly what the real `sign approve` recorded when the batch was approved.
  const changeTotal = w.obligationZats + w.feeReserve - w.obligationZats - batchFeeOf(w);
  const changeNotes = opts.changeNotes ?? [{ pool: "ironwood", value: changeTotal }];
  for (const [i, note] of changeNotes.entries())
    c.notes.push({ txid: tx1, height: 100001, pool: note.pool, address: CHANGE_ADDR, diversifier_index: "99", action_index: i,
      value_zats: note.value, memo_hex: null, spent_in_txid: null });
  const changeSum = changeNotes.reduce((s, n) => s + n.value, 0);
  for (const n of signerNames) {
    const adir = path.join(w.hosts[n], "approvals", w.id);
    mkdirSync(adir, { recursive: true, mode: 0o700 });
    const mapped = w.obligationRows.map((o, i) => ({ party: o.party, output_index: i, amount_zats: String(o.amount_zats) }));
    const sources = [...new Set(w.obligationRows.map((o) => (o.party.startsWith("leaf:") ? `deposit:${w.fx.notes[Number(o.party.slice(5))].txid}:ironwood:${Number(o.party.slice(5))}` : o.party)) )];
    writeFileSync(path.join(adir, "ledger.json"), JSON.stringify([{ batch: 1, txid: tx1, expiry_height: 100364, approved_tip: 100000, sources, mapped }]) + "\n", { mode: 0o600 });
  }
  writeFileSync(w.chainFile, JSON.stringify(c));
  const sc = scenario(w);
  const ledger = new Ledger(w.state, id);
  ledger.pin(w.obligationRows as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  const pczt = path.join(w.state, "settle", id, "batch-1.pczt");
  writeFileSync(pczt, `b47 seeded batch 1 ${tx1}\n`);
  ledger.stage(batch.id, pczt, tx1);
  ledger.confirm(batch.id, tx1, 100001, w.obligationRows.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "ironwood" })));
  if (opts.allocatesReturn !== false) {
    ledger.pin([{ party: "reserve-return", kind: "payout", amount_zats: String(sc.returnAmount) }] as any);
    ledger.eligible();
    ledger.allocate(13);
  }
  const rows = ledger.rows();
  const receipts = ledger.receipts();
  ledger.close();
  const sd = path.join(w.state, "settle", id);
  const maps = [0, 1].map(i => signApprovalMap({ auction_id: id, batch: 1, txid: tx1, outputs: w.obligationRows.map((o, i2) => ({ party: o.party, output_index: i2 })), defaults: [], balance_refunds: [] }, witnessPrivate(String(i))));
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes(maps));
  writeFileSync(path.join(sd, "receipts.json"), jsonBytes(receipts));
  writeFileSync(path.join(sd, "summary.json"), jsonBytes({ auction_id: id, lwd_endpoints: ["127.0.0.1:9", "127.0.0.1:10"], rows: rows.filter((r: any) => r.party !== "reserve-return"),
    batches: [{ id: 1, pczt_hash: hash(readFileSync(pczt)), txid: tx1, height: 100001, state: "mined" }], signoffs: [], plan: {}, offline_signer: "alice" }));
  // The real publish writes the public dir from exactly these state files.
  const republish = path.join(ROOT, "tmp/b47-republish.mjs");
  const r = spawnSync(process.execPath, [republish, id], { encoding: "utf8", env: { ...process.env, ...worldEnv(w) } });
  if (r.status !== 0) throw new Error(`republish failed: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return { tx1, returnAmount: sc.returnAmount, change: changeSum };
}

// B52 (H23, docs/design/phase7-b52-return-fee.md item 5): the pre-B52 wedge — a PENDING batch whose rows
// were allocated TOGETHER (the reserve-return row with the ordinary rows; the old `allocate` had no return
// rule and the worker's own-batch check then threw mid-loop after the batch was committed, so every re-run
// resurfaced it). Written through the REAL Ledger class: one batch, no transaction, every row allocated.
function seedMixedPending(w: World) {
  const id = w.id;
  const sc = scenario(w);
  const ledger = new Ledger(w.state, id);
  ledger.pin([...w.obligationRows, { party: "reserve-return", kind: "payout", amount_zats: String(sc.returnAmount) }] as any);
  ledger.eligible();
  ledger.db.prepare("INSERT INTO batches(id) VALUES(?)").run(1);
  ledger.db.prepare("UPDATE obligations SET state='allocated',batch=1").run();
  const rows = ledger.rows();
  ledger.close();
  return { rows, returnAmount: sc.returnAmount };
}

// B51 (P2-2) — the reviewer's probe world: batch 1 is staged with its txid and that transaction has ALREADY
// MINED on the stub chain (its funding notes spent, one mature change note) — but the ledger never confirmed
// it (the process died between broadcast and `ledger.confirm`). The rows are still `allocated`. Written through
// the REAL Ledger class; the staged PCZT is the stub's own JSON body, so the worker really resumes it, reads
// its mined height and confirms it. Nothing is published and no receipts.json exists — the re-run does that.
function seedBroadcastUnconfirmed(w: World) {
  const id = w.id;
  const sd = path.join(w.state, "settle", id);
  const batchFee = batchFeeOf(w);
  const change = w.feeReserve - batchFee;
  const c = chain(w);
  const spends = c.notes.map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`);
  const pczt = path.join(sd, "batch-1.pczt");
  // The stub create/inspect world: the batch pays the obligation rows and its change is one note. Its txid is
  // exactly sha256 of the signed bytes, as `pczt extract` computes it.
  writeFileSync(pczt, JSON.stringify({ rows: w.obligationRows.map(o => ({ recipient: UA_ORCHARD, amount_zats: o.amount_zats })),
    input_zats: w.obligationZats + w.feeReserve, fee_zats: batchFee, change_zats: change, spends, spend_values: c.notes.map((n: any) => Number(n.value_zats)), expiry_height: 100364 }));
  const tx1 = hash(readFileSync(pczt));
  for (const n of c.notes) if (spends.includes(`${n.txid}:${n.pool}:${n.action_index}`)) n.spent_in_txid = tx1;
  c.tip = 100012;
  c.mined[tx1] = { height: 100001, rows: [] };
  c.broadcasts.push(tx1);
  // B49: the change note carries the transaction's own txid (the scan's mined-height evidence) at a mature
  // height — the exact probe shape ("a mature 35,000-zat change note").
  c.notes.push({ txid: tx1, height: 100001, pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "99", action_index: 0,
    value_zats: change, memo_hex: null, spent_in_txid: null });
  writeFileSync(w.chainFile, JSON.stringify(c));
  // Each host's own approval ledger records batch 1's rows at their amounts — what the real `sign approve`
  // recorded before the crash (B49's "paid" rule's ledger half).
  for (const n of signerNames) {
    const adir = path.join(w.hosts[n], "approvals", id);
    mkdirSync(adir, { recursive: true, mode: 0o700 });
    const mapped = w.obligationRows.map((o, i) => ({ party: o.party, output_index: i, amount_zats: String(o.amount_zats) }));
    const sources = [...new Set(w.obligationRows.map((o) => (o.party.startsWith("leaf:") ? `deposit:${w.fx.notes[Number(o.party.slice(5))].txid}:ironwood:${Number(o.party.slice(5))}` : o.party)))];
    writeFileSync(path.join(adir, "ledger.json"), JSON.stringify([{ batch: 1, txid: tx1, expiry_height: 100364, approved_tip: 100000, sources, mapped }]) + "\n", { mode: 0o600 });
  }
  // The worker's own confirmation inputs: the hosts' signed {party, output_index} maps and the builder's
  // build.json cross-check for batch 1.
  writeFileSync(path.join(sd, "batch-1.build.json"), jsonBytes({ outputs: w.obligationRows.map((o, i) => ({ party: o.party, output_index: i })) }));
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes([0, 1].map(i => signApprovalMap({ auction_id: id, batch: 1, txid: tx1,
    outputs: w.obligationRows.map((o, i2) => ({ party: o.party, output_index: i2 })), defaults: [], balance_refunds: [] }, witnessPrivate(String(i))))));
  const ledger = new Ledger(w.state, id);
  ledger.pin(w.obligationRows as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  ledger.stage(batch.id, pczt, tx1);
  // The crash: staged and mined, never confirmed — the rows stay `allocated`.
  const rows = ledger.rows();
  ledger.close();
  return { tx1, change, rows };
}

async function red() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });

  console.log("=== red (a) on base bundles (8a9f638): the R107 wall — nothing can settle");
  const w = writeWorld("w1-base", fx, { root: BASE, benzo: BASE_BENZO, feeReserve: 60000 });
  const a = runSettle(w);
  console.log(`OBSERVE a-red exit=${a.code}`);
  console.log((a.err || a.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  const refused = (a.err.match(/refused-rows \["reserve-return"\]/g) ?? []).length;
  check("a-red-exit-1", a.code !== 0, `the settle refuses (exit ${a.code})`);
  check("a-red-r107-signature", refused === 3 && /no signer host could list its derivable rows/.test(a.err) && /the auction still owes 5 outstanding/.test(a.err),
    `the exact R107 signature of the h15-live transcript: ${refused} hosts refused with refused-rows ["reserve-return"], then "no signer host could list its derivable rows"`);
  check("a-red-nothing-paid", chain(w).broadcasts.length === 0 && !existsSync(path.join(w.state, "settle", w.id, "receipts.json")),
    "nothing was broadcast and no receipt recorded — the live run could not settle at all before R107's fix");

  console.log("=== red (b) on base bundles (8a9f638): the R107b crash on the live post-R107 world");
  const w2 = writeWorld("w2-base", fx, { root: BASE, benzo: BASE_BENZO, feeReserve: 60000 });
  const seeded = seedPostBatchOne(w2);
  console.log(`OBSERVE seeded return row ${seeded.returnAmount} zats allocated to batch 2 (the live state at the crash)`);
  const b = runSettle(w2);
  console.log(`OBSERVE b-red exit=${b.code}`);
  console.log((b.err || b.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  check("b-red-exit-1", b.code !== 0, `the settle crashes (exit ${b.code})`);
  check("b-red-r107b-signature", /ERROR settle Cannot read properties of null \(reading 'amount_zats'\)/.test(b.err),
    "the exact R107b signature of the h15-live transcript: the plan no longer derives the return (its own batch is pending) and the worker reads its amount from the plan");
  const after = chain(w2);
  check("b-red-return-not-recorded", after.broadcasts.length === 1 && receiptsOf(w2).length === 5 && !settlementOf(w2)?.reserve_return,
    "the base worker never records the return (it crashes before signing completes)");

  console.log("=== green on the same seeded world: this tree completes the return (the red/green pair)");
  const wg = writeWorld("w2-green-seed", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  const seededGreen = seedPostBatchOne(wg);
  const g = runSettle(wg);
  console.log(`OBSERVE b-green-same-world exit=${g.code}`);
  check("b-green-same-world", g.code === 0 && receiptsOf(wg).some((r: any) => r.party === "reserve-return" && r.amount_zats === String(seededGreen.returnAmount)) && !!settlementOf(wg)?.reserve_return,
    `the identical seeded world settles green on this tree (${seededGreen.returnAmount} zats returned, accounting published)`);

  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}

// ==============================================================================
// B51 red legs (base bundles from a107447 — docs/design/phase7-b51-review-fixes.md)
// ==============================================================================
async function red51() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });

  console.log("=== red (g) on base bundles (a107447): the H19 preflight double-counts the in-flight batch (P2-2)");
  const w = writeWorld("g-base", fx, { root: BASE51, benzo: BASE51_BENZO, feeReserve: 60000 });
  const seeded = seedBroadcastUnconfirmed(w);
  const demanded = w.obligationZats + Math.max(Math.ceil(w.obligationZats / 10), 5000);
  const g = runSettle(w);
  console.log(`OBSERVE g-red exit=${g.code}`);
  console.log((g.err || g.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  const line = `ERROR settle fee reserve short: pay ${demanded} zats to ${FEE_RESERVE_UA} and run benzo settle again`;
  check("g-red-preflight-refusal", g.code === 1 && g.err.includes(line),
    `the preflight refuses demanding ${demanded} zats — the total batch 1 ALREADY paid (${w.obligationZats} zats) plus the margin (the reviewer's probe line was "pay 4400440 zats"): ${g.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1)?.slice(0, 160) ?? "(no ERROR line)"}`);
  check("g-red-cannot-confirm", !existsSync(path.join(w.state, "settle", w.id, "receipts.json")) && chain(w).broadcasts.length === 1 &&
    seeded.rows.every((r: any) => r.state === "allocated"),
    "the run cannot even CONFIRM the batch that is already mined: no receipts recorded, nothing new broadcast, every row still allocated");

  console.log("=== red (h) on base bundles (a107447): the fee bound omits the change re-spend per remaining batch (P3)");
  const wh = writeWorld("h-base", fx, { root: BASE51, benzo: BASE51_BENZO, feeReserve: 40000 });
  const h = runSettle(wh);
  console.log(`OBSERVE h-red exit=${h.code}`);
  console.log((h.err || h.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  check("h-red-undercounted-bound", h.code === 1 && h.err.includes("pay 20000 zats") && !h.err.includes("pay 25000 zats"),
    `the base bound is short one spend per remaining batch: it demands 20000 zats where the pinned demand is 25000 (${h.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1)?.slice(0, 160) ?? "(no ERROR line)"})`);

  console.log("=== red (i) on base bundles (a107447): the send's 'already exists in mempool' text is trusted alone (P3-2)");
  const wi = writeWorld("i-base", fx, { root: BASE51, benzo: BASE51_BENZO, feeReserve: 60000 });
  armLiar(wi);
  const i = runSettle(wi, 45000); // the base accepts the lie and sits in the 30-minute mined-wait; the driver kills it
  console.log(`OBSERVE i-red exit=${i.code} killed=${i.killed}`);
  console.log((i.err || i.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  const lied = i.err.match(/settlement broadcast [0-9a-f]{64}/)?.[0] ?? "(none)";
  check("i-red-accepts-the-lie", lied !== "(none)" && i.killed,
    `the base trusted the error string alone — ${lied} — for a transaction nothing recorded, then sat in the 30-minute mined-wait (the reviewer's stall; the driver killed it at 45 s)`);
  check("i-red-nothing-recorded", chain(wi).broadcasts.length === 0 && chain(wi).pending.length === 0 && !existsSync(path.join(wi.state, "settle", wi.id, "receipts.json")),
    "nothing was broadcast, nothing is pending or mined, and no receipt was recorded");

  console.log("=== red (j) on base bundles (a107447): the kept fallback lets the published doc feed its own accounting back (P3-3)");
  const wj = writeWorld("j-base", fx, { root: BASE51, benzo: BASE51_BENZO, feeReserve: 60000 });
  seedPostBatchOne(wj);
  const j0 = runSettle(wj);
  const jInspect = path.join(wj.state, "settle", wj.id, "batch-2.inspect.json");
  const jHad = existsSync(jInspect) && !!settlementOf(wj)?.reserve_return;
  rmSync(jInspect, { force: true });
  const jRedBefore = dirDigest(wj.publicDir);
  const jAccBefore = JSON.stringify(settlementOf(wj)?.reserve_return ?? null);
  const j = runSettle(wj);
  const jRedAfter = dirDigest(wj.publicDir);
  const jAccAfter = JSON.stringify(settlementOf(wj)?.reserve_return ?? null);
  console.log(`OBSERVE j-red exits=${j0.code},${j.code} accounting ${jAccBefore} -> ${jAccAfter} changed=${JSON.stringify(digestDiff(jRedBefore, jRedAfter))}`);
  check("j-red-doc-feeds-itself", jHad && j0.code === 0 && j.code === 0 && jAccBefore !== "null" && jAccBefore === jAccAfter,
    `with the paid batch's own record gone the base re-reads the accounting out of the already-published doc (${jAccAfter}) and exits 0 — the doc feeds its own accounting back (the republication then drops the deleted batch inspect: ${JSON.stringify(digestDiff(jRedBefore, jRedAfter))})`);

  console.log("=== green on the same seeded world: this tree refuses instead of re-reading the published doc");
  const wjg = writeWorld("j-green", fx, { root: ROOT, benzo: GREEN_BENZO, feeReserve: 60000 });
  seedPostBatchOne(wjg);
  const jg0 = runSettle(wjg);
  rmSync(path.join(wjg.state, "settle", wjg.id, "batch-2.inspect.json"), { force: true });
  const jg = runSettle(wjg);
  check("j-green-same-world-refuses", jg0.code === 0 && jg.code === 1 && /without its accounting in the ledger/.test(jg.err),
    `the same seeded world refuses on this tree (exits ${jg0.code}, ${jg.code}) — the published doc can never feed its own accounting back`);

  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}

// ==============================================================================
// B52 red legs (base bundles from 59c863c — docs/design/phase7-b52-return-fee.md)
// ==============================================================================
async function red52() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });

  console.log("=== red (a2) on base bundles (59c863c): the predicted fee cannot build the cross-pool sweep (P2-1)");
  const w = writeWorld("a2-base", fx, { root: BASE52, benzo: BASE52_BENZO, feeReserve: 120000 });
  const seeded = seedPostBatchOne(w, { allocatesReturn: false, changeNotes: [{ pool: "orchard", value: 50000 }, { pool: "orchard", value: 30000 }, { pool: "orchard", value: 15000 }] });
  const a2 = runSettle(w);
  console.log(`OBSERVE a2-red exit=${a2.code}`);
  console.log((a2.err || a2.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  check("a2-red-crash-loop", a2.code !== 0 && /no signer host could build batch 2/.test(a2.err) && !/refused-rows/.test(a2.err),
    `the base plan's prediction (95,000 − 5,000 x max(2, 3) = 80,000) cannot balance the wallet's real 25,000 fee: every host's build dies UNYPED and benzo settle exits ${a2.code} at the return batch on every re-run (P2-1's wall)`);
  const a2b = runSettle(w);
  check("a2-red-every-rerun", a2b.code !== 0, `the re-run crashes the same way (exit ${a2b.code}) — the wall an honest re-run cannot pass`);
  check("a2-red-nothing-paid", !existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? true : !receiptsOf(w).some((r: any) => r.party === "reserve-return") && !settlementOf(w)?.reserve_return,
    `the return never completes on the base (no receipt, no accounting; ${seeded.change} zats stranded in the vault)`);

  console.log("=== red (e) on base bundles (59c863c): the mixed batch throws mid-loop and crash-loops (H23)");
  const we = writeWorld("e-base", fx, { root: BASE52, benzo: BASE52_BENZO, feeReserve: 70000 });
  seedMixedPending(we);
  const e = runSettle(we);
  console.log(`OBSERVE e-red exit=${e.code}`);
  console.log((e.err || e.out).trim().split("\n").map(l => "  | " + l).join("\n"));
  check("e-red-throws", e.code !== 0 && /the reserve-return row must be its own batch, alone/.test(e.err),
    `the base throws AFTER ledger.allocate committed the mixed batch: exit ${e.code} — every re-run resurfaces it`);
  const e2 = runSettle(we);
  check("e-red-still-pending", e2.code !== 0 && !existsSync(path.join(we.state, "settle", we.id, "receipts.json")) && chain(we).broadcasts.length === 0,
    `nothing is paid and the mixed batch stays pending — the H23 crash loop (re-run exit ${e2.code})`);

  console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
  process.exitCode = failed ? 1 : 0;
}

part === "after" ? await green() : part === "before52" ? await red52() : part === "before51" ? await red51() : await red();
