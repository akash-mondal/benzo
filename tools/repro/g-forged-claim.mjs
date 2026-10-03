// G-review test: is a deposit-party claim in the published doc forgeable?
// checkPublicAuction (api/public-auction.ts, "claims" check) derives a deposit claim's owner key from
// claims[].memo_hex (the memo ciphertext the operator publishes) and the published beacon. Nothing ties
// memo_hex to the on-chain deposit — the signer plan anchors to the scanned note (settle/plan.ts), but
// `benzo verify` re-derives from the published memo alone. If the whole chain (memo ct -> owner key ->
// owner_sig) can be minted by an attacker, verify accepts claim evidence that no bidder ever produced.
//
// Builds: real quicknet beacon (docs/evidence/phase-4/cli/beacon.json), phase-4 signed manifest, an
// attacker-minted tlock ciphertext to that round carrying an attacker owner key, then runs the shipped
// checkPublicAuction. PASS-forged = zero errors with the forged claim; control = tampered owner_sig errors.
//
// Copied read-only from /Users/akshmnd/Dev Projects/benzo-sol-g/tests/g-forged-claim.mjs (Reviewer G's lab).
// Adaptations (nothing else changed): ROOT is this repo (git toplevel), and the forged claim's party uses
// the R26 item 1 output-position identity (deposit:<txid>:<pool>:<action_index>) so the corpus matches the
// current code's party shape — G's diversifier-index party is now refused at `claim N party` in every tree.
// Added below G's own two checks (R23 item 1 controls, same entry points):
//   r23-1-certified-claim-accepted  the same claim with a q_w-certified strays statement naming its
//                                   party + SHA-256(memo_hex) is accepted (the witnesses saw it)
//   r23-1-wrong-party-refused       a certified statement binding the memo to a different party refuses
//   r23-1-quorum-refused            one signature below q_w refuses
//   r23-1-tampered-sig-certified    with valid certification, a tampered owner_sig still refuses
//   r23-1-witness-strays-sign       the shipped `benzo witness strays` signs the statement from its own
//                                   scan and its certificate is what the verifier accepts
//
// Usage: node tools/repro/g-forged-claim.mjs
// Needs: npm ci. No network: tlock-js encrypts to the pinned published beacon offline.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tools/repro/g-forged-claim.mjs");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });

