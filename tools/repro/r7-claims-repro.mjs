// R7 follow-up repro — head rulings R10 item 3, R11, R13 (2026-10-03):
//
//   R10K (P1, signer-side key pin): a manifest whose envelope_keys are not the signers' own keys is accepted
//   today (the operator can pin keys it holds); after the fix every signer refuses
//   "manifest does not pin this signer's envelope key" at auction sign and in its settlement plan.
//
//   R11 (P2, claim griefing): a well-shaped but unsigned claim recorded first blocks the owner's valid claim
//   forever ("a different claim for this party is already recorded"); after the fix both are recorded and the
//   signer plan uses the first claim whose owner signature verifies.
//
//   R13 (P2, public verifiability): "paid through an owner-signed claim" is accepted on the signing quorum's
//   word with no public claim evidence; after the fix publish() emits the used claims and benzo verify checks
//   each owner_sig against the owner key in the opening, refusing a forged claim.
//
// Usage: node tools/repro/r7-claims-repro.mjs <cleared-auction-id> [--settle]
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id, ...rest] = process.argv.slice(2);
const settle = rest.includes("--settle");
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r7-claims-repro.mjs <auction-id> [--settle]"); process.exit(2); }
const cli = (args, input, stdinText) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { input: stdinText ?? (input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input)), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
const randomId = () => execFileSync("node", ["-e", "console.log(require('crypto').randomBytes(32).toString('hex'))"], { encoding: "utf8" }).trim();
const fresh = () => spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "vault"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const show = (label, r) => console.log(`${label}: ${r.code === 0 ? "accepted" : "refused"} ${r.out.trim().slice(-160).replace(/\n/g, " ")}`);

// ---- R10K: a manifest pinning an operator key at bob's index (1) -------------------------------
const deposit = [fresh(), fresh()];
const swapped = [...signerKeys]; swapped[1] = "44".repeat(32);
const idK = randomId();
const manifest = { version: 1, network: "test", auction_id: idK, escrow_ua: deposit[0],
  frost_group_key: readFileSync(path.join(STATE, "group-key.txt"), "utf8").trim(), lot: "R10K pin repro", supply: 2,
  reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: process.env.BNZ_COLLATERAL_ZATS, fee_zats: "0",
  deposit_addresses: deposit,
  drand: { chain_hash: process.env.BNZ_DRAND_CHAIN_HASH, public_key: process.env.BNZ_DRAND_PUBLIC_KEY, scheme: "bls-unchained-g1-rfc9380", genesis: Number(process.env.BNZ_DRAND_GENESIS), period: 3, R: 1 + Math.ceil((Math.floor(Date.now() / 1000) + 7200 - Number(process.env.BNZ_DRAND_GENESIS)) / 3) },
  T_submit: Math.floor(Date.now() / 1000) + 3600, T_freeze: Math.floor(Date.now() / 1000) + 5000, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1", envelope_keys: swapped };
show("R10K create with an operator key at bob's index", cli(["auction", "create"], manifest));
show("R10K auction sign", cli(["auction", "sign", "--id", idK]));

// ---- R11: junk claim first, owner's valid claim second -----------------------------------------
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicDir = path.resolve(config.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const result = JSON.parse(readFileSync(path.join(publicDir, "result.json"), "utf8"));
const leaf0 = doc.frozen.leaves[0];
const ownerPrivate = JSON.parse(readFileSync(path.join(STATE, "bids", id, leaf0.ciphertext_hash + ".json"), "utf8")).owner_private_hex;
const dest = spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
const junk = { kind: "claim-refund", auction_id: id, party: "leaf:0", destination_ua: dest, destination_sha256: "0".repeat(64), owner_sig: "11".repeat(64) };
const claimsFile = path.join(STATE, "run", "r7-claims-repro");
rmSync(claimsFile, { recursive: true, force: true }); mkdirSync(claimsFile, { recursive: true });
writeFileSync(path.join(claimsFile, "junk.json"), JSON.stringify(junk), { mode: 0o600 });
show("R11 record junk claim (well-shaped, forged signature)", cli(["claim-refund", "--id", id, "--file", path.join(claimsFile, "junk.json"), "--defer"]));
const request = cli(["claim-refund", "--id", id, "--party", "leaf:0", "--destination", dest, "--owner-key-stdin"], undefined, ownerPrivate);
console.log(`R11 owner claim build: ${request.code === 0 ? "signed" : "refused " + request.out.trim().slice(-100)}`);
if (request.code === 0) {
  writeFileSync(path.join(claimsFile, "owner.json"), request.out.trim(), { mode: 0o600 });
  show("R11 record the owner's valid claim after the junk one", cli(["claim-refund", "--id", id, "--file", path.join(claimsFile, "owner.json"), "--defer"]));
  const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 });
  console.log(`R11 plan exit ${plan.status}`);
  if (plan.status === 0) {
    const parsed = JSON.parse(plan.stdout);
    const leaf0Out = parsed.obligations.find((o) => o.party === "leaf:0");
    console.log(`R11 leaf:0 ${leaf0Out ? "payable" : "still in the exception queue"}; used claim: ${JSON.stringify((parsed.claims_used ?? []).find((c) => c.party === "leaf:0") ?? null)?.slice(0, 120)}`);
  }
}

// ---- R13: public claim evidence ---------------------------------------------------------------
if (settle) {
  const settled = cli(["claim-refund", "--id", id, "--file", path.join(claimsFile, "owner.json")]);
  console.log(`R13 settle exit ${settled.code}`);
}
const cold = path.join(ROOT, "tmp/e2e/r7/claims-cold");
rmSync(cold, { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
const signer = JSON.parse(readFileSync(path.join(publicDir, "signer.json"), "utf8")).signer;
const clean = cli(["verify", "--dir", cold, "--signer", signer]);
console.log(`R13 verify on the claim-paid copy: exit ${clean.code} ${clean.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 200) || "(no error lines)"}`);
const published = JSON.parse(readFileSync(path.join(cold, "auction.json"), "utf8"));
console.log(`R13 published claims: ${JSON.stringify((published.claims ?? []).map((c) => c.party))}`);
if ((published.claims ?? []).length) {
  const forged = { ...published, claims: published.claims.map((c, i) => (i === 0 ? { ...c, owner_sig: "22".repeat(64) } : c)) };
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  writeFileSync(path.join(cold, "auction.json"), canonical(forged) + "\n");
  const forgedCheck = cli(["verify", "--dir", cold, "--signer", signer]);
  console.log(`R13 verify with a forged published claim: exit ${forgedCheck.code} ${forgedCheck.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 200) || "(no error lines)"}`);
}
