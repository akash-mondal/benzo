// R7 item 1 repro — gate W rooted in signer-derived data (Reviewer R F-3 = Reviewer G G1).
//
// Claim under test: the signer's destination decision must come only from its own fresh tle openings
// (settle/plan.ts) and the published auction.json envelope records, refusing when the coordinator's
// private ledger (STATE/auction/<id>.json) differs from either. This probe drives the shipped entry
// points against a live CLEARED product auction: it rewrites the private ledger's opened/envelopes into
// self-consistent fabricated pairs (attacker owner keys + attacker-sealed envelopes naming the attacker's
// UA), then runs the shipped settlement worker and, if a batch is allocated, a real PCZT paying the
// redirected destination through the real `benzo sign inspect`.
//
// Observed approval = CONFIRMED (the operator rewrites the private ledger and every signer check passes).
// Observed refusal naming the derived-data mismatch = FIXED.
//
// Usage: node tools/repro/r7-1-ledger-redirect-repro.mjs <auction-id> [signer-name]
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
// leak-audit (gate LA): printed outputs never carry a full destination UA; comparisons keep full values.
const ab = (a) => (typeof a === "string" && a.length > 20 ? a.slice(0, 8) + "…" + a.slice(-6) : a);
const { generateOwnerKey, generateEnvelopeKey, openEnvelope, sealEnvelope, signEnvelope, settlementCommitment } =
  await import(path.join(ROOT, "envelope/dist/index.mjs"));

const [id, signerName = "bob"] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r7-1-ledger-redirect-repro.mjs <auction-id> [signer]"); process.exit(2); }
const ledgerFile = path.join(STATE, "auction", `${id}.json`);
const original = readFileSync(ledgerFile);
const ledger = JSON.parse(original.toString("utf8"));
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const published = JSON.parse(readFileSync(path.join(path.resolve(config.public_dir), "auction.json"), "utf8"));

// Part A (also R7 item 2 fail-before): the operator-held envelope private key, if present, decrypts the
// bidder's destination — the privacy leak Reviewer R F-1 / Reviewer G G4.
const operatorKeyFile = path.join(STATE, "product", `${id}.envelope.json`);
let sealToPub = null;
try {
  const ek = JSON.parse(readFileSync(operatorKeyFile, "utf8"));
  sealToPub = ek.public_hex;
  const rec = (published.envelopes ?? [])[0];
  if (rec && ek.private_hex) console.log(`F-1 CONFIRMED: operator state ${path.basename(operatorKeyFile)} holds the envelope private key; it decrypts leaf 0's destination ${ab(openEnvelope(rec.envelope_ct, ek.private_hex))}`);
} catch {
  console.log("F-1 FIXED: no operator-held envelope private key exists in product state");
  sealToPub = generateEnvelopeKey().public_hex; // any key; after the fix nothing opens it — the probe never needs to
}
// Part B: self-consistent fabricated (opened, envelopes) pairs per leaf — the operator's own owner key,
// nonce and commitment over an envelope sealed to the auction envelope key and carrying the operator's
// destination. Everything verifies against itself; only the signer's own derivation can catch it.
const attacker = "utest1redacted";
const fabricated = published.frozen.leaves.map((leaf) => {
  const owner = generateOwnerKey(), nonce = randomBytes(16).toString("hex");
  const envelope_ct = sealEnvelope(attacker, sealToPub);
  const pt = Buffer.alloc(128);
  Buffer.from(nonce, "hex").copy(pt, 45);
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  Buffer.from(settlementCommitment(nonce, envelope_ct), "hex").copy(pt, 93);
  return {
    opening: { leaf_index: leaf.leaf_index, plaintext_hex: pt.toString("hex") },
    record: { ciphertext_hash: leaf.ciphertext_hash, envelope_ct, owner_sig: signEnvelope(owner, id, leaf.ciphertext_hash, envelope_ct) },
  };
});
const tampered = {
  ...ledger,
  opened: (ledger.opened ?? []).map((o) => fabricated.find((f) => f.opening.leaf_index === o.leaf_index)?.opening ?? o),
  envelopes: (ledger.envelopes ?? []).map((e) => fabricated.find((f) => f.record.ciphertext_hash === e.ciphertext_hash)?.record ?? e),
};
mkdirSync(path.join(STATE, "run"), { recursive: true });
writeFileSync(path.join(STATE, "run", `${id}.ledger-backup.json`), original, { mode: 0o600 });
let outcome = "INCONCLUSIVE";
try {
  writeFileSync(ledgerFile, JSON.stringify(tampered), { mode: 0o600 });
  // Shipped settlement worker against the tampered ledger; killed at the first allocated batch (the
  // production resume boundary) so nothing is signed or broadcast here.
  const worker = spawn(path.join(ROOT, "bin/benzo"), ["settle", "--id", id], { detached: true });
  let out = "", err = "";
  const done = new Promise((resolve) => worker.on("close", resolve));
  worker.stdout.on("data", (d) => { out += d; if (out.includes('"allocated"')) { try { process.kill(-worker.pid, "SIGKILL"); } catch {} } });
  worker.stderr.on("data", (d) => { err += d; });
  await Promise.race([done, new Promise((r) => setTimeout(r, 240000))]);
  const workerError = /private ledger|differ/.test(err);
  if (workerError) {
    outcome = "FIXED";
    console.log(`FIXED: the settlement worker refused the tampered private ledger (${err.trim().slice(-160)}).`);
  } else {
    const status = JSON.parse(spawnSync(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "status", id], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout);
    const rows = status.rows.filter((r) => r.batch === 1);
    console.log(`allocated batch 1 rows: ${rows.map((r) => `${r.party}=${r.amount_zats}`).join(" ") || "(none)"}`);
    const seller_ua = JSON.parse(readFileSync(path.join(STATE, "settle", id, `routing-${signerName}.json`), "utf8")).seller_ua;
    const dir = path.join(STATE, "run", `r7-1-${id}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const candidate = path.join(dir, "redirect.pczt");
    const payments = rows.map((r) => ({ recipient: r.party === "seller" ? seller_ua : attacker, amount_zats: r.amount_zats }));
    spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "vault"), candidate, "--network", "test"], { input: JSON.stringify(payments), encoding: "utf8", maxBuffer: 64 << 20 });
    const check = spawnSync(path.join(ROOT, "bin/benzo"), ["sign", "inspect", "--id", id, "--batch", "1", "--candidate", candidate, "--name", signerName], { encoding: "utf8", maxBuffer: 64 << 20 });
    console.log(`sign inspect exit ${check.status}`);
    console.log((check.stdout + check.stderr).trim().slice(-400));
    if (check.status === 0) { outcome = "CONFIRMED"; console.log(`CONFIRMED: the signer approved a real PCZT paying ${ab(attacker)} — the coordinator rewrites STATE/auction/<id>.json and every check passes.`); }
    else if (/private ledger|differ|refused/.test(check.stderr)) { outcome = "FIXED"; console.log(`FIXED: the signer refused the redirected PCZT (${check.stderr.trim().slice(-160)}).`); }
    else console.log("INCONCLUSIVE: refusal for an unrelated reason; see output above");
  }
} finally {
  writeFileSync(ledgerFile, original);
  console.log(`restored ${path.basename(ledgerFile)}; outcome ${outcome}`);
}
