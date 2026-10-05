// Design §5 (gate X): a witness recomputes the frozen root from ITS OWN chain scan before it signs. Every frozen leaf
// must be a note this witness sees itself — at a manifest deposit address, Ironwood, mined, unspent, exactly C — whose
// memo carries exactly the leaf's tlock ciphertext (round R, quicknet; the operator's own admission rule) and envelope
// tag. The root is rebuilt from those scanned leaves in the published order and compared. Deposits the operator did
// not admit are strays, covered by the strays statement (R23 item 1), not by this check.
import { hash, requireThat } from "../manifest/schema";
import { tree, type Deposit, type Frozen, type Leaf } from "../clear/merkle";
import { memoTlockCiphertext } from "../settle/envelopes";

export type ScannedNote = { txid: string; height: number | null; pool: string; address: string; diversifier_index: string; value_zats: number | string; memo_hex: string; spent_in_txid: string | null };

// `settled` (signer hosts deriving settlement rows, Ruling R28 item 2): a frozen deposit may already be spent by this
// auction's own settlement; it must still be a mined, exact-C note at a deposit address whose memo is the leaf's.
// `confirmedAt` (witnesses, R28 item 9): the tip the admission rule's confirmations are counted against.
export function recomputeFrozen(m: { auction_id: string; deposit_addresses: string[]; C_zats: string; drand: { R: number }; confirmations?: number }, manifestHash: string, frozen: Frozen, notes: ScannedNote[], opts: { settled?: boolean; confirmedAt?: number } = {}): { root: string; leaf_count: number } {
  const leaves: Leaf[] = frozen.leaves.map((l, i) => {
    const matches = notes.filter(n => n.txid === l.deposit.txid && n.address === l.deposit.address && n.diversifier_index === l.deposit.diversifier_index);
    requireThat(matches.length === 1, `leaf ${i}: deposit not in this witness's own scan`);
    const n = matches[0];
    requireThat(m.deposit_addresses.includes(n.address) && n.pool === "ironwood" && !!n.height && (opts.settled || !n.spent_in_txid) && BigInt(n.value_zats) === BigInt(m.C_zats), `leaf ${i}: scanned deposit is not an admissible bid`);
    if (opts.confirmedAt !== undefined) requireThat(opts.confirmedAt - n.height! + 1 >= (m.confirmations ?? 10), `leaf ${i}: deposit has fewer than ${m.confirmations ?? 10} confirmations`);
    const { ct, memo_tag } = memoTlockCiphertext(n.memo_hex, m.drand.R);
    requireThat(ct === l.ciphertext_hex && (l.memo_envelope_tag ?? null) === memo_tag, `leaf ${i}: scanned memo differs from the frozen ciphertext`);
    const deposit: Deposit = { txid: n.txid, pool: "ironwood", address: n.address, diversifier_index: n.diversifier_index };
    return { auction_id: m.auction_id, manifest_hash: manifestHash, ciphertext_hash: hash(Buffer.from(ct, "hex")), deposit, leaf_index: i, ciphertext_hex: ct, ...(memo_tag !== null ? { memo_envelope_tag: memo_tag } : {}) };
  });
  return { root: tree(leaves).root, leaf_count: leaves.length };
}
