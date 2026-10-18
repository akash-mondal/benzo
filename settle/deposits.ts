// R26 item 1: the one deposit-note identity rule. A note is identified by its output position —
// `deposit:<txid>:<pool>:<action_index>` with `action_index` the output/action index benzo-scan emits —
// never by its address's diversifier index: one transaction can carry two outputs to the same deposit
// address, and each note is its own refund obligation. Every plan, claim, verify and evidence path derives
// and parses deposit parties through these helpers. A zero-value note is never an obligation: it is
// ignored here and counted in verify's accounting (`settlement.ignored`).
import { slotOrders } from "../clear/features";
export type DepositNote = {
  txid: string;
  pool: string;
  action_index: number;
  address: string;
  value_zats: number;
  memo_hex: string;
  height: number | null;
  spent_in_txid: string | null;
};

// Strict party shape: 64-hex txid, one of the three shielded pool names, and an output/action index in
// the scanner's u16 range (decimal, no leading zeros).
const PARTY = /^deposit:([0-9a-f]{64}):(sapling|orchard|ironwood):(0|[1-9][0-9]*)$/;

export function isDepositParty(party: string): boolean {
  const m = PARTY.exec(party);
  return !!m && Number(m[3]) <= 65535;
}

// Historical published rows (evidence from Phases 2–5 before R26 item 1) name a note by its
// address's diversifier index, `deposit:<txid>:<diversifier_index>`. Those directories are immutable,
// so every verifier-side ACCEPTANCE of a published party takes either identity. Writers never emit
// this one; the strict identity above stays the only one the product writes.
const LEGACY_PARTY = /^deposit:([0-9a-f]{64}):(0|[1-9][0-9]*)$/;

export function isAnyDepositParty(party: string): boolean {
  return isDepositParty(party) || !!LEGACY_PARTY.exec(party);
}

export function depositParty(note: { txid: string; pool: string; action_index: number }): string {
  const party = `deposit:${note.txid}:${note.pool}:${note.action_index}`;
  if (!isDepositParty(party)) throw new Error(`refused: scanned note is not a deposit identity (${party})`);
  return party;
}

// The exact note a deposit party names, or undefined when none does. Ruling R44 (F18): an unkeyable note
// is an ERROR, never a silent disable — a note-shaped party outside the scanner's u16 range is refused loudly.
export function partyNote<T extends { txid: string; pool: string; action_index: number }>(notes: T[], party: string): T | undefined {
  const m = PARTY.exec(party);
  if (!m) return undefined;
  if (Number(m[3]) > 65535) throw new Error(`refused: unkeyable deposit note identity ${party}; an unkeyable note is an ERROR`);
  return notes.find(n => n.txid === m[1] && String(n.pool) === m[2] && String(n.action_index) === m[3]);
}

// Zero-value notes are never obligations (rows or exception rows): they are ignored and counted.
export function refundable<T extends DepositNote>(notes: T[]): { payable: T[]; ignored: { party: string; amount_zats: string }[] } {
  const payable: T[] = [], ignored: { party: string; amount_zats: string }[] = [];
  for (const n of notes) {
    if (n.value_zats > 0) payable.push(n);
    else ignored.push({ party: depositParty(n), amount_zats: "0" });
  }
  return { payable, ignored };
}

// The plan's stray rule, shared with the witnesses' strays statement: a deposit-address note that is not
// one of the frozen leaves' deposits (or any of them when nothing was frozen). Ruling R40 item 1 (F1): in a
// bond-then-pay auction a slot collision's note is a stray too — only the first deposit note at each deposit
// slot is an order (clear/features.ts slotOrders, the one shared rule), so the later note at a used slot
// refunds through this same stray path to its own depositor and can never be credited or defaulted against a
// co-slot bidder.
export function strayNotes<T extends { txid: string; address: string }>(
  notes: T[],
  m: { deposit_addresses: string[]; bond?: unknown },
  frozen: { leaves: { leaf_index: number; deposit: { txid: string; address: string } }[] } | null | undefined,
): T[] {
  const leaves = frozen?.leaves ?? [];
  const collide = new Set(slotOrders(m, leaves).collisions.map(l => `${l.deposit.txid}:${l.deposit.address}`));
  return notes.filter(n =>
    m.deposit_addresses.includes(n.address) &&
    (!leaves.some(l => l.deposit.txid === n.txid && l.deposit.address === n.address) ||
     collide.has(`${n.txid}:${n.address}`)));
}

