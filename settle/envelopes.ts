// R6 (Reviewer R F3, gate W): settlement destinations for bids come only from the bid's owner-signed
// envelope, never from operator routing. Each signer resolves a leaf's destination by checking the published
// envelope record against the owner material inside the opened bid (owner_sig over auction_id, ciphertext_hash,
// envelope_ct; the salted settlement commitment over the same ciphertext) and only then opening the envelope
// with its own key. A bid without a valid envelope is not paid here; the plan moves it to the exception queue.
// source: envelope record/public shapes from api/public-auction.ts (Track B), validation rules per
// docs/design/phase5-part1-live.md §4.
import { verifyOpensReport, type OpensReport } from "../witness";
import { envelopeRecordValid, openEnvelope, settlementCommitment, verifyEnvelope } from "../envelope";
import { hash, requireThat } from "../manifest/schema";
import { partyNote, type DepositNote } from "./deposits";
import { tleOpening } from "../manifest/reserve";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// R10 item 2: the multi-recipient v2 format is merged and `bid seal` seals to the manifest's pinned keys,
// so a validated v2 envelope is paid through (each signer opens it with its own key; R10 item 4's
// two-signer agreement gates it). The R7.2 interim refusal is gone.

// R10 item 3 (design §10 item 2): every signer requires the signed manifest to pin ITS OWN envelope key at
// its own index (alice 0, bob 1, carol 2), so an operator cannot pin keys it holds and still get signatures.
// Checked at auction sign and again in the signer's settlement plan.
export const SIGNER_ENVELOPE_INDEX: Record<string, number> = { alice: 0, bob: 1, carol: 2 };
export function requireOwnEnvelopeKey(m: { envelope_keys?: string[] }, name: string, stateDir: string): void {
  const index = SIGNER_ENVELOPE_INDEX[name];
  requireThat(index !== undefined, "unknown signer");
  const file = path.join(stateDir, "signers", name, "envelope-key.json");
  if (!existsSync(file)) return;
  const own = JSON.parse(readFileSync(file, "utf8")).public_hex;
  requireThat(Array.isArray(m.envelope_keys) && m.envelope_keys[index] === own, "manifest does not pin this signer's envelope key");
}

export type EnvelopeRecord = { ciphertext_hash: string; envelope_ct: string; owner_sig: string };

// The 512-byte BNZ memo framing (docs/PHASE-1.md section 6). v2 (R16 item 2, corrected by R18):
//   ff424e5a02 || u16be ct_len || tlock_ct || envelope_tag (18) || zero pad
// where envelope_tag is the first 18 bytes of SHA-256(envelope_ct) for a bid that carries an envelope, or
// 18 zero bytes when it does not (exact 512-byte fit at ct_len = 487; `bid seal` refuses any longer
// ciphertext). 18 bytes stop a third party from substituting an envelope for someone else's deposit at
// 2^144 (second preimage); a 2^72 collision would only let a depositor confuse its own refund, and the key
// commitment plus 2-signer agreement still decide the destination (R18). v1 (pre-R16 evidence):
//   ff424e5a01 || u16be length || tlock ciphertext || zero pad
// v1 memos stay readable; they bind no envelope. Returns the sealed-bid ciphertext inside a deposit memo
// and the memo's envelope tag (null for v1), or null when the memo is not a sealed bid — such a stray has
// no owner key and is only ever an exception-queue row (R7 item 6).
export function memoSealedBid(memoHex: string): { ciphertext_hex: string; envelope_tag: string | null } | null {
  try {
    if (typeof memoHex !== "string" || !/^[0-9a-f]{1024}$/.test(memoHex)) return null;
    const memo = Buffer.from(memoHex, "hex"), version = memo.subarray(0, 5), length = memo.readUInt16BE(5);
    if (version.equals(Buffer.from("ff424e5a01", "hex"))) {
      if (length <= 0 || length > 505 || !memo.subarray(7 + length).equals(Buffer.alloc(505 - length))) return null;
      return { ciphertext_hex: memo.subarray(7, 7 + length).toString("hex"), envelope_tag: null };
    }
    if (version.equals(Buffer.from("ff424e5a02", "hex"))) {
      if (length <= 0 || length > 487 || !memo.subarray(7 + length + 18).equals(Buffer.alloc(487 - length))) return null;
      return { ciphertext_hex: memo.subarray(7, 7 + length).toString("hex"), envelope_tag: memo.subarray(7 + length, 7 + length + 18).toString("hex") };
    }
    return null;
  } catch {
    return null;
  }
}

