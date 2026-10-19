// Batch B53 proof (offline): the resume, re-send and ledger gaps (Reviewer R round 4: P2-2, P3-3, P3-1,
// P3-2, P3-5, P3-6, P3-7, P3-8) — docs/design/phase7-b53-resume-and-ledger.md. Every product decision runs
// the real shipped code; only the offline-impossible externals are stubbed (the b47 stub harness
// tools/repro/b47-world.ts and the h-fixtures host stubs), and each section's stub cases live in their own
// new functions so no shared stub file is touched.
//
// Red on the BASE commit 59c863c bundles under tmp/b53/base-src (built ONCE from the pristine base commit,
// never another worktree), green after on this tree's bundles.
//
// Sections (the optional third argument runs one):
//   p22  P2-2: a mined PRE-H3 two-pool batch (the reviewer's probe world) resumes through the real
//        `benzo settle` confirm. Colliding per-pool action indexes with DIFFERENT amounts must attribute
//        each receipt to its own pool; with EQUAL amounts the batch must be parked as an exception with the
//        reason "manual reconciliation: pre-H3 two-pool batch (H2)" and a re-run must exit 0 (base: throws
//        "mined amount differs from result.json" — or one receipt per allocated output — on every re-run).
//   p33  P3-3: a true "already exists in mempool" under custody (send-without-storing: the wallet is blind
//        until the transaction mines). Run 1 broadcast and died; run 2 re-sends and hears the phrase twice
//        from a wallet that does not know the txid — it must fall through to the bounded mined-wait, reach
//        mined, confirm and continue (base: attempt 2 throws and the run crash-loops until the transaction
//        actually mines).
//   p31  P3-1: a zero-change paying batch counts as paid through the new minedHeightOf callback (11 deep
//        counts, 9 deep does not, reorged out does not) — the shared predicate settle/deposits.ts
//        paidByOwnLedger, red against the base tree's own predicate bundle.
//   p35  P3-5: mapPairAgrees also compares auction_id and txid, and earliestAgreedBond's defaults selection
//        only picks a list carried by a FULLY agreeing pair (two map versions, each carried by two
//        witnesses, that disagree on outputs can never bless a defaults list).
//   p32  P3-2: a pre-B49 approval entry with no `mapped` heals after a re-approve (sign approve merges the
//        new mapped into the existing same-txid entry) and after migration on read (the stored
//        approvals/<id>/batch-<n>.json map plus this host's own derived row amounts) — and then counts as
//        paid at the shared rule.
//   p37  P3-7: a `balance-excess:` row's backing notes join the candidate's approval-ledger `sources`, so a
//        second live candidate that re-spends one is refused (base: both candidates are approved).
//
// Build+run:
//   npx esbuild tools/repro/b53-resume-ledger.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b53.mjs
//   node tmp/b53.mjs after  [p22|p33|p31|p35|p32|p37]
//   node tmp/b53.mjs before [p22|p33|p31|p35|p32|p37]
//   base bundles, built ONCE from the pristine base commit (the b47 recipe):
//     mkdir -p tmp/b53/base-src && git archive 59c863c | tar -x -C tmp/b53/base-src && ln -s $PWD/node_modules tmp/b53/base-src/node_modules
//     (cd tmp/b53/base-src && node cli/build.mjs && for f in settle/plan.ts:settle/dist/plan.mjs settle/cli.ts:settle/dist/cli.mjs clear/cli.ts:clear/dist/cli.mjs settle/deposits.ts:settle/dist/deposits.mjs witness/index.ts:dist/witness.mjs; do npx esbuild "${f%%:*}" --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile="${f##*:}"; done)
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hash, jsonBytes, reserveReturnUaCommitment, sellerUaCommitment } from "../../manifest/schema";
import { signApprovalMap, signOpensReport } from "../../witness";
import { modeEntry } from "../../clear/registry";
import { Ledger } from "../../settle/ledger";
import { buildAuction, fetchBeacon, needRealPczt, writePublicDir, witnessPrivate, UA_ORCHARD, type Fixture } from "./h-fixtures";
import { makeStubs } from "./b47-world";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2], only = process.argv[3];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b53.mjs before|after [section]"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b53.mjs ${part}${only ? " " + only : ""} (tools/repro/b53-resume-ledger.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const BASE = path.join(ROOT, "tmp", "b53", "base-src");
const GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
const BASE_BENZO = path.join(BASE, "cli", "dist", "benzo.mjs");
if (part === "before") for (const f of [BASE_BENZO, path.join(BASE, "settle/dist/cli.mjs"), path.join(BASE, "settle/dist/plan.mjs"), path.join(BASE, "clear/dist/cli.mjs"), path.join(BASE, "settle/dist/deposits.mjs"), path.join(BASE, "dist/witness.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
if (part === "after") for (const f of [GREEN_BENZO, path.join(ROOT, "settle/dist/cli.mjs"), path.join(ROOT, "settle/dist/plan.mjs"), path.join(ROOT, "clear/dist/cli.mjs")])
  if (!existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);
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

const R = 32704232; // a past quicknet round (h-fixtures fetches its authentic beacon once)
const FEE_RESERVE_UA = "utest1b53feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b53internalchangeaddress000000000000000000000000000000000000";
const CONFIRMATIONS = 10;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const obligationsOf = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)]
  .map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats }) as { party: string; kind: string; amount_zats: string });