// B46 (H15, docs/design/phase7-b46-reserve-return.md, Revision R103): the reserve-return row's AMOUNT is
// value-based. Vault value is FUNGIBLE — the wallet picks every batch's inputs, so an ordinary batch can spend
// a bidder's stray note and return its value as internal change — so checking WHICH notes the return spends
// cannot protect anyone. Only the amount can: once the auction owes NOTHING (the gate below), the return pays
// the vault's WHOLE unspent value minus the ZIP-317 fee, spending every unspent note (nothing is left behind).
//
// B46 R103: the ONE "nothing is owed" gate, shared by the signer plan (settle/plan.ts) and every signer host
// (cli/host-derive.ts deriveReserveReturn). The return is planned or approved only when EVERY one of these
// holds, judged from our own derivation plus the published accounting:
//   - every owed row has a published receipt — the owed set is the money rules' own obligations (result
//     rows, balance rows, treasury) PLUS every stray deposit note and late/excess balance note our own scan
//     derives (strayNotes/refundable/balanceSettlement, run WITHOUT requiring a destination: a row is owed
//     whether or not anyone has claimed it, and whether or not we could pay it today);
//   - no published row is unresolved (an exception row, or a row without its receipt);
//   - no published balance refund is unpaid (a `pending` entry);
//   - no batch is pending (the plan's own ledger).
// An unclaimed stray therefore delays the return indefinitely. That is the conservative choice (R103).
// The returned list is the outstanding items, deduplicated by identity — its length is the waits line's N.
export function reserveReturnOutstanding(input: {
  owed: Iterable<{ party: string; amount_zats: string }>;
  rows: Iterable<{ party: string; amount_zats: string; state?: string }>;
  receipts: Iterable<{ party: string; amount_zats: string }>;
  balance_refunds?: Iterable<{ party: string; amount_zats: string; state?: string }> | undefined;
  pending_batches?: number | undefined;
}): string[] {
  const out = new Set<string>();
  const receipts = [...input.receipts];
  const receipted = (party: string, amount_zats: string): boolean => receipts.some(r => r.party === party && r.amount_zats === amount_zats);
  // Owning a row is not enough: the row must be PAID at its amount by a published receipt. This is what
  // catches an unclaimed stray or balance note hidden from the published rows — our own scan derived it.
  for (const o of input.owed) if (!receipted(o.party, o.amount_zats)) out.add(o.party);
  for (const r of input.rows) {
    const settled = (r.state === "paid" || r.state === "refunded") && receipted(r.party, r.amount_zats);
    if (!settled) out.add(r.party); // an exception row, or a row without its receipt: unresolved
  }
  for (const b of input.balance_refunds ?? []) if (b.state !== "paid" || !receipted(b.party, b.amount_zats)) out.add(b.party);
  for (let i = 0; i < (input.pending_batches ?? 0); i++) out.add(`pending batch ${i + 1}`);
  return [...out].sort();
}
// B46 R103: the return's amount — the vault's WHOLE unspent value minus the ZIP-317 fee of the one-row
// transaction that spends every unspent note (5,000 x max(2, notes), settle/src/main.rs's standard_fee rule).
// `amount_zats` is null while the value does not cover the fee (the return is never worth planning then).
// `ids` names the notes the transaction must spend — the host approval ledger's source identities, so a
// second live candidate can never spend them again (Ruling R28 item 3).
export function reserveReturnAmount<T extends { txid: string; pool: string; action_index: number; value_zats: number | string; spent_in_txid?: string | null }>(
  notes: T[],
): { total_zats: string; fee_zats: string; amount_zats: string | null; ids: string[] } {
  const unspent = notes.filter(n => (n.spent_in_txid ?? null) == null && BigInt(n.value_zats) > 0n);
  const total = unspent.reduce((s, n) => s + BigInt(n.value_zats), 0n);
  const fee = reserveReturnFee(unspent.length);
  return { total_zats: total.toString(), fee_zats: fee.toString(), amount_zats: total > fee ? (total - fee).toString() : null,
    ids: unspent.map(n => reserveSourceId(n)).sort() };
}
// B46: the one note identity for a vault note (the same `<txid>:<pool>:<action_index>` the ledger's refund
// backing uses), so plan, hosts, the approval ledger and packets all name a note the same way.
export function reserveSourceId(note: { txid: string; pool: string; action_index: number }): string {
  return `${note.txid}:${note.pool}:${note.action_index}`;
}
// B46: the ZIP-317 fee of the one-row return transaction — it spends k notes and pays one output,
// so it carries k shielded actions and pays 5,000 x max(2, actions) zats (settle/src/main.rs's standard_fee rule).
// The row pays total − fee; the row is only worth planning while total > fee.
export function reserveReturnFee(sourceCount: number): bigint {
  return 5000n * BigInt(Math.max(2, sourceCount));
}

// The slot-collision notes among the strays (R40 item 1): their published envelope record belongs to the
// frozen LEAF's ciphertext, so the memo-to-record binding is not publicly checkable for a stray row — the
// plan and every host refund them through the owner-signed claim path only.
export function isSlotCollision<T extends { txid: string; address: string }>(
  n: T,
  m: { deposit_addresses: string[]; bond?: unknown },
  frozen: { leaves: { leaf_index: number; deposit: { txid: string; address: string } }[] } | null | undefined,
): boolean {
  return slotOrders(m, (frozen?.leaves ?? [])).collisions.some(l => l.deposit.txid === n.txid && l.deposit.address === n.address);
}