// The memo-bound envelope rule (R16 item 2): only the depositor sets the memo, so the memo's envelope tag
// is the pre-R authenticator of an envelope record — a record is bound exactly when the first 18 bytes of
// SHA-256(envelope_ct) equal the memo's tag. A v1 memo (null) binds nothing and an all-zero tag says the bid
// carries no envelope, so neither can bind a record. One shared rule for intake (clear/auction-cli admit),
// verify (api/public-auction) and the signer's cancel path (memoBoundEnvelope), so they cannot drift (R12).
export function memoBindsEnvelope(memoEnvelopeTag: string | null, envelopeCtHex: string): boolean {
  return typeof memoEnvelopeTag === "string" && /^[0-9a-f]{36}$/.test(memoEnvelopeTag) &&
    memoEnvelopeTag !== "00".repeat(18) && /^[0-9a-f]+$/.test(envelopeCtHex) && envelopeCtHex.length % 2 === 0 &&
    hash(Buffer.from(envelopeCtHex, "hex")).slice(0, 36) === memoEnvelopeTag;
}

// R16 item 2: before R a signer authenticates an envelope from the chain alone — the deposit's scanned memo
// commits to the envelope tag (framing v2) — with no tlock opening at all, then opens it with its own
// key to the bidder's destination. A record the memo does not bind is never opened (null) and the cancel
// path moves its deposit to the exception queue. Track A wires this into the CANCELLED/REFUNDING branch.
export function memoBoundEnvelope(memoHex: string, rec: EnvelopeRecord, envelopePrivateHex: string): string | null {
  const memo = memoSealedBid(memoHex);
  return memo && memoBindsEnvelope(memo.envelope_tag, rec.envelope_ct) ? openDestination(rec, envelopePrivateHex) : null;
}

// The published-record format rule is the one shared `envelopeRecordValid(record, envelope_keys)` exported
// from envelope/ (R12 item 1): the exact v2 shape for n = 3 with the magic and the signed manifest's
// `envelope_keys` as stanza recipients in order, or the pre-v2 572-byte box where the manifest pins no keys.
// R7 item 3 (R F-4 = G3): it is enforced at intake (clear/auction-cli.ts admit) so a malformed record can never
// enter a published directory.

