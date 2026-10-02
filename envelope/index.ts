// Settlement envelopes (gate W): the bidder's refund/delivery destination sealed client-side to each custody
// signer's X25519 envelope key, and authenticated by the bid's one-time owner key (Ed25519 over auction_id,
// ciphertext_hash, envelope_ct — threat model #7, #32, #38). Envelope ciphertexts are public; plaintexts never are.
// The owner signature and the salted settlement commitment bind the whole envelope.
//
// Multi-recipient sealed box (docs/design/phase5-part1-live.md §4): a random 32-byte content key encrypts the
// fixed 512-byte padded plaintext (ChaCha20-Poly1305 IETF) and is wrapped (age-style stanza per recipient) to
// each signer's X25519 public key with crypto_box_seal. Bytes:
//
//   "benzo-envelope-v2" (17) || n (1..3) || n * (recipient_pk 32 || sealed_key 80) || nonce 12 || body (528)
//
// The header (magic || n || stanzas) is the AEAD associated data, so any stanza splice breaks every recipient's
// open — the same binding age applies to its header MAC. All cryptography comes from libsodium
// (crypto_box_seal per stanza, crypto_aead_chacha20poly1305_ietf for the body — see docs/AUDITS.md); no
// hand-written key derivation. The recipient set is the signed manifest's `envelope_keys` (the three signers).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import sodium from "libsodium-wrappers";
import { jsonBytes, requireThat } from "../manifest/schema";
import { requireShieldedDestination } from "./destination";
await sodium.ready;

export type OwnerKey = { public_hex: string; private_hex: string };
export type EnvelopeKey = { public_hex: string; private_hex: string };
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const raw = (h: string, n: number) => {
  requireThat(typeof h === "string" && (n === 0 ? h.length % 2 === 0 : h.length === n * 2) && /^[0-9a-f]*$/.test(h), "key/signature hex");
  return Buffer.from(h, "hex");
};

// One-time owner key per bid (threat #38) and per-auction envelope key held by each signer.
export function generateOwnerKey(): OwnerKey {
  const k = generateKeyPairSync("ed25519");
  return { private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
    public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex") };
}
export function ownerPublic(ownerPrivateHex: string): string {
  return createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw(ownerPrivateHex, 32)]), type: "pkcs8", format: "der" }))
    .export({ type: "spki", format: "der" }).subarray(12).toString("hex");
}
export function generateEnvelopeKey(): EnvelopeKey {
  const kp = sodium.crypto_box_keypair();
  return { private_hex: hex(kp.privateKey), public_hex: hex(kp.publicKey) };
}

