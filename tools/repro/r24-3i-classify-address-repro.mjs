// R24 item 3 (i) proof — `envelope/destination.ts` classifies Zcash addresses through librustzcash's
// audited `zcash_address` 0.13.0 (`benzo-pczt classify-address`, built from settle/ by this run),
// never the hand-written parser it replaced.
//
//   r24-3i-verdicts-identical: identical verdicts to the PRE-SWAP parser on every input — the
//      existing destination fixtures (tools/repro/fixtures/zcash-address-cases.json: the official
//      zcash-test-vectors rows re-encoded by that repo's own reference encoders) plus FRESH real
//      testnet UAs, Sapling and transparent addresses (the pinned zcash-devtool wallet stack) and a
//      freshly encoded TEX. The pre-swap parser is preserved verbatim as the differential oracle
//      (git show 264ff8b:envelope/destination.ts — the hand-written bech32/F4Jumble/Base58Check
//      code, kept for this comparison only); classifyDestination / requireShieldedDestination /
//      unifiedReceivers must return the same values or refuse with the same message.
//   r24-3i-vector-labels: the new classification matches the official vector rows' own labels
//      (kind/network/shielded/receivers), never a value our code produced.
//   r24-3i-fresh-addresses: the fresh real testnet addresses behave per the shielded-only rule —
//      the UA and Sapling accepted, the t-addr and TEX refused with the exact product refusals.
//
// Output: `PASS r24-3i-<id>` / `ERROR r24-3i-<id> <reason>`; exit 0 only if all PASS.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bech32m } from "@scure/base";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR || ".benzo");
const WORK = path.join(ROOT, "tmp/r24-3i");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));

// ---- build from this working tree: the shipped classifier's tool + both TS parsers ----
execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", "settle/Cargo.toml"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(ROOT, "envelope/destination.ts"), "--bundle", "--platform=node", "--format=esm",
  "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
  "--outfile=" + path.join(WORK, "new.mjs"), "--log-level=warning",
], { cwd: ROOT });
// the pre-swap parser, verbatim from git, as the differential oracle only (its schema import is re-rooted)
const oracleSrc = execFileSync("git", ["show", "264ff8b:envelope/destination.ts"], { cwd: ROOT, encoding: "utf8" })
  .replace('"../manifest/schema"', '"' + path.join(ROOT, "manifest/schema").replace(/\\/g, "/") + '"');
writeFileSync(path.join(WORK, "oracle-destination.ts"), oracleSrc);
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(WORK, "oracle-destination.ts"), "--bundle", "--platform=node", "--format=esm",
  "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
  "--outfile=" + path.join(WORK, "oracle.mjs"), "--log-level=warning",
], { cwd: ROOT });
const fresh = await import(pathToFileURL(path.join(WORK, "new.mjs")).href);
const oracle = await import(pathToFileURL(path.join(WORK, "oracle.mjs")).href);

// ---- the matrix: the existing destination fixtures + fresh real testnet addresses ----
const cases = JSON.parse(readFileSync(path.join(ROOT, "tools/repro/fixtures/zcash-address-cases.json"), "utf8"));
const matrix = [];
for (const row of cases.ua) matrix.push({ s: row.address, label: { kind: "unified", network: row.network, shielded: row.shielded, receivers: row.receivers } });
for (const row of cases.sapling) matrix.push({ s: row.address, label: { kind: "sapling", network: row.network, shielded: true, receivers: [] } });
for (const row of cases.tex) matrix.push({ s: row.address, label: { kind: "tex", network: row.network, shielded: false, receivers: [] } });
for (const row of cases.transparent) matrix.push({ s: row.address, label: { kind: "transparent", network: row.network, shielded: false, receivers: [] } });
for (const s of [...cases.reject_checksum, ...cases.reject_hrp_mismatch, ...cases.r2_other]) matrix.push({ s });

