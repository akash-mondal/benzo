#!/usr/bin/env node
// G-7 mainnet-readiness proof (PHASE-5 R28 open item, this run's item 3): the network-aware address checks and
// the `benzo-pczt --network test|main` parameter, proven with MAINNET-FORMAT fixtures.
//
//   g7-mainnet-ua-on-main        every official mainnet UA row (tools/repro/fixtures/zcash-address-cases.json,
//                                zcash-test-vectors rows) passes uaShape(addr, "main") and isUnifiedOn(addr, "main")
//                                exactly when the vectors' own `shielded` label is true — never a value our code produced.
//   g7-mainnet-ua-refused-on-test the same mainnet UAs are refused under "test" (wrong-network, unchanged rule).
//   g7-testnet-ua-on-test / _refused-on-main  the mirror for the official testnet rows.
//   g7-classifier-network-labels `benzo-pczt classify-address` reports the vectors' own network labels (main/test/regtest).
//   g7-ufvk-network-matches      benzo-pczt ufvk-ak decodes a UFVK only under its OWN network (real uview1… and
//                                uviewtest1… UFVKs from the pinned zcash-sign) — and the ak is the one it was made from.
//   g7-missing-network-refused   every network-dependent benzo-pczt command refuses without --network (no silent testnet).
//   g7-manifest-lock-stays       the manifest schema's `network: "test"` lock still refuses a network:"main" manifest
//                                (the head lifts it later), while the address checks themselves accept its u1 addresses.
//
// Output: `PASS g7-<id>` / `ERROR g7-<id> <reason>`; exit 0 only if all PASS.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR || ".benzo");
const WORK = path.join(ROOT, "tmp/g7-network");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));

const PCZT = path.join(ROOT, "settle/target/release/benzo-pczt");
const sh = (cmd, args, input) => {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", input, maxBuffer: 64 << 20 });
    return { code: 0, out, err: "" };
  } catch (e) { return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" }; }
};
const classify = (addr) => JSON.parse(sh(PCZT, ["classify-address", addr]).out.trim());

// the shipped pure matcher + the classifier-backed boundary check, bundled from this working tree
writeFileSync(path.join(WORK, "entry.mjs"), [
  'export { uaShape, validateManifest } from "../../manifest/schema";',
  'export { isUnifiedOn } from "../../envelope/destination";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(WORK, "entry.mjs"), "--bundle", "--platform=node", "--format=esm",
  "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
  "--outfile=" + path.join(WORK, "lib.mjs"), "--log-level=warning",
], { cwd: ROOT });
const { uaShape, validateManifest, isUnifiedOn } = await import(pathToFileURL(path.join(WORK, "lib.mjs")).href);

// ---- the official fixtures (never values our code produced) ----
const cases = JSON.parse(readFileSync(path.join(ROOT, "tools/repro/fixtures/zcash-address-cases.json"), "utf8"));

// 1. classifier labels vs the vectors' own labels, and the two checks per network
{
  let labelBad = [], mainBad = [], mainRef = [], testBad = [], testRef = [];
  for (const r of cases.ua) {
    const c = classify(r.address);
    if (c.kind !== "unified" || c.network !== r.network) labelBad.push(`${r.address.slice(0, 12)}… ${c.kind}/${c.network} want unified/${r.network}`);
    const shielded = r.receivers.some((x) => x.typecode === 2 || x.typecode === 3);
    if (shielded !== r.shielded) labelBad.push(`${r.address.slice(0, 12)}… receiver shielded ${shielded} want ${r.shielded}`);
    if (r.network === "main") {
      if (!uaShape(r.address, "main") || isUnifiedOn(r.address, "main") !== r.shielded) mainBad.push(r.address.slice(0, 16));
      if (uaShape(r.address, "test") || isUnifiedOn(r.address, "test")) mainRef.push(r.address.slice(0, 16));
    }
    if (r.network === "test") {
      if (!uaShape(r.address, "test") || isUnifiedOn(r.address, "test") !== r.shielded) testBad.push(r.address.slice(0, 16));
      if (uaShape(r.address, "main") || isUnifiedOn(r.address, "main")) testRef.push(r.address.slice(0, 16));
    }
  }
  check("g7-classifier-network-labels", labelBad.length === 0, labelBad.slice(0, 3).join(" | "));
  check("g7-mainnet-ua-on-main", mainBad.length === 0, mainBad.slice(0, 3).join(" | "));
  check("g7-mainnet-ua-refused-on-test", mainRef.length === 0, mainRef.slice(0, 3).join(" | "));
  check("g7-testnet-ua-on-test", testBad.length === 0, testBad.slice(0, 3).join(" | "));
  check("g7-testnet-ua-refused-on-main", testRef.length === 0, testRef.slice(0, 3).join(" | "));
}

