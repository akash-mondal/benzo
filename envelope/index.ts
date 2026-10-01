// Settlement envelopes (gate W): the bidder's refund/delivery destination sealed client-side to the custody signers'
// per-auction X25519 envelope key, and authenticated by the bid's one-time owner key (Ed25519 over auction_id,
// ciphertext_hash, envelope_ct — threat model #7, #32, #38). Envelope ciphertexts are public; plaintexts never are.
// The owner signature and the salted settlement commitment bind the envelope to the tlock-sealed bid.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, sign, verify } from "node:crypto";
import { requireThat } from "../manifest/schema";
import { requireShieldedDestination } from "./destination";

export type OwnerKey = { public_hex: string; private_hex: string };
export type EnvelopeKey = { public_hex: string; private_hex: string };
const X_PUB = Buffer.from("302a300506032b656e032100", "hex"); // spki prefix for a raw X25519 public key
const X_PRIV = Buffer.from("302e020100300506032b656e04220420", "hex"); // pkcs8 prefix for a raw X25519 private key
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const raw = (h: string, n: number) => {
  requireThat(typeof h === "string" && (n === 0 ? h.length % 2 === 0 : h.length === n * 2) && /^[0-9a-f]*$/.test(h), "key/signature hex");
  return Buffer.from(h, "hex");
};
const xPublic = (h: string) => createPublicKey({ key: Buffer.concat([X_PUB, raw(h, 32)]), type: "spki", format: "der" });
const xPrivate = (h: string) => createPrivateKey({ key: Buffer.concat([X_PRIV, raw(h, 32)]), type: "pkcs8", format: "der" });

// One-time owner key per bid (threat #38) and per-auction envelope key held by each signer.
export function generateOwnerKey(): OwnerKey {
  const k = generateKeyPairSync("ed25519");
  return { private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
    public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex") };
}
export function generateEnvelopeKey(): EnvelopeKey {
  const k = generateKeyPairSync("x25519");
  return { private_hex: hex(k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16)),
    public_hex: hex(k.publicKey.export({ type: "spki", format: "der" }).subarray(12)) };
}

// Sealed box: eph_pk(32) || nacl_nonce(12) || ChaCha20-Poly1305(plaintext), key = SHA256(tag || shared || eph_pk || recipient_pk).
function derive(shared: Buffer, eph: string, recipient: string): Buffer {
  return createHash("sha256").update("benzo-envelope-v1").update(shared).update(raw(eph, 32)).update(raw(recipient, 32)).digest();
}
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
export function sealEnvelope(plaintext: string, recipientPublicHex: string): string {
  requireShieldedDestination(plaintext);
  const eph = generateKeyPairSync("x25519"), ephPub = hex(eph.publicKey.export({ type: "spki", format: "der" }).subarray(12));
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: xPublic(recipientPublicHex) });
  const nonce = createHash("sha256").update(shared).update(ephPub).digest().subarray(0, 12);
  const cipher = createCipheriv("chacha20-poly1305", derive(shared, ephPub, recipientPublicHex), nonce, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(padPlaintext(plaintext)), cipher.final(), cipher.getAuthTag()]);
  return hex(Buffer.concat([raw(ephPub, 32), nonce, ct]));
}
export function openEnvelope(envelopeCtHex: string, recipientPrivateHex: string): string {
  const body = raw(envelopeCtHex, 0);
  requireThat(body.length === 32 + 12 + ENVELOPE_PT_BYTES + 16, "envelope length");
  const ephPub = body.subarray(0, 32).toString("hex"), nonce = body.subarray(32, 44);
  const shared = diffieHellman({ privateKey: xPrivate(recipientPrivateHex), publicKey: xPublic(ephPub) });
  const recipientPub = hex(createPublicKey(xPrivate(recipientPrivateHex)).export({ type: "spki", format: "der" }).subarray(12));
  const decipher = createDecipheriv("chacha20-poly1305", derive(shared, ephPub, recipientPub), nonce, { authTagLength: 16 });
  decipher.setAuthTag(body.subarray(body.length - 16));
  const pt = Buffer.concat([decipher.update(body.subarray(44, body.length - 16)), decipher.final()]);
  // Signer side: a destination that is not shielded is refused here too, so a tampered sealer cannot smuggle one in.
  const destination = unpadPlaintext(pt);
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
