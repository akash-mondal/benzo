// source: benzo-sol-g/tests/g2-envelope-crash-not-exception.mjs (Reviewer G lab probe), retargeted at this checkout (root path only).
// Reviewer G test 2 — bids with malformed or undecryptable envelope records CRASH settlement instead of
// going to the exception queue; a single malicious (or mistaken) bidder can wedge every refund in the vault.
//
// plan.ts: `if(published&&party.startsWith("leaf:")&&!validEnvelope(src,...))exceptions.push(row)` — the
// exception queue is reached only when validEnvelope RETURNS FALSE. Cases (a),(b),(c) below never return
// false: validEnvelope throws (plan exits 1) or passes and openDestination throws later in
// settle/cli.ts destinations() (PCZT create and every signer check exit 1). Intake (clear/auction-cli.ts
// admit) only checks /^[0-9a-f]+$/ and /^[0-9a-f]{128}$/ — all three records below are admitted verbatim.
//
// Run: node tests/g2-envelope-crash-not-exception.mjs
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (b) => createHash("sha256").update(b).digest("hex");

const { generateEnvelopeKey, generateOwnerKey, sealEnvelope, signEnvelope, settlementCommitment } =
  await import(path.join(ROOT, "envelope/dist/index.mjs"));
const { validEnvelope, envelopeRecipient } = await import(path.join(ROOT, "settle/dist/envelopes.mjs"));

const auctionId = hash("g2-auction");
const manifest = { bytes: Buffer.from(JSON.stringify({ auction_id: auctionId })).toString("base64") };
const ciphertextHash = hash("g2-bid-ct");
const key = generateEnvelopeKey();
const owner = generateOwnerKey();
const nonce = hash("g2-nonce").slice(0, 32);
const shieldedUa = "utest1redacted";
const pt = (commitment) => {
  const p = Buffer.alloc(128);
  Buffer.from(nonce, "hex").copy(p, 45);
  Buffer.from(owner.public_hex, "hex").copy(p, 61);
  Buffer.from(commitment, "hex").copy(p, 93);
  return p.toString("hex");
};
const doc = (envelopeCt, sig) => ({
  manifest,
  frozen: { leaves: [{ leaf_index: 0, ciphertext_hash: ciphertextHash, deposit: { address: "utest1g2" } }] },
  opened: [{ leaf_index: 0, plaintext_hex: pt(settlementCommitment(nonce, envelopeCt)) }],
  envelopes: [{ ciphertext_hash: ciphertextHash, envelope_ct: envelopeCt, owner_sig: sig }],
});

const show = (label, fn) => {
  try { const r = fn(); console.log(`${label}: returned ${JSON.stringify(r)?.slice(0, 60)}`); }
  catch (e) { console.log(`${label}: THROWS "${e.message}"`); }
};

// (a) odd-length hex envelope_ct — passes intake regex /^[0-9a-f]+$/; no valid owner_sig is even needed:
// verifyEnvelope throws inside ownerBinding (raw(ct,0) requires even length) before the signature check.
const oddCt = "ababababc";
const oddSig = "ab".repeat(64); // admitted by intake's /^[0-9a-f]{128}$/; never reached
show("a1) intake-shape check (admit)      ", () => /^[0-9a-f]+$/.test(oddCt) && /^[0-9a-f]{128}$/.test(oddSig));
show("a2) validEnvelope (plan exception?)", () => validEnvelope(doc(oddCt, oddSig), 0));
show("a3) envelopeRecipient (signer/dest)", () => envelopeRecipient(doc(oddCt, oddSig), 0, key.private_hex, null));

// (b) even-length, well-formed record, but sealed to a key the signers do not hold (or the operator
// key-swapped envelope_pubkey at bid time): validEnvelope PASSES (plan => obligation, not exception),
// openDestination throws at PCZT creation / signer check time.
const wrongKey = generateEnvelopeKey();
const wrongCt = sealEnvelope(shieldedUa, wrongKey.public_hex);
const wrongSig = signEnvelope(owner, auctionId, ciphertextHash, wrongCt);
show("b1) validEnvelope (plan exception?)", () => validEnvelope(doc(wrongCt, wrongSig), 0));
show("b2) envelopeRecipient (signer/dest)", () => envelopeRecipient(doc(wrongCt, wrongSig), 0, key.private_hex, null));

// (c) transparent destination sealed to the RIGHT key. The bidder's sealEnvelope refuses t-addrs, but the
// sealed-box format needs no secret cooperation — anyone with the public envelope key can build a ciphertext
// that decrypts (under the signers' key) to a t-addr (library format: eph_pk || nonce || ChaCha20-Poly1305,
// key = SHA256("benzo-envelope-v1"||shared||ephPub||recipientPub), nonce = SHA256(shared||ephPub)[:12]).
const tAddr = "tmEZPFPFmP3nJnMH1mzf5uTQWaUbVMdMYdV37wnM"; // testnet t-addr, base58check-validated by the shipped classifier
const { createCipheriv, createDiffieHellman: _unused, diffieHellman, createPublicKey, createPrivateKey } = await import("node:crypto");
const X_PUB = Buffer.from("302a300506032b656e032100", "hex"), X_PRIV = Buffer.from("302e020100300506032b656e04220420", "hex");
const hex = (b) => Buffer.from(b).toString("hex");
let tCt, tSig;
try {
  const eph = (await import("node:crypto")).generateKeyPairSync("x25519");
  const ephPub = hex(eph.publicKey.export({ type: "spki", format: "der" }).subarray(12));
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey({ key: Buffer.concat([X_PUB, Buffer.from(key.public_hex, "hex")]), type: "spki", format: "der" }) });
  const dk = (await import("node:crypto")).createHash("sha256").update("benzo-envelope-v1").update(shared).update(Buffer.from(ephPub, "hex")).update(Buffer.from(key.public_hex, "hex")).digest();
  const nonce = (await import("node:crypto")).createHash("sha256").update(shared).update(Buffer.from(ephPub, "hex")).digest().subarray(0, 12);
  const payload = Buffer.alloc(512); payload.writeUInt16BE(tAddr.length, 0); Buffer.from(tAddr, "utf8").copy(payload, 2);
  const cipher = createCipheriv("chacha20-poly1305", dk, nonce, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  tCt = hex(Buffer.concat([Buffer.from(ephPub, "hex"), nonce, body]));
  tSig = signEnvelope(owner, auctionId, ciphertextHash, tCt);
} catch (e) { console.log("c0) building t-addr ciphertext:", e.message); }
if (tCt) {
  show("c1) validEnvelope (plan exception?)", () => validEnvelope(doc(tCt, tSig), 0));
  show("c2) envelopeRecipient (signer/dest)", () => envelopeRecipient(doc(tCt, tSig), 0, key.private_hex, null));
}
console.log(`
In all three cases the row is NOT exception-queued by settle/plan.ts (validEnvelope neither returns false
nor is the decryptability ever probed there); the throw escapes to the process boundary, so ONE such bid
halts the entire settlement (all refunds, the seller payout, stranded in the FROST vault) until someone
edits state by hand.`);
