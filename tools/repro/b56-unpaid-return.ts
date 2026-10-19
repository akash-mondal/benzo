// Batch B56 proof (offline): an unpaid `reserve-return` row is never published (ruling R121, ruling on
// B54's Q4) — docs/design/phase7-b56-unpaid-return-row.md. Every product decision runs the real shipped
// code; only the offline-impossible externals are stubbed (the b47 stub harness tools/repro/b47-world.ts
// makeStubs and the h-fixtures host stubs), and the worlds are the b54 worlds (tools/repro/b54-dust-and-
// sweep.ts writeWorld/seedBatchOne, kept as a shared COPY here) with one new knob: the hosts' wallet scan
// can lag the shared chain state (fixture.json `host_scan_omit_txid` on the HOSTS only, read by this
// fold's own host `benzo-scan` stub — the one-note-behind plan/host skew of B54's Q4; inert without it).
//
// Red on the BASE commit 92fc8da bundles under tmp/b56/base-src (built ONCE from the pristine base
// commit), green after on this tree's bundles.
//
// Sections (the optional third argument runs one):
//   skew  (a) Plan/host skew: the plan derives the return, the host refuses it (one note behind). Red:
//         run 1 publishes the bare `reserve-return` exception row, its own verify refuses the doc
//         (`a reserve-return row or receipt without the published reserve_return accounting`) and every
//         later `benzo settle` dies before pinning (`no signer host could list its derivable rows`,
//         exit 1) — the permanent wall from a transient skew. Green: the doc publishes without the row,
//         verify accepts, the private ledger keeps the row, and a second run exits 0 with the typed
//         waits line (the pinned exception row's reason).
//   heal  (b) A pre-B56 published dir with a bare row (fabricated exactly as the base publish wrote it:
//         the summary rows verbatim) — the next run heals it. Red: the run dies at the wall (the stale
//         row stays, verify refuses). Green: the republish drops the row, verify accepts, and the run
//         proceeds (the row re-pins as its exception row with its reason; the skew persists so it stays
//         unpublished).
//   paid  (c) The normal path is unchanged: the same pre-B56 dir once the transient skew has healed
//         (the host wallet current again). Red: the base is still walled — the return is never paid.
//         Green: the run heals the dir AND pays the return normally — the row (paid), its receipt and
//         the published reserve_return accounting, verify accepts, and a re-run is clean. (The clean-
//         world paid path itself is the b46/b47/b54 folds, which stay green.)
//
// Build+run:
//   npx esbuild tools/repro/b56-unpaid-return.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b56.mjs
//   node tmp/b56.mjs after  [skew|heal|paid]
//   node tmp/b56.mjs before [skew|heal|paid]
//   base bundles, built ONCE from the pristine base commit (the b54 recipe, tmp/build-b56-bases.sh):
//     mkdir -p tmp/b56/base-src && git archive 92fc8da | tar -x -C tmp/b56/base-src && ln -s $PWD/node_modules tmp/b56/base-src/node_modules
//     (cd tmp/b56/base-src && node cli/build.mjs && for f in settle/plan.ts:settle/dist/plan.mjs settle/cli.ts:settle/dist/cli.mjs clear/cli.ts:clear/dist/cli.mjs settle/deposits.ts:settle/dist/deposits.mjs witness/index.ts:dist/witness.mjs cli/host-derive.ts:dist/host-derive.mjs cli/host-chain.ts:dist/host-chain.mjs; do npx esbuild ...; done)
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
//   tmp/b47-republish.mjs built first (R118).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment } from "../../manifest/schema";
import { signApprovalMap, signOpensReport } from "../../witness";
import { modeEntry } from "../../clear/registry";
import { Ledger } from "../../settle/ledger";
import { buildAuction, fetchBeacon, needRealPczt, witnessPrivate, writePublicDir, UA_ORCHARD, type Fixture } from "./h-fixtures";
import { makeStubs } from "./b47-world";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2], only = process.argv[3];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b56.mjs before|after [skew|heal|paid]"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b56.mjs ${part}${only ? " " + only : ""} (tools/repro/b56-unpaid-return.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const BASE = path.join(ROOT, "tmp", "b56", "base-src");
const GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
const BASE_BENZO = path.join(BASE, "cli", "dist", "benzo.mjs");
for (const f of part === "before"
  ? [BASE_BENZO, path.join(BASE, "settle/dist/cli.mjs"), path.join(BASE, "settle/dist/plan.mjs")]
  : [GREEN_BENZO, path.join(ROOT, "settle/dist/cli.mjs"), path.join(ROOT, "settle/dist/plan.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the bundles first (see the header)`);
const REAL_PCZT = needRealPczt(ROOT);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const wants = (section: string) => !only || only === section;
const sh = (cmd: string, args: string[], env: Record<string, string>, timeoutMs?: number) => {
  const r = spawnSync(cmd, args, { input: "", encoding: "utf8", maxBuffer: 64 << 20,
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}), env: { ...process.env, ...env } });
  return { code: r.status ?? 1, killed: !!(r.error && (r.error as any).code === "ETIMEDOUT"), out: r.stdout ?? "", err: r.stderr ?? "" };
};

const R = 32704232; // a past quicknet round (the h-fixtures machinery fetches its authentic beacon once)
const FEE_RESERVE_UA = "utest1b56feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b56internalchangeaddress000000000000000000000000000000000000";
const CONFIRMATIONS = 10;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const obligationsOf = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)]
  .map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats }) as { party: string; kind: string; amount_zats: string });