// The authenticated envelope record for one frozen leaf, or null when the bid has no valid matching
// envelope (missing record, unknown ciphertext, malformed record, bad owner signature, mismatched
// settlement commitment, or a record that breaks the shared format/recipient rule — such a record is
// "no valid owner-signed settlement envelope" and lands in the exception queue). R7 item 3 (R F-4 = G3):
// this function is total — a malformed, undersized or otherwise unverifiable record is "not valid", never a
// throw, so one bad bid can never abort the plan for every other party; settle/plan.ts moves such a leaf to
// the exception queue.
export function validEnvelope(a: { manifest: any; frozen: any; opened?: any[]; envelopes?: any[] }, leafIndex: number): EnvelopeRecord | null {
  try {
    const leaf = a.frozen?.leaves?.[leafIndex];
    const rec = (a.envelopes ?? []).find((e: any) => e.ciphertext_hash === leaf?.ciphertext_hash) as EnvelopeRecord | undefined;
    const opening = (a.opened ?? []).find((o: any) => o.leaf_index === leafIndex);
    if (!leaf || !rec || !opening || typeof opening.plaintext_hex !== "string" || !/^[0-9a-f]{256}$/.test(opening.plaintext_hex)) return null;
    const m = JSON.parse(Buffer.from(a.manifest.bytes, "base64").toString("utf8"));
    // R12 item 1: the one shared rule (envelope/index.ts) — exact v2 n = 3 shape with the manifest's
    // `envelope_keys` as stanza recipients in order, or the pre-v2 box where the manifest pins no keys.
    if (!envelopeRecordValid(rec, m.envelope_keys)) return null;
    const pt = Buffer.from(opening.plaintext_hex, "hex");
    const owner = pt.subarray(61, 93).toString("hex"), nonce = pt.subarray(45, 61).toString("hex"), commitment = pt.subarray(93, 125).toString("hex");
    if (!verifyEnvelope(owner, m.auction_id, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig)) return null;
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

// R20 (head review of c7f1029): a stray or cancelled deposit's envelope is AUTHENTICATED before it is ever
// opened — an operator-inserted record for a memo-less or v1 stray is never paid. Exactly one of:
//   (a) the deposit memo is framing v2 and its envelope_tag binds rec.envelope_ct (Track B's rule, arriving
//       with the memo v2 merge — the hook below is a no-op until the parser yields the tag), or
//   (b) after R, the record passes validEnvelope against the memo's own tlock opening — the bid's owner
//       signature plus its salted settlement commitment, with the memo opening to this auction's 128-byte
//       sealed-bid layout.
// Otherwise null — the row is an exception row, claimable through benzo claim-refund.
export function authenticatedMemoEnvelope(
  observed: DepositNote[],
  party: string,
  manifestPacket: any,
  envelopes: EnvelopeRecord[] | undefined,
  tleBin: string,
): EnvelopeRecord | null {
  try {
    const note = partyNote(observed, party);
    const memo = note?.memo_hex ? memoSealedBid(note.memo_hex) : null;
    if (!memo) return null;
    const ctHex = memo.ciphertext_hex;
    const ctHash = hash(Buffer.from(ctHex, "hex"));
    const rec = (envelopes ?? []).find(e => e.ciphertext_hash === ctHash);
    if (!rec) return null;
    const manifest = JSON.parse(Buffer.from(manifestPacket.bytes, "base64").toString("utf8"));
    // (a) head merge (R20 + R16 item 2/R18): a framing-v2 memo whose envelope_tag binds this record (only the
    // depositor sets the memo) authenticates it before R with no tlock opening; it must still satisfy the shared
    // format/recipient rule.
    if (memoBindsEnvelope(memo.envelope_tag, rec.envelope_ct) && envelopeRecordValid(rec, manifest.envelope_keys)) return rec;
    const ptHex = tleOpening(tleBin, manifest.drand.chain_hash, ctHex);
    if (!ptHex) return null;
    const pt = Buffer.from(ptHex, "hex");
    if (pt.length !== 128 || pt[0] !== 0 || pt.subarray(1, 33).toString("hex") !== manifest.auction_id) return null;
    return validEnvelope({ manifest: manifestPacket, frozen: { leaves: [{ leaf_index: 0, ciphertext_hash: ctHash }] }, opened: [{ leaf_index: 0, plaintext_hex: ptHex }], envelopes }, 0);
  } catch {
    return null;
  }
}

// R10 item 2 + R20: the deposit-party twin of envelopeRecipient — the AUTHENTICATED memo-bound record,
// opened with the signer's own key. Total like the rest of this module: anything unresolvable is null.
export function memoEnvelopeRecipient(
  observed: DepositNote[],
  party: string,
  manifestPacket: any,
  envelopes: EnvelopeRecord[] | undefined,
  tleBin: string,
  envelopePrivateHex: string,
): string | null {
  try {
    const rec = authenticatedMemoEnvelope(observed, party, manifestPacket, envelopes, tleBin);
    return rec ? openDestination(rec, envelopePrivateHex) : null;
  } catch {
    return null;
  }
}

// R10 item 2/4: the acting signer's own envelope private half, read from its own state dir (the operator's
// tooling never holds it — R7 item 2). Null when the signer has no key file.
export function ownEnvelopePrivate(stateDir: string, name: string): string | null {
  try {
    const file = path.join(stateDir, "signers", name, "envelope-key.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).private_hex ?? null : null;
  } catch {
    return null;
  }
}

// R23 item 2 (Reviewer G G3): the plan's two-signer envelope gate counts only reports whose signature
// verifies against the pinned witness set (the report is signed by the reporting signer's own witness
// key), one per distinct witness key — an unsigned or forged report is ignored, and one witness never
// counts twice. Returns party -> the dest_sha256 at least two distinct witnesses reported ok for.
export function agreedDestinations(
  reports: { signer: string; opens: { leaf: number | null; party: string; ok: boolean; dest_sha256: string | null }[]; witness?: string; signature?: string }[],
  witnessKeys: string[] | null,
): Map<string, string> {
  const perParty = new Map<string, Map<string, Set<string>>>();
  for (const r of reports ?? []) {
    if (!verifyOpensReport(r as OpensReport, witnessKeys)) continue;
    for (const e of r.opens ?? []) {
      if (!e || e.ok !== true || typeof e.dest_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.dest_sha256)) continue;
      const byDest = perParty.get(e.party) ?? new Map<string, Set<string>>();
      perParty.set(e.party, byDest);
      const keys = byDest.get(e.dest_sha256) ?? new Set<string>();
      byDest.set(e.dest_sha256, keys);
      keys.add((r as OpensReport).witness!);
    }
  }
  const agreed = new Map<string, string>();
  for (const [party, byDest] of perParty) {
    const best = [...byDest].sort((a, b) => b[1].size - a[1].size)[0];
    if (best && best[1].size >= 2) agreed.set(party, best[0]);
  }
  return agreed;
}