// 2. benzo-pczt takes its network and decodes the UFVK only under its own network
{
  const ak = "07".padStart(64, "0");
  const ufvkMain = sh(path.join(STATE, "bin/zcash-sign"), ["generate", "-n", "main", "--ak", ak]).out.match(/Unified Full Viewing Key: "(.*)"/)?.[1] ?? "";
  const ufvkTest = sh(path.join(STATE, "bin/zcash-sign"), ["generate", "-n", "test", "--ak", ak]).out.match(/Unified Full Viewing Key: "(.*)"/)?.[1] ?? "";
  check("g7-ufvk-fixture-shape", ufvkMain.startsWith("uview1") && ufvkTest.startsWith("uviewtest1"), `${ufvkMain.slice(0, 10)}… ${ufvkTest.slice(0, 12)}…`);
  for (const [net, ufvk] of [["main", ufvkMain], ["test", ufvkTest]]) {
    const f = path.join(WORK, `ufvk-${net}.txt`); writeFileSync(f, ufvk + "\n", { mode: 0o600 });
    const ok = sh(PCZT, ["ufvk-ak", f, "--network", net]);
    const wrong = net === "main" ? "test" : "main";
    const bad = sh(PCZT, ["ufvk-ak", f, "--network", wrong]);
    check(`g7-ufvk-network-${net}`,
      ok.code === 0 && ok.out.trim() === ak && bad.code !== 0 && /UFVK decode/.test(bad.err),
      `ok ${ok.code}/${ok.out.trim().slice(0, 8)} wrong ${bad.code}: ${(bad.err || bad.out).trim().slice(-80)}`);
  }
  const none = sh(PCZT, ["ufvk-ak", path.join(WORK, "ufvk-test.txt")]);
  const noneAddr = sh(PCZT, ["address", path.join(WORK, "no-wallet")]);
  check("g7-missing-network-refused",
    none.code !== 0 && /missing --network/.test(none.err + none.out) && noneAddr.code !== 0 && /missing --network/.test(noneAddr.err + noneAddr.out),
    `ufvk-ak ${none.code}, address ${noneAddr.code}`);
}

// 3. the manifest schema's network:"test" lock stays; its address checks are already main-ready
{
  const mainAddr = cases.ua.find((r) => r.network === "main" && r.shielded).address;
  const base = {
    version: 1, network: "main", auction_id: "00".repeat(32), escrow_ua: mainAddr, frost_group_key: "11".repeat(32),
    lot: "g7", supply: 1, reserve_zats: "0", tick_zats: "1", B_max_zats: "2", q_max: 1, C_zats: "2", fee_zats: "0",
    deposit_addresses: [mainAddr],
    drand: { chain_hash: process.env.BNZ_DRAND_CHAIN_HASH, public_key: process.env.BNZ_DRAND_PUBLIC_KEY, scheme: "bls-unchained-g1-rfc9380", genesis: Number(process.env.BNZ_DRAND_GENESIS), period: 3, R: 5 },
    T_submit: 1_000, T_freeze: 3_000, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  };
  let lockMsg = "";
  try { validateManifest(base); } catch (e) { lockMsg = String(e.message); }
  check("g7-manifest-lock-stays", /version\/network/.test(lockMsg), `a network:"main" manifest passed validateManifest (${lockMsg})`);
  check("g7-main-address-checks-ready", uaShape(base.escrow_ua, "main") && isUnifiedOn(base.escrow_ua, "main"),
    "the manifest's u1 escrow_ua is not accepted by the network-aware checks under main");
}

console.log(failures ? `RESULT FAIL ${failures} failing` : "RESULT PASS all g7 assertions");
process.exit(failures ? 1 : 0);
