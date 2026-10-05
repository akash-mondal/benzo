// Settlement envelopes (gate W): the bidder's refund/delivery destination sealed client-side to each custody
// signer's X25519 envelope key, and authenticated by the bid's one-time owner key (Ed25519 over auction_id,
// ciphertext_hash, envelope_ct — threat model #7, #32, #38). Envelope ciphertexts are public; plaintexts never are.
// The owner signature and the salted settlement commitment bind the whole envelope.
//
// Multi-recipient sealed box (docs/design/phase5-part1-live.md §4): a random 32-byte content key encrypts the
// fixed 512-byte padded plaintext (ChaCha20-Poly1305 IETF) and is wrapped (age-style stanza per recipient) to
// each signer's X25519 public key with crypto_box_seal. Bytes (R10 item 1):
//
//   "benzo-envelope-v2" (17) || n (1..3) || n * (recipient_pk 32 || sealed_key 80) || key_commit (32) || nonce 12 || body (528)
//
// The header (magic || n || stanzas || key_commit) is the AEAD associated data, so any stanza splice breaks every
// recipient's open — the same binding age applies to its header MAC. key_commit =
// crypto_generichash(32, content_key, key = "benzo-envelope-v2-kc" zero-padded to libsodium's
// crypto_generichash_KEYBYTES) is recomputed by openEnvelope after unwrapping and refused on mismatch
// (`envelope key commitment`): ChaCha20-Poly1305 is not key-committing, so without this field a hostile sealer
// could wrap different content keys for different signers and make them open different destinations (R10).
// All cryptography comes from libsodium (crypto_box_seal per stanza, crypto_aead_chacha20poly1305_ietf for the
// body, crypto_generichash/BLAKE2b for the key commitment — see docs/AUDITS.md); no hand-written key derivation.
// The recipient set is the signed manifest's `envelope_keys` (the three signers).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import sodium from "libsodium-wrappers";
import { canonical, jsonBytes, requireThat } from "../manifest/schema";
import { requireShieldedDestination } from "./destination";
import { type Deliver, type DeliverInput, requireDeliver } from "./deliver";
await sodium.ready;

