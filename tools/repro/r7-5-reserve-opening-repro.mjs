// R7 item 5 repro — publish() emits reserve_opening after R, so sealed-reserve product auctions can settle
// and verify (Reviewer G G2: the F2 reserve check was dead wiring in product mode).
//
// Checks on a live CLEARED sealed-reserve product auction (observations printed):
//   R1 the published auction.json carries reserve_opening equal to the fresh pinned-Go-tle decryption of
//      manifest.sealed_reserve (the repro derives it independently);
//   R2 the shipped signer plan (settle/dist/plan.mjs) accepts it;
//   R3 benzo verify on a cold copy accepts it.
//
// Missing R1 with R2/R3 refusing "reserve opening published differs from re-derived" = CONFIRMED (dead
// wiring). All three green = FIXED.
//
// Usage: node tools/repro/r7-5-reserve-opening-repro.mjs <cleared-auction-id>
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r7-5-reserve-opening-repro.mjs <cleared-auction-id>"); process.exit(2); }
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicDir = path.resolve(config.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const signer = JSON.parse(readFileSync(path.join(publicDir, "signer.json"), "utf8")).signer;

// R1: independent fresh derivation with the pinned Go tle.
const sealed = Buffer.from(doc.manifest.bytes, "base64").toString("utf8");
const manifest = JSON.parse(sealed);
const tle = spawnSync(path.join(STATE, "bin/tle"), ["-d", "-c", manifest.drand.chain_hash], { input: Buffer.from(manifest.sealed_reserve, "hex"), maxBuffer: 1 << 20 });
const derived = tle.status === 0 ? tle.stdout.toString("hex") : null;
const publishedOpening = doc.reserve_opening?.plaintext_hex ?? null;
console.log(`R1 published reserve_opening: ${publishedOpening ? "present" : "MISSING"}`);
console.log(`R1 fresh tle derivation:      ${derived ? derived.slice(0, 32) + "…" : "undecryptable"}`);
console.log(`R1 equal: ${publishedOpening !== null && publishedOpening === derived}`);

// R2: the shipped signer plan.
const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 });
console.log(`R2 signer plan exit ${plan.status} ${(plan.stderr ?? "").trim().slice(-160).replace(/\n/g, " | ")}`);

// R3: benzo verify on a cold copy.
const cold = path.join(ROOT, "tmp/e2e/r7/reserve-cold");
rmSync(cold, { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
const verify = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", cold, "--signer", signer], { encoding: "utf8", maxBuffer: 64 << 20 });
const errors = ((verify.stdout ?? "") + (verify.stderr ?? "")).split("\n").filter((l) => l.startsWith("ERROR")).join(" | ");
console.log(`R3 verify exit ${verify.status} ${errors.slice(0, 200) || "(no error lines)"}`);
console.log(publishedOpening !== null && publishedOpening === derived && plan.status === 0 && verify.status === 0
  ? "FIXED: publish() carries the reserve opening and both the signer plan and benzo verify accept the sealed-reserve product auction."
  : publishedOpening === null
    ? "CONFIRMED: publish() never emits reserve_opening — every sealed-reserve product auction is refused by the signer plan and benzo verify (G2 dead wiring)."
    : "INCONCLUSIVE: see the observations above.");