// ---- the worker worlds (the b54 world, kept as a shared COPY; the b47 stub harness via makeStubs) ----
type World = {
  label: string; id: string; fx: Fixture; root: string; state: string; publicDir: string; shared: string;
  chainFile: string; stubBin: string; benzo: string; hosts: Record<string, string>;
  rows: { party: string; kind: string; amount_zats: string }[]; obligationZats: number; feeReserve: number;
};

// The fold's own host scan stub: the shared chain state MINUS the notes fixture.json's `host_scan_omit_txid`
// names — the host wallet is one (or more) notes behind the coordinator's scan, the transient plan/host
// skew B54's Q4 ruled on. Without the knob it is the plain b47 scan stub.
const STUB_SCAN_BEHIND = `if (process.env.BNZ_NETWORK === "main") { process.stderr.write("test stubs refuse BNZ_NETWORK=main\\n"); process.exit(1); }
if (!process.env.BNZ_TEST_CHAIN) { process.stderr.write("test stubs need BNZ_TEST_CHAIN\\n"); process.exit(1); }
const fs = require("fs"), path = require("path");
const chain = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
let fix = {}; try { fix = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(process.argv[1])), "fixture.json"), "utf8")); } catch {}
const omit = new Set((fix.host_scan_omit_txid ?? []).map(String));
for (const n of chain.notes) if (!omit.has(String(n.txid))) console.log(JSON.stringify(n));
`;