mkdirSync(path.join(ROOT, "tmp"), { recursive: true });
writeFileSync(path.join(ROOT, "tmp/g-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as env from "../envelope/index";',
  'export * as api from "../api/public-auction";',
  'export * as seal from "../settle/envelopes";',
  'export { deriveClaimOpenings, publishedClient } from "../cli/published-beacon";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"),
  ["tmp/g-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/g-lib.mjs", "--log-level=warning",
   "--banner:js=import{createRequire}from'node:module';const require=createRequire(import.meta.url);"],
  { cwd: ROOT, stdio: "inherit" });
const lib = await import(pathToFileURL(path.join(ROOT, "tmp/g-lib.mjs")).href);
const { schema, env, api, seal } = lib;
const pb = lib;
const { timelockEncrypt } = await import(pathToFileURL(path.join(ROOT, "node_modules/tlock-js/index.js")).href);

const beacon = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/beacon.json"), "utf8"));
const packet = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/manifest.json"), "utf8"));
const manifest = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
const auctionId = manifest.auction_id;

const local = pb.publishedClient(beacon);

// attacker-minted sealed-bid plaintext: [0]=0, [1..33]=auction_id, [61..93]=attacker owner pk
const owner = env.generateOwnerKey();
const pt = Buffer.alloc(128);
pt[0] = 0;
Buffer.from(auctionId, "hex").copy(pt, 1);
Buffer.from(owner.public_hex, "hex").copy(pt, 61);
// tlock-encrypt the plaintext bytes to the beacon's round with the network's public key (offline)
const armored = await timelockEncrypt(beacon.round, pt, local);
const b64 = armored.split("\n").filter(l => l && !l.startsWith("-----")).join("");
const ctHex = Buffer.from(b64, "base64").toString("hex");
const memo = Buffer.alloc(512);
Buffer.from("ff424e5a01", "hex").copy(memo, 0);
memo.writeUInt16BE(ctHex.length / 2, 5);
Buffer.from(ctHex, "hex").copy(memo, 7);
const memo_hex = memo.toString("hex");
if (seal.memoSealedBid(memo_hex) !== ctHex) throw new Error("memo framing mismatch");

// the forged claim: any 64-hex "txid", attacker envelope hash (never verified against anything here)
const party = `deposit:${createHash("sha256").update("attacker-tx").digest("hex")}:ironwood:0`;
const claimEnvelopeSha = createHash("sha256").update("attacker envelope ct").digest("hex");
const body = { kind: "claim-refund", auction_id: auctionId, party, claim_envelope_sha256: claimEnvelopeSha };
const owner_sig = env.signStatement({ private_hex: owner.private_hex, public_hex: owner.public_hex }, body);

const settlement = {
  rows: [{ party, kind: "refund", amount_zats: "1000", state: "paid" }],
  receipts: [{ auction_id: auctionId, party, txid: "attacker-tx", pool: "orchard", output_index: 0, amount_zats: "1000" }],
};
const claims = [{ party, claim_envelope_sha256: claimEnvelopeSha, owner_sig, memo_hex }];
const pub = {
  dir: ROOT, signer: packet.signer, legacy: true, state: "REFUNDING",
  manifestPacket: packet, manifest, manifest_hash: schema.client(packet, packet.signer).manifest_hash,
  frozen: null, opened: [], beacon, serialBeacon: null, launchInput: undefined,
  result: null, resultBytes: null, receipts: [], envelopes: [], witnessSet: null, witnessCerts: [], straysCerts: [],
  settlement, claims,
};

const openings = await pb.deriveClaimOpenings(pub.claims, beacon);
const checks = api.checkPublicAuction(pub, { claimOpenings: openings });
const errors = checks.filter(c => c.error);
console.log("derived owner from forged memo:", openings.get(0)?.slice(0, 16) + "...");
console.log("expected owner              :", owner.public_hex.slice(0, 16) + "...");
console.log("errors with FORGED claim    :", errors.length ? errors.map(c => `${c.id}: ${c.error}`).join(" | ") : "none");
console.log(errors.length === 0 ? "PASS g-forged-claim-accepted" : "FAIL g-forged-claim-accepted");
const forgedAccepted = errors.length === 0;

// control: tampered signature must be refused
const bad = { ...pub, claims: [{ ...pub.claims[0], owner_sig: owner_sig.slice(0, 126) + "00" }] };
const badChecks = api.checkPublicAuction(bad, { claimOpenings: openings });
const badErr = badChecks.filter(c => c.error && c.id === "claims");
console.log(badErr.length === 1 ? "PASS g-forged-claim-control (tampered sig refused)" : `FAIL control: ${JSON.stringify(badErr)}`);

// ---- R23 item 1 controls: the witness-certified strays statement -------------------------------
// The strays certificate is an INPUT fixture (what witnesses publish after their own scans), hand-built
// exactly as witness/index.ts defines it: Ed25519 over "benzo-strays-v1" || canonical JSON of the
// statement, by keys of the manifest-pinned witness set (q_w = 2 of 2).
const edRaw = (k) => ({
  private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
  public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
});
const edPrivate = (h) => ({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(h, "hex")]), type: "pkcs8", format: "der" });
const W = [edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519"))];
const signStrays = (st, w) => ({ witness: w.public_hex, signature: edSign(null, Buffer.concat([Buffer.from("benzo-strays-v1"), schema.jsonBytes(st)]), edPrivate(w.private_hex)).toString("hex") });

const manifestSigner = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
const witnessSet = schema.signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: W.map(w => w.public_hex) }, manifestSigner);
const manifest2 = { ...manifest, witness_set_hash: schema.hash(schema.jsonBytes(witnessSet)) };
const packet2 = schema.signRecord(manifest2, manifestSigner);
const memo_sha256 = createHash("sha256").update(memo).digest("hex");
const statement = { version: 1, auction_id: auctionId, strays: [{ party, memo_sha256, value_zats: "1000" }] };
const certified = {
  ...pub, signer: packet2.signer, manifestPacket: packet2, manifest: manifest2, manifest_hash: schema.hash(Buffer.from(packet2.bytes, "base64")),
  witnessSet, straysCerts: [{ statement, signatures: W.map(w => signStrays(statement, w)) }],
};
const claimErrors = (p) => api.checkPublicAuction(p, { claimOpenings: openings }).filter(c => c.error && c.id === "claims");

const okCertified = claimErrors(certified);
console.log(okCertified.length === 0 ? "PASS r23-1-certified-claim-accepted (claim bound to the witnesses' scan)" : `ERROR r23-1-certified-claim-accepted ${JSON.stringify(okCertified)}`);

const wrongParty = { ...certified, straysCerts: [{ statement: { ...statement, strays: [{ ...statement.strays[0], party: `deposit:${"ab".repeat(32)}:ironwood:0` }] }, signatures: W.map(w => signStrays({ ...statement, strays: [{ ...statement.strays[0], party: `deposit:${"ab".repeat(32)}:ironwood:0` }] }, w)) }] };
const wrongErr = claimErrors(wrongParty);
console.log(wrongErr.length === 1 && /certified strays statement/.test(wrongErr[0].error) ? "PASS r23-1-wrong-party-refused" : `ERROR r23-1-wrong-party-refused ${JSON.stringify(wrongErr)}`);

