// R15 item 3 repro — claims carry the destination sealed in a v2 envelope; `salt` and `destination_ua` are
// gone from the request; only `claim_envelope_sha256` is published (Reviewer R F6 + the head finding on
// R13: the published destination hash matched candidate addresses and the request showed the operator
// every destination).
//
//   L1 (the flip): the shipped bidder-side `benzo claim-refund` request. Before, the request carries the
//      plaintext destination (`destination_ua`) plus a salted destination hash — the operator reads every
//      destination and anyone holding a candidate address can match its hash. After, the destination is
//      SEALED in a v2 envelope to the manifest's pinned signer keys: the request is
//      {party, claim_envelope_ct, owner_sig} over the body {kind, auction_id, party, claim_envelope_sha256}
//      and contains no destination string and no matchable destination hash.
//   L2: the record-time operator side accepts the new request (`claim-refund --defer`) and the shipped
//      signer plan's claims_used carries only {party, claim_envelope_sha256, owner_sig} (+ the scanned
//      memo for strays), with the sealed destination opened per signer (the plan's claim_envelopes entry).
//
// The plan leg runs in a scratch BNZ_STATE_DIR (fixture auction flipped to REFUNDING, fresh owner-signed
// claim over real tle memo openings) exactly like tools/repro/r16-1-cancel-claims-repro.mjs; the live state
// is never touched.
//
// Usage: node tools/repro/r15-3-claim-envelope-repro.mjs
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const SCRATCH = path.join(ROOT, "tmp/e2e/r15-3-state");
const scratch = (p) => path.join(SCRATCH, p);
const sh = (cmd, args, input, env = {}) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ...env, BNZ_STATE_DIR: SCRATCH } });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "" };
};
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });

// The r16-1 scratch recipe: a fixture auction flipped to REFUNDING in the scratch, its mined batches kept
// so the plan still counts the deposits it refunded.
const sourceAuction = process.argv[2] ?? "3bbfa50130665d5177c6fdcd19ebb610b47fcf2a8016c38a7a0b1a21b2a0801a";
const realLedger = JSON.parse(readFileSync(path.join(STATE, "auction", `${sourceAuction}.json`), "utf8"));
const realConfig = JSON.parse(readFileSync(path.join(STATE, "product", `${sourceAuction}.json`), "utf8"));
const manifest = JSON.parse(Buffer.from(realLedger.manifest.bytes, "base64").toString("utf8"));
const cancelled = (doc) => { const d = { ...doc, state: "REFUNDING" }; delete d.opened; return d; };
writeFileSync(scratch(`auction/${sourceAuction}.json`), JSON.stringify(cancelled(realLedger)), { mode: 0o600 });
const publicDir = scratch("public");
cpSync(path.resolve(realConfig.public_dir), publicDir, { recursive: true });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(cancelled(JSON.parse(readFileSync(path.join(path.resolve(realConfig.public_dir), "auction.json"), "utf8")))));
writeFileSync(scratch(`product/${sourceAuction}.json`), JSON.stringify({ ...realConfig, public_dir: publicDir }), { mode: 0o600 });
mkdirSync(scratch(`settle/${sourceAuction}`), { recursive: true });
for (const f of ["routing-alice.json", "routing-bob.json", "routing-carol.json", "routing-commitment.json"])
  cpSync(path.join(STATE, "settle", sourceAuction, f), scratch(`settle/${sourceAuction}/${f}`));
cpSync(path.join(STATE, "settle", sourceAuction, "ledger.sqlite"), scratch(`settle/${sourceAuction}/ledger.sqlite`));
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(scratch(`settle/${sourceAuction}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}
const { memoSealedBid } = await import(path.join(ROOT, "settle/dist/envelopes.mjs"));
const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const { DatabaseSync } = await import("node:sqlite");
const owned = new Set(new DatabaseSync(scratch(`settle/${sourceAuction}/ledger.sqlite`), { readOnly: true }).prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
const target = notes.find((n) => manifest.deposit_addresses.includes(n.address) && (!n.spent_in_txid || owned.has(n.spent_in_txid))
  && n.memo_hex && memoSealedBid(n.memo_hex) && existsSync(path.join(STATE, "bids", sourceAuction, sha256(Buffer.from(memoSealedBid(n.memo_hex), "hex")) + ".json")));
if (!target) { console.error("no claimable bid deposit with an owner key"); process.exit(2); }
const party = `deposit:${target.txid}:${target.diversifier_index}`;
const ownerPrivate = JSON.parse(readFileSync(path.join(STATE, "bids", sourceAuction, sha256(Buffer.from(memoSealedBid(target.memo_hex), "hex")) + ".json"), "utf8")).owner_private_hex;
const dest = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).out.trim();
if (!dest.startsWith("utest1")) { console.error(`fresh bidder address unavailable: ${dest}`); process.exit(2); }

// ---- L1: the shipped bidder-side claim request ------------------------------------------------------
const built = sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", sourceAuction, "--party", party, "--destination", dest, "--owner-key-stdin"], ownerPrivate);
let outcome = "INCONCLUSIVE";
if (built.code !== 0) console.log(`L1 claim build failed: ${built.out.trim().slice(-160)}`);
else {
  const request = JSON.parse(built.stdout);
  console.log(`L1 request fields: ${JSON.stringify(Object.keys(request).sort())}`);
  const leaksDestination = /utest1/.test(JSON.stringify(request));
  const hasHashableCommit = /^[0-9a-f]{64}$/.test(request.destination_commit ?? "") || typeof request.destination_ua === "string";
  if (leaksDestination || hasHashableCommit) {
    outcome = "CONFIRMED";
    console.log(`CONFIRMED: the claim request ${leaksDestination ? "hands the operator the plaintext destination" : "commits to the destination with a matchable hash"} — the operator reads every destination and a candidate address's hash can be matched.`);
  } else if (typeof request.claim_envelope_ct === "string" && /^[0-9a-f]{64}$/.test(request.claim_envelope_sha256 ?? "")
    && request.claim_envelope_sha256 === sha256(Buffer.from(request.claim_envelope_ct, "hex"))) {
    // L2: the record-time operator side accepts it and the shipped signer plan publishes only the hash.
    const recorded = sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", sourceAuction, "--defer"], built.stdout);
    console.log(`L2 record-time check: ${recorded.code === 0 ? "accepted" : `refused ${recorded.out.trim().slice(-120)}`}`);
    const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), sourceAuction]);
    console.log(`L2 plan exit ${planRun.code}`);
    if (planRun.code === 0 && recorded.code === 0) {
      const plan = JSON.parse(planRun.stdout);
      const used = plan.claims_used.find((c) => c.party === party);
      console.log(`L2 claims_used entry: ${JSON.stringify(used)}`);
      const sealed = plan.claim_envelopes?.[party] === request.claim_envelope_ct;
      const publishesOnlyHash = used && used.claim_envelope_sha256 === request.claim_envelope_sha256 && !/utest1/.test(JSON.stringify(used)) && used.destination_commit === undefined;
      if (sealed && publishesOnlyHash) {
        outcome = "FIXED";
        console.log("FIXED: the destination is sealed in the claim envelope (opened per signer), and the published claim carries only party, claim_envelope_sha256, owner_sig (and the scanned memo).");
      }
    } else console.log(`L2 plan stderr: ${planRun.out.trim().slice(-160)}`);
  }
}
console.log(`outcome ${outcome}`);
