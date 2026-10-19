// B50 (docs/design/phase7-b50-p2-sweep.md): the remaining verify/settle P2s — H1, H3, H5, H6 and H7 (H21's
// cases extend tools/repro/b48-p3s.ts). Every case runs the REAL shipped code (the in-process
// checkPublicAuction / publish the folds use at their real boundary, and the real `bin/benzo` CLI through
// the b47 stub harness for the worker cases) on one small but REAL auction fixture (tools/repro/
// h-fixtures.ts: real tlock ciphertexts to a past quicknet round, signed manifest, frozen set, envelope
// records and a cleared result). Each section is red on the BASE commit's code and green after:
//   red/green h1  receipt-attestation holds its two attesting maps to FULL agreement (mapPairAgrees):
//                  two pinned maps that agree on the receipt's txid and outputs but differ in `strays`,
//                  `defaults` or `batch` jointly attest nothing (base: ACCEPTED — the H1 hole);
//   red/green h3  the one-pool rule on every build path as an R46-style typed set-aside: `sign build` and
//                  `sign approve` refuse a two-pool candidate typed (exit 3, the minority pool's rows
//                  named), the worker sets those rows aside and the batch's other rows still pay —
//                  custody (hostBuild) and local build alike (base: the custody path pays the two-pool
//                  batch, the local path wedges the run untyped);
//   red/green h5  batch `proofs`, `inspect` and `signing` hold their exact shapes: an extra key or a blob
//                  in place of a field is refused (base: ACCEPTED — only the leak guard looked at them);
//   red/green h6  the receipt exact-key check runs in receipt-attestation, so a result-less (cancelled)
//                  settlement's receipt cannot carry an extra key (base: ACCEPTED — the check lived in
//                  accounting, which a cancelled settlement skips);
//   red/green h7  a bond auction whose every batch is set aside publishes a no-payment settlement carrying
//                  the set-aside reasons, and verify accepts it (base: publish refuses at `pick === null`);
//   control dirs  every committed published dir still verifies (listed one by one; identical on both legs).
//
// Build+run (red drives the PRISTINE base commit's bundles — the folds' git-archive recipe):
//   npx esbuild tools/repro/b50-p2-sweep.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b50.mjs
//   BNZ_STATE_DIR=tmp/b50/state node tmp/b50.mjs after [h1|h3|h5|h6|h7|dirs]
//   base tree (built ONCE from the pristine base commit 503826b before any B50 edit):
//     mkdir -p tmp/b50/base-src && git archive 503826b | tar -x -C tmp/b50/base-src
//     ln -s $PWD/node_modules tmp/b50/base-src/node_modules && ln -s $PWD/vendor tmp/b50/base-src/vendor
//     (cd tmp/b50/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs && npx esbuild settle/envelopes.ts ... --outfile=settle/dist/envelopes.mjs && npx esbuild settle/cli.ts ... --outfile=settle/dist/cli.mjs && npx esbuild clear/cli.ts ... --outfile=clear/dist/cli.mjs && npx esbuild clear/auction-cli.ts ... --outfile=clear/dist/auction.mjs)
//   the red leg runs THIS driver's sources over the base product code:
//     cp tools/repro/b50-p2-sweep.ts tools/repro/h-fixtures.ts tmp/b50/base-src/tools/repro/
//     (cd tmp/b50/base-src && npx esbuild tools/repro/b50-p2-sweep.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=tmp/b50-base.mjs)
//     BNZ_STATE_DIR=tmp/b50/state node tmp/b50-base.mjs before [section]
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, sellerUaCommitment, reserveReturnUaCommitment } from "../../manifest/schema";
import { sealBlob } from "../../envelope";
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
import { deriveClaimOpenings } from "../../cli/published-beacon";
import { modeEntry } from "../../clear/registry";
import { signApprovalMap, signOpensReport } from "../../witness";
import { assertScratch } from "./scratch";
import { makeStubs } from "./b47-world";
import { buildAuction, fetchBeacon, needRealPczt, witnessPrivate, UA_ORCHARD, UA_SAPLING_ONLY, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2], only = process.argv[3];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b50.mjs before|after [h1|h3|h5|h6|h7|dirs]"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b50.mjs ${part}${only ? " " + only : ""} (tools/repro/b50-p2-sweep.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const BASE = path.join(ROOT, "tmp", "b50", "base-src");
const BENZO = part === "before" ? path.join(BASE, "cli", "dist", "benzo.mjs") : path.join(ROOT, "cli", "dist", "benzo.mjs");
if (!existsSync(BENZO)) throw new Error(`${BENZO} missing — build the bundles first (see the header)`);
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const wants = (section: string) => !only || only === section;

