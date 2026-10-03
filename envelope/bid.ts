// The 128-byte bid plaintext layout (docs/PHASE-1.md section 6) with real owner material instead of Phase 1's
// random bytes: owner_pubkey is the bid's one-time Ed25519 key (threat #38) and settlement_commitment is the
// independently salted commitment to the settlement envelope (threat #7, #32). The layout itself never changes.
import { randomBytes } from "node:crypto";
import { requireThat } from "../manifest/schema";
import { generateOwnerKey, sealEnvelope, sealEnvelopePayload, settlementCommitment, signEnvelope, type Deliver, type OwnerKey } from "./index";

export type BidFields = { auction_id: string; price_zats: bigint; quantity: number; nonce_hex: string; owner_public_hex: string; settlement_commitment_hex: string };
export type SealedBid = {
  plaintext_hex: string; nonce_hex: string; owner: OwnerKey; settlement_commitment_hex: string;
  envelope_ct_hex: string; ciphertext_hash_hex: string; owner_sig_hex: string;
};

export function buildBidPlaintext(f: BidFields): Buffer {
  const pt = Buffer.alloc(128);
  requireThat(/^[0-9a-f]{64}$/.test(f.auction_id) && f.price_zats >= 0n && f.price_zats < 2n ** 64n && Number.isInteger(f.quantity) && f.quantity >= 0 && f.quantity < 2 ** 32, "bid fields");
  const nonce = Buffer.from(f.nonce_hex, "hex"), owner = Buffer.from(f.owner_public_hex, "hex"), commitment = Buffer.from(f.settlement_commitment_hex, "hex");
  requireThat(nonce.length === 16 && owner.length === 32 && commitment.length === 32, "owner material lengths");
  pt.writeUInt8(0, 0);
  Buffer.from(f.auction_id, "hex").copy(pt, 1);
  pt.writeBigUInt64BE(f.price_zats, 33);
  pt.writeUInt32BE(f.quantity, 41);
  nonce.copy(pt, 45); owner.copy(pt, 61); commitment.copy(pt, 93);
  return pt;
}

// Client-side bid preparation: real owner key, sealed settlement envelope (destination never leaves the client in
// plaintext), salted commitment, then the plaintext for the sealer to tlock. `envelope_public_hexs` is the signed
// manifest's `envelope_keys` (§4: the content key is wrapped to each signer's key in its own stanza). Callers tlock
// plaintext_hex to round R and then call bindSealedBid to attach the owner signature over the resulting ciphertext hash.
// R19 item 1: `deliver` (the cross-chain destination) rides the same envelope as payload v2; `destination_ua`
// stays the mandatory shielded refund (for the product's Zcash settlement).
export function prepareBid(args: { auction_id: string; price_zats: bigint; quantity: number; destination_ua?: string; deliver?: Deliver; envelope_public_hexs?: string[] }): Omit<SealedBid, "ciphertext_hash_hex" | "owner_sig_hex"> {
  const owner = generateOwnerKey(), nonce_hex = randomBytes(16).toString("hex");
  let envelope_ct_hex = "";
  if (args.destination_ua !== undefined) {
    requireThat(Array.isArray(args.envelope_public_hexs) && args.envelope_public_hexs.length > 0 &&
      args.envelope_public_hexs.every(h => typeof h === "string" && /^[0-9a-f]{64}$/.test(h)), "envelope public key");
    envelope_ct_hex = args.deliver !== undefined
      ? sealEnvelopePayload({ refund: args.destination_ua, deliver: args.deliver }, args.envelope_public_hexs!)
      : sealEnvelope(args.destination_ua, args.envelope_public_hexs!);
  } else {
    requireThat(args.deliver === undefined, "envelope deliver without a refund destination");
  }
  const settlement_commitment_hex = settlementCommitment(nonce_hex, envelope_ct_hex);
  const plaintext_hex = buildBidPlaintext({ auction_id: args.auction_id, price_zats: args.price_zats, quantity: args.quantity, nonce_hex, owner_public_hex: owner.public_hex, settlement_commitment_hex }).toString("hex");
  return { plaintext_hex, nonce_hex, owner, settlement_commitment_hex, envelope_ct_hex };
}

export function bindSealedBid(prep: Omit<SealedBid, "ciphertext_hash_hex" | "owner_sig_hex">, auction_id: string, ciphertext_hash_hex: string): SealedBid {
  return { ...prep, ciphertext_hash_hex, owner_sig_hex: signEnvelope(prep.owner, auction_id, ciphertext_hash_hex, prep.envelope_ct_hex) };
}