function writeWorld(label: string, fx: Fixture, opts: { root: string; benzo: string; feeReserve: number; extraNotes?: any[]; hostScanOmit?: string[] }): World {
  const stubs = makeStubs({ realPczt: REAL_PCZT, confirmations: CONFIRMATIONS, changeAddr: CHANGE_ADDR, uaOrchard: UA_ORCHARD });
  const id = fx.id;
  const base = path.join(opts.root, "tmp", "b56-worlds", label);
  rmSync(base, { recursive: true, force: true });
  const state = path.join(base, "state"), publicDir = path.join(base, "public"), shared = path.join(base, "shared");
  const chainFile = path.join(shared, "chain-state.json"), stubBin = path.join(base, "stub-bin");
  for (const d of [state, path.join(state, "run"), path.join(state, "auction"), path.join(state, "product"), shared, stubBin, path.join(state, "vaults", id, "wallet")])
    mkdirSync(d, { recursive: true, mode: 0o700 });
  stubs.writeStateBin(path.join(state, "bin"));
  const fixtureJson = JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA] });
  writeFileSync(path.join(state, "fixture.json"), fixtureJson);
  const rows = obligationsOf(fx);
  const obligationZats = rows.reduce((s, o) => s + Number(o.amount_zats), 0);
  const notes: any[] = [...(opts.extraNotes ?? []), ...fx.notes.map(n => ({ ...n }))];
  notes.push({ txid: hash("b56-fee-reserve-" + label), height: 90100, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: opts.feeReserve, memo_hex: null, spent_in_txid: null });
  writeFileSync(chainFile, JSON.stringify({ tip: 100000, send_mode: "ok", notes, pending: [], mined: {}, broadcasts: [] }));
  writeFileSync(path.join(state, "auction", "manifest-signing.pem"), fx.manifestPem, { mode: 0o600 });
  writeFileSync(path.join(state, "auction", `${id}.json`), jsonBytes({ manifest: fx.manifestPacket, signer: fx.signer, state: "CLEARED",
    leaves: fx.leaves, receipts: fx.receipts, frozen: fx.frozen, opened: fx.opened, result: fx.result, trace: [], beacon: fx.beacon,
    envelopes: fx.envelopes, witness_set: fx.witnessSet }));
  const routing = { bidders: [], seller_ua: UA_ORCHARD, fee_reserve_ua: FEE_RESERVE_UA, reserve_return_ua: UA_ORCHARD };
  writeFileSync(path.join(state, "product", `${id}.json`), jsonBytes({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing, public_dir: publicDir }));
  writeFileSync(path.join(state, "vaults", id, "keys.json"), jsonBytes({ group_key: fx.groupKey }));
  mkdirSync(path.join(state, "settle", id), { recursive: true, mode: 0o700 });
  const dest = hash(Buffer.from(UA_ORCHARD, "utf8"));
  for (const [n, w] of [["alice", "0"], ["bob", "1"]] as const) {
    const body = { signer: n, opens: fx.leaves.map((l: any) => ({ leaf: l.leaf_index, party: `leaf:${l.leaf_index}`, ok: true, dest_sha256: dest })) };
    writeFileSync(path.join(state, "settle", id, `envelope-opens-${n}.json`), jsonBytes({ ...body, ...signOpensReport(body, witnessPrivate(w)) }));
    writeFileSync(path.join(state, "settle", id, `routing-${n}.json`), jsonBytes(routing), { mode: 0o600 });
  }
  writeFileSync(path.join(state, "settle", id, "routing-commitment.json"), jsonBytes({ sha256: hash(jsonBytes(routing)), pinned_at: Date.now() }));
  for (const [n, i] of [["alice", 0], ["bob", 1], ["carol", 2]] as const) {
    for (const d of [path.join(state, "signers", n), path.join(state, "frost")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(state, "signers", n, "envelope-key.json"), JSON.stringify(fx.envelopeKeys[i]));
    writeFileSync(path.join(state, "frost", `${n}.toml`), "group = 0\n");
    writeFileSync(path.join(state, "frost", `${n}.pubkey`), createHash("sha256").update("b56-contact-" + n).digest("hex") + "\n");
  }
  writeFileSync(path.join(state, "group-key.txt"), fx.groupKey + "\n");
  const hosts: Record<string, string> = {};
  for (const [n, i] of [["alice", 0], ["bob", 1], ["carol", 2]] as const) {
    const hs = path.join(base, "host-" + n);
    hosts[n] = hs;
    stubs.writeStateBin(path.join(hs, "bin"));
    // The one-note-behind knob lives in the HOSTS' own fixture.json (their benzo-scan stub reads it); the
    // coordinator's fixture carries none and its scan sees the whole chain state.
    writeFileSync(path.join(hs, "fixture.json"), JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA],
      ...(opts.hostScanOmit?.length ? { host_scan_omit_txid: opts.hostScanOmit } : {}) }));
    if (opts.hostScanOmit?.length) stubs.stub(path.join(hs, "bin"), "benzo-scan", STUB_SCAN_BEHIND);
    for (const d of [hs, path.join(hs, "run"), path.join(hs, "auction"), path.join(hs, "auctions", id), path.join(hs, "signers", n), path.join(hs, "witness")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(hs, "auctions", id, "group-key.txt"), fx.groupKey + "\n");
    writeFileSync(path.join(hs, "auctions", id, "frost.toml"), "group = 0\n");
    writeFileSync(path.join(hs, "operator-signer.txt"), fx.signer + "\n");
    writeFileSync(path.join(hs, "ufvk.txt"), "uviewtest1fixture\n");
    writeFileSync(path.join(hs, "signers", n, "envelope-key.json"), JSON.stringify(fx.envelopeKeys[i]));
    writeFileSync(path.join(hs, "witness", `${n}.key`), witnessPrivate(String(i)), { mode: 0o600 });
  }
  stubs.stub(stubBin, "orb", stubs.STUB_ORB);
  stubs.stub(stubBin, "orbctl", stubs.STUB_ORB);
  writeFileSync(path.join(shared, "stub-config.json"), JSON.stringify({ shared, benzo: opts.benzo, hosts }));
  writePublicDir(publicDir, fx);
  return { label, id, fx, root: opts.root, state, publicDir, shared, chainFile, stubBin, benzo: opts.benzo, hosts,
    rows, obligationZats, feeReserve: opts.feeReserve };
}