// The in-process verdict — the same path `benzo verify` takes (its claim openings included), reduced to
// ACCEPTED or REFUSED with the first errors (r78's verdict helper).
const verdict = async (pub: any, opts: any = {}): Promise<string> => {
  const claimOpenings = await deriveClaimOpenings(pub.claims ?? [], pub.beacon);
  const errors = checkPublicAuction(pub, { claimOpenings, ...opts }).filter((c: any) => c.error);
  return errors.length ? "REFUSED " + errors.map((c: any) => `${c.id}: ${String(c.error).slice(0, 90)}`).join(" | ") : "ACCEPTED";
};
const sh = (args: string[], env: Record<string, string> = {}) => runCmd(process.execPath, [BENZO, ...args], env);
const runCmd = (cmd: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(cmd, args, { input: "", encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: path.join(ROOT, "tmp", "b50", "state"), ...env } });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const lastLine = (r: { out: string; err: string }) => (r.err || r.out).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 160) ?? "";

// ---- the fixture: one small real auction (h-fixtures), its obligations and the two signed maps of one
// paying batch. The fixture's own witness halves (witnessPrivate) sign the maps, so a case can re-sign one
// over a DIFFERENT signed body — exactly what H1's "two maps that agree only on txid and outputs" is.
const R = 32704232;
const TX1 = hash("b50-batch-1"), TX2 = hash("b50-batch-2");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const obligationsOf = (fx: Fixture) => [...modeEntry(fx.manifestPacket).obligations(fx.result as any, null)];

// The all-paid uniform settlement over the fixture's obligations: one paying batch, receipts per row, and
// the two agreeing host-signed maps of that batch (the shape settle/cli.ts finalize and publish write).
const paidSettlement = (fx: Fixture, mapBody: (who: number) => any) => {
  const obs = obligationsOf(fx);
  const rows = obs.map(([party, amount], i) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats: amount, state: "paid", batch: 1, txid: TX1, output_index: i, pool: "ironwood" }));
  const receipts = obs.map(([party, amount], i) => ({ auction_id: fx.id, party, txid: TX1, pool: "ironwood", output_index: i, amount_zats: amount }));
  const maps = [0, 1].map(w => signApprovalMap(mapBody(w) as any, witnessPrivate(String(w))));
  return { rows, receipts, ignored: [], approval_maps: maps };
};
const mapOver = (fx: Fixture, overrides: (who: number) => any = () => ({})) => (who: number) => ({
  auction_id: fx.id, batch: 1, txid: TX1,
  outputs: obligationsOf(fx).map(([party], i) => ({ party, output_index: i })),
  defaults: [], balance_refunds: [], ...overrides(who),
});

const writeFixtureDir = (dir: string, fx: Fixture, settlement: any) => {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const doc: any = {
    version: 1, auction_id: fx.id, signer: fx.signer, manifest: fx.manifestPacket, state: "SETTLED",
    receipts: fx.receipts, frozen: fx.frozen, result: fx.result, opened: fx.opened, beacon: fx.beacon,
    witness_set: fx.witnessSet, witness_cert: fx.witnessCert, envelopes: fx.envelopes, settlement,
  };
  writeFileSync(path.join(dir, "auction.json"), jsonBytes(doc));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(fx.manifestPacket));
};