const oneSig = { ...certified, straysCerts: [{ statement, signatures: [signStrays(statement, W[0])] }] };
const quorumErr = claimErrors(oneSig);
console.log(quorumErr.length === 1 && /strays witness quorum/.test(quorumErr[0].error) ? "PASS r23-1-quorum-refused" : `ERROR r23-1-quorum-refused ${JSON.stringify(quorumErr)}`);

const tamperedCertified = { ...certified, claims: [{ ...certified.claims[0], owner_sig: owner_sig.slice(0, 126) + "00" }] };
const tamperedErr = claimErrors(tamperedCertified);
console.log(tamperedErr.length === 1 && /owner signature/.test(tamperedErr[0].error) ? "PASS r23-1-tampered-sig-certified" : `ERROR r23-1-tampered-sig-certified ${JSON.stringify(tamperedErr)}`);

// ---- the writer: shipped `benzo witness strays` builds + signs the statement from its own scan -------
// The witness's scan is a benzo-scan-shaped notes file (the stray carrying the claim's memo); the command
// signs it with its own witness key and records the certificate in the public document. Its output must be
// exactly the statement the verifier accepts above.
const WORK = path.join(ROOT, "tmp/g-work"), STATE2 = path.join(WORK, "state"), REPO = path.join(WORK, "repo");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(path.join(STATE2, "witness"), { recursive: true });
mkdirSync(path.join(WORK, "public"), { recursive: true });
execFileSync("git", ["init", "-q"], { cwd: (mkdirSync(REPO, { recursive: true }), REPO) });
writeFileSync(path.join(REPO, ".env"), "# fixture: the repro passes BNZ_STATE_DIR in the environment\n");
writeFileSync(path.join(STATE2, "witness", "w0.key"), W[0].private_hex, { mode: 0o600 });
writeFileSync(path.join(STATE2, "witness", "w1.key"), W[1].private_hex, { mode: 0o600 });
const notesFile = path.join(WORK, "notes.jsonl");
writeFileSync(notesFile, JSON.stringify({ txid: createHash("sha256").update("attacker-tx").digest("hex"), height: 100, pool: "ironwood", address: manifest2.deposit_addresses[0], action_index: 0, diversifier_index: "0", value_zats: 1000, memo_hex, spent_in_txid: null }) + "\n");
writeFileSync(path.join(WORK, "public", "auction.json"), JSON.stringify({ version: 1, auction_id: auctionId, signer: packet2.signer, manifest: packet2, state: "REFUNDING", receipts: [], witness_set: witnessSet }));
const straysRun = spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), "witness", "strays", "--dir", path.join(WORK, "public"), "--signer", packet2.signer, "--key", path.join(STATE2, "witness", "w1.key"), "--notes", notesFile],
  { cwd: REPO, env: { ...process.env, BNZ_STATE_DIR: STATE2 }, encoding: "utf8", maxBuffer: 64 << 20 });
const straysRun0 = spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), "witness", "strays", "--dir", path.join(WORK, "public"), "--signer", packet2.signer, "--key", path.join(STATE2, "witness", "w0.key"), "--notes", notesFile],
  { cwd: REPO, env: { ...process.env, BNZ_STATE_DIR: STATE2 }, encoding: "utf8", maxBuffer: 64 << 20 });
if (straysRun.status === 0 && straysRun0.status === 0) {
  const written = JSON.parse(readFileSync(path.join(WORK, "public", "auction.json"), "utf8")).strays_cert;
  const entry = written?.[0]?.statement?.strays?.[0];
  const fed = claimErrors({ ...certified, straysCerts: written });
  const ok = written?.length === 2 && entry?.party === party && entry?.memo_sha256 === memo_sha256 && entry?.value_zats === "1000" && fed.length === 0;
  console.log(ok ? "PASS r23-1-witness-strays-sign (q_w witnesses sign their own scans; the certificate is what the verifier accepts)" : `ERROR r23-1-witness-strays-sign ${JSON.stringify({ entry, fed })}`);
} else {
  console.log(`ERROR r23-1-witness-strays-sign command refused: ${(straysRun0.stderr || straysRun0.stdout || straysRun.stderr || straysRun.stdout).trim().slice(-300)}`);
}

console.log(forgedAccepted ? "RESULT FORGED-CLAIM-ACCEPTED (G1 open)" : "RESULT FORGED-CLAIM-REFUSED (G1 fixed)");
process.exitCode = forgedAccepted ? 1 : 0;
