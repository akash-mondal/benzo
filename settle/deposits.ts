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

// B46 (H15, docs/design/phase7-b46-reserve-return.md): the ONE eligible-source rule for the reserve-return row,
// shared by the signer plan (settle/plan.ts), every signer host (cli/host-derive.ts) and the evidence tools. The
// per-auction vault can also hold funds that belong to bidders — stray deposits and late or excess balance notes
// their owners may still claim (R42; there is no claim deadline) — so the return may spend ONLY:
//   - the fee-reserve note(s): notes received at the operator config's fee_reserve_ua; and
//   - internal change of this auction's own settlement transactions: notes at the vault's internal (change)
//     addresses — `benzo-pczt owns` reports "internal", the same scope rule settle/src/main.rs uses to mark
//     change (a host refuses change that is not an internal vault address).
// A note at any manifest deposit address, bond balance address, escrow or buyback treasury address is NEVER a
// source of the return — even when nobody has claimed it. A fee_reserve_ua configured as one of those addresses
// therefore has NO eligible note at all: the safety rule wins and the reserve stays in the vault.
export function reserveReturnSources<T extends { address: string; value_zats: number | string; spent_in_txid?: string | null }>(
  notes: T[],
  m: { deposit_addresses: string[]; escrow_ua: string; bond?: { balance_addresses?: string[] } | undefined; buyback?: { funding_ua?: string; treasury_ua?: string } | undefined; rfq?: { funding_ua?: string; treasury_ua?: string } | undefined },
  feeReserveUa: string | null | undefined,
  isInternal: (address: string) => boolean,
): T[] {
  // The absolute exclusion: anything a bidder or a treasury can own. This comes first, so a lying packet's
  // fee_reserve_ua can never make a deposit or balance note eligible.
  const never = new Set<string>([m.escrow_ua, ...m.deposit_addresses, ...(m.bond?.balance_addresses ?? [])]);
  for (const block of [m.buyback, m.rfq]) for (const f of [block?.funding_ua, block?.treasury_ua]) if (typeof f === "string") never.add(f);
  return notes.filter(n =>
    n.spent_in_txid == null && BigInt(n.value_zats) > 0n &&
    (isInternal(n.address) || (typeof feeReserveUa === "string" && feeReserveUa.length > 0 && n.address === feeReserveUa && !never.has(n.address))));
}
// B46: the one note identity for a reserve source (the same `<txid>:<pool>:<action_index>` the ledger's refund
// backing uses), so plan, hosts and packets all name a source note the same way.
export function reserveSourceId(note: { txid: string; pool: string; action_index: number }): string {
  return `${note.txid}:${note.pool}:${note.action_index}`;
}
// B46: the ZIP-317 fee of the one-row return transaction — it spends the k eligible notes and pays one output,
// so it carries k shielded actions and pays 5,000 x max(2, actions) zats (settle/src/main.rs's standard_fee rule).
// The row pays sum − fee; the row is only worth planning while sum > fee.
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