const worldEnv = (w: World): Record<string, string> => ({
  BNZ_STATE_DIR: w.state, BNZ_TEST_CHAIN: w.chainFile, BNZ_TEST_STUBS: path.join(w.shared, "stub-config.json"),
  BNZ_PCZT_BIN: path.join(w.state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(w.state, "bin", "benzo-scan"),
  BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/",
  BNZ_FROSTD_HOST: "stub-frostd:2744", BNZ_FROSTD_ADDR: "stub-frostd:2744", BNZ_ROOT: w.root,
  PATH: `${w.stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
});
const runSettle = (w: World, timeoutMs?: number) => w.benzo === GREEN_BENZO
  ? sh(path.join(ROOT, "bin/benzo"), ["settle", "--id", w.id], worldEnv(w), timeoutMs)
  : sh(process.execPath, [w.benzo, "settle", "--id", w.id], worldEnv(w), timeoutMs);
const runVerify = (w: World) => sh(process.execPath, [w.benzo, "verify", "--dir", w.publicDir, "--signer", w.fx.signer], worldEnv(w));
const chain = (w: World) => JSON.parse(readFileSync(w.chainFile, "utf8"));
const receiptsOf = (w: World) => JSON.parse(readFileSync(path.join(w.state, "settle", w.id, "receipts.json"), "utf8"));
const settlementOf = (w: World) => JSON.parse(readFileSync(path.join(w.publicDir, "auction.json"), "utf8")).settlement ?? null;
const ledgerRows = (w: World) => {
  const db = new DatabaseSync(path.join(w.state, "settle", w.id, "ledger.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT party,kind,amount_zats,state,batch,txid FROM obligations ORDER BY party").all() as any[]; } finally { db.close(); }
};
const settleLog = (w: World) => { try { return readFileSync(path.join(w.state, "run", "settle-cli.log"), "utf8"); } catch { return ""; } };

// The seeded world every section starts from (the b54 seedBatchOne, kept as a shared COPY): batch 1 paid
// every ordinary row (the live post-batch-1 state), published and receipted through the REAL Ledger class
// and the real republish (tools/repro/b47-republish.ts, R118). The vault is then left with the batch's
// change note plus `extraNotes` — the late note the skew worlds hide from the hosts' wallet scan.
function seedBatchOne(w: World): { tx1: string; change: number } {
  const id = w.id;
  const tx1 = hash("b56-seed-batch1-" + w.label);
  const c = chain(w);
  const feeNote = hash("b56-fee-reserve-" + w.label);
  const spends = c.notes.filter((n: any) => w.fx.notes.some((f: any) => f.txid === n.txid) || n.txid === feeNote).map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`);
  for (const n of c.notes) if (spends.includes(`${n.txid}:${n.pool}:${n.action_index}`)) n.spent_in_txid = tx1;
  const batchFee = 5000 * Math.max(2, Math.max(spends.length, w.rows.length + 1));
  const change = w.feeReserve - batchFee;
  c.tip = 100012;
  c.mined[tx1] = { height: 100001, rows: [] };
  c.broadcasts.push(tx1);
  c.notes.push({ txid: tx1, height: 100001, pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "99", action_index: 0,
    value_zats: change, memo_hex: null, spent_in_txid: null });
  writeFileSync(w.chainFile, JSON.stringify(c));
  for (const n of ["alice", "bob"]) {
    const adir = path.join(w.hosts[n], "approvals", w.id);
    mkdirSync(adir, { recursive: true, mode: 0o700 });
    const mapped = w.rows.map((o, i) => ({ party: o.party, output_index: i, amount_zats: String(o.amount_zats) }));
    const sources = [...new Set(w.rows.map((o) => (o.party.startsWith("leaf:") ? `deposit:${w.fx.notes[Number(o.party.slice(5))].txid}:ironwood:${Number(o.party.slice(5))}` : o.party)))];
    writeFileSync(path.join(adir, "ledger.json"), JSON.stringify([{ batch: 1, txid: tx1, expiry_height: 100364, approved_tip: 100000, sources, mapped }]) + "\n", { mode: 0o600 });
  }
  const pczt = path.join(w.state, "settle", id, "batch-1.pczt");
  writeFileSync(pczt, `b56 seeded batch 1 ${tx1}\n`);
  const ledger = new Ledger(w.state, id);
  ledger.pin(w.rows as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  ledger.stage(batch.id, pczt, tx1);
  ledger.confirm(batch.id, tx1, 100001, w.rows.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "ironwood" })));
  const rows = ledger.rows(), receipts = ledger.receipts();
  ledger.close();
  const sd = path.join(w.state, "settle", id);
  const maps = [0, 1].map(i => signApprovalMap({ auction_id: id, batch: 1, txid: tx1, outputs: w.rows.map((o, i2) => ({ party: o.party, output_index: i2 })), defaults: [], balance_refunds: [] }, witnessPrivate(String(i))));
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes(maps));
  writeFileSync(path.join(sd, "receipts.json"), jsonBytes(receipts));
  writeFileSync(path.join(sd, "summary.json"), jsonBytes({ auction_id: id, lwd_endpoints: ["127.0.0.1:9", "127.0.0.1:10"], rows: rows.filter((r: any) => r.party !== "reserve-return"),
    batches: [{ id: 1, pczt_hash: hash(readFileSync(pczt)), txid: tx1, height: 100001, state: "mined" }], signoffs: [], plan: {}, offline_signer: "alice" }));
  const republish = path.join(ROOT, "tmp/b47-republish.mjs");
  const r = spawnSync(process.execPath, [republish, id], { encoding: "utf8", env: { ...process.env, ...worldEnv(w) } });
  if (r.status !== 0) throw new Error(`republish failed: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return { tx1, change };
}

// The row the leg's own plan derives for the vault's unspent value (the pre-B56 run pinned exactly this
// row as its exception row when no host derived it).
const planReserveRow = (w: World): { amount_zats: string } => {
  const p = sh(process.execPath, [path.join(w.root, "settle/dist/plan.mjs"), w.id], worldEnv(w));
  const line = p.out.trim().split("\n").filter(l => l.startsWith("{")).at(-1);
  if (!line) throw new Error(`plan produced no JSON: ${(p.err || p.out).trim().slice(-300)}`);
  const row = JSON.parse(line).reserve_return;
  if (!row) throw new Error(`plan derived no reserve-return row: ${(p.err || p.out).trim().slice(-300)}`);
  return row;
};

// The pre-B56 published state of the wall (B54's Q4): the private ledger pinned the derived row as its
// exception row and the base publish carried the summary rows VERBATIM into the published settlement —
// the bare `reserve-return` row with its reason and no accounting. Written through the REAL Ledger class;
// the published doc and the public summary.json are exactly what cli/product.ts publish wrote before
// R121's filter (the same rows, injected back — the green publish would filter them out).
function seedPreB56(w: World, row: { amount_zats: string }, reason: string): void {
  const id = w.id, sd = path.join(w.state, "settle", id);
  const ledger = new Ledger(w.state, id);
  ledger.pin([], [{ party: "reserve-return", kind: "payout", amount_zats: String(row.amount_zats) } as any]);
  const pinned = ledger.rows().find(r => r.party === "reserve-return")!;
  ledger.close();
  const summaryPath = path.join(sd, "summary.json");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  summary.rows = [...summary.rows, { ...pinned, reason }].sort((a: any, b: any) => String(a.party).localeCompare(String(b.party)));
  writeFileSync(summaryPath, jsonBytes(summary));
  const docPath = path.join(w.publicDir, "auction.json");
  const doc = JSON.parse(readFileSync(docPath, "utf8"));
  doc.settlement.rows = summary.rows;
  writeFileSync(docPath, jsonBytes(doc));
  writeFileSync(path.join(w.publicDir, "summary.json"), jsonBytes(doc.settlement));
}

const SKEW_REASON = "the vault's value cannot be swept in one transaction (the tool's quote spends 50000 zats of this signer's scanned unspent total 30000)";
const GENERIC_REASON = "the reserve-return row is not derivable on any signer host (the tool's sweep quote refused or no host answered); it waits for the paid gate — it is not claimable";

// ---- (a) skew: the plan derives the return, the host refuses it (one note behind) ----------------------
async function skew() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const late = { txid: hash("b56-late-note"), height: 99200, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "21", action_index: 0,
    value_zats: 20000, memo_hex: null, spent_in_txid: null };
  const w = writeWorld(`skew-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO,
    feeReserve: 60000, extraNotes: [late], hostScanOmit: [late.txid] });
  const seeded = seedBatchOne(w);
  console.log(`OBSERVE skew-${part} seeded batch 1 ${seeded.tx1.slice(0, 16)}… change ${seeded.change} + the late 20000 note (the hosts' wallet scan omits it)`);
  const r1 = runSettle(w);
  console.log(`OBSERVE skew-${part} settle run 1 exit=${r1.code}`);
  console.log((r1.err || r1.out).trim().split("\n").filter(Boolean).slice(-6).map(l => "  | " + l).join("\n"));
  const settlement = settlementOf(w);
  const bare = (settlement?.rows ?? []).find((x: any) => x.party === "reserve-return") ?? null;
  const rr = settlement?.reserve_return ?? null;
  const receipts = existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
  if (part === "before") {
    check("skew-red-bare-row-published", r1.code === 0 && !!bare && bare.state === "exception" && !rr && !receipts.some((x: any) => x.party === "reserve-return"),
      `run 1 publishes the bare reserve-return exception row (no receipt, no accounting): ${JSON.stringify(bare)}`);
    check("skew-red-reason-names-the-wall", !!bare && /scanned unspent total 30000/.test(String(bare.reason ?? "")),
      `the published row carries the typed reason that names the true wall: ${String(bare?.reason ?? "").slice(0, 120)}`);
    const v = runVerify(w);
    check("skew-red-verify-refuses", v.code !== 0 && /a reserve-return row or receipt without the published reserve_return accounting/.test(v.err + v.out),
      `the product's own verify refuses the published dir (exit ${v.code}) — the doc no honest reader accepts`);
    const r2 = runSettle(w);
    console.log(`OBSERVE skew-${part} settle run 2 exit=${r2.code}`);
    check("skew-red-every-later-run-walled", r2.code === 1 && /no signer host could list its derivable rows/.test(r2.err) && !receiptsOf(w).some((x: any) => x.party === "reserve-return"),
      `every later benzo settle dies before pinning at the wall (exit ${r2.code}) — a permanent wall from a transient skew`);
  } else {
    check("skew-no-row-published", r1.code === 0 && !bare && !rr && !receipts.some((x: any) => x.party === "reserve-return"),
      `the doc publishes without the row (run 1 exit ${r1.code}) — the hosts' public check never sees a bare return row, so the wall cannot form`);
    const kept = ledgerRows(w).find((x: any) => x.party === "reserve-return") ?? null;
    check("skew-ledger-keeps-row", !!kept && kept.state === "exception",
      `the private ledger keeps the row and its state (${JSON.stringify(kept)}) — only the published rows leave it out`);
    check("skew-waits-line-still-printed", /reserve-return to the exception queue: /.test(r1.err + settleLog(w)) && /scanned unspent total 30000/.test(r1.err + settleLog(w)),
      "the run still prints the typed waits line — the pinned exception row's reason names why the return waits");
    const v = runVerify(w);
    check("skew-verify-accepts", v.code === 0 && !/^ERROR/m.test(v.err),
      `benzo verify accepts the published dir (exit ${v.code}); ${v.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);
    const r2 = runSettle(w);
    console.log(`OBSERVE skew-${part} settle run 2 exit=${r2.code}`);
    check("skew-second-run-exits-0", r2.code === 0 && !receiptsOf(w).some((x: any) => x.party === "reserve-return") && !(settlementOf(w)?.reserve_return),
      `a second run exits 0 with the waits line and publishes nothing for the unpaid return (exit ${r2.code}, ${(r2.err.match(/reserve-return to the exception queue: [^\n]*/g) ?? []).length} waits lines)`);
  }
}

// ---- (b) heal: a pre-B56 published dir with a bare row ------------------------------------------------
async function heal() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const late = { txid: hash("b56-late-note"), height: 99200, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "21", action_index: 0,
    value_zats: 20000, memo_hex: null, spent_in_txid: null };
  const w = writeWorld(`heal-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO,
    feeReserve: 60000, extraNotes: [late], hostScanOmit: [late.txid] });
  const seeded = seedBatchOne(w);
  const planned = planReserveRow(w);
  seedPreB56(w, planned, SKEW_REASON);
  console.log(`OBSERVE heal-${part} seeded batch 1 ${seeded.tx1.slice(0, 16)}… and the pre-B56 bare row at ${planned.amount_zats} zats`);
  const pre = settlementOf(w);
  const preBare = (pre?.rows ?? []).find((x: any) => x.party === "reserve-return") ?? null;
  check("heal-pre-state-is-the-bare-row-dir", !!preBare && preBare.state === "exception" && !pre?.reserve_return,
    `the fabricated starting dir carries the bare row exactly as the base publish wrote it: ${JSON.stringify(preBare)?.slice(0, 160)}`);
  const r = runSettle(w);
  console.log(`OBSERVE heal-${part} settle exit=${r.code}`);
  console.log((r.err || r.out).trim().split("\n").filter(Boolean).slice(-6).map(l => "  | " + l).join("\n"));
  const settlement = settlementOf(w);
  const bare = (settlement?.rows ?? []).find((x: any) => x.party === "reserve-return") ?? null;
  const rr = settlement?.reserve_return ?? null;
  if (part === "before") {
    check("heal-red-no-heal", r.code === 1 && /no signer host could list its derivable rows/.test(r.err) && !!bare,
      `the next run dies at the wall and the stale bare row stays (exit ${r.code}) — the pre-B56 dir is unhealable on base`);
    const v = runVerify(w);
    check("heal-red-verify-refuses", v.code !== 0 && /a reserve-return row or receipt without the published reserve_return accounting/.test(v.err + v.out),
      `benzo verify still refuses the unhealed dir (exit ${v.code})`);
  } else {
    check("heal-green-heals", r.code === 0 && !bare && !rr && !/no signer host could list its derivable rows/.test(r.err),
      `the next run heals the dir: the republish drops the unpaid row (exit ${r.code}, run proceeded past the derivable gate)`);
    const kept = ledgerRows(w).find((x: any) => x.party === "reserve-return") ?? null;
    check("heal-green-ledger-keeps-row", !!kept && kept.state === "exception",
      `the row still waits in the private ledger (${JSON.stringify(kept)}) — the skew persists, so it stays unpublished`);
    const v = runVerify(w);
    check("heal-green-verify-accepts", v.code === 0 && !/^ERROR/m.test(v.err),
      `benzo verify accepts the healed dir (exit ${v.code}); ${v.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);
  }
}

// ---- (c) paid: the normal path is unchanged -----------------------------------------------------------
async function paid() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const late = { txid: hash("b56-late-note"), height: 99200, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "21", action_index: 0,
    value_zats: 20000, memo_hex: null, spent_in_txid: null };
  const w = writeWorld(`paid-${part}`, fx, { root: part === "before" ? BASE : ROOT, benzo: part === "before" ? BASE_BENZO : GREEN_BENZO,
    feeReserve: 60000, extraNotes: [late] });
  const seeded = seedBatchOne(w);
  const planned = planReserveRow(w);
  seedPreB56(w, planned, SKEW_REASON);
  console.log(`OBSERVE paid-${part} seeded batch 1 ${seeded.tx1.slice(0, 16)}…, the pre-B56 bare row at ${planned.amount_zats} zats, and the skew healed (the hosts' wallet current)`);
  const r = runSettle(w);
  console.log(`OBSERVE paid-${part} settle exit=${r.code}`);
  console.log((r.err || r.out).trim().split("\n").filter(Boolean).slice(-6).map(l => "  | " + l).join("\n"));
  const receipts = existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
  const settlement = settlementOf(w);
  const row = (settlement?.rows ?? []).find((x: any) => x.party === "reserve-return") ?? null;
  const rr = settlement?.reserve_return ?? null;
  const receipt = receipts.find((x: any) => x.party === "reserve-return") ?? null;
  if (part === "before") {
    check("paid-red-wall-never-pays", r.code === 1 && /no signer host could list its derivable rows/.test(r.err) && !receipt && !rr,
      `the base stays walled behind its own published bare row — the return can never be paid (exit ${r.code}, no receipt, no accounting)`);
  } else {
    check("paid-row-receipt-accounting", r.code === 0 && !!row && row.state === "paid" && !!receipt && !!rr,
      `the normal path is unchanged: the paid row, its receipt and the accounting all publish (exit ${r.code}, receipt ${JSON.stringify(receipt)?.slice(0, 120)})`);
    check("paid-accounting-exact", !!rr && rr.remaining_zats === "50000" && rr.fee_zats === "10000" && rr.dust_notes === 0 && rr.dust_zats === "0",
      `the accounting is the vault's whole unspent value minus the tool's fee: ${JSON.stringify(rr)}`);
    const v = runVerify(w);
    check("paid-verify-accepts", v.code === 0 && !/^ERROR/m.test(v.err),
      `benzo verify accepts the published dir (exit ${v.code}); ${v.out.trim().split("\n").filter(l => l.startsWith("OK")).length} OK lines`);
    const rerun = runSettle(w);
    check("paid-rerun-idempotent", rerun.code === 0 && receiptsOf(w).length === receipts.length && JSON.stringify(settlementOf(w)?.reserve_return ?? null) === JSON.stringify(rr),
      `a re-run is clean and republishes the same row, receipt and accounting (exit ${rerun.code})`);
  }
}

if (wants("skew")) await skew();
if (wants("heal")) await heal();
if (wants("paid")) await paid();
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
