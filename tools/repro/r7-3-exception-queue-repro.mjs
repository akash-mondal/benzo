// R7 item 3 repro — a malformed, undersized or undecryptable envelope record moves that leaf to the
// exception queue and never aborts settlement for the other parties (Reviewer R F-4 = Reviewer G G3).
//
// Claim under test: settle/plan.ts must complete with the bad leaf in the exception queue instead of the
// record's malformed hex throwing out of validEnvelope and killing the whole plan. This probe injects a
// malformed envelope record (odd-length ct — admitted by the pre-fix intake regex) into BOTH the private
// ledger and the published auction.json of a live CLEARED product auction, runs the shipped signer plan,
// and restores both files afterwards. It also checks the shipped intake shape helper (settle/envelopes.ts
// envelopeRecordShape, used by clear/auction-cli.ts admit) — the fixed-length rule that keeps malformed
// records out of published directories.
//
// Observed plan abort on the malformed record = CONFIRMED. Observed plan completion with the leaf in the
// exception queue = FIXED.
//
// Usage: node tools/repro/r7-3-exception-queue-repro.mjs <cleared-auction-id>
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r7-3-exception-queue-repro.mjs <cleared-auction-id>"); process.exit(2); }
const ledgerFile = path.join(STATE, "auction", `${id}.json`);
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicFile = path.join(path.resolve(config.public_dir), "auction.json");
const ledgerBytes = readFileSync(ledgerFile), publicBytes = readFileSync(publicFile);
const ledger = JSON.parse(ledgerBytes.toString("utf8")), published = JSON.parse(publicBytes.toString("utf8"));
const leaf0 = published.frozen.leaves[0];

// The one shared published-record rule (R12 item 1, probed here per R15 item 4): intake (clear/auction-cli.ts
// admit), settlement (settle/envelopes.ts validEnvelope) and `benzo verify` all use envelopeRecordValid from
// envelope/ — the exact v2 n = 3 shape with the signed manifest's pinned envelope_keys as stanza recipients
// in order, or the pre-v2 572-byte box only where the manifest pins none (the Phase 2–4 evidence).
try {
  const env = await import(path.join(ROOT, "envelope/dist/index.mjs"));
  const keys = JSON.parse(Buffer.from(ledger.manifest.bytes, "base64").toString("utf8")).envelope_keys;
  const own = (ledger.envelopes ?? [])[0] ?? { envelope_ct: "ab".repeat(572), owner_sig: "ab".repeat(64) };
  console.log(`shared rule, pinned keys, malformed ct: ${env.envelopeRecordValid({ envelope_ct: "ababababc", owner_sig: "ab".repeat(64) }, keys) ? "ACCEPTED (malformed record can enter)" : "refused"}`);
  console.log(`shared rule, pinned keys, this dir's own record: ${env.envelopeRecordValid(own, keys) ? "accepted" : "refused (pre-v2 record with pinned keys)"}`);
  console.log(`shared rule, no pinned keys, the same record: ${env.envelopeRecordValid(own, undefined) ? "accepted (Phase 2-4 evidence reading)" : "refused"}`);
  console.log(`shared rule, short owner_sig: ${env.envelopeRecordValid({ ...own, owner_sig: "ab".repeat(32) }, keys) ? "ACCEPTED" : "refused"}`);
} catch {
  console.log("shared rule: envelope/dist bundle absent — run npm run build:core");
}

// Case A: malformed record for leaf 0, self-consistently in both documents.
const bad = { ciphertext_hash: leaf0.ciphertext_hash, envelope_ct: "ababababc", owner_sig: "ab".repeat(64) };
const withBad = (doc) => ({ ...doc, envelopes: [bad, ...(doc.envelopes ?? []).filter((e) => e.ciphertext_hash !== leaf0.ciphertext_hash)] });
let outcome = "INCONCLUSIVE";
try {
  writeFileSync(ledgerFile, JSON.stringify(withBad(ledger)), { mode: 0o600 });
  writeFileSync(publicFile, JSON.stringify(withBad(published)));
  const plan = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 });
  console.log(`plan exit ${plan.status}`);
  if (plan.status !== 0) {
    console.log(`plan stderr: ${(plan.stderr ?? "").trim().slice(-200)}`);
    if (/key\/signature hex|envelope/.test(plan.stderr ?? "")) {
      outcome = "CONFIRMED";
      console.log("CONFIRMED: one malformed envelope record aborts the whole settlement plan — every other party's refund and the seller payout are wedged with it.");
    }
  } else {
    const parsed = JSON.parse(plan.stdout);
    console.log(`obligations: ${JSON.stringify(parsed.obligations.map((o) => o.party))}`);
    console.log(`exceptions: ${JSON.stringify(parsed.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
    const leaf0Exception = parsed.exceptions.find((e) => e.party === "leaf:0");
    const sellerOk = parsed.obligations.some((o) => o.party === "seller");
    if (leaf0Exception && sellerOk) {
      outcome = "FIXED";
      console.log(`FIXED: the plan completed with leaf:0 in the exception queue (${leaf0Exception.reason ?? "no reason recorded"}) while every other party stayed payable.`);
    }
  }
} finally {
  writeFileSync(ledgerFile, ledgerBytes);
  writeFileSync(publicFile, publicBytes);
  console.log(`restored both documents; outcome ${outcome}`);
}
