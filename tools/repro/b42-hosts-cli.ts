// Batch B42 proof (offline): the `benzo hosts ...` commands issue exactly the orb/orbctl call sequences the old
// e2e/lib/hosts.ts functions issued, for the same inputs, with `orb`/`orbctl` replaced by a PATH stub that records
// every call. The old module is extracted from git at the pre-move commit (96ce0f5) and bundled next to the new one,
// so the comparison is against the real old code, not a description of it. It also shows:
//   - `hosts witness` refusing before freeze and refusing a certificate whose signature is wrong (nothing written),
//   - the checked merge writes a document byte-identical to the old raw JSON edit's,
//   - `sign envelope-key --show` / `witness keygen --show` printing the existing public half, refusing when there is
//     none, never replacing a key, and no run ever printing private key material,
//   - `hosts dkg` refusing when the auction's vault already exists,
//   - the H10 wiring offline: the scenario's manifest build (`auction create --config operator.json`, the same file
//     shape tools/repro/markets.ts writes) sets seller_ua_commitment to the pure commitment of the config's seller_ua,
//   - every `benzo` command quoted in the three guides matches its `--help`.
// The stub replaces only orb/orbctl; the local CLI is the real shipped one (the address classifier is the real
// audited benzo-pczt built by build:settle; the offline stand-ins are the wallet/signing externals a chain run needs:
// zcash-sign, grpcurl, zcash-devtool and benzo-pczt's ufvk-ak/address, exactly the stub classes tools/repro/h-fixtures.ts
// documents). This driver never reads the real $BNZ_STATE_DIR, the main checkout's state, any wallet, or a network.
// Build+run: npx esbuild tools/repro/b42-hosts-cli.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b42-hosts-cli.mjs && node tmp/b42-hosts-cli.mjs
import { build } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertScratch } from "./scratch";
import { QUICKNET, hash, sellerUaCommitment, signRecord, verifyRecord, type Manifest, type Signed } from "../../manifest/schema";
import { freezeStatement, signStatement, validateWitnessSet, witnessSetHash, type WitnessSet } from "../../witness";
import { generateEnvelopeKey } from "../../envelope";
import { UA_ORCHARD } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/b42-hosts-cli.mjs (tools/repro/b42-hosts-cli.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const OUT = assertScratch(path.join(ROOT, "tmp/b42"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let ok = true;
const check = (id: string, pass: boolean, d = "") => {
  console.log(`${pass ? "PASS" : "ERROR"} ${id}${d ? " " + d : ""}`);
  ok &&= pass;
};

// Builds the proof runs: build:cli + build:core are cheap and re-run here; the real benzo-pczt (the audited
// address classifier and ufvk-ak) comes from build:settle and is only checked, like every offline run.
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
execFileSync("npm", ["run", "--silent", "build:core"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const BENZO = path.join(ROOT, "cli/dist/benzo.mjs");
const REAL_PCZT = path.join(ROOT, "settle/target/release/benzo-pczt");
if (!existsSync(REAL_PCZT)) {
  console.log(`ERROR missing ${path.relative(ROOT, REAL_PCZT)}; run \`npm run build:settle\` first`);
  process.exit(1);
}

// ---- fixture material -------------------------------------------------------
// Deterministic keys: the tools/bench.ts recipe (keys derived from SHA-256 of a seed and a tag), B42's own seed.
const bytes = (tag: string) => Buffer.from(hash("benzo-phase6-b42" + ":" + tag), "hex");
const edKey = (seed: Buffer) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), type: "pkcs8", format: "der" });
const manifestPem = edKey(bytes("manifest")).export({ type: "pkcs8", format: "pem" }).toString();
const manifestSigner = createPublicKey(edKey(bytes("manifest"))).export({ type: "spki", format: "der" }).toString("hex");
const rawPublic = (tag: string) => createPublicKey(edKey(bytes(tag))).export({ type: "spki", format: "der" }).toString("hex").slice(24);
const witnessPriv = (i: number) => bytes(`witness:${i}`).toString("hex");
const witnessPubs = [0, 1, 2].map(i => rawPublic(`witness:${i}`));
const GROUP_KEY = bytes("group").toString("hex"); // what the stubbed `sign dkg` reports and the stubbed ufvk-ak echoes
const envelopeKeys = [generateEnvelopeKey(), generateEnvelopeKey(), generateEnvelopeKey()];

// The fixture manifest: the shape tools/repro/h-fixtures.ts proves passes the mode registry's client (uniform),
// with a future release round so `auction create`'s deadline rules hold without a chain.
const auctionId = bytes("auction").toString("hex");
const now = Math.ceil(Date.now() / 1000);
const release = now + 3600, R = 1 + Math.ceil((release - QUICKNET.genesis) / QUICKNET.period);
const depositAddresses = [UA_ORCHARD, "utest1" + bytes("deposit-1").toString("hex"), "utest1" + bytes("deposit-2").toString("hex")];
const manifest: Manifest = {
  version: 1, network: "test", auction_id: auctionId, escrow_ua: UA_ORCHARD, frost_group_key: GROUP_KEY, lot: "b42 fixture round",
  supply: 1, reserve_zats: "1000", tick_zats: "1000", B_max_zats: "200000", q_max: 1, C_zats: "200010", fee_zats: "0",
  deposit_addresses: depositAddresses, drand: { ...QUICKNET, R }, T_submit: now + 240, T_freeze: now + 1800, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  envelope_keys: envelopeKeys.map(k => k.public_hex),
} as Manifest;
const witnessSet = signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: witnessPubs }, manifestPem);
(manifest as any).witness_set_hash = witnessSetHash(witnessSet);
const manifestPacket = signRecord(manifest, manifestPem);