// fresh real testnet UA + its receivers and a fresh t-addr, straight from the pinned wallet stack.
// The throwaway fixture wallet lives under $BNZ_STATE_DIR like all key material; the setup is
// fixture generation, not an assertion, and gets one retry when the wallet stack flakes
// (its transparent gap-limit reservation has failed transiently on a first generate-address).
const devtool = path.join(STATE, "bin", "zcash-devtool");
const walletDir = path.join(STATE, "r24-3i-wallet");
const setupWallet = () => {
  rmSync(walletDir, { recursive: true, force: true });
  mkdirSync(walletDir, { recursive: true });
  execFileSync(devtool, ["wallet", "-w", walletDir, "init", "--name", "r24-3i", "--identity", path.join(walletDir, "id.age"), "--network", "test"], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  execFileSync(devtool, ["wallet", "-w", walletDir, "get-info"], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  execFileSync(devtool, ["wallet", "-w", walletDir, "sync"], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  const gen = spawnSync(devtool, ["wallet", "-w", walletDir, "generate-address"], { encoding: "utf8", timeout: 120_000 });
  return gen.status === 0 ? `${gen.stdout}\n${gen.stderr}` : null; // the wallet stack prints the receiver list on stderr
};
let generated = setupWallet() ?? setupWallet();
if (!generated) throw new Error("zcash-devtool generate-address failed twice");
const freshUa = /^\s*Address: (\S+)$/m.exec(generated)?.[1] ?? "";
const freshSapling = /- Sapling \((\S+)\)/.exec(generated)?.[1] ?? "";
const freshT = /- Transparent P2PKH \((\S+)\)/.exec(generated)?.[1] ?? "";
const freshTex = bech32m.encode("textest", bech32m.toWords(randomBytes(20))); // independent encoder, fresh 20-byte payload
if (!freshUa || !freshSapling || !freshT) throw new Error(`zcash-devtool generate-address output unparsed: ${generated.slice(0, 200)}`);
const freshInputs = { ua: freshUa, sapling: freshSapling, taddr: freshT, tex: freshTex };
matrix.push({ s: freshUa, fresh: "ua" }, { s: freshSapling, fresh: "sapling" }, { s: freshT, fresh: "taddr" }, { s: freshTex, fresh: "tex" });

// ---- verdicts through every public API of both parsers ----
const verdict = (mod, s) => {
  const out = {};
  try { out.classify = { ok: mod.classifyDestination(s) }; } catch (e) { out.classify = { err: e.message }; }
  try { mod.requireShieldedDestination(s); out.require = { ok: true }; } catch (e) { out.require = { err: e.message }; }
  try { out.receivers = { ok: mod.unifiedReceivers(s) }; } catch (e) { out.receivers = { err: e.message }; }
  return out;
};
const mismatches = [];
for (const item of matrix) {
  const a = verdict(oracle, item.s), b = verdict(fresh, item.s);
  if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ s: item.s.slice(0, 40), old: a, new: b });
}
check("r24-3i-verdicts-identical",
  mismatches.length === 0,
  `${mismatches.length}/${matrix.length} inputs differ, first: ${JSON.stringify(mismatches[0] ?? {}).slice(0, 300)}`);

// the official vector rows' own labels (independent expectations), on the new classifier
const labelDiffs = [];
for (const item of matrix.filter((x) => x.label)) {
  const v = verdict(fresh, item.s);
  const got = v.classify.ok, want = item.label;
  const okShape = got && got.kind === want.kind && got.network === want.network && got.shielded === want.shielded;
  const okRec = want.kind === "unified"
    ? JSON.stringify(v.receivers.ok ?? null) === JSON.stringify(want.receivers)
    : v.receivers.ok === undefined; // non-UAs refuse unifiedReceivers, matching the pre-swap parser
  if (!okShape || !okRec) labelDiffs.push({ s: item.s.slice(0, 40), got, want });
}
check("r24-3i-vector-labels",
  labelDiffs.length === 0,
  `${labelDiffs.length} rows differ from the official labels, first: ${JSON.stringify(labelDiffs[0] ?? {}).slice(0, 300)}`);

// the shielded-only rule on fresh real testnet addresses
const refusal = (s, want) => {
  try { fresh.requireShieldedDestination(s); return `accepted`; } catch (e) { return e.message === `refused: ${want}` ? "ok" : `got ${e.message}`; }
};
check("r24-3i-fresh-addresses",
  JSON.stringify(fresh.classifyDestination(freshInputs.ua)) === JSON.stringify({ kind: "unified", shielded: true, network: "test" }) &&
    JSON.stringify(fresh.classifyDestination(freshInputs.sapling)) === JSON.stringify({ kind: "sapling", shielded: true, network: "test" }) &&
    refusal(freshInputs.taddr, "transparent address (t-addr)") === "ok" &&
    refusal(freshInputs.tex, "TEX address") === "ok",
  `ua ${JSON.stringify(fresh.classifyDestination(freshInputs.ua))} sapling ${JSON.stringify(fresh.classifyDestination(freshInputs.sapling))} taddr ${refusal(freshInputs.taddr, "transparent address (t-addr)")} tex ${refusal(freshInputs.tex, "TEX address")}`);

console.log(failures === 0
  ? `RESULT PASS zcash_address classification (${matrix.length} inputs incl. fresh real testnet UA/Sapling/t-addr/TEX) with verdicts identical to the pre-swap parser`
  : `RESULT FAIL ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