const MAGIC = Buffer.from("benzo-envelope-v2"); // 17 bytes
const STANZA_BYTES = 32 + 80; // recipient X25519 pk || crypto_box_seal(32-byte content key)
const NONCE_BYTES = 12;
// Fixed 512-byte plaintext (R4 item 3): u16be payload length || payload || zero pad, so every envelope ciphertext
// has the same length and reveals nothing about the receiver type. openEnvelope strips and checks the padding.
export const ENVELOPE_PT_BYTES = 512;
function padPlaintext(plaintext: string): Buffer {
  requireThat(typeof plaintext === "string" && plaintext.length > 0, "envelope plaintext");
  const payload = Buffer.from(plaintext, "utf8");
  requireThat(payload.length <= ENVELOPE_PT_BYTES - 2, "envelope plaintext too long");
  const pt = Buffer.alloc(ENVELOPE_PT_BYTES);
  pt.writeUInt16BE(payload.length, 0);
  payload.copy(pt, 2);
  return pt;
}
function unpadPlaintext(pt: Buffer): string {
  requireThat(pt.length === ENVELOPE_PT_BYTES, "envelope plaintext length");
  const n = pt.readUInt16BE(0);
  requireThat(n > 0 && n <= ENVELOPE_PT_BYTES - 2 && pt.subarray(2 + n).equals(Buffer.alloc(ENVELOPE_PT_BYTES - 2 - n)), "envelope padding");
  return pt.subarray(2, 2 + n).toString("utf8");
}
export function sealEnvelope(plaintext: string, recipientPublicHexes: string[]): string {
  requireShieldedDestination(plaintext);
  requireThat(Array.isArray(recipientPublicHexes) && recipientPublicHexes.length >= 1 && recipientPublicHexes.length <= 3, "envelope recipients");
  requireThat(new Set(recipientPublicHexes).size === recipientPublicHexes.length, "duplicate envelope recipient");
  const recipients = recipientPublicHexes.map(h => raw(h, 32));
  const contentKey = sodium.randombytes_buf(32); // random per envelope, never derived from the recipients
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const stanzas = Buffer.concat(recipients.map(pk => Buffer.concat([pk, sodium.crypto_box_seal(contentKey, pk)])));
  const header = Buffer.concat([MAGIC, Buffer.from([recipients.length]), stanzas]); // AEAD associated data
  const body = Buffer.from(sodium.crypto_aead_chacha20poly1305_ietf_encrypt(padPlaintext(plaintext), header, null, nonce, contentKey));
  return hex(Buffer.concat([header, nonce, body]));
}
export function openEnvelope(envelopeCtHex: string, recipientPrivateHex: string): string {
  const b = raw(envelopeCtHex, 0);
  requireThat(b.length > MAGIC.length + 1, "envelope length");
  requireThat(b.subarray(0, MAGIC.length).equals(MAGIC), "envelope magic");
  const n = b[MAGIC.length];
  requireThat(n >= 1 && n <= 3, "envelope stanzas");
  const headerLen = MAGIC.length + 1 + STANZA_BYTES * n;
  requireThat(b.length === headerLen + NONCE_BYTES + ENVELOPE_PT_BYTES + 16, "envelope length");
  const header = b.subarray(0, headerLen), stanzas = b.subarray(MAGIC.length + 1, headerLen);
  const nonce = b.subarray(headerLen, headerLen + NONCE_BYTES), body = b.subarray(headerLen + NONCE_BYTES);
  const sk = raw(recipientPrivateHex, 32), myPk = Buffer.from(sodium.crypto_scalarmult_base(sk));
  let mine = -1, matches = 0;
  for (let i = 0; i < n; i++) {
    if (stanzas.subarray(i * STANZA_BYTES, i * STANZA_BYTES + 32).equals(myPk)) { mine = i; matches++; }
  }
  requireThat(matches === 1, "envelope recipient"); // the 4th key has no stanza; duplicates are tampering
  let contentKey: Uint8Array = new Uint8Array(0);
  try {
    contentKey = sodium.crypto_box_seal_open(stanzas.subarray(mine * STANZA_BYTES + 32, (mine + 1) * STANZA_BYTES), myPk, sk);
  } catch { requireThat(false, "envelope key wrap"); }
  requireThat(contentKey.length === 32, "envelope key wrap");
  let pt: Uint8Array = new Uint8Array(0);
  try {
    pt = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(null, body, header, nonce, contentKey);
  } catch { requireThat(false, "envelope body"); }
  // Signer side: a destination that is not shielded is refused here too, so a tampered sealer cannot smuggle one in.
  const destination = unpadPlaintext(Buffer.from(pt));
  requireShieldedDestination(destination);
  return destination;
}

// Owner binding over (auction_id, ciphertext_hash, envelope_ct) and the salted public commitment (threat #7/#32).
export function ownerBinding(auctionIdHex: string, ciphertextHashHex: string, envelopeCtHex: string): Buffer {
  return Buffer.concat([Buffer.from("benzo-envelope-v1"), raw(auctionIdHex, 32), raw(ciphertextHashHex, 32), raw(envelopeCtHex, 0)]);
}
export function signEnvelope(owner: OwnerKey, auctionIdHex: string, ciphertextHashHex: string, envelopeCtHex: string): string {
  return sign(null, ownerBinding(auctionIdHex, ciphertextHashHex, envelopeCtHex),
    createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw(owner.private_hex, 32)]), type: "pkcs8", format: "der" })).toString("hex");
}
export function verifyEnvelope(ownerPublicHex: string, auctionIdHex: string, ciphertextHashHex: string, envelopeCtHex: string, signatureHex: string): boolean {
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw(ownerPublicHex, 32)]), type: "spki", format: "der" });
  return verify(null, ownerBinding(auctionIdHex, ciphertextHashHex, envelopeCtHex), key, raw(signatureHex, 64));
}
export function settlementCommitment(nonceHex: string, envelopeCtHex: string): string {
  return createHash("sha256").update(raw(nonceHex, 16)).update(raw(envelopeCtHex, 0)).digest("hex");
}

// Settlement statement (R3 item 7): the bid's one-time owner key signs a canonical JSON body — auction, leaf,
// fill, price, payout/refund txid — that anyone can check against result.json and the chain.
export function statementBinding(body: Record<string, unknown>): Buffer {
  return Buffer.concat([Buffer.from("benzo-settlement-statement-v1"), jsonBytes(body)]);
}
export function signStatement(owner: OwnerKey, body: Record<string, unknown>): string {
  return sign(null, statementBinding(body),
    createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw(owner.private_hex, 32)]), type: "pkcs8", format: "der" })).toString("hex");
}
export function verifyStatement(ownerPublicHex: string, body: Record<string, unknown>, signatureHex: string): boolean {
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw(ownerPublicHex, 32)]), type: "spki", format: "der" });
  return verify(null, statementBinding(body), key, raw(signatureHex, 64));
}