// R19 item 1: the envelope payload is v2 canonical JSON `{"v":2,"refund":…,"deliver":{…}}` inside the
// same fixed padded plaintext; a plain-UA plaintext (v1) is still read as `{refund}`. `refund` is
// mandatory and shielded-only; `deliver` is the cross-chain destination (validated per chain at seal
// and at every use — `envelope/deliver.ts`).
export interface EnvelopePayload { refund: string; deliver?: DeliverInput }
export type { Deliver, DeliverInput } from "./deliver";

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
const COMMIT_BYTES = 32; // key_commit (R10 item 1), inside the header / associated data
const NONCE_BYTES = 12;
// Fixed 512-byte plaintext (R4 item 3): u16be payload length || payload || zero pad, so every envelope ciphertext
// has the same length and reveals nothing about the receiver type. openEnvelope strips and checks the padding.
export const ENVELOPE_PT_BYTES = 512;
// R10 item 1: the fixed envelope-ciphertext byte length for n = 3 (the production recipient set).
export const ENVELOPE_CT_BYTES_N3 = MAGIC.length + 1 + STANZA_BYTES * 3 + COMMIT_BYTES + NONCE_BYTES + ENVELOPE_PT_BYTES + 16;
// R12 item 1: the pre-v2 sealed box (32 || 12 || 512 || 16 = 572 bytes). It is accepted as a published record
// only where the signed manifest pins no `envelope_keys` (the Phase 2–4 evidence); nowhere else.
export const ENVELOPE_CT_BYTES_PRE_V2 = 32 + 12 + ENVELOPE_PT_BYTES + 16;
// key_commit key (R10 item 1): the 20-byte ASCII label zero-padded with `32 - label.length` to exactly
// libsodium's crypto_generichash_KEYBYTES. The head review of 79aed9e found the padding computed as
// `32 - 19`, which made KC_KEY 33 bytes; the key is exactly KEYBYTES, asserted here (fix before any live
// envelope exists — none had been sealed under the wrong key).
const KC_LABEL = Buffer.from("benzo-envelope-v2-kc");
const KC_KEY = Buffer.concat([KC_LABEL, Buffer.alloc(sodium.crypto_generichash_KEYBYTES - KC_LABEL.length)]);
requireThat(KC_KEY.length === sodium.crypto_generichash_KEYBYTES, "envelope kc key");
function keyCommit(contentKey: Uint8Array): Buffer {
  return Buffer.from(sodium.crypto_generichash(32, contentKey, KC_KEY));
}
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
function sealPadded(plaintext: string, recipientPublicHexes: string[]): string {
  requireThat(Array.isArray(recipientPublicHexes) && recipientPublicHexes.length >= 1 && recipientPublicHexes.length <= 3, "envelope recipients");
  requireThat(new Set(recipientPublicHexes).size === recipientPublicHexes.length, "duplicate envelope recipient");
  const recipients = recipientPublicHexes.map(h => raw(h, 32));
  const contentKey = sodium.randombytes_buf(32); // random per envelope, never derived from the recipients
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const stanzas = Buffer.concat(recipients.map(pk => Buffer.concat([pk, sodium.crypto_box_seal(contentKey, pk)])));
  const header = Buffer.concat([MAGIC, Buffer.from([recipients.length]), stanzas, keyCommit(contentKey)]); // AEAD associated data
  const body = Buffer.from(sodium.crypto_aead_chacha20poly1305_ietf_encrypt(padPlaintext(plaintext), header, null, nonce, contentKey));
  return hex(Buffer.concat([header, nonce, body]));
}
// v1: a plain shielded-UA plaintext (pre-R19 callers and evidence).
export function sealEnvelope(plaintext: string, recipientPublicHexes: string[], network: string): string {
  requireShieldedDestination(plaintext, network);
  return sealPadded(plaintext, recipientPublicHexes);
}
// R19 item 1: seal the v2 payload. The plaintext is the canonical JSON of {v:2, refund, deliver?}
// (manifest/schema `canonical`), inside the unchanged fixed padded plaintext. R25 item 1: the
// deliver's `salt` is generated HERE — 32 fresh random bytes inside the sealed envelope, never
// caller-supplied — so only parties who open the envelope know it.
export function sealEnvelopePayload(payload: EnvelopePayload, recipientPublicHexes: string[], network: string): string {
  requireThat(payload !== null && typeof payload === "object" && !Array.isArray(payload), "envelope payload");
  requireShieldedDestination(payload.refund, network);
  const doc: Record<string, unknown> = { v: 2, refund: payload.refund };
  // R25 item 3: the railgun kind has no escrow adapter and is not shipped — refused at `bid seal` outright
  if (payload.deliver !== undefined) requireThat(payload.deliver.kind !== "railgun", "deliver.kind railgun not supported");
  if (payload.deliver !== undefined) doc.deliver = requireDeliver({ ...payload.deliver, salt: randomBytes(32).toString("hex") });
  return sealPadded(canonical(doc), recipientPublicHexes);
}
// The X25519 public key of an envelope recipient key (the same derivation openPadded matches against) —
// used by `xchain attest` to identify which manifest envelope_keys a --envelope-key file is (R25 item 2).
export function envelopePublicKey(recipientPrivateHex: string): string {
  return hex(Buffer.from(sodium.crypto_scalarmult_base(raw(recipientPrivateHex, 32))));
}

// §11 H7 (host custody): a whole candidate PCZT sealed by the building host to ONE signer's pinned envelope key, so
// the coordinator relays it without reading the refund recipients in it. crypto_box_seal (libsodium) takes any
// length; the open refuses any tampered or foreign blob.
export function sealBlob(bytes: Buffer, recipientPublicHex: string): Buffer {
  return Buffer.from(sodium.crypto_box_seal(bytes, raw(recipientPublicHex, 32)));
}
export function openBlob(sealed: Buffer, recipientPrivateHex: string): Buffer {
  const sk = raw(recipientPrivateHex, 32);
  return Buffer.from(sodium.crypto_box_seal_open(sealed, sodium.crypto_scalarmult_base(sk), sk));
}