// In-memory settlement tamper over a committed doc (r78's helper): the projection checks re-read the
// files on disk, so a mutated in-memory settlement exercises exactly the settlement guards.
const tamper = (dir: string, f: (s: any) => void) => {
  const pub = loadPublicAuction(dir);
  const s = JSON.parse(JSON.stringify(pub.settlement));
  f(s);
  return { ...pub, settlement: s };
};

// ---- H3's worker worlds: the b47 stub harness (tools/repro/b47-world.ts), one shared chain-state file,
// stub wallet/scanner/grpcurl/benzo-pczt/zcash-sign/frost-client and (custody) a stub orb/orbctl whose
// `benzo sign build|approve|derivable|join` are the REAL shipped commands against each host's own state dir.
const FEE_RESERVE_UA = "utest1b50feereserveaddress00000000000000000000000000000000000000";
const CHANGE_ADDR = "utest1b50internalchangeaddress000000000000000000000000000000000000";
const CONFIRMATIONS = 10;

type World = {
  label: string; id: string; fx: Fixture; root: string; state: string; publicDir: string; shared: string;
  chainFile: string; stubBin: string; benzo: string; hosts: Record<string, string>; custody: boolean;
};

function writeWorkerWorld(label: string, fx: Fixture, opts: { root: string; benzo: string; custody: boolean; poolByAmount?: Record<string, string> }): World {
  const stubs = makeStubs({ realPczt: REAL_PCZT, confirmations: CONFIRMATIONS, changeAddr: CHANGE_ADDR, uaOrchard: UA_ORCHARD });
  const id = fx.id;
  const base = path.join(opts.root, "tmp", "b50-worlds", label);
  rmSync(base, { recursive: true, force: true });
  const state = path.join(base, "state"), publicDir = path.join(base, "public"), shared = path.join(base, "shared");
  const chainFile = path.join(shared, "chain-state.json"), stubBin = path.join(base, "stub-bin");
  for (const d of [state, path.join(state, "run"), path.join(state, "auction"), path.join(state, "product"), shared, stubBin, ...(opts.custody ? [path.join(state, "vaults", id, "wallet")] : [])])
    mkdirSync(d, { recursive: true, mode: 0o700 });
  stubs.writeStateBin(path.join(state, "bin"));
  const fixtureJson = JSON.stringify({ groupKey: fx.groupKey, internal_addresses: [CHANGE_ADDR, FEE_RESERVE_UA], ...(opts.poolByAmount ? { pool_by_amount: opts.poolByAmount } : {}) });
  writeFileSync(path.join(state, "fixture.json"), fixtureJson);
  const notes: any[] = fx.notes.map(n => ({ ...n }));
  notes.push({ txid: hash("b50-fee-reserve-" + label), height: 90100, pool: "ironwood", address: FEE_RESERVE_UA, diversifier_index: "9", action_index: 0, value_zats: 60000, memo_hex: null, spent_in_txid: null });
  writeFileSync(chainFile, JSON.stringify({ tip: 100000, send_mode: "ok", notes, pending: [], mined: {}, broadcasts: [] }));
  writeFileSync(path.join(state, "auction", "manifest-signing.pem"), fx.manifestPem, { mode: 0o600 });
  writeFileSync(path.join(state, "auction", `${id}.json`), jsonBytes({ manifest: fx.manifestPacket, signer: fx.signer, state: "CLEARED",
    leaves: fx.leaves, receipts: fx.receipts, frozen: fx.frozen, opened: fx.opened, result: fx.result, trace: [], beacon: fx.beacon,
    envelopes: fx.envelopes, witness_set: fx.witnessSet }));
  const routing = { bidders: [], seller_ua: UA_ORCHARD, fee_reserve_ua: FEE_RESERVE_UA, reserve_return_ua: UA_ORCHARD };
  writeFileSync(path.join(state, "product", `${id}.json`), jsonBytes({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing, public_dir: publicDir }));
  if (opts.custody) writeFileSync(path.join(state, "vaults", id, "keys.json"), jsonBytes({ group_key: fx.groupKey }));
  mkdirSync(path.join(state, "settle", id), { recursive: true, mode: 0o700 });
  const dest = hash(Buffer.from(UA_ORCHARD, "utf8"));
  for (const [n, w] of [["alice", "0"], ["bob", "1"]] as const) {
    const body = { signer: n, opens: fx.leaves.map((l: any) => ({ leaf: l.leaf_index, party: `leaf:${l.leaf_index}`, ok: true, dest_sha256: dest })) };
    writeFileSync(path.join(state, "settle", id, `envelope-opens-${n}.json`), jsonBytes({ ...body, ...signOpensReport(body, witnessPrivate(w)) }));
    writeFileSync(path.join(state, "settle", id, `routing-${n}.json`), jsonBytes(routing), { mode: 0o600 });
  }
  writeFileSync(path.join(state, "settle", id, "routing-commitment.json"), jsonBytes({ sha256: hash(jsonBytes(routing)), pinned_at: Date.now() }));
  // The local build path signs through the operator state's own frost configs and signer envelope keys.
  for (const [n, i] of [["alice", 0], ["bob", 1], ["carol", 2]] as const) {
    for (const d of [path.join(state, "signers", n), path.join(state, "frost")]) mkdirSync(d, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(state, "signers", n, "envelope-key.json"), JSON.stringify(fx.envelopeKeys[i]));
    writeFileSync(path.join(state, "frost", `${n}.toml`), "group = 0\n");
    writeFileSync(path.join(state, "frost", `${n}.pubkey`), createHash("sha256").update("b50-contact-" + n).digest("hex") + "\n");
  }
  writeFileSync(path.join(state, "group-key.txt"), fx.groupKey + "\n");
  const hosts: Record<string, string> = {};
  if (opts.custody) {
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
  }
  writePublicDir(publicDir, fx);
  return { label, id, fx, root: opts.root, state, publicDir, shared, chainFile, stubBin, benzo: opts.benzo, hosts, custody: opts.custody };
}

