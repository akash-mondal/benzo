// H13 (docs/design/phase7-h13-h14.md items 4-5): the host openings cache and the per-batch verify measurement.
// Offline, on the tools/bench.ts fixture machinery (tools/repro/h-fixtures.ts: real tlock ciphertexts of
// 128-byte bids sealed to past quicknet round 32704232) at N = 55 and N = 1,000 leaves, plus 2 stray notes
// per fixture so the memo cache is exercised:
//   - time `sign derivable` (which runs deriveRows — the per-batch host work) for the FIRST and the SECOND
//     batch, before (base commit bundles) and after (this tree);
//   - count openSealedBid calls through the BNZ_OPENINGS_TRACE proof hook (envelope/opening.ts), split into
//     the deriveRows process itself and its internal `benzo verify` grandchild: the second batch after must
//     not re-decrypt anything;
//   - (B45, H16) count every `benzo-pczt` spawn through the BNZ_PCZT_TRACE proof hook (the h-fixtures stub),
//     split into `classify-address` calls and the rest: before, every derived row classifies per row; after,
//     the first batch makes ONE classifyAddresses call (one bulk classify-address per 2,000 addresses) and
//     the second batch spawns classify-address ZERO times — the host's classify-cache.json (next to
//     openings.json: {bin_sha256, entries: {sha256(address): verdict}}, mode 0600) serves it. A changed
//     binary hash discards the cache whole and the verdicts re-derive byte-identically;
//   - time `benzo verify` on both fixtures (the design's "measure first" for the --openings-cache decision)
//     and, after, with the host's own cache file;
//   - check the cache rules: $BNZ_STATE_DIR/auctions/<id>/openings.json (openings: {leaf_index:
//     plaintext|null}) and memo-openings.json (keyed by sha256(ciphertext)), mode 0600, reused only when BOTH
//     frozen_root and beacon_sha256 match, otherwise rebuilt, never packet input (verify refuses any other
//     path), and the derived rows stay byte-identical to the base commit's.
//
// Build+run:
//   npx esbuild tools/repro/h13-host-scale.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/h13.mjs
//   (B45: base bundles = the pristine base commit BEFORE B45, under tmp/b45/base — built once from a
//    `git archive` extraction with the tree's own build:core + build:cli, then `cp -R cli/dist
//    tmp/b45/base/cli-dist`, so the BASE_BENZO sign derivable and its verify grandchild run base code)
//   (green bundles from this tree: npm run build:core && npm run build:cli)
//   node tmp/h13.mjs before && node tmp/h13.mjs after
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import { canonical, jsonBytes, QUICKNET } from "../../manifest/schema";
import { buildAuction, fetchBeacon, needRealPczt, UA_ORCHARD, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/h13.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/h13.mjs ${part} (tools/repro/h13-host-scale.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const WORK = path.join(ROOT, "tmp", "h13");
mkdirSync(WORK, { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;
const BASE = path.join(ROOT, "tmp", "b45", "base");
const BASE_BENZO = path.join(BASE, "cli-dist", "benzo.mjs");
const GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
if (part === "before" && !existsSync(BASE_BENZO)) throw new Error(`${BASE_BENZO} missing — build the base bundles first (see the header)`);
if (part === "after" && !existsSync(GREEN_BENZO)) throw new Error(`${GREEN_BENZO} missing — run npm run build:core && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const save = (name: string, value: unknown) => writeFileSync(path.join(WORK, name), jsonBytes(value));
const load = (name: string) => JSON.parse(readFileSync(path.join(WORK, name), "utf8"));

// The honest drand pins, so sealing to the past round needs no network (the tools/bench.ts rule).
const pinnedInfo = { public_key: QUICKNET.public_key, period: QUICKNET.period, genesis_time: QUICKNET.genesis, hash: QUICKNET.chain_hash, groupHash: "", schemeID: QUICKNET.scheme, metadata: { beaconID: "quicknet" } };
const pinnedClient = { chain: () => ({ info: async () => pinnedInfo }) } as unknown as Parameters<typeof timelockEncrypt>[2];
// The v1 memo framing the fixtures use: ff424e5a01 || u16be ct_len || tlock_ct || zero pad.
const memoV1 = (ct: Buffer): string => {
  if (ct.length > 505) throw new Error("ciphertext memo cap");
  const memo = Buffer.alloc(512); Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
  return memo.toString("hex");
};
// One stray: a mined exact-C deposit at the fixture's deposit address whose memo is a REAL sealed 128-byte bid
// for this auction's round — not a frozen leaf, so deriveRows treats it as a stray and opens its memo
// (memoOwner) exactly as it does live.
const strayNote = async (fixture: Fixture, i: number) => {
  const pt = Buffer.alloc(128, 7 + i);
  const ct = Buffer.from(decodeArmor(await timelockEncrypt(fixture.R, pt, pinnedClient)), "binary");
  // The base commit's deriveRows opens this memo through Go tle (the h-fixtures stub maps ciphertexts to the
  // fixture's plaintexts), so the stray's ciphertext must be registered there exactly like the leaves.
  fixture.plaintexts[ct.toString("hex")] = pt.toString("hex");
  return { txid: createHash("sha256").update(`benzo-h13-stray-${i}`).digest("hex"), height: 95000 + i, pool: "ironwood",
    address: fixture.manifest.deposit_addresses[0], diversifier_index: String(9000 + i), action_index: 9000 + i,
    value_zats: Number(fixture.manifest.C_zats), memo_hex: memoV1(ct), spent_in_txid: null };
};

// ---- fixtures: generated once by `before`, byte-shared with `after` (the envelope keys are random) ----------
const buildFixture = async (N: number): Promise<Fixture> => {
  const beacon = await fetchBeacon(32704232);
  const fixture = await buildAuction({ beacon, count: N });
  fixture.notes.push(await strayNote(fixture, 1), await strayNote(fixture, 2));
  return fixture;
};
const fixtureFile = (N: number) => path.join(WORK, `fixture-${N}.json`);

// ---- the sign derivable harness (h-fixtures stub state; every product decision is real code) ---------------
const setupState = (label: string, fixture: Fixture) => {
  const state = path.join(WORK, `state-${label}`);
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, fixture, REAL_PCZT);
  const packet = path.join(WORK, `packet-${label}`);
  rmSync(packet, { recursive: true, force: true }); mkdirSync(path.join(packet, "public"), { recursive: true, mode: 0o700 });
  writePublicDir(path.join(packet, "public"), fixture);
  writeFileSync(path.join(packet, "packet.json"), jsonBytes({ auction_id: fixture.id, signer: fixture.signer, seller_ua: "utest1redacted" }));
  return { state, packet };
};
const runDerivable = (label: string, benzo: string, fixture: Fixture, state: string, packet: string, run: number) => {
  const trace = path.join(WORK, `trace-${label}-run${run}.log`);
  rmSync(trace, { force: true });
  const pcztTrace = path.join(WORK, `pczt-${label}-run${run}.log`);
  rmSync(pcztTrace, { force: true });
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [benzo, "sign", "derivable", "--id", fixture.id, "--packet", packet, "--name", "alice"], {
    input: "", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/", BNZ_OPENINGS_TRACE: trace, BNZ_PCZT_TRACE: pcztTrace },
  });
  const ms = performance.now() - t0;
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, ms, parsed, err: r.stderr ?? "", out: r.stdout ?? "", pid: r.pid, trace, pcztTrace };
};
// openSealedBid calls, split between the deriveRows process itself (pid === the sign derivable child) and its
// internal benzo verify grandchild.
const countOpens = (file: string, ownPid: number | undefined) => {
  const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  const own = lines.filter(l => l.pid === ownPid).length;
  return { own, verify: lines.length - own, total: lines.length };
};
// benzo-pczt invocations (BNZ_PCZT_TRACE, the h-fixtures stub), split into classify-address calls and the
// rest (ufvk-ak/owns/create/inspect) — the per-row classify spawn is the H16 cost being removed.
const countPczt = (file: string) => {
  const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
  const classify = lines.filter(l => l.startsWith("classify-address")).length;
  return { classify, other: lines.length - classify, total: lines.length };
};
const runVerify = (label: string, benzo: string, fixture: Fixture, state: string, publicDir: string, extra: string[] = []) => {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [benzo, "verify", "--dir", publicDir, "--signer", fixture.signer, ...extra], {
    encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: state },
  });
  return { code: r.status ?? 1, ms: performance.now() - t0, out: r.stdout ?? "", err: r.stderr ?? "" };
};

const beaconSha = (beacon: { signature: string }) => createHash("sha256").update(Buffer.from(beacon.signature, "hex")).digest("hex");
const doPart = async (N: number) => {
  const benzo = part === "before" ? BASE_BENZO : GREEN_BENZO;
  let fixture: Fixture;
  if (part === "before") {
    console.log(`=== fixture: N=${N} real tlock ciphertexts to quicknet round 32704232 + 2 stray notes`);
    fixture = await buildFixture(N);
    save(`fixture-${N}.json`, fixture);
  } else fixture = load(`fixture-${N}.json`) as Fixture;
  const { state, packet } = setupState(`${part}-${N}`, fixture);
  const publicDir = path.join(packet, "public");

  console.log(`=== ${part} verify: time benzo verify on the ${N}-leaf fixture`);
  const cold = runVerify(`${part}-${N}`, benzo, fixture, state, publicDir);
  check(`verify-${N}-cold-passes`, cold.code === 0, `exit ${cold.code}`);
  console.log(`OBSERVE verify N=${N} cold ${cold.ms.toFixed(0)} ms (${part}${part === "after" ? ", no cache" : ""})`);

  console.log(`=== ${part} deriveRows: sign derivable for the first and the second batch (same host state)`);
  const run1 = runDerivable(`${part}-${N}`, benzo, fixture, state, packet, 1);
  check(`derive-${N}-run1-passes`, run1.code === 0 && (run1.parsed?.rows?.length ?? 0) > 0,
    run1.code === 0 ? `exit 0, ${run1.parsed?.rows?.length ?? 0} rows` : `exit ${run1.code}: ${(run1.err || run1.out).trim().split("\n").filter((l: string) => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 180) || "(no ERROR line)"}`);
  const run2 = runDerivable(`${part}-${N}`, benzo, fixture, state, packet, 2);
  check(`derive-${N}-run2-passes`, run2.code === 0 && (run2.parsed?.rows?.length ?? 0) > 0,
    run2.code === 0 ? `exit 0, ${run2.parsed?.rows?.length ?? 0} rows` : `exit ${run2.code}: ${(run2.err || run2.out).trim().split("\n").filter((l: string) => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 180) || "(no ERROR line)"}`);
  console.log(`OBSERVE derive N=${N} first-batch ${run1.ms.toFixed(0)} ms, second-batch ${run2.ms.toFixed(0)} ms (${part})`);
  check(`derive-${N}-rows-identical`, JSON.stringify(run1.parsed?.rows) === JSON.stringify(run2.parsed?.rows),
    "the second batch derives the byte-identical rows");

  const opens1 = countOpens(run1.trace, run1.pid), opens2 = countOpens(run2.trace, run2.pid);
  console.log(`OBSERVE opens N=${N} first-batch own=${opens1.own} verify=${opens1.verify} total=${opens1.total} (${part})`);
  console.log(`OBSERVE opens N=${N} second-batch own=${opens2.own} verify=${opens2.verify} total=${opens2.total} (${part})`);
  const pczt1 = countPczt(run1.pcztTrace), pczt2 = countPczt(run2.pcztTrace);
  console.log(`OBSERVE pczt N=${N} first-batch classify=${pczt1.classify} other=${pczt1.other} total=${pczt1.total} (${part})`);
  console.log(`OBSERVE pczt N=${N} second-batch classify=${pczt2.classify} other=${pczt2.other} total=${pczt2.total} (${part})`);
  if (part === "after") {
    check(`derive-${N}-second-batch-zero-opens`, opens2.total === 0,
      `the second batch re-decrypts nothing: own=${opens2.own}, verify=${opens2.verify}`);
    check(`derive-${N}-first-batch-cached-structure`, opens1.own === N + 2 && opens1.verify === N,
      `the first batch opens each leaf once per computation (own deriveRows ${opens1.own} = ${N} leaves + 2 stray memos, verify ${opens1.verify} = ${N} leaves)`);
    check(`derive-${N}-second-batch-zero-classify`, pczt2.classify === 0,
      `the second batch spawns classify-address zero times (other benzo-pczt calls: ${pczt2.other})`);
    check(`derive-${N}-first-batch-one-classify-call`, pczt1.classify === 1,
      `the first batch classifies every derived destination with one classifyAddresses call (spawns ${pczt1.classify})`);
  }
  return { fixture, state, publicDir, benzo, rows: run2.parsed?.rows, run1, run2 };
};

for (const N of [55, 1000]) {
  const done = await doPart(N);
  if (part === "before") save(`rows-${N}.json`, done.rows);
  else {
    check(`derive-${N}-rows-match-base`, canonical(done.rows) === canonical(load(`rows-${N}.json`)),
      "same answers: the derived rows are byte-identical to the base commit's (canonical JSON)");

    // The cache files: this host's own computation, mode 0600, both keys, and the two keyings.
    const auctionDir = path.join(done.state, "auctions", done.fixture.id);
    const leafFile = path.join(auctionDir, "openings.json"), memoFile = path.join(auctionDir, "memo-openings.json");
    const leafDoc = JSON.parse(readFileSync(leafFile, "utf8")), memoDoc = JSON.parse(readFileSync(memoFile, "utf8"));
    const mode = (f: string) => (statSync(f).mode & 0o777).toString(8);
    check(`cache-${N}-shape`, leafDoc.frozen_root === done.fixture.frozen.root && leafDoc.beacon_sha256 === beaconSha(done.fixture.beacon)
      && Object.keys(leafDoc.openings).length === N && Object.values(leafDoc.openings).every(v => typeof v === "string" && (v as string).length === 256),
      `openings.json: {frozen_root: ${leafDoc.frozen_root.slice(0, 12)}…, beacon_sha256: ${leafDoc.beacon_sha256.slice(0, 12)}…, openings: ${Object.keys(leafDoc.openings).length}}`);
    check(`cache-${N}-memo-shape`, memoDoc.frozen_root === done.fixture.frozen.root && memoDoc.beacon_sha256 === beaconSha(done.fixture.beacon)
      && Object.keys(memoDoc.openings).length === 2 && Object.keys(memoDoc.openings).every(k => /^[0-9a-f]{64}$/.test(k)),
      `memo-openings.json: 2 entries keyed by sha256(ciphertext)`);
    check(`cache-${N}-mode-0600`, mode(leafFile) === "600" && mode(memoFile) === "600", `openings.json mode ${mode(leafFile)}, memo-openings.json mode ${mode(memoFile)}`);
    check(`cache-${N}-state-only`, !existsSync(path.join(done.publicDir, "openings.json")),
      "the cache lives under this host's own BNZ_STATE_DIR, never in the packet");

    // The classify cache (B45, H16): classify-cache.json next to openings.json — every classified address
    // keyed by sha256(address) with the classifier binary's own sha256, mode 0600.
    const classifyFile = path.join(auctionDir, "classify-cache.json");
    const classifyDoc = JSON.parse(readFileSync(classifyFile, "utf8"));
    const binSha = createHash("sha256").update(readFileSync(path.join(done.state, "bin", "benzo-pczt"))).digest("hex");
    const uaKey = createHash("sha256").update(UA_ORCHARD).digest("hex");
    const entries = classifyDoc.entries ?? {};
    check(`classify-cache-${N}-shape`, classifyDoc.bin_sha256 === binSha && Object.keys(entries).length >= 1
      && Object.keys(entries).every(k => /^[0-9a-f]{64}$/.test(k)) && entries[uaKey]?.kind === "unified",
      `classify-cache.json: {bin_sha256: ${String(classifyDoc.bin_sha256).slice(0, 12)}…, entries: ${Object.keys(entries).length} keyed by sha256(address), ua verdict ${entries[uaKey]?.kind}}`);
    check(`classify-cache-${N}-mode-0600`, mode(classifyFile) === "600", `classify-cache.json mode ${mode(classifyFile)}`);
    check(`classify-cache-${N}-state-only`, !existsSync(path.join(done.publicDir, "classify-cache.json")),
      "the classify cache lives under this host's own BNZ_STATE_DIR, never in the packet");

    // The warm verify (item 5): the same verdicts without re-decrypting the covered leaves.
    const warm = runVerify(`after-${N}-warm`, done.benzo, done.fixture, done.state, done.publicDir, ["--openings-cache", leafFile]);
    check(`verify-${N}-warm-passes`, warm.code === 0, `exit ${warm.code}`);
    console.log(`OBSERVE verify N=${N} warm-with-cache ${warm.ms.toFixed(0)} ms (after)`);

    if (N === 55) {
      // A cache with other keys covers nothing and is rebuilt: tamper both keys, re-run, expect re-decryption
      // and both files rewritten with the matching keys (the rule is size-independent, proven at N=55).
      writeFileSync(leafFile, jsonBytes({ ...leafDoc, beacon_sha256: "0".repeat(64) }), { mode: 0o600 });
      writeFileSync(memoFile, jsonBytes({ ...memoDoc, frozen_root: "0".repeat(64) }), { mode: 0o600 });
      const rebuilt = runDerivable("after-55-rebuild", done.benzo, done.fixture, done.state, path.join(WORK, "packet-after-55"), 3);
      const opens3 = countOpens(rebuilt.trace, rebuilt.pid);
      const restoredLeaf = JSON.parse(readFileSync(leafFile, "utf8")), restoredMemo = JSON.parse(readFileSync(memoFile, "utf8"));
      check("cache-rebuild-on-key-mismatch", rebuilt.code === 0 && opens3.total > 0
        && restoredLeaf.beacon_sha256 === beaconSha(done.fixture.beacon) && restoredLeaf.frozen_root === done.fixture.frozen.root
        && restoredMemo.frozen_root === done.fixture.frozen.root,
        `non-matching keys rebuilt the cache: ${opens3.total} opens, both files rewritten with matching keys`);

      // B45: the classify cache is bound to the classifier binary's own sha256 — a changed binary discards
      // the file whole and the verdicts re-derive from the binary itself, byte-identically.
      const classifyDoc2 = JSON.parse(readFileSync(classifyFile, "utf8"));
      writeFileSync(classifyFile, jsonBytes({ ...classifyDoc2, bin_sha256: "0".repeat(64) }), { mode: 0o600 });
      const redone = runDerivable("after-55-classify-rebuild", done.benzo, done.fixture, done.state, path.join(WORK, "packet-after-55"), 4);
      const redoneSpawns = countPczt(redone.pcztTrace);
      const restored = JSON.parse(readFileSync(classifyFile, "utf8"));
      check("classify-cache-discarded-on-binary-change", redone.code === 0 && redoneSpawns.classify >= 1
        && restored.bin_sha256 === binSha
        && JSON.stringify(restored.entries[uaKey]) === JSON.stringify(classifyDoc2.entries[uaKey]),
        `bin_sha256 mismatch discarded the cache: ${redoneSpawns.classify} classify spawns re-derived the verdicts, file rewritten with the binary's sha256 and a byte-identical entry`);

      // The host-only flag refuses any file that is not this host's own openings.json ("never packet input").
      const foreign = runVerify("after-55-foreign", done.benzo, done.fixture, done.state, done.publicDir,
        ["--openings-cache", path.join(done.publicDir, "openings.json")]);
      check("verify-refuses-foreign-cache", foreign.code !== 0 && /openings cache must be this host's own/.test(foreign.err),
        `a packet-supplied cache path is refused: ${(foreign.err || foreign.out).trim().split("\n").at(-1)?.slice(0, 120)}`);

      // The help says the flag is host-only (item 5).
      const helpOut = spawnSync(process.execPath, [done.benzo, "verify", "--help"], { encoding: "utf8" }).stdout ?? "";
      check("verify-help-says-host-only", /HOST-ONLY/.test(helpOut) && /never uses it/.test(helpOut), "benzo verify --help documents --openings-cache as host-only");
    }
  }
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