// ---- the worker worlds (the b47 stub harness via tools/repro/b47-world.ts makeStubs, custody always) ----
type World = {
  label: string; id: string; fx: Fixture; root: string; state: string; publicDir: string; shared: string;
  chainFile: string; stubBin: string; benzo: string; hosts: Record<string, string>;
  rows: { party: string; kind: string; amount_zats: string }[];
};

function writeWorld(label: string, fx: Fixture, opts: { root: string; benzo: string; extraNotes?: any[] }): World {
  const stubs = makeStubs({ realPczt: REAL_PCZT, confirmations: CONFIRMATIONS, changeAddr: CHANGE_ADDR, uaOrchard: UA_ORCHARD });
  const id = fx.id;
  const base = path.join(opts.root, "tmp", "b53-worlds", label);
  rmSync(base, { recursive: true, force: true });
  const state = path.join(base, "state"), publicDir = path.join(base, "public"), shared = path.join(base, "shared");
  const chainFile = path.join(shared, "chain-state.json"), stubBin = path.join(base, "stub-bin");
  for (const d of [state, path.join(state, "run"), path.join(state, "auction"), path.join(state, "product"), shared, stubBin, path.join(state, "vaults", id, "wallet")])
    mkdirSync(d, { recursive: true, mode: 0o700 });
  stubs.writeStateBin(path.join(state, "bin"));
  const fixtureJson = JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA] });
  writeFileSync(path.join(state, "fixture.json"), fixtureJson);
  const notes: any[] = [...(opts.extraNotes ?? []), ...fx.notes.map(n => ({ ...n }))];
  notes.push({ txid: hash("b53-fee-reserve-" + label), height: 90100, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: 60000, memo_hex: null, spent_in_txid: null });
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
    writeFileSync(path.join(state, "frost", `${n}.pubkey`), createHash("sha256").update("b53-contact-" + n).digest("hex") + "\n");
  }
  writeFileSync(path.join(state, "group-key.txt"), fx.groupKey + "\n");
  const hosts: Record<string, string> = {};
  for (const [n, i] of [["alice", 0], ["bob", 1], ["carol", 2]] as const) {
    const hs = path.join(base, "host-" + n);
    hosts[n] = hs;
    stubs.writeStateBin(path.join(hs, "bin"));
    writeFileSync(path.join(hs, "fixture.json"), fixtureJson);
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
    rows: obligationsOf(fx) };
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

