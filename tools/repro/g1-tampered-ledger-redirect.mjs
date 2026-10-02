// source: benzo-sol-g/tests/g1-tampered-ledger-redirect.mjs (Reviewer G lab probe), retargeted at this checkout (root path only).
// Reviewer G test 1 — Gate W (envelope-authenticated destinations) pivots on coordinator-mutable data.
//
// Claim under test: settle/cli.ts destinations() (the signer-side destination decision for every PCZT)
// validates the envelope against `a = auction()` — the PRIVATE ledger at BNZ_STATE_DIR/auction/<id>.json —
// whose `opened` and `envelopes` fields the coordinator writes throughout the auction (admit/open/publish)
// and which is NEVER pinned, hashed, or compared against the published document or a fresh tle decryption.
// A coordinator that rewrites those two fields after R redirects any bid's refund to its own UA while
// plan.ts (which reads the PUBLISHED doc + fresh decryption) and public `benzo verify` still pass.
//
// Run: node tests/g1-tampered-ledger-redirect.mjs
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (b) => createHash("sha256").update(b).digest("hex");

const { generateEnvelopeKey, generateOwnerKey, sealEnvelope, signEnvelope, settlementCommitment } =
  await import(path.join(ROOT, "envelope/dist/index.mjs"));
const { envelopeRecipient, validEnvelope } = await import(path.join(ROOT, "settle/dist/envelopes.mjs"));

const auctionId = hash("g1-auction");
const manifest = { bytes: Buffer.from(JSON.stringify({ auction_id: auctionId })).toString("base64") };
const ciphertextHash = hash("g1-bid-ciphertext"); // frozen leaf's ciphertext hash — public, fixed at freeze
const depositAddress = "utest1g1" + hash("g1-deposit").slice(0, 44);

// The bidder's genuine material: one-time owner key inside the tlock-sealed bid, envelope sealed to the
// per-auction key with the bidder's true refund UA.
const bidderOwner = generateOwnerKey();
const bidderNonce = hash("g1-nonce").slice(0, 32);
const envelopeKey = generateEnvelopeKey(); // per-auction key; private half pinned to each signer at settle init
const bidderUa = "utest1redacted";
const bidderEnvelopeCt = sealEnvelope(bidderUa, envelopeKey.public_hex);
const bidderCommitment = settlementCommitment(bidderNonce, bidderEnvelopeCt);
const bidderSig = signEnvelope(bidderOwner, auctionId, ciphertextHash, bidderEnvelopeCt);

const bidPt = (nonce, owner, commitment) => {
  const pt = Buffer.alloc(128);
  Buffer.from(nonce, "hex").copy(pt, 45);
  Buffer.from(owner.public_hex ?? owner, "hex").copy(pt, 61);
  Buffer.from(commitment, "hex").copy(pt, 93);
  return pt.toString("hex");
};

// What the ledger looks like when honest (this is what plan.ts ALSO sees via the published doc, and what
// public `benzo verify` checks against its own fresh tlock-js decryption — both pass on the genuine data).
const genuineLedger = {
  manifest,
  frozen: { leaves: [{ leaf_index: 0, ciphertext_hash: ciphertextHash, deposit: { address: depositAddress } }] },
  opened: [{ leaf_index: 0, plaintext_hex: bidPt(bidderNonce, bidderOwner.public_hex, bidderCommitment) }],
  envelopes: [{ ciphertext_hash: ciphertextHash, envelope_ct: bidderEnvelopeCt, owner_sig: bidderSig }],
};

// What the coordinator writes into BNZ_STATE_DIR/auction/<id>.json after R: SAME leaf ciphertext hash,
// but the opened plaintext's owner key and settlement commitment are swapped (fields the coordinator can
// rewrite because nothing pins this file), plus a matching envelope record sealed to the SAME public
// envelope key — sealing needs only the PUBLIC half — containing the operator's own UA.
const attackerOwner = generateOwnerKey();
const operatorUa = "utest1redacted";
const attackerEnvelopeCt = sealEnvelope(operatorUa, envelopeKey.public_hex);
const attackerCommitment = settlementCommitment(bidderNonce, attackerEnvelopeCt);
const attackerSig = signEnvelope(attackerOwner, auctionId, ciphertextHash, attackerEnvelopeCt);
const tamperedLedger = {
  ...genuineLedger,
  opened: [{ leaf_index: 0, plaintext_hex: bidPt(bidderNonce, attackerOwner.public_hex, attackerCommitment) }],
  envelopes: [{ ciphertext_hash: ciphertextHash, envelope_ct: attackerEnvelopeCt, owner_sig: attackerSig }],
};

const signerKeyHex = envelopeKey.private_hex;
const fromGenuine = envelopeRecipient(genuineLedger, 0, signerKeyHex, null);
const fromTampered = envelopeRecipient(tamperedLedger, 0, signerKeyHex, null);

console.log("genuine ledger  -> destination:", fromGenuine);
console.log("tampered ledger -> destination:", fromTampered);
console.log("validEnvelope accepts the tampered record:", validEnvelope(tamperedLedger, 0) !== null);

let ok = true;
if (fromGenuine !== bidderUa) { console.error("FAIL: genuine ledger did not resolve to the bidder UA"); ok = false; }
if (fromTampered !== operatorUa) { console.error("FAIL: tampered ledger did not resolve to the operator UA"); ok = false; }
if (validEnvelope(tamperedLedger, 0) === null) { console.error("FAIL: tampered record rejected"); ok = false; }

// The two docs differ ONLY in coordinator-writable ledger fields (opened[i].plaintext_hex owner/commitment
// bytes and envelopes[i]); the frozen leaf, its ciphertext hash, the manifest and the envelope key are
// byte-identical — i.e. every artifact that IS pinned (routing, envelope key, published doc) is untouched.
console.log(ok
  ? "\nCONFIRMED: the signer-side destination decision flips from the bidder's UA to the operator's UA"
    + " by rewriting only BNZ_STATE_DIR/auction/<id>.json (opened/envelopes), which nothing pins or"
    + " re-derives — settle/cli.ts destinations() reads exactly this file."
  : "");
process.exit(ok ? 0 : 1);
