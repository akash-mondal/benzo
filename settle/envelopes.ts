// R6 (Reviewer R F3, gate W): settlement destinations for bids come only from the bid's owner-signed
// envelope, never from operator routing. Each signer resolves a leaf's destination by checking the published
// envelope record against the owner material inside the opened bid (owner_sig over auction_id, ciphertext_hash,
// envelope_ct; the salted settlement commitment over the same ciphertext) and only then opening the envelope
// with its own key. A bid without a valid envelope is not paid here; the plan moves it to the exception queue.
// source: envelope record/public shapes from api/public-auction.ts (Track B), validation rules per
// docs/design/phase5-part1-live.md §4.
import { ENVELOPE_PT_BYTES, openEnvelope, settlementCommitment, verifyEnvelope } from "../envelope";

// R7 item 2 interim (R F-1/F-2 = G4): every envelope is still a single-recipient box, so at most one signer
// could open a given bidder's envelope and gate W2 (every signer independently matches every output) cannot
// hold. Until Track B delivers the multi-recipient envelope format (design phase5-part1-live §4 [B]), an
// envelope destination is refused with this clear error — never paid from an operator-held key — and the
// refund waits in the exception queue for an owner-signed `benzo claim-refund` request (R7 item 4).
export const ENVELOPE_INTERIM_REFUSAL = "multi-recipient envelope format (design §4 [B]) not merged; operator-held keys are not used";

export type EnvelopeRecord = { ciphertext_hash: string; envelope_ct: string; owner_sig: string };

// The single-recipient sealed box is exactly eph_pk(32) || nacl_nonce(12) || ChaCha20-Poly1305(padded
// ENVELOPE_PT_BYTES plaintext + 16-byte tag). R7 item 3 (R F-4 = G3): this fixed shape is enforced at intake
// (clear/auction-cli.ts admit) so a malformed record can never enter a published directory.
export const ENVELOPE_CT_BYTES = 32 + 12 + ENVELOPE_PT_BYTES + 16;
export function envelopeRecordShape(envelopeCtHex: unknown, ownerSigHex: unknown): boolean {
  return typeof envelopeCtHex === "string" && /^[0-9a-f]+$/.test(envelopeCtHex) && envelopeCtHex.length === ENVELOPE_CT_BYTES * 2
    && typeof ownerSigHex === "string" && /^[0-9a-f]{128}$/.test(ownerSigHex);
}

// The authenticated envelope record for one frozen leaf, or null when the bid has no valid matching
// envelope (missing record, unknown ciphertext, malformed record, bad owner signature or mismatched
// settlement commitment). R7 item 3 (R F-4 = G3): this function is total — a malformed, undersized or
// otherwise unverifiable record is "not valid", never a throw, so one bad bid can never abort the plan for
// every other party; settle/plan.ts moves such a leaf to the exception queue.
export function validEnvelope(a: { manifest: any; frozen: any; opened?: any[]; envelopes?: any[] }, leafIndex: number): EnvelopeRecord | null {
  try {
    const leaf = a.frozen?.leaves?.[leafIndex];
    const rec = (a.envelopes ?? []).find((e: any) => e.ciphertext_hash === leaf?.ciphertext_hash) as EnvelopeRecord | undefined;
    const opening = (a.opened ?? []).find((o: any) => o.leaf_index === leafIndex);
    if (!leaf || !rec || !opening || typeof opening.plaintext_hex !== "string" || !/^[0-9a-f]{256}$/.test(opening.plaintext_hex)) return null;
    if (!envelopeRecordShape(rec.envelope_ct, rec.owner_sig)) return null;
    const pt = Buffer.from(opening.plaintext_hex, "hex");
    const owner = pt.subarray(61, 93).toString("hex"), nonce = pt.subarray(45, 61).toString("hex"), commitment = pt.subarray(93, 125).toString("hex");
    const auctionId = JSON.parse(Buffer.from(a.manifest.bytes, "base64").toString("utf8")).auction_id;
    if (!verifyEnvelope(owner, auctionId, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig)) return null;
    if (commitment !== settlementCommitment(nonce, rec.envelope_ct)) return null;
    return rec;
  } catch {
    return null;
  }
}

// The signer's own key opens the authenticated envelope to the bidder's shielded destination, or null when
// the envelope cannot be opened with it (wrong key, corrupted box, or a plaintext that is not a shielded
// destination). Total for the same reason as validEnvelope (R7 item 3).
export function openDestination(rec: EnvelopeRecord, envelopePrivateHex: string): string | null {
  try {
    return openEnvelope(rec.envelope_ct, envelopePrivateHex);
  } catch {
    return null;
  }
}

// The signer-side destination decision for one leaf row: the owner-signed envelope's destination, or null when
// the bid has no valid envelope (the row is never paid — plan moves it to the exception queue). The coordinator's
// pinned fallback is accepted by nothing here; taking it is mutation 5M2's vulnerability (W2).
export function envelopeRecipient(
  a: { manifest: any; frozen: any; opened?: any[]; envelopes?: any[] },
  leafIndex: number,
  envelopePrivateHex: string,
  _coordinatorPinned?: string | null,
): string | null {
  const rec = validEnvelope(a, leafIndex);
  return rec ? openDestination(rec, envelopePrivateHex) : null;
}