const worldEnv = (w: World): Record<string, string> => ({
  BNZ_STATE_DIR: w.state, BNZ_TEST_CHAIN: w.chainFile, BNZ_TEST_STUBS: path.join(w.shared, "stub-config.json"),
  BNZ_PCZT_BIN: path.join(w.state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(w.state, "bin", "benzo-scan"),
  BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: "http://127.0.0.1:9/",
  BNZ_FROSTD_HOST: "stub-frostd:2744", BNZ_FROSTD_ADDR: "stub-frostd:2744", BNZ_ROOT: w.root,
  PATH: `${w.stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
});

const run = async () => {
  const beacon = await fetchBeacon(R);
  const fx: Fixture = await buildAuction({ beacon, commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
  check("fixture-seller-payout", /^[1-9][0-9]*$/.test(fx.payout), `the fixture result owes the seller ${fx.payout} zats`);
  const obs = obligationsOf(fx);
  check("fixture-obligations", obs.length >= 2 && obs.some(([p]) => p === "seller"), `the fixture owes ${obs.map(([p, a]) => `${p}:${a}`).join(", ")}`);

  // ---- H3: the one-pool rule on every build path as an R46-style typed set-aside ---------------------
  if (wants("h3")) {
    console.log("=== h3: a two-pool candidate is refused typed on every build path; the other rows pay");
    // The worker worlds run a zero-auction-fee fixture (the settle plan's own rule: the network fee comes
    // from the fee reserve, exactly as tools/repro/b47-settle-e2e.ts builds its worlds).
    const fxW: Fixture = await buildAuction({ beacon, count: 3, fee_zats: "0", commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
    const obsW = obligationsOf(fxW);
    const minorityW = obsW.find(([p]) => p === "leaf:2") ?? obsW[0];
    const poolByAmountW = { [minorityW[1]]: "orchard" };
    const minority = obs.find(([p]) => p === "leaf:2") ?? obs[0];
    const poolByAmount = { [minority[1]]: "orchard" };
    const rowList = obs.map(([party, amount_zats]) => ({ party, kind: party === "seller" ? "payout" : "refund", amount_zats }));
    const candidateRows = obs.map(([, amount_zats]) => ({ recipient: UA_ORCHARD, amount_zats }));
    const hostEnv = (st: string) => ({
      BNZ_STATE_DIR: st, BNZ_PCZT_BIN: path.join(st, "bin", "benzo-pczt"),
      BNZ_SCAN_BIN: path.join(st, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/",
    });
    const hostState = (name: string, pools: boolean) => {
      const st = path.join(ROOT, "tmp", "b50", `h3-state-${name}`);
      rmSync(st, { recursive: true, force: true });
      writeHostState(st, fx, REAL_PCZT);
      const fix = JSON.parse(readFileSync(path.join(st, "fixture.json"), "utf8"));
      if (pools) fix.pool_by_amount = poolByAmount;
      writeFileSync(path.join(st, "fixture.json"), JSON.stringify(fix));
      return st;
    };
    const packetDir = (name: string, rows: any[], candidate?: { rows: any[] }) => {
      const dir = path.join(ROOT, "tmp", "b50", `h3-packet-${name}`);
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true, mode: 0o700 });
      writePublicDir(path.join(dir, "public"), fx);
      const meta: any = { auction_id: fx.id, signer: fx.signer, seller_ua: UA_ORCHARD, batch: 1, expiry_blocks: 100 };
      if (rows.length) writeFileSync(path.join(dir, "rows.json"), jsonBytes(rows));
      if (candidate) {
        const content = JSON.stringify({ rows: candidate.rows });
        writeFileSync(path.join(dir, "candidate.pczt"), content);
        writeFileSync(path.join(dir, "sealed-alice.bin"), sealBlob(Buffer.from(content), fx.envelopeKeys[0].public_hex), { mode: 0o600 });
        meta.plan_version = createHash("sha256").update(readFileSync(path.join(dir, "candidate.pczt"))).digest("hex");
      }
      writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
      return dir;
    };

    // (1) the real `sign build` and `sign approve` on a signer-host state dir (the b48 harness).
    {
      const st = hostState("build-two-pools", true), dir = packetDir("build-two-pools", rowList);
      const b = sh(["sign", "build", "--id", fx.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(st));
      const typed = b.code === 3 && b.err.includes(`refused-rows ${JSON.stringify([minority[0]])}`);
      check("h3-build-two-pools-typed", typed && !existsSync(path.join(dir, "build.json")),
        `a two-pool candidate: exit ${b.code}, ${typed ? `refused-rows ["${minority[0]}"] (the minority pool's rows only)` : `no typed refusal (${lastLine(b)})`}, nothing built`);
    }
    {
      const st = hostState("build-one-pool", false), dir = packetDir("build-one-pool", rowList);
      const b = sh(["sign", "build", "--id", fx.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(st));
      check("h3-build-one-pool-ok", b.code === 0 && existsSync(path.join(dir, "build.json")),
        `control, one pool: exit ${b.code}, ${existsSync(path.join(dir, "build.json")) ? "built" : "not built"} (${lastLine(b)})`);
    }
    {
      const st = hostState("approve-two-pools", true), dir = packetDir("approve-two-pools", [], { rows: candidateRows });
      const a = sh(["sign", "approve", "--id", fx.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(st));
      const typed = a.code === 3 && a.err.includes(`refused-rows ${JSON.stringify([minority[0]])}`);
      check("h3-approve-two-pools-typed", typed && !existsSync(path.join(st, "approvals", fx.id, "batch-1.json")),
        `a two-pool candidate: exit ${a.code}, ${typed ? `refused-rows ["${minority[0]}"] (the minority pool's rows only)` : `no typed refusal (${lastLine(a)})`}, no approval recorded`);
    }
    {
      const st = hostState("approve-one-pool", false), dir = packetDir("approve-one-pool", [], { rows: candidateRows });
      const a = sh(["sign", "approve", "--id", fx.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(st));
      check("h3-approve-one-pool-ok", a.code === 0 && existsSync(path.join(st, "approvals", fx.id, "batch-1.json")),
        `control, one pool: exit ${a.code}, ${existsSync(path.join(st, "approvals", fx.id, "batch-1.json")) ? "approved" : "not approved"} (${lastLine(a)})`);
    }

    // (2)+(3) the real `bin/benzo settle` worker through the b47 stub harness (tools/repro/b47-world.ts):
    // custody (hostBuild via real `sign build`) and the local build path.
    for (const custody of [true, false]) {
      const label = custody ? "h3-custody" : "h3-local";
      const w = writeWorkerWorld(label, fxW, { root: part === "before" ? BASE : ROOT, benzo: BENZO, custody, poolByAmount: poolByAmountW });
      const r = runCmd(custody && w.benzo === path.join(ROOT, "cli", "dist", "benzo.mjs") ? path.join(ROOT, "bin", "benzo") : process.execPath,
        custody && w.benzo === path.join(ROOT, "cli", "dist", "benzo.mjs") ? ["settle", "--id", w.id] : [w.benzo, "settle", "--id", w.id], worldEnv(w));
      console.log(`OBSERVE ${label} exit=${r.code}`);
      console.log(r.err.trim().split("\n").filter(Boolean).slice(-12).map(l => "  | " + l).join("\n"));
      const doc = existsSync(path.join(w.publicDir, "auction.json")) ? JSON.parse(readFileSync(path.join(w.publicDir, "auction.json"), "utf8")) : null;
      const rows: any[] = doc?.settlement?.rows ?? [];
      const receipts: any[] = doc?.settlement?.receipts ?? [];
      const minorityRow = rows.find((x) => x.party === minorityW[0]);
      const others = obsW.filter(([p]) => p !== minorityW[0]);
      check(`${label}-other-rows-paid`, r.code === 0 && others.every(([p, a]) => receipts.some((x) => x.party === p && x.amount_zats === a)),
        `the batch's other rows paid: ${others.map(([p]) => p).join(", ")} (receipts: ${receipts.map((x) => x.party).join(", ") || "none"})`);
      check(`${label}-minority-set-aside`, !!minorityRow && minorityRow.state === "exception" && !receipts.some((x) => x.party === minorityW[0]),
        `${minorityW[0]} waits in the exception queue: row ${minorityRow ? minorityRow.state : "missing"}, receipt ${receipts.some((x) => x.party === minorityW[0]) ? "PAID" : "none"}`);
      check(`${label}-set-aside-reason`, new RegExp(`ERROR batch \\d+: [^\n]*${minorityW[0]}[^\n]*set aside this run`).test(r.err),
        `the set-aside is reported with its reason and the named row (the worker's batch line)`);
    }
  }

  // ---- H1: receipt-attestation requires FULL map agreement -------------------------------------------
  if (wants("h1")) {
    console.log("=== h1: the two attesting maps must agree on every signed field (mapPairAgrees)");
    const dir = path.join(ROOT, "tmp", "b50", "h1-public");
    {
      writeFixtureDir(dir, fx, paidSettlement(fx, mapOver(fx)));
      const v = await verdict(loadPublicAuction(dir));
      check("h1-honest-pair-accepted", v === "ACCEPTED", `two fully agreeing maps: ${v}`);
    }
    {
      const settlement = paidSettlement(fx, mapOver(fx, (who) => (who === 1 ? { strays: [{ party: "deposit:" + "ab".repeat(32) + ":ironwood:9", memo_sha256: "cd".repeat(32) }] } : {})));
      writeFixtureDir(dir, fx, settlement);
      const v = await verdict(loadPublicAuction(dir));
      const refused = /receipt-attestation/.test(v) && v.startsWith("REFUSED");
      check("h1-strays-differ-refused", refused, `maps agreeing on txid+outputs but differing in strays: ${v}`);
    }
    {
      const settlement = paidSettlement(fx, mapOver(fx, (who) => (who === 1 ? { defaults: [0] } : {})));
      writeFixtureDir(dir, fx, settlement);
      const v = await verdict(loadPublicAuction(dir));
      const refused = /receipt-attestation/.test(v) && v.startsWith("REFUSED");
      check("h1-defaults-differ-refused", refused, `maps agreeing on txid+outputs but differing in defaults: ${v}`);
    }
    {
      const settlement = paidSettlement(fx, mapOver(fx, (who) => (who === 1 ? { batch: 2 } : {})));
      writeFixtureDir(dir, fx, settlement);
      const v = await verdict(loadPublicAuction(dir));
      const refused = /receipt-attestation/.test(v) && v.startsWith("REFUSED");
      check("h1-batch-differ-refused", refused, `maps agreeing on txid+outputs but differing in batch: ${v}`);
    }
  }

  // ---- H5: exact shapes for batch proofs, inspect and signing ----------------------------------------
  if (wants("h5")) {
    console.log("=== h5: batch proofs/inspect/signing hold their exact shapes");
    const real = path.join(ROOT, "docs/evidence/phase-6/markets/launch-r34/launch-cold");
    const legacy = path.join(ROOT, "docs/evidence/phase-6/rg/settle-crash/settle/main");
    {
      const v = await verdict(loadPublicAuction(real));
      check("h5-honest-doc-accepted", v === "ACCEPTED", `the committed launch-r34 doc: ${v}`);
    }
    {
      const v = await verdict(loadPublicAuction(legacy));
      check("h5-honest-legacy-proofs-accepted", v === "ACCEPTED", `the committed settle-crash doc (carries proofs): ${v}`);
    }
    const cases: [string, string, (s: any) => void][] = [
      ["h5-signing-blob-refused", "a blob in place of the signing object", (s) => { s.batches[0].signing = "aGVsbG8gd29ybGQ="; }],
      ["h5-signing-extra-key-refused", "an extra key in signing", (s) => { s.batches[0].signing.leak = "aGVsbG8="; }],
      ["h5-signing-field-blob-refused", "a blob in place of signing.sighash", (s) => { s.batches[0].signing.sighash = "aGVsbG8gd29ybGQ="; }],
      ["h5-inspect-blob-refused", "a blob in place of the inspect object", (s) => { s.batches[0].inspect = "aGVsbG8gd29ybGQ="; }],
      ["h5-inspect-extra-key-refused", "an extra key in inspect", (s) => { s.batches[0].inspect.encoded_payload = "aGVsbG8="; }],
      ["h5-inspect-field-blob-refused", "a blob in place of inspect.fee_zats", (s) => { s.batches[0].inspect.fee_zats = "aGVsbG8gd29ybGQ="; }],
      ["h5-inspect-wrong-type-refused", "a string in place of inspect.actions", (s) => { s.batches[0].inspect.actions = "12"; }],
      ["h5-inspect-output-extra-key-refused", "an extra key in an inspect output", (s) => { s.batches[0].inspect.outputs[0].recipient = "aGVsbG8="; }],
      ["h5-proofs-blob-refused", "a blob in place of the proofs list", (s) => { s.batches[0].proofs = "aGVsbG8gd29ybGQ="; }],
      ["h5-proofs-entry-blob-refused", "a blob in place of proofs[0].height", (s) => { s.batches[0].proofs = [{ height: "aGVsbG8=", raw_hash: "ab".repeat(32) }]; }],
    ];
    for (const [id, what, mutate] of cases) {
      const v = await verdict(tamper(real, mutate));
      const refused = v.startsWith("REFUSED");
      check(id, refused, `${what}: ${v}`);
    }
  }

  // ---- H6: the receipt exact-key check runs on result-less (cancelled) settlements --------------------
  if (wants("h6")) {
    console.log("=== h6: the receipt exact-key check moves into receipt-attestation (cancelled settlements)");
    const cancelledDocs = [
      "docs/evidence/phase-5/live-regression-4876156/cli/cancelled.json",
      "docs/evidence/phase-5/live-regression-7b4b0f9/cli/cancelled.json",
      "docs/evidence/phase-6/rg/cli-auction/cli/cancelled.json",
    ];
    const asDir = (i: number) => {
      const dir = path.join(ROOT, "tmp", "b50", `h6-cancelled-${i}`);
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      copyFileSync(path.join(ROOT, cancelledDocs[i]), path.join(dir, "auction.json"));
      return dir;
    };
    for (const [i, f] of cancelledDocs.entries()) {
      const v = await verdict(loadPublicAuction(asDir(i)));
      check(`h6-honest-cancelled-${i}-accepted`, v === "ACCEPTED", `${f}: ${v}`);
    }
    {
      const pub = loadPublicAuction(asDir(1));
      const s = JSON.parse(JSON.stringify(pub.settlement));
      s.receipts[0].extra_key = "a smuggled field";
      const v = await verdict({ ...pub, settlement: s });
      const refused = /receipt/.test(v) && v.startsWith("REFUSED");
      check("h6-cancelled-receipt-extra-key-refused", refused, `a cancelled receipt carrying an extra key: ${v}`);
    }
    {
      const pub = loadPublicAuction(asDir(2));
      const s = JSON.parse(JSON.stringify(pub.settlement));
      s.receipts[1].memo_hex = "aGVsbG8gd29ybGQ=";
      const v = await verdict({ ...pub, settlement: s });
      const refused = /receipt/.test(v) && v.startsWith("REFUSED");
      check("h6-cancelled-receipt-blob-field-refused", refused, `a cancelled receipt carrying a blob field: ${v}`);
    }
  }

  // ---- control: every committed published dir still verifies (listed one by one) ---------------------
  if (wants("dirs")) {
    console.log("=== dirs: every committed published dir still verifies");
    const dirs = execFileSync("bash", ["-c", "cd docs/evidence && find . -name manifest.json | sed 's|/manifest.json$||' | sort"], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const d of dirs) {
      const full = path.join(ROOT, "docs/evidence", d);
      try {
        // The Phase 2/3 and settle-crash legacy dirs keep signer.json beside their subdirs (the r82
        // replay recipe): assemble the reader's view of one in tmp/ before loading it.
        let readDir = full;
        if (!existsSync(path.join(full, "signer.json")) && !existsSync(path.join(full, "auction.json")) && existsSync(path.join(path.dirname(full), "signer.json"))) {
          readDir = path.join(ROOT, "tmp", "b50", "dirs", d.replace(/\//g, "_"));
          rmSync(readDir, { recursive: true, force: true }); mkdirSync(readDir, { recursive: true });
          for (const f of readdirSync(full)) copyFileSync(path.join(full, f), path.join(readDir, f));
          copyFileSync(path.join(path.dirname(full), "signer.json"), path.join(readDir, "signer.json"));
        }
        const pub = loadPublicAuction(readDir);
        const unattested = (pub.settlement?.receipts ?? []).length > 0 && (pub.settlement?.approval_maps ?? []).length === 0;
        const v = await verdict(pub, unattested ? { allowUnattested: true } : {});
        check(`dir ${d}`, v === "ACCEPTED", v);
      } catch (e) {
        check(`dir ${d}`, false, `threw ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }
};

await run();
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