// The frozen statement the witness board certifies (root and leaf count only; no chain is involved in a certificate).
const frozen = { auction_id: auctionId, manifest_hash: manifestPacket.sha256, root: bytes("frozen-root").toString("hex"), leaf_count: 0, cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 100, leaves: [] as any[] };
const statement = freezeStatement(manifest as any, frozen as any);
const certOf = (i: number, corrupt = false) => {
  const sig = signStatement(statement, witnessPriv(i));
  return { statement, signatures: [{ witness: sig.witness, signature: corrupt ? (sig.signature[0] === "a" ? "b" : "a") + sig.signature.slice(1) : sig.signature }] };
};

// ---- the orb/orbctl PATH stub ---------------------------------------------
// One recorder for every orb/orbctl call: it appends {"cmd", "args"} per invocation and answers from canned.json.
// The canned answers model a well-behaved host (non-empty stdout for the commands the helper retries empties on),
// so no retry path fires and the recorded sequence is the production one.
const STUB_BIN = path.join(OUT, "stub-bin"), CANNED = path.join(OUT, "canned.json"), LOG = path.join(OUT, "orb-log.jsonl");
mkdirSync(STUB_BIN, { recursive: true });
const stubImpl = `const fs = require("fs"), path = require("path");
const cmd = path.basename(process.argv[1]).replace(/\\.cjs$/, "");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ cmd, args }) + "\\n");
const canned = JSON.parse(fs.readFileSync(process.env.STUB_CANNED, "utf8"));
const fail = (m) => { process.stderr.write("orb stub: " + m + "\\n"); process.exit(1); };
const say = (v) => { process.stdout.write(typeof v === "string" ? v : JSON.stringify(v)); process.stdout.write("\\n"); };
if (cmd === "orbctl") {
  if (args[0] === "push") { say("ok"); process.exit(0); }
  fail("unknown orbctl call " + args.join(" "));
}
if (args[0] !== "run") fail("unknown orb call " + args.join(" "));
const at = args.indexOf("-m") + 1, host = args[at].replace(/^benzo-/, "");
const remote = args.slice(args.indexOf("-u") + 2);
const verb = remote[0], rest = remote.slice(1);
if (verb === "test" && rest[0] === "-f") process.exit((canned.exists || {})[host + "|" + rest[1]] ?? 1);
if (verb === "cat") { const v = (canned.cat || {})[host + "|" + rest[0]]; if (v === undefined) fail("no canned cat for " + host + " " + rest[0]); say(v); process.exit(0); }
if (verb === "env") { say("closed"); process.exit(0); } // frost-client sessions --close-all
const base = verb.split("/").pop();
if (base === "chown" || base === "rm" || base === "mkdir" || base === "zcash-devtool") { say("ok"); process.exit(0); }
if (base === "benzo") {
  const sub = rest.slice(0, 2).join(" "), v = (canned.json || {})[sub] && (canned.json || {})[sub][host];
  if (v === undefined) fail("no canned output for " + sub + " on " + host);
  say(v); process.exit(0);
}
fail("unknown remote command " + verb);
`;
for (const name of ["orb", "orbctl"]) {
  writeFileSync(path.join(STUB_BIN, name + ".cjs"), stubImpl);
  writeFileSync(path.join(STUB_BIN, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`);
  chmodSync(path.join(STUB_BIN, name), 0o755);
}
process.env.PATH = `${STUB_BIN}:${process.env.PATH}`;
process.env.STUB_LOG = LOG;
process.env.STUB_CANNED = CANNED;
const setPhase = (phase: any) => { writeFileSync(CANNED, JSON.stringify(phase)); rmSync(LOG, { force: true }); };
// Recorded calls are normalized before comparison: each state's path becomes <STATE> (the old and new runs keep
// separate scratch states), and the three `sign dkg` launches are concurrent (Promise.all), so the call MULTISET is
// the production behaviour, not the interleaving.
const calls = (): string[] => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => {
  const c = JSON.parse(l);
  return `${c.cmd} ${c.args.join(" ")}`.split(STATE_OLD).join("<STATE>").split(STATE_NEW).join("<STATE>")
    .replace(/tmp\/b42\/(?:cmp-old2|cmp-old|cmp-new|cmd-public|bad-public|nofreeze-public|opens-public)/g, "<PUBLIC>");
}) : []);

// The wallet/signing externals an offline `auction keys` needs, in each scratch state's bin dir (the same stub
// class tools/repro/h-fixtures.ts uses). benzo-pczt's classify-address runs the REAL audited binary; ufvk-ak and
// address are the offline stand-ins (the UFVK is a stub string, so its ak check echoes the canned group key).
const stubBenzoPczt = `const cp = require("child_process"), path = require("path");
const a = process.argv.slice(2);
// B57: since B45 the classifier runs in bulk (\`classify-address --stdin\`); the stub passes stdin through to the
// REAL binary, the same as tools/repro/b47-world.ts (before B57 it forwarded only a[1] and \`auction keys\` failed).
if (a[0] === "classify-address" && a[1] === "--stdin") { const r = cp.spawnSync(${JSON.stringify(REAL_PCZT)}, ["classify-address", "--stdin"], { input: require("fs").readFileSync(0), maxBuffer: 1 << 28 }); process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1); }
if (a[0] === "classify-address") { process.stdout.write(cp.execFileSync(${JSON.stringify(REAL_PCZT)}, ["classify-address", a[1]], { encoding: "utf8" })); process.exit(0); }
if (a[0] === "ufvk-ak") { console.log(${JSON.stringify(GROUP_KEY)}); process.exit(0); }
if (a[0] === "address") { console.log(${JSON.stringify(UA_ORCHARD)}); process.exit(0); }
process.stderr.write("benzo-pczt stub: unknown command " + a[0] + "\\n"); process.exit(1);
`;
const writeStateTools = (state: string) => {
  const bin = path.join(state, "bin");
  for (const d of [state, bin, path.join(state, "run"), path.join(state, "auction"), path.join(state, "product"), path.join(state, "custody")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const stub = (name: string, source: string) => {
    writeFileSync(path.join(bin, name + ".cjs"), source); chmodSync(path.join(bin, name + ".cjs"), 0o755);
    writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`); chmodSync(path.join(bin, name), 0o755);
  };
  stub("zcash-sign", `process.stdout.write('Unified Full Viewing Key: "uviewtest1b42fixtureufvk"\\n');`);
  stub("grpcurl", `console.log(JSON.stringify({ height: 100000 }));`);
  stub("zcash-devtool", `process.exit(0);`);
  stub("benzo-pczt", stubBenzoPczt);
};