const chain = (w: World) => JSON.parse(readFileSync(w.chainFile, "utf8"));
const receiptsOf = (w: World) => JSON.parse(readFileSync(path.join(w.state, "settle", w.id, "receipts.json"), "utf8"));
const summaryOf = (w: World) => JSON.parse(readFileSync(path.join(w.state, "settle", w.id, "summary.json"), "utf8"));
const settleLog = (w: World) => { try { return readFileSync(path.join(w.state, "run", "settle-cli.log"), "utf8"); } catch { return ""; } };

// ---- p22 stub cases (NEW function): the mined two-pool batch's inspect reports PER-POOL action indexes,
// exactly what the real benzo-pczt inspect reports and a pre-H3 signed map attributes outputs by. The body
// the seed writes names each row's pool and action index; nothing else in the stub changes.
function twoPoolPcztStub(): string {
  return `const fs = require("fs"), path = require("path"), crypto = require("crypto");
const state = path.dirname(path.dirname(process.argv[1]));
const fix = JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8"));
const a = process.argv.slice(2), cmd = a[0];
const txidOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
if (cmd === "ufvk-ak") { console.log(fix.groupKey); process.exit(0); }
if (cmd === "owns") { console.log(((fix.internal_addresses ?? []).includes(a[2])) ? "internal" : "external"); process.exit(0); }
if (cmd === "address") { console.log(${JSON.stringify(UA_ORCHARD)}); process.exit(0); }
if (cmd === "inspect") {
  const buf = fs.readFileSync(a[1]), body = JSON.parse(buf.toString("utf8"));
  // The seeded body's rows name their own pool and per-pool action index — a pre-H3 two-pool candidate.
  const outputs = body.rows.map((r) => ({ index: r.action_index, pool: r.pool, is_change: false, recipient: r.recipient, amount_zats: String(r.amount_zats) }));
  const output = body.rows.reduce((s, r) => s + Number(r.amount_zats), 0);
  const input = Number(body.input_zats ?? output);
  console.log(JSON.stringify({ outputs, consensus_branch_id: "37a5165b", tx_version: 6, actions: body.rows.length,
    inputs: (body.spends ?? []).map((s, i) => ({ index: i, pool: "ironwood", value_zats: Number((body.spend_values ?? [])[i] ?? 0) })),
    input_zats: input, output_zats: output, fee_zats: input - output,
    expiry_height: Number(body.expiry_height ?? 100364), txid: txidOf(buf),
    shielded_sighash: txidOf(buf),
    randomizers: [{ pool: "ironwood", index: 0, alpha: crypto.createHash("sha256").update(Buffer.concat([buf, Buffer.from("alpha")])).digest("hex") }] }));
  process.exit(0);
}
process.stderr.write("benzo-pczt two-pool stub: unknown command " + cmd + "\\n"); process.exit(1);
`;
}
const stub = (bin: string, name: string, source: string) => {
  const impl = path.join(bin, name + ".cjs");
  writeFileSync(impl, source); execFileSync("chmod", ["755", impl]);
  writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`); execFileSync("chmod", ["755", path.join(bin, name)]);
};

// The reviewer's probe world through the REAL worker: one already-MINED staged batch whose signed maps carry
// the pre-H3 colliding per-pool output indexes (two rows share an output_index, as `orchard:0` and `sapling:0`
// do). `collision` names the two rows that share the first one's action index; with equal amounts that is the
// probe's ambiguous world (the batch must park), with different amounts its resolvable world (each receipt
// attributes to its own pool). Written through the REAL Ledger class; the staged PCZT is the stub world's own
// JSON body, so the worker really resumes it, reads its mined height and runs confirm.
function seedMinedTwoPool(w: World, opts: { equal: boolean; collision: [number, number] }) {
  const id = w.id, sd = path.join(w.state, "settle", id);
  const rows = [...w.rows];
  if (opts.equal) {
    // The probe's equal-amounts world: a second row at the first row's own amount — a stray deposit note of
    // the same value (the plan re-derives it as its own exception row; the batch was staged before all of
    // that). It takes slot 1 so it shares the first row's per-pool action index (the probe world).
    const value = Number(rows[0].amount_zats);
    rows.splice(1, 0, { party: `deposit:${hash("b53-stray-" + w.label)}:ironwood:0`, kind: "refund", amount_zats: String(value) });
  }
  // The pre-H3 world: per-pool action indexes — every row its own index except the collision pair, which
  // shares the first one's index in the OTHER pool (two indexes collide; amounts decide or refuse).
  const [ci, cj] = opts.collision;
  const assign = rows.map((r, k) => ({ ...r,
    pool: k === cj ? (ci % 2 ? "orchard" : "sapling") : (k % 2 ? "sapling" : "orchard"),
    action_index: k === cj ? ci : k }));
  const total = rows.reduce((s, r) => s + Number(r.amount_zats), 0);
  const body = { rows: assign.map(r => ({ recipient: UA_ORCHARD, amount_zats: r.amount_zats, pool: r.pool, action_index: r.action_index })),
    input_zats: total + 10000, fee_zats: 10000, change_zats: 10000,
    spends: chain(w).notes.map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`),
    spend_values: chain(w).notes.map((n: any) => Number(n.value_zats)), expiry_height: 100364 };
  const pczt = path.join(sd, "batch-1.pczt");
  writeFileSync(pczt, JSON.stringify(body));
  const tx1 = sha256(readFileSync(pczt));
  const c = chain(w);
  for (const n of c.notes) if (body.spends.includes(`${n.txid}:${n.pool}:${n.action_index}`)) n.spent_in_txid = tx1;
  c.tip = 100012;
  // Mined at 100005: 8 confirmations, so the paid gate keeps the return waiting and the case stays on the
  // confirm path it is about (the return's own machinery is b47's cases (a)/(b)).
  c.mined[tx1] = { height: 100005, rows: [] };
  c.broadcasts.push(tx1);
  c.notes.push({ txid: tx1, height: 100005, pool: "ironwood", address: CHANGE_ADDR, diversifier_index: "99", action_index: 0,
    value_zats: 10000, memo_hex: null, spent_in_txid: null });
  writeFileSync(w.chainFile, JSON.stringify(c));
  // The worker's own confirmation inputs: the hosts' two agreeing signed {party, output_index} maps (the
  // pre-H3 shape: output_index is the per-pool action index) and the builder's build.json cross-check.
  const mapped = assign.map(r => ({ party: r.party, output_index: r.action_index }));
  writeFileSync(path.join(sd, "batch-1.build.json"), jsonBytes({ outputs: mapped }));
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes([0, 1].map(i => signApprovalMap({ auction_id: id, batch: 1, txid: tx1,
    outputs: mapped, defaults: [], balance_refunds: [] }, witnessPrivate(String(i))))));
  // Each host's own approval ledger records batch 1's rows at their amounts (B49's "paid" rule's ledger half).
  for (const n of ["alice", "bob", "carol"]) {
    const adir = path.join(w.hosts[n], "approvals", id);
    mkdirSync(adir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(adir, "ledger.json"), JSON.stringify([{ batch: 1, txid: tx1, expiry_height: 100364, approved_tip: 100000,
      sources: assign.map(r => r.party), mapped: assign.map(r => ({ party: r.party, output_index: r.action_index, amount_zats: r.amount_zats })) }]) + "\n", { mode: 0o600 });
  }
  const ledger = new Ledger(w.state, id);
  ledger.pin(assign.map(({ party, kind, amount_zats }) => ({ party, kind, amount_zats })) as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  ledger.stage(batch.id, pczt, tx1);
  // The crash: staged and mined, never confirmed (the B47 crash window) — the rows stay `allocated`.
  ledger.close();
  return { tx1, assign };
}
async function p22() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const run = part === "before" ? { root: BASE, benzo: BASE_BENZO } : { root: ROOT, benzo: GREEN_BENZO };
  const tag = part === "before" ? "red" : "green";

  // ---- case A: colliding indexes, different amounts — attribute each receipt to its own pool -----------
  {
    const w = writeWorld(`p22-diff-${tag}`, fx, run);
    stub(path.join(w.state, "bin"), "benzo-pczt", twoPoolPcztStub());
    const seeded = seedMinedTwoPool(w, { equal: false, collision: [w.rows.length - 2, w.rows.length - 1] });
    const r1 = runSettle(w);
    console.log(`OBSERVE p22-diff-${tag} first run exit=${r1.code}`);
    console.log((r1.err || r1.out).trim().split("\n").filter(Boolean).slice(-10).map(l => "  | " + l).join("\n"));
    const got = existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
    const byParty = new Map(got.map((x: any) => [x.party, x]));
    const attributed = seeded.assign.every((row) => {
      const rec: any = byParty.get(row.party);
      return rec && rec.pool === row.pool && rec.output_index === row.action_index && rec.txid === seeded.tx1;
    });
    if (part === "after") {
      check("p22-diff-attributed", r1.code === 0 && got.length === seeded.assign.length && attributed,
        `every receipt attributed to its own pool through (output_index, amount_zats): ${got.map((x: any) => `${x.party}->${x.pool}:${x.output_index}`).join(", ") || "none"}`);
      const r2 = runSettle(w);
      check("p22-diff-rerun-0", r2.code === 0 && JSON.stringify(receiptsOf(w)) === JSON.stringify(got),
        `a re-run exits 0 and changes nothing (exit ${r2.code})`);
    } else {
      check("p22-diff-red-wedges", r1.code !== 0 && /mined amount differs from result\.json|one receipt per allocated output/.test(r1.err),
        `the base confirm throws on the resumed mined batch (exit ${r1.code}): ${(r1.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1) ?? "").slice(0, 140)}`);
      const r2 = runSettle(w);
      check("p22-diff-red-every-rerun", r2.code !== 0 && /mined amount differs from result\.json|one receipt per allocated output/.test(r2.err),
        `every re-run takes the same path and throws again (exit ${r2.code}) — the wall an honest re-run cannot pass`);
      check("p22-diff-red-nothing-recorded", got.length === 0 && chain(w).broadcasts.length === 1,
        "no receipt recorded and nothing re-broadcast on the base");
    }
  }

  // ---- case B: colliding indexes, EQUAL amounts — park the batch, re-run exits 0 --------------------
  {
    const w = writeWorld(`p22-equal-${tag}`, fx, { ...run, extraNotes: [{ txid: hash("b53-stray-" + `p22-equal-${tag}`), height: 90500, pool: "ironwood", address: fx.manifest.deposit_addresses[0], diversifier_index: "5", action_index: 0, value_zats: Number(obligationsOf(fx)[0].amount_zats), memo_hex: null, spent_in_txid: null }] });
    stub(path.join(w.state, "bin"), "benzo-pczt", twoPoolPcztStub());
    const seeded = seedMinedTwoPool(w, { equal: true, collision: [0, 1] });
    const r1 = runSettle(w);
    console.log(`OBSERVE p22-equal-${tag} first run exit=${r1.code}`);
    console.log((r1.err || r1.out).trim().split("\n").filter(Boolean).slice(-10).map(l => "  | " + l).join("\n"));
    const receipts0 = () => existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
    if (part === "after") {
      const s = summaryOf(w), rows: any[] = s.rows ?? [], batch1 = (s.batches ?? []).find((b: any) => b.id === 1);
      const parked = rows.filter(r => r.batch === 1);
      check("p22-equal-parked", r1.code === 0 && !!batch1 && batch1.state === "exception" && batch1.height === 100005 && parked.length > 0 &&
        parked.every(r => r.state === "exception" && r.reason === "manual reconciliation: pre-H3 two-pool batch (H2)"),
        `the ambiguous batch is parked as an exception with its reason (batch ${batch1 ? batch1.state : "missing"}, ${parked.length} rows waiting for manual reconciliation)`);
      check("p22-equal-nothing-paid", receipts0().length === 0 && chain(w).broadcasts.length === 1,
        "nothing was attributed or paid — no receipt recorded and nothing re-broadcast");
      const r2 = runSettle(w);
      const s2 = summaryOf(w), rows2: any[] = s2.rows ?? [];
      check("p22-equal-rerun-0", r2.code === 0 && rows2.filter(r => r.batch === 1).every(r => r.state === "exception") &&
        receipts0().length === 0,
        `a re-run exits 0 and never re-allocates the parked rows (exit ${r2.code}; the rows keep their batch binding)`);
    } else {
      check("p22-equal-red-wedges", r1.code !== 0 && /mined amount differs from result\.json|one receipt per allocated output/.test(r1.err),
        `the base confirm throws on the resumed mined batch (exit ${r1.code}): ${(r1.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1) ?? "").slice(0, 140)}`);
      const r2 = runSettle(w);
      check("p22-equal-red-every-rerun", r2.code !== 0 && /mined amount differs from result\.json|one receipt per allocated output/.test(r2.err),
        `every re-run takes the same path and throws again (exit ${r2.code})`);
      check("p22-equal-red-misattributes-or-throws", receipts0().length === 0,
        "the base either threw or (equal amounts) attributed a receipt to the wrong pool — nothing clean was recorded");
    }
  }
}