// The recipient X25519 public keys of an envelope, in stanza order (R10 item 1: product validation requires
// them to be exactly the signed manifest's `envelope_keys`, in order). Throws on a malformed envelope.
export function envelopeRecipients(envelopeCtHex: string): string[] {
  const b = raw(envelopeCtHex, 0);
  requireThat(b.length > MAGIC.length + 1 + COMMIT_BYTES, "envelope length");
  requireThat(b.subarray(0, MAGIC.length).equals(MAGIC), "envelope magic");
  const n = b[MAGIC.length];
  requireThat(n >= 1 && n <= 3, "envelope stanzas");
  const headerLen = MAGIC.length + 1 + STANZA_BYTES * n + COMMIT_BYTES;
  requireThat(b.length === headerLen + NONCE_BYTES + ENVELOPE_PT_BYTES + 16, "envelope length");
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(hex(b.subarray(MAGIC.length + 1 + i * STANZA_BYTES, MAGIC.length + 1 + i * STANZA_BYTES + 32)));
  return out;
}
// R12 item 1 (Reviewer R F-2/F-4): the one shared published-record rule, used by intake
// (clear/auction-cli.ts admit), settlement (settle/envelopes.ts validEnvelope) and `benzo verify`. When the
// signed manifest pins `envelope_keys`, a record is valid only as the exact v2 shape for n = 3 — the fixed
// length, the magic, and stanza recipients equal to `envelope_keys` in order — so a substituted or truncated
// recipient set can never be admitted, published or certified. When the manifest pins no keys (the pre-v2
// Phase 2–4 evidence), only the pre-v2 572-byte sealed box is accepted. Total: a malformed record is invalid,
// never a throw.
export function envelopeRecordValid(record: { envelope_ct?: unknown; owner_sig?: unknown }, envelope_keys: unknown): boolean {
  try {
    const ct = record?.envelope_ct, sig = record?.owner_sig;
    if (typeof ct !== "string" || !/^[0-9a-f]+$/.test(ct) || ct.length % 2 !== 0) return false;
    if (typeof sig !== "string" || !/^[0-9a-f]{128}$/.test(sig)) return false;
    const b = Buffer.from(ct, "hex");
    if (!Array.isArray(envelope_keys)) return b.length === ENVELOPE_CT_BYTES_PRE_V2;
    if (b.length !== ENVELOPE_CT_BYTES_N3) return false;
    const recipients = envelopeRecipients(ct);
    return recipients.length === envelope_keys.length && recipients.every((k, i) => k === envelope_keys[i]);
  } catch {
    return false;
  }
}
function openPadded(envelopeCtHex: string, recipientPrivateHex: string): string {
  const b = raw(envelopeCtHex, 0);
  requireThat(b.length > MAGIC.length + 1 + COMMIT_BYTES, "envelope length");
  requireThat(b.subarray(0, MAGIC.length).equals(MAGIC), "envelope magic");
  const n = b[MAGIC.length];
  requireThat(n >= 1 && n <= 3, "envelope stanzas");
  const headerLen = MAGIC.length + 1 + STANZA_BYTES * n + COMMIT_BYTES;
  requireThat(b.length === headerLen + NONCE_BYTES + ENVELOPE_PT_BYTES + 16, "envelope length");
  const header = b.subarray(0, headerLen), stanzas = b.subarray(MAGIC.length + 1, headerLen - COMMIT_BYTES);
  const commit = b.subarray(headerLen - COMMIT_BYTES, headerLen);
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
  // R10 item 1: the unwrapped key must be the one the header commits to — a hostile sealer that wraps a
  // different content key into this stanza is refused here, before the body is ever tried.
  requireThat(sodium.memcmp(keyCommit(contentKey), commit), "envelope key commitment");
  let pt: Uint8Array = new Uint8Array(0);
  try {
    pt = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(null, body, header, nonce, contentKey);
  } catch { requireThat(false, "envelope body"); }
  const text = unpadPlaintext(Buffer.from(pt));
  return text;
}
// R19 item 1: read the payload. A plain-UA plaintext (v1) is read as {refund}; a `{`-leading plaintext
// must be exactly the v2 shape. `deliver` is returned unformat-validated — every use runs
// `requireDeliver` (seal did already; a tampered sealer is refused at use, e.g. into the exception queue).
function parseEnvelopePayload(text: string, network: string): EnvelopePayload {
  if (!text.startsWith("{")) {
    requireShieldedDestination(text, network);
    return { refund: text };
  }
  let doc: any;
  try { doc = JSON.parse(text); } catch { requireThat(false, "envelope payload"); doc = null; }
  const keys = doc !== null && typeof doc === "object" && !Array.isArray(doc) ? Object.keys(doc).sort() : null;
  requireThat(
    keys !== null && doc.v === 2 && typeof doc.refund === "string" &&
      (keys.join(",") === "refund,v" || (keys.join(",") === "deliver,refund,v" && doc.deliver !== null && typeof doc.deliver === "object" && !Array.isArray(doc.deliver))),
    "envelope payload v2",
  );
  requireShieldedDestination(doc.refund, network);
  return doc.deliver === undefined ? { refund: doc.refund } : { refund: doc.refund, deliver: doc.deliver as DeliverInput };
}
export function openEnvelopePayload(envelopeCtHex: string, recipientPrivateHex: string, network: string): EnvelopePayload {
  return parseEnvelopePayload(openPadded(envelopeCtHex, recipientPrivateHex), network);
}
export function openEnvelope(envelopeCtHex: string, recipientPrivateHex: string, network: string): string {
  return openEnvelopePayload(envelopeCtHex, recipientPrivateHex, network).refund;
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