// ---- the old module (pre-move) and the new one, side by side ----------------
// The old e2e/lib/hosts.ts is taken from git at 96ce0f5 and bundled with esbuild (its relative imports resolve
// against e2e/lib exactly as they did). STATE is resolved at module import, so each bundle is imported with its own
// BNZ_STATE_DIR: the old module runs against state-old, the new CLI runs against state-new.
const bundle = async (source: string, resolveDir: string, outfile: string) => {
  await build({ stdin: { contents: source, resolveDir, sourcefile: path.basename(outfile).replace(/\.mjs$/, ".ts"), loader: "ts" }, bundle: true, platform: "node", format: "esm", packages: "external", outfile, logLevel: "warning" });
};
const oldSource = execFileSync("git", ["show", "96ce0f5:e2e/lib/hosts.ts"], { encoding: "utf8" });
await bundle(oldSource, path.join(ROOT, "e2e/lib"), path.join(OUT, "old-hosts.mjs"));
await bundle(readFileSync(path.join(ROOT, "cli/hosts.ts"), "utf8"), path.join(ROOT, "cli"), path.join(OUT, "new-hosts.mjs"));
const STATE_OLD = path.join(OUT, "state-old"), STATE_NEW = path.join(OUT, "state-new");
// BNZ_STATE_DIR is passed to every spawn RELATIVE to the repo root: the hosts module resolves it with path.join
// (e2e/lib/env.ts semantics) and the CLI with path.resolve (settle/io.ts), which agree only for a relative value.
const stateOldRel = "tmp/b42/state-old", stateNewRel = "tmp/b42/state-new";
writeStateTools(STATE_OLD); writeStateTools(STATE_NEW);
process.env.BNZ_STATE_DIR = stateOldRel;
const old: any = await import(path.join(OUT, "old-hosts.mjs"));
process.env.BNZ_STATE_DIR = stateNewRel;
const fresh: any = await import(path.join(OUT, "new-hosts.mjs"));
process.env.BNZ_STATE_DIR = stateNewRel; // every later CLI spawn names its own state explicitly; this is the fallback

