// R16 item 4 repro — every stray claim's owner key is derived by the verifier itself, from the memo the
// claim publishes (`memo_hex`, which matches the scanned deposit) and the published beacon;
// `claims[].opening` is gone (Reviewer R F3).
//
//   L0 property: the published stray claim's `memo_hex` is exactly the vault-scanned deposit's memo — the
//      memo the signer plan attached from its own scan — so "the memo the claim publishes" is anchored to
//      the scanned deposit by construction, and the verifier derives the owner key from it + the beacon.
//   L1 (the F3 flip): a well-shaped stray claim carrying an operator-supplied `opening` — a self-consistent
//      128-byte plaintext plus an owner signature over the claim body under a fresh key the operator
//      chose (the auction id is even in the layout the plan uses) — is accepted today, because the owner
//      key comes from whatever opening the operator publishes. After the fix `claims[].opening` is refused
//      and the owner key only ever comes from the published memo's beacon-anchored opening, so the same
//      forgery fails the `claims` check.
//   L2 (fail-closed): a claim carrying the real memo but a corrupted owner_sig is refused
//      `claim N owner signature` in both builds.
//
// The probe drives the shipped `bin/benzo verify` on a copied public directory (the live directory is
// never touched) and asserts on the `claims` check line specifically; other checks' lines are printed as
// context only. The L1/L2 corpus keeps the real manifest, frozen set, openings and beacon but drops the
// settlement summary (so the claim-paid-rows rule is out of scope for this probe) and replaces the claims
// list with freshly built, freshly signed entries — nothing about the forgery is pre-baked.
//
// Usage: node tools/repro/r16-4-stray-claim-opening-repro.mjs <auction-id-with-a-published-stray-claim>
import { spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r16-4-stray-claim-opening-repro.mjs <auction-id>"); process.exit(2); }

// The real signing/verification primitives come from the shipped modules (fresh keys and signatures here —
// nothing about the forgery is pre-baked).
writeFileSync(path.join(ROOT, "tmp/repro-r16-4-entry.mjs"),
  'export * as envelope from "../envelope/index";\n', { flag: "w" });
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r16-4-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r16-4-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { envelope } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r16-4-lib.mjs")).href);

const publicDir = path.resolve(JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8")).public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const stray = (doc.claims ?? []).find((c) => /^deposit:[0-9a-f]{64}:.+$/.test(c.party ?? ""));
if (!stray) { console.error("no published stray claim in this directory"); process.exit(2); }
const auctionId = doc.auction_id;
const verify = (dir) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", dir, "--signer", doc.signer], { encoding: "utf8", maxBuffer: 64 << 20 });
  const claimsLine = `${p.stdout ?? ""}${p.stderr ?? ""}`.split("\n").find((l) => /^OK claims|^ERROR claims/.test(l)) ?? "(no claims line)";
  return { code: p.status, claimsLine, other: `${p.stdout ?? ""}${p.stderr ?? ""}`.split("\n").filter((l) => /^(OK|ERROR) /.test(l) && !/^OK claims|^ERROR claims/.test(l)).length };
};

// ---- L0: the published memo is the scanned deposit's memo ----------------------------------------
{
  const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
    .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const m = /^deposit:([0-9a-f]{64}):(.+)$/.exec(stray.party);
  const note = notes.find((n) => n.txid === m[1] && String(n.diversifier_index) === m[2]);
  console.log(`L0 published claim memo_hex matches the scanned deposit: ${note && note.memo_hex === stray.memo_hex}`);
  if (!note || note.memo_hex !== stray.memo_hex) { console.log("L0 FAILED — the claim does not publish the scanned deposit's memo"); process.exit(1); }
}

// ---- L1: the F3 forgery — an operator-supplied opening -------------------------------------------
const dir = path.join(ROOT, "tmp/e2e/r16-4-dir");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync(publicDir, dir, { recursive: true });
const corpus = (claims) => { const d = { ...doc, claims }; delete d.settlement; return d; };
const commit = /^[0-9a-f]{64}$/.test(stray.claim_envelope_sha256 ?? "") ? stray.claim_envelope_sha256 : randomBytes(32).toString("hex");
{
  const owner = envelope.generateOwnerKey();
  const pt = Buffer.alloc(128, 0x42);
  pt[0] = 0;
  Buffer.from(auctionId, "hex").copy(pt, 1); // the layout the plan checks — the forgery mimics everything but the owner
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  const body = { kind: "claim-refund", auction_id: auctionId, party: stray.party, claim_envelope_sha256: commit };
  const forged = { party: stray.party, claim_envelope_sha256: commit, owner_sig: envelope.signStatement(owner, body), opening: pt.toString("hex") };
  writeFileSync(path.join(dir, "auction.json"), JSON.stringify(corpus([forged])));
  const run = verify(dir);
  console.log(`L1 forged claim with operator-supplied opening: exit ${run.code} ${run.claimsLine} (${run.other} other check lines)`);
  if (/^OK claims/.test(run.claimsLine)) {
    console.log("CONFIRMED: verify derives the stray claim's owner key from claims[].opening — the operator supplies it, so any self-consistent forged claim verifies.");
    console.log("outcome CONFIRMED");
  } else {
    console.log("FIXED: the operator-supplied opening is refused; the stray claim's owner key comes only from the published memo's beacon-anchored opening.");
    console.log(`outcome ${/claim \d+ (memo_hex|shape)/.test(run.claimsLine) ? "FIXED" : "INCONCLUSIVE " + run.claimsLine}`);
  }
}

// ---- L2: fail-closed on a corrupted signature ----------------------------------------------------
{
  const owner = envelope.generateOwnerKey();
  const body = { kind: "claim-refund", auction_id: auctionId, party: stray.party, claim_envelope_sha256: commit };
  const bad = { party: stray.party, claim_envelope_sha256: commit, owner_sig: envelope.signStatement(owner, body), memo_hex: stray.memo_hex };
  bad.owner_sig = (bad.owner_sig[0] === "0" ? "1" : "0") + bad.owner_sig.slice(1);
  writeFileSync(path.join(dir, "auction.json"), JSON.stringify(corpus([bad])));
  const run = verify(dir);
  console.log(`L2 real memo with a corrupted owner_sig: exit ${run.code} ${run.claimsLine}`);
}