// ---- p33 stub cases (NEW function): the custody re-send under a TRUE "already exists in mempool". The
// wallet stub gets one more send mode, `mempool-blind`: the transaction sits in the mempool (pending) but
// `list-tx` stays blind to it until it mines (send-without-storing's real behaviour — the wallet stores
// nothing unmined), every send answers the truthful phrase, and the pending entry mines on its own after
// `blind_ms` (the driver-controlled stand-in for the next block). Nothing else in the stub changes.
function blindDevtoolStub(changeAddr: string): string {
  return `const fs = require("fs"), crypto = require("crypto");
const chainFile = process.env.BNZ_TEST_CHAIN, a = process.argv.slice(2);
const txidOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
function mine(c, txid) {
  const p = c.pending.find(x => x.txid === txid);
  if (!p) return;
  c.pending = c.pending.filter(x => x.txid !== txid);
  c.tip += 1;
  for (const s of p.spends) { const n = c.notes.find(n => n.txid + ":" + n.pool + ":" + n.action_index === s); if (n) n.spent_in_txid = txid; }
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
    for (const t of [...c.pending]) if (!t.blind_until || Date.now() >= t.blind_until) mine(c, t.txid);
    if (!c.pending.length && c.send_mode === "mempool-blind") c.send_mode = "ok";
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
    const record = { txid, spends: body.spends, change_zats: body.change_zats, change_address: ${JSON.stringify(changeAddr)}, rows: body.rows };
    // The TRUE mempool state: the transaction is in the mempool, the wallet stays blind (nothing stored),
    // and every send answers the truthful phrase until it mines.
    if (c.send_mode === "mempool-blind") {
      if (!c.pending.some(x => x.txid === txid)) c.pending.push({ ...record, blind_until: Date.now() + (c.blind_ms ?? 20000) });
      fs.writeFileSync(chainFile, JSON.stringify(c));
      process.stderr.write("Error: Send failed: (-1) transaction already exists in mempool\\n");
      process.exit(1);
    }
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
}

// Run 1 broadcast and died between `ledger.stage` and the mined-wait: the batch is staged with its txid,
// the transaction sits in the mempool (blind to the wallet), nothing is mined and nothing is confirmed.
function seedBlindCrash(w: World) {
  const id = w.id, sd = path.join(w.state, "settle", id);
  const rows = w.rows;
  const body = { rows: rows.map(r => ({ recipient: UA_ORCHARD, amount_zats: r.amount_zats })),
    input_zats: rows.reduce((s, r) => s + Number(r.amount_zats), 0) + 10000, fee_zats: 10000, change_zats: 10000,
    spends: chain(w).notes.map((n: any) => `${n.txid}:${n.pool}:${n.action_index}`),
    spend_values: chain(w).notes.map((n: any) => Number(n.value_zats)), expiry_height: 100364 };
  const pczt = path.join(sd, "batch-1.pczt");
  writeFileSync(pczt, JSON.stringify(body));
  const tx1 = sha256(readFileSync(pczt));
  const c = chain(w);
  c.tip = 100012;
  c.send_mode = "mempool-blind"; c.blind_ms = 25000;
  c.pending.push({ txid: tx1, spends: body.spends, change_zats: 10000, change_address: CHANGE_ADDR, rows: body.rows, blind_until: Date.now() + 25000 });
  c.broadcasts.push(tx1); // run 1 really broadcast it
  writeFileSync(w.chainFile, JSON.stringify(c));
  const mapped = rows.map((r, i) => ({ party: r.party, output_index: i }));
  writeFileSync(path.join(sd, "batch-1.build.json"), jsonBytes({ outputs: mapped }));
  writeFileSync(path.join(sd, "batch-1.maps.json"), jsonBytes([0, 1].map(i => signApprovalMap({ auction_id: id, batch: 1, txid: tx1,
    outputs: mapped, defaults: [], balance_refunds: [] }, witnessPrivate(String(i))))));
  for (const n of ["alice", "bob", "carol"]) {
    const adir = path.join(w.hosts[n], "approvals", id);
    mkdirSync(adir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(adir, "ledger.json"), JSON.stringify([{ batch: 1, txid: tx1, expiry_height: 100364, approved_tip: 100000,
      sources: rows.map((r) => r.party), mapped: rows.map((r, i) => ({ party: r.party, output_index: i, amount_zats: r.amount_zats })) }]) + "\n", { mode: 0o600 });
  }
  const ledger = new Ledger(w.state, id);
  ledger.pin(rows as any);
  ledger.eligible();
  const batch = ledger.allocate(13)!;
  ledger.stage(batch.id, pczt, tx1);
  ledger.close();
  return { tx1 };
}

async function p33() {
  const beacon = await fetchBeacon(R);
  const fx = await buildAuction({ beacon, count: 4, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  const run = part === "before" ? { root: BASE, benzo: BASE_BENZO } : { root: ROOT, benzo: GREEN_BENZO };
  const tag = part === "before" ? "red" : "green";
  const w = writeWorld(`p33-${tag}`, fx, run);
  stub(path.join(w.state, "bin"), "zcash-devtool", blindDevtoolStub(CHANGE_ADDR));
  const seeded = seedBlindCrash(w);
  // Run 2: the honest re-send after the crash. Both sends answer the TRUE phrase from a wallet that does
  // not know the txid.
  const r2 = runSettle(w);
  console.log(`OBSERVE p33-${tag} run 2 exit=${r2.code}`);
  console.log((r2.err || r2.out).trim().split("\n").filter(Boolean).slice(-8).map(l => "  | " + l).join("\n"));
  const phrases = (settleLog(w).match(/transaction already exists in mempool/g) ?? []).length;
  const receipts = existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : [];
  if (part === "after") {
    check("p33-reaches-mined", r2.code === 0 && receipts.length === w.rows.length && receipts.every((x: any) => x.txid === seeded.tx1),
      `run 2 reached mined and confirmed the staged batch (exit ${r2.code}, ${receipts.length} receipts at ${seeded.tx1.slice(0, 16)}…)`);
    check("p33-continues", r2.err.includes(`settlement already in mempool ${seeded.tx1}; waiting for it to mine`) && phrases >= 2,
      `the run continued past the double phrase (${phrases} truthful answers) into the mined-wait`);
    check("p33-never-rebroadcast", chain(w).broadcasts.length === 1 && chain(w).broadcasts[0] === seeded.tx1,
      "the transaction was never re-broadcast (run 1's broadcast stands; run 2 only waited)");
    const r3 = runSettle(w);
    check("p33-rerun-0", r3.code === 0 && receiptsOf(w).length === w.rows.length,
      `a further re-run is clean (exit ${r3.code})`);
  } else {
    check("p33-red-crash-loops", r2.code === 1 && /already exists in mempool/.test(r2.err) && receipts.length === 0,
      `the base run 2 throws on the true phrase (exit ${r2.code}): ${(r2.err.trim().split("\n").filter(l => l.includes("ERROR")).at(-1) ?? "").slice(0, 140)}`);
    const r3 = runSettle(w);
    check("p33-red-every-rerun", r3.code === 1 && /already exists in mempool/.test(r3.err),
      `every re-run takes the same path — the crash-loop until the transaction actually mines (exit ${r3.code})`);
    check("p33-red-nothing-recorded", chain(w).broadcasts.length === 1 && chain(w).broadcasts[0] === seeded.tx1 && (existsSync(path.join(w.state, "settle", w.id, "receipts.json")) ? receiptsOf(w) : []).length === 0,
      "nothing was recorded and nothing was re-broadcast on the base");
  }
}

// ---- p31 (P3-1): the shared "paid" predicate with the injected minedHeightOf lookup. The green leg runs
// the shipped settle/deposits.ts; the red leg runs the BASE tree's own predicate bundle (the pristine
// 59c863c settle/deposits.ts, esbuild'd per the header), where a zero-change batch can never count.
async function p31() {
  const cur = await import("../../settle/deposits");
  const dep: any = part === "before" ? await import(pathToFileURL(path.join(BASE, "settle", "dist", "deposits.mjs")).href) : cur;
  const tip = 110, txid = "aa".repeat(32);
  const att = [{ txid, party: "leaf:0", output_index: 0, amount_zats: "15000" }];
  const receipt = [{ party: "leaf:0", amount_zats: "15000", txid, output_index: 0 }];
  // A zero-change paying batch: one vault note was spent by the tx, and the scan carries NO note of the
  // txid itself (the batch spent exact inputs and left no change).
  const scanZeroChange = [{ txid: "bb".repeat(32), height: 100, spent_in_txid: txid }];
  // The ordinary batch's control world: the change note's txid IS the paying txid.
  const scanNormal = [{ txid: "bb".repeat(32), height: 100, spent_in_txid: txid }, { txid, height: 100, spent_in_txid: null }];
  // A reorged-out batch whose notes the scan still carries, at no height.
  const scanReorged = [{ txid: "bb".repeat(32), height: null, spent_in_txid: txid }, { txid, height: null, spent_in_txid: null }];
  const count = (scan: any[], at: (t: string) => number) => dep.paidByOwnLedger(receipt, att, scan, tip, at).length;
  const eleven = () => 100, nine = () => 102, gone = () => 0; // the injected lookup at 11 deep, 9 deep, and absent
  console.log(`OBSERVE p31-${part} zero-change 11 deep=${count(scanZeroChange, eleven)} 9 deep=${count(scanZeroChange, nine)} reorged=${count(scanZeroChange, gone)} scan-note-reorged=${count(scanReorged, eleven)} ordinary=${count(scanNormal, gone)}`);
  if (part === "after") {
    check("p31-zero-change-11-deep", count(scanZeroChange, eleven) === 1,
      "a zero-change batch 11 deep counts through the injected minedHeightOf lookup");
    check("p31-zero-change-9-deep", count(scanZeroChange, nine) === 0,
      "9 deep does not count (the same >=10 rule as the scan)");
    check("p31-reorged-out", count(scanZeroChange, gone) === 0,
      "a reorged-out transaction (the lookup finds no height) does not count");
    check("p31-scan-authoritative", count(scanReorged, eleven) === 0,
      "a scan that carries the txid's own note stays authoritative — a reorged note never falls back to the chain lookup");
    check("p31-ordinary-unchanged", count(scanNormal, gone) === 1,
      "the ordinary change-note world counts exactly as before (no lookup needed)");
  } else {
    check("p31-zero-change-red", count(scanZeroChange, eleven) === 0,
      "the base predicate counts a zero-change batch 11 deep as NOT paid — the row is owed forever (the wall)");
    check("p31-zero-change-red-ignores-lookup", count(scanZeroChange, eleven) === 0 && count(scanNormal, eleven) === 1,
      "the base reads the mined height only from a vault note of the paying txid (its change): the ordinary world counts, the zero-change one never does");
  }
}

if (wants("p22")) await p22();
if (wants("p33")) await p33();
if (wants("p31")) await p31();
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
