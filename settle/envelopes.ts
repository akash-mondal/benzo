// R6 (Reviewer R F3, gate W): settlement destinations for bids come only from the bid's owner-signed
// envelope, never from operator routing. Each signer resolves a leaf's destination by checking the published
// envelope record against the owner material inside the opened bid (owner_sig over auction_id, ciphertext_hash,
// envelope_ct; the salted settlement commitment over the same ciphertext) and only then opening the envelope
// with its own key. A bid without a valid envelope is not paid here; the plan moves it to the exception queue.
// source: envelope record/public shapes from api/public-auction.ts (Track B), validation rules per
// docs/design/phase5-part1-live.md §4.
import { openEnvelope, settlementCommitment, verifyEnvelope } from "../envelope";

export type EnvelopeRecord = { ciphertext_hash: string; envelope_ct: string; owner_sig: string };

// The authenticated envelope record for one frozen leaf, or null when the bid has no valid matching
// envelope (missing record, unknown ciphertext, bad owner signature or mismatched settlement commitment).
export function validEnvelope(a: { manifest: any; frozen: any; opened?: any[]; envelopes?: any[] }, leafIndex: number): EnvelopeRecord | null {
  const leaf = a.frozen?.leaves?.[leafIndex];
  const rec = (a.envelopes ?? []).find((e: any) => e.ciphertext_hash === leaf?.ciphertext_hash) as EnvelopeRecord | undefined;
  const opening = (a.opened ?? []).find((o: any) => o.leaf_index === leafIndex);
  if (!leaf || !rec || !opening || typeof opening.plaintext_hex !== "string" || !/^[0-9a-f]{256}$/.test(opening.plaintext_hex)) return null;
  const pt = Buffer.from(opening.plaintext_hex, "hex");
  const owner = pt.subarray(61, 93).toString("hex"), nonce = pt.subarray(45, 61).toString("hex"), commitment = pt.subarray(93, 125).toString("hex");
  const auctionId = JSON.parse(Buffer.from(a.manifest.bytes, "base64").toString("utf8")).auction_id;
  if (!verifyEnvelope(owner, auctionId, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig)) return null;
  if (commitment !== settlementCommitment(nonce, rec.envelope_ct)) return null;
  return rec;
}

// The signer's own key opens the authenticated envelope to the bidder's shielded destination.
export function openDestination(rec: EnvelopeRecord, envelopePrivateHex: string): string {
  return openEnvelope(rec.envelope_ct, envelopePrivateHex);
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