// The operator's CLI helpers, one per state (the same invocation shape for the old functions' benzo callback and
// for the `hosts dkg` command's own localBenzo: the shipped cli/dist/benzo.mjs, last JSON line of stdout).
const benzoIn = (state: string) => (args: string[], input?: any): any => {
  const rel = path.isAbsolute(state) ? path.relative(ROOT, state) : state;
  const r = spawnSync(process.execPath, [BENZO, ...args], { input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: rel, BNZ_PCZT_BIN: path.join(ROOT, rel, "bin", "benzo-pczt") } });
  if (r.status !== 0) throw new Error(`benzo ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return JSON.parse(r.stdout.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!);
};
const runCommand = (state: string, args: string[]): { code: number; out: string; err: string } => {
  const rel = path.isAbsolute(state) ? path.relative(ROOT, state) : state;
  const r = spawnSync(process.execPath, [BENZO, ...args], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: rel, BNZ_PCZT_BIN: path.join(ROOT, rel, "bin", "benzo-pczt") } });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
};
const lastJson = (out: string) => JSON.parse(out.split("\n").filter(l => l.startsWith("{")).at(-1)!);

// ---- canned host answers ----------------------------------------------------
const hostJson = (make: (n: string) => any) => Object.fromEntries(["alice", "bob", "carol"].map(n => [n, make(n)]));
const envelopeCanned = hostJson(n => ({ name: n, public_hex: envelopeKeys[["alice", "bob", "carol"].indexOf(n)].public_hex }));
const witnessKeygenCanned = hostJson(n => ({ name: n, public_hex: witnessPubs[["alice", "bob", "carol"].indexOf(n)], key_file: `/home/benzo/.benzo/witness/${n}.key` }));
const dkgCanned = hostJson(() => ({ group_key: GROUP_KEY }));
const witnessSignCanned = hostJson(n => ({ signed: n }));
const opensCanned = hostJson(n => ({
  signer: n, opens: [
    { leaf: 0, party: "leaf:0", ok: n !== "carol", dest_sha256: n === "carol" ? null : bytes("dest").toString("hex") },
    { leaf: 1, party: "leaf:1", ok: false, dest_sha256: null },
  ],
  witness: witnessPubs[["alice", "bob", "carol"].indexOf(n)], signature: "00".repeat(64),
}));
const hostDocOf = (certs: any[]) => JSON.stringify({ version: 1, auction_id: auctionId, signer: manifestSigner, manifest: manifestPacket, state: "OPEN", receipts: [], frozen, witness_set: witnessSet, witness_cert: certs });
const catFor = (certs: (i: number) => any) => Object.fromEntries([
  ...["bob", "carol"].map(n => [`${n}|/home/benzo/.benzo/contacts/${n}.pubkey`, "00".repeat(32)]),
  ...["alice", "bob", "carol"].map(n => [`${n}|/home/benzo/pub-${auctionId.slice(0, 12)}/auction.json`, hostDocOf([certs(["alice", "bob", "carol"].indexOf(n))])]),
]);
const keysFreshPhase = { exists: {}, cat: {}, json: { "sign envelope-key": envelopeCanned, "witness keygen": witnessKeygenCanned } };
const keysReusePhase = {
  exists: Object.fromEntries(["alice", "bob", "carol"].map(n => [`${n}|/home/benzo/.benzo/signers/${n}/envelope-key.json`, 0])),
  cat: Object.fromEntries(["alice", "bob", "carol"].map(n => [`${n}|/home/benzo/.benzo/signers/${n}/envelope-key.json`, JSON.stringify({ public_hex: envelopeCanned[n].public_hex })])),
  json: { "witness keygen": witnessKeygenCanned },
};
const dkgPhase = { exists: {}, cat: catFor(i => certOf(i)), json: { "sign dkg": dkgCanned, "auction keys": hostJson(() => ({ auction_id: auctionId, group_key: GROUP_KEY, escrow_ua: UA_ORCHARD })) } };
const witnessPhase = (corrupt: number | null) => ({ exists: {}, cat: catFor(i => certOf(i, i === corrupt)), json: { "witness sign": witnessSignCanned } });
const opensPhase = { exists: {}, cat: {}, json: { "sign envelope-opens": opensCanned } };

// ---- 1. hosts keys: same call sequence, same output -------------------------
const showKeys = (k: any) => `envelope ${k.envelope_keys.map((x: string) => x.slice(0, 8)).join(",")} witness ${k.witness_keys.map((x: string) => x.slice(0, 8)).join(",")}`;
for (const [phaseName, phase, again] of [["fresh", keysFreshPhase, false], ["reuse", keysReusePhase, true]] as const) {
  // The old side's witness-key registry lives under state-old and the new side's under state-new, so both runs see
  // the same precondition (first run generates and registers, second run reuses the registry silently).
  if (again) for (const state of [STATE_OLD, STATE_NEW]) for (const n of ["alice", "bob", "carol"]) writeFileSync(path.join(state, "custody", `witness-${n}.pub`), witnessPubs[["alice", "bob", "carol"].indexOf(n)]);
  setPhase(phase);
  const before = calls();
  const oldKeys = { envelope_keys: old.hostEnvelopeKeys(), witness_keys: old.hostWitnessKeys() };
  const oldCalls = calls().slice(before.length);
  setPhase(phase);
  const r = runCommand(STATE_NEW, ["hosts", "keys"]);
  const newCalls = calls();
  const newKeys = r.code === 0 ? lastJson(r.out) : null;
  check(`hosts-keys-${phaseName}-sequence`, r.code === 0 && JSON.stringify(oldCalls) === JSON.stringify(newCalls), `${newCalls.length} orb calls${JSON.stringify(oldCalls) === JSON.stringify(newCalls) ? "" : `\n  old ${JSON.stringify(oldCalls)}\n  new ${JSON.stringify(newCalls)}`}`);
  check(`hosts-keys-${phaseName}-output`, JSON.stringify(oldKeys) === JSON.stringify(newKeys), showKeys(newKeys));
}

// ---- 2. hosts dkg: same call sequence, same output --------------------------
for (const state of [STATE_OLD, STATE_NEW]) rmSync(path.join(state, "vaults"), { recursive: true, force: true });
const id2 = bytes("dkg-auction").toString("hex");
setPhase(dkgPhase);
const beforeDkg = calls();
const oldK = await old.dkgOnHosts(id2, benzoIn(stateOldRel));
const oldDkgCalls = calls().slice(beforeDkg.length).sort();
setPhase(dkgPhase);
const dkgRun = runCommand(stateNewRel, ["hosts", "dkg", "--id", id2]);
const newDkgCalls = calls().sort();
const newK = lastJson(dkgRun.out);
check("hosts-dkg-sequence", JSON.stringify(oldDkgCalls) === JSON.stringify(newDkgCalls), `${newDkgCalls.length} orb/orbctl calls (sorted: the three sign dkg launches are concurrent)${JSON.stringify(oldDkgCalls) === JSON.stringify(newDkgCalls) ? "" : `\n  old ${JSON.stringify(oldDkgCalls)}\n  new ${JSON.stringify(newDkgCalls)}`}`);
check("hosts-dkg-output", oldK.group_key === newK.group_key && oldK.escrow_ua === newK.escrow_ua && JSON.stringify(oldK.keys) === JSON.stringify(newK.keys) && newK.group_key === GROUP_KEY,
  `group ${newK.group_key.slice(0, 12)}… escrow ${String(newK.escrow_ua).slice(0, 16)}… keys ${newK.keys.length}`);
check("hosts-dkg-output-shape", Object.keys(newK).sort().join() === "escrow_ua,group_key,keys", Object.keys(newK).sort().join());
// A second `hosts dkg` for the same auction refuses before any host call (the vault already exists).
setPhase(dkgPhase);
const secondDkg = runCommand(STATE_NEW, ["hosts", "dkg", "--id", id2]);
check("hosts-dkg-refuses-existing-vault", secondDkg.code === 1 && /already exists/.test(secondDkg.err) && calls().length === 0, secondDkg.err.trim().slice(-120));

// ---- 3. hosts witness: sequence, checked merge, byte-identical document -----
const makePublic = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  const doc: any = { version: 1, auction_id: auctionId, signer: manifestSigner, manifest: manifestPacket, state: "OPEN", receipts: [], frozen, witness_set: witnessSet };
  writeFileSync(path.join(dir, "auction.json"), JSON.stringify(doc));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifestPacket));
};
const writeOperatorState = (state: string, dir: string) => {
  writeFileSync(path.join(state, "auction", `${auctionId}.json`), JSON.stringify({ signer: manifestSigner, manifest: manifestPacket, state: "OPEN", receipts: [], frozen }));
  writeFileSync(path.join(state, "product", `${auctionId}.json`), JSON.stringify({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing: { bidders: depositAddresses.map(deposit_ua => ({ deposit_ua })), seller_ua: UA_ORCHARD, fee_reserve_ua: depositAddresses[1] }, public_dir: dir }));
};
// 3a. the byte-for-byte document check at the shared-function level: the old raw edit and the new checked merge.
const pubOld = path.join(OUT, "cmp-old"), pubNew = path.join(OUT, "cmp-new");
makePublic(pubOld); makePublic(pubNew);
setPhase(witnessPhase(null));
old.hostWitnessCerts(auctionId, pubOld, manifestSigner, ["alice", "bob"]);
setPhase(witnessPhase(null));
fresh.hostWitnessCerts(auctionId, pubNew, manifestSigner, ["alice", "bob"]);
check("witness-merge-byte-identical", readFileSync(path.join(pubOld, "auction.json"), "utf8") === readFileSync(path.join(pubNew, "auction.json"), "utf8"),
  `merged document ${hash(readFileSync(path.join(pubNew, "auction.json"))).slice(0, 16)}… (${JSON.parse(readFileSync(path.join(pubNew, "auction.json"), "utf8")).witness_cert.length} certificates)`);
// 3b. the command: same sequence as the old function's, then the republish.
const pubCmd = path.join(OUT, "cmd-public");
makePublic(pubCmd); writeOperatorState(STATE_NEW, pubCmd);
makePublic(path.join(OUT, "cmp-old2"));
setPhase(witnessPhase(null));
const beforeW = calls();
old.hostWitnessCerts(auctionId, path.join(OUT, "cmp-old2"), manifestSigner, ["alice", "bob"]); // sequence reference only (a throwaway copy)
const oldWCalls = calls().slice(beforeW.length);
setPhase(witnessPhase(null));
const wRun = runCommand(STATE_NEW, ["hosts", "witness", "--id", auctionId, "--names", "alice,bob"]);
const newWCalls = calls();
check("hosts-witness-sequence", wRun.code === 0 && JSON.stringify(oldWCalls) === JSON.stringify(newWCalls), `${newWCalls.length} orb/orbctl calls${JSON.stringify(oldWCalls) === JSON.stringify(newWCalls) ? "" : `\n  old ${JSON.stringify(oldWCalls)}\n  new ${JSON.stringify(newWCalls)}`}`);
const wOut = lastJson(wRun.out);
check("hosts-witness-output", Array.isArray(wOut.certificates) && wOut.certificates.length === 2 && wOut.q_w === 2 && Object.keys(wOut).sort().join() === "certificates,q_w",
  `${wOut.certificates.length} certificates, q_w ${wOut.q_w}`);
// 3c. a certificate whose signature is wrong is refused and nothing is written.
const pubBad = path.join(OUT, "bad-public");
makePublic(pubBad); writeOperatorState(STATE_NEW, pubBad);
setPhase(witnessPhase(0));
const badRun = runCommand(STATE_NEW, ["hosts", "witness", "--id", auctionId, "--names", "alice,bob"]);
check("hosts-witness-bad-cert-refused", badRun.code === 1 && /signature/.test(badRun.err) && readFileSync(path.join(pubBad, "auction.json"), "utf8") === JSON.stringify({ version: 1, auction_id: auctionId, signer: manifestSigner, manifest: manifestPacket, state: "OPEN", receipts: [], frozen, witness_set: witnessSet }),
  badRun.err.trim().split("\n").at(-1)?.slice(0, 120) ?? "");
// 3d. before freeze: refused before any host call.
const pubNoFrozen = path.join(OUT, "nofreeze-public");
makePublic(pubNoFrozen);
{ const doc = JSON.parse(readFileSync(path.join(pubNoFrozen, "auction.json"), "utf8")); delete doc.frozen; writeFileSync(path.join(pubNoFrozen, "auction.json"), JSON.stringify(doc)); }
writeOperatorState(STATE_NEW, pubNoFrozen);
{ const s = JSON.parse(readFileSync(path.join(STATE_NEW, "auction", `${auctionId}.json`), "utf8")); delete s.frozen; writeFileSync(path.join(STATE_NEW, "auction", `${auctionId}.json`), JSON.stringify(s)); }
setPhase(witnessPhase(null));
const noFreezeRun = runCommand(STATE_NEW, ["hosts", "witness", "--id", auctionId, "--names", "alice,bob"]);
check("hosts-witness-before-freeze-refused", noFreezeRun.code === 1 && /freeze/.test(noFreezeRun.err) && calls().length === 0, noFreezeRun.err.trim().split("\n").at(-1)?.slice(0, 120) ?? "");

// ---- 4. hosts envelope-opens: same sequence, same saved reports -------------
for (const state of [STATE_OLD, STATE_NEW]) mkdirSync(path.join(state, "settle"), { recursive: true });
const pubOpens = path.join(OUT, "opens-public");
makePublic(pubOpens); writeOperatorState(STATE_NEW, pubOpens);
setPhase(opensPhase);
const beforeO = calls();
old.hostEnvelopeOpens(auctionId, pubOpens);
const oldOCalls = calls().slice(beforeO.length);
setPhase(opensPhase);
const oRun = runCommand(STATE_NEW, ["hosts", "envelope-opens", "--id", auctionId]);
const newOCalls = calls();
check("hosts-envelope-opens-sequence", oRun.code === 0 && JSON.stringify(oldOCalls) === JSON.stringify(newOCalls), `${newOCalls.length} orb/orbctl calls${JSON.stringify(oldOCalls) === JSON.stringify(newOCalls) ? "" : `\n  old ${JSON.stringify(oldOCalls)}\n  new ${JSON.stringify(newOCalls)}`}`);
const oOut = lastJson(oRun.out);
check("hosts-envelope-opens-output", JSON.stringify(oOut) === JSON.stringify({ reports: [{ name: "alice", ok_rows: 1, not_ok_rows: 1 }, { name: "bob", ok_rows: 1, not_ok_rows: 1 }, { name: "carol", ok_rows: 0, not_ok_rows: 2 }] }),
  JSON.stringify(oOut));
// The old function saved the same reports where settle reads them (it returned nothing); the files must be identical.
check("hosts-envelope-opens-reports-saved", ["alice", "bob", "carol"].every(n =>
  readFileSync(path.join(STATE_NEW, "settle", auctionId, `envelope-opens-${n}.json`), "utf8") === readFileSync(path.join(STATE_OLD, "settle", auctionId, `envelope-opens-${n}.json`), "utf8")),
  "state/settle/<id>/envelope-opens-<name>.json identical old vs new");

// ---- 5. --show: the existing public half, never a replacement ---------------
const showState = path.join(OUT, "show-state");
mkdirSync(path.join(showState, "signers", "alice"), { recursive: true, mode: 0o700 });
mkdirSync(path.join(showState, "witness"), { recursive: true, mode: 0o700 });
const runShow = (args: string[]) => {
  const r = spawnSync(process.execPath, [BENZO, ...args], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: showState } });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", err: r.stderr ?? "" };
};
const allOutput: string[] = [];
const record = (r: any) => { allOutput.push(r.stdout + r.stderr); return r; };
const keyGen = record(runShow(["sign", "envelope-key", "--name", "alice"]));
const keyGenJson = JSON.parse(keyGen.stdout.trim());
check("show-envelope-key-generate-once", keyGen.status === 0 && /^[0-9a-f]{64}$/.test(keyGenJson.public_hex), `public ${keyGenJson.public_hex.slice(0, 12)}…`);
const keyShow = record(runShow(["sign", "envelope-key", "--name", "alice", "--show"]));
check("show-envelope-key-prints-existing", keyShow.status === 0 && JSON.parse(keyShow.stdout.trim()).public_hex === keyGenJson.public_hex, keyShow.stdout.trim());
const keyAgain = record(runShow(["sign", "envelope-key", "--name", "alice"]));
check("show-envelope-key-never-replaced", keyAgain.status === 1 && /already exists/.test(keyAgain.err), keyAgain.err.trim().split("\n").at(-1)?.slice(0, 100) ?? "");
const keyNone = record(runShow(["sign", "envelope-key", "--name", "bob", "--show"]));
check("show-envelope-key-refuses-missing", keyNone.status === 1 && /missing/.test(keyNone.err), keyNone.err.trim().split("\n").at(-1)?.slice(0, 100) ?? "");
const wGen = record(runShow(["witness", "keygen", "--name", "alice"]));
const wGenJson = JSON.parse(wGen.stdout.trim());
check("show-witness-key-generate-once", wGen.status === 0 && /^[0-9a-f]{64}$/.test(wGenJson.public_hex) && typeof wGenJson.key_file === "string", `public ${wGenJson.public_hex.slice(0, 12)}…`);
const wShow = record(runShow(["witness", "keygen", "--name", "alice", "--show"]));
check("show-witness-key-prints-existing", wShow.status === 0 && JSON.parse(wShow.stdout.trim()).public_hex === wGenJson.public_hex, wShow.stdout.trim());
const wAgain = record(runShow(["witness", "keygen", "--name", "alice"]));
check("show-witness-key-never-replaced", wAgain.status === 1 && /already exists/.test(wAgain.err), wAgain.err.trim().split("\n").at(-1)?.slice(0, 100) ?? "");
const wNone = record(runShow(["witness", "keygen", "--name", "bob", "--show"]));
check("show-witness-key-refuses-missing", wNone.status === 1 && /missing/.test(wNone.err), wNone.err.trim().split("\n").at(-1)?.slice(0, 100) ?? "");
// Never print private key material: no run's output may contain either stored private key.
const privateHexes = [JSON.parse(readFileSync(path.join(showState, "signers", "alice", "envelope-key.json"), "utf8")).private_hex, readFileSync(path.join(showState, "witness", "alice.key"), "utf8").trim()];
check("show-no-private-key-material", privateHexes.every(h => /^[0-9a-f]{64,}$/.test(h)) && allOutput.every(o => privateHexes.every(h => !o.includes(h))), `${allOutput.length} captured outputs, neither private half appears`);

// ---- 6. H10 wiring offline: the scenario's manifest build with --config -----
// The exact file shape tools/repro/markets.ts writes before `auction create` (settlement + routing with
// routing.seller_ua), under the scratch state exactly as the harness keeps its operator.json in state/run/.
const createState = path.join(OUT, "state-create");
writeStateTools(createState);
const createRun = (extra: string[], label: string) => {
  const dir = path.join(createState, "run", label);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "unsigned-manifest.json"), JSON.stringify({ ...manifest, auction_id: bytes(`create-${label}`).toString("hex") }));
  writeFileSync(path.join(dir, "witness-set.json"), JSON.stringify(witnessSet));
  return { dir, r: runCommand(createState, ["auction", "create", "--file", path.join(dir, "unsigned-manifest.json"), "--witness-set", path.join(dir, "witness-set.json"), ...extra]) };
};
const operatorJson = (seller_ua: string) => JSON.stringify({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing: { bidders: depositAddresses.map(deposit_ua => ({ deposit_ua })), seller_ua, fee_reserve_ua: depositAddresses[1] } });
{
  const dir = path.join(createState, "run", "with-config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "operator.json"), operatorJson(UA_ORCHARD));
  const { r } = createRun(["--config", path.join(dir, "operator.json")], "with-config");
  const draft = JSON.parse(readFileSync(path.join(createState, "product", `${bytes("create-with-config").toString("hex")}.draft.json`), "utf8"));
  check("h10-create-config-sets-commitment", r.code === 0 && draft.manifest.seller_ua_commitment === sellerUaCommitment(UA_ORCHARD),
    `seller_ua_commitment ${String(draft.manifest.seller_ua_commitment).slice(0, 16)}… (create exit ${r.code}${r.code ? ": " + r.err.trim().slice(-120) : ""})`);
}
{
  const { r } = createRun([], "no-config");
  const draft = JSON.parse(readFileSync(path.join(createState, "product", `${bytes("create-no-config").toString("hex")}.draft.json`), "utf8"));
  check("h10-create-without-config-unbound", r.code === 0 && draft.manifest.seller_ua_commitment === undefined, `legacy draft (create exit ${r.code}${r.code ? ": " + r.err.trim().slice(-120) : ""})`);
}
{
  const dir = path.join(createState, "run", "bad-seller");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "operator.json"), operatorJson("utest1" + bytes("not-a-ua").toString("hex")));
  const { r } = createRun(["--config", path.join(dir, "operator.json")], "bad-seller");
  check("h10-create-refuses-unclassifiable-seller-ua", r.code === 1 && /seller_ua/.test(r.err), r.err.trim().split("\n").at(-1)?.slice(0, 120) ?? "");
}
// The live harness wiring itself: markets.ts must pass its own operator.json to `auction create`.
const marketsSrc = readFileSync(path.join(ROOT, "tools/repro/markets.ts"), "utf8");
check("h10-markets-wired", /auction", "create", "--witness-set", path\.join\(privateDir, "witness-set\.json"\), "--config", path\.join\(privateDir, "operator\.json"\)/.test(marketsSrc),
  "tools/repro/markets.ts auction create carries --config <state/run/…/operator.json>");

// ---- 7. every command in the three guides matches its --help ----------------
const guides = ["docs/guide-operator.md", "docs/guide-signer.md", "docs/guide-bidder.md"];
let guideCommands = 0;
for (const g of guides) {
  for (const line of readFileSync(path.join(ROOT, g), "utf8").split("\n")) {
    const m = line.match(/^\s*\$ (benzo .+)$/);
    if (!m) continue;
    const quoted = m[1].replace(/\[([^\]]*)\]/g, "$1").replace(/\(([^)]*)\)/g, "$1");
    const words = quoted.split(/\s+/);
    const firstOpt = words.findIndex(w => w.startsWith("--"));
    const command = words.slice(1, firstOpt < 0 ? words.length : firstOpt).filter(w => !w.includes("|") || !w.startsWith("--"));
    const options = [...quoted.matchAll(/--[a-z-]+/g)].map(x => x[0]);
    const help = spawnSync(process.execPath, [BENZO, ...command, "--help"], { encoding: "utf8", env: process.env });
    const text = help.stdout + help.stderr;
    guideCommands++;
    const missing = options.filter(o => !text.includes(o));
    check(`guide-help ${g} ${m[1].split(/\s+--/)[0].trim()}`, help.status === 0 && text.includes(`benzo ${command[0]}`) && missing.length === 0,
      missing.length ? `options not in --help: ${missing.join(" ")}` : `${options.length} options checked`);
  }
}

console.log(`guide commands checked: ${guideCommands}`);
console.log(ok ? "RESULT PASS b42-hosts-cli: hosts commands match the old harness exactly; refusals, --show and H10 hold" : "RESULT FAIL b42-hosts-cli");
process.exitCode = ok ? 0 : 1;
