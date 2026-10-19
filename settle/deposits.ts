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
    // R107b: the reserve-return row itself is never outstanding for its own gate (it is published, without a
    // receipt, while its batch is in flight).
    if (r.party === "reserve-return") continue;
    const settled = (r.state === "paid" || r.state === "refunded") && receipted(r.party, r.amount_zats);
    if (!settled) out.add(r.party); // an exception row, or a row without its receipt: unresolved
  }
  for (const b of input.balance_refunds ?? []) if (b.state !== "paid" || !receipted(b.party, b.amount_zats)) out.add(b.party);
  for (let i = 0; i < (input.pending_batches ?? 0); i++) out.add(`pending batch ${i + 1}`);
  return [...out].sort();
}
// B52 (Reviewer R round 4, P2-1, docs/design/phase7-b52-return-fee.md): the return's amount and fee come
// from the TOOL's own quote of the sweep (settle/quote.ts quoteSweep — `benzo-pczt quote-sweep`, the same
// wallet and fee rule `create` uses), never from a prediction over the source count: the real fee is the
// ZIP-317 fee of the transaction's actual per-pool action counts, which `inspect` enforces. What the rules
// still derive here is the vault's scanned unspent value and the note identities the sweep must spend:
// `total_zats` is the figure every signer compares the candidate's inspect `input_zats` against (nothing
// is left behind), and `ids` are the host approval ledger's source identities, so a second live candidate
// can never spend them again (Ruling R28 item 3).
//
// B52 item 3 (Sapling): NO vault address can receive Sapling. Every vault address (deposit, fee-reserve,
// balance, change) is generated by `benzo-pczt address` (settle/src/main.rs), which derives
// `UnifiedAddressRequest::ORCHARD` unified addresses — zcash_keys' ORCHARD request requires an Orchard
// receiver and OMITS every other receiver, so the UA carries no Sapling receiver a sender could pay. A
// Sapling note in the vault is therefore unreachable today; if one ever appeared, `quote-sweep` refuses
// it (a note the tool cannot spend) and the row is not planned — the typed waits line, never a crash.
export function reserveUnspent<T extends { txid: string; pool: string; action_index: number; value_zats: number | string; spent_in_txid?: string | null }>(
  notes: T[],
): { total_zats: string; ids: string[] } {
  const unspent = notes.filter(n => (n.spent_in_txid ?? null) == null && BigInt(n.value_zats) > 0n);
  const total = unspent.reduce((s, n) => s + BigInt(n.value_zats), 0n);
  return { total_zats: total.toString(), ids: unspent.map(n => reserveSourceId(n)).sort() };
}
// B46: the one note identity for a vault note (the same `<txid>:<pool>:<action_index>` the ledger's refund
// backing uses), so plan, hosts, the approval ledger and packets all name a note the same way.
export function reserveSourceId(note: { txid: string; pool: string; action_index: number }): string {
  return `${note.txid}:${note.pool}:${note.action_index}`;
}

// B49 (Reviewer R round 2, P0-1/P2-2, docs/design/phase7-b49-paid-means-mined.md): the ONE rule for "paid",
// judged from our own data only. A published receipt counts ONLY when both hold:
//   - our own ledger approved a candidate with that txid and that row among its mapped outputs at that
//     amount (a signer host's approval ledger approvals/<id>/ledger.json, or the plan's own settle ledger);
//   - our own vault scan shows that txid mined and deep: a vault note with spent_in_txid = txid (the
//     transaction spent one of this vault's notes) AND a vault note of that txid carrying a height at or
//     below our own tip and at least 10 confirmations deep (the transaction's own note in our scan is the
//     scan's evidence of its mined height).
// Packet receipts are only an index — never trusted on their own. A row without such a receipt is
// outstanding. A transaction a reorg un-mines loses both scan traces, so its row is owed again (P2-2).
//
// B53 (P3-1, Reviewer R round 4): a paying batch that spends exact inputs and leaves NO change has only
// spent_in_txid traces — the scan carries no note of its txid — so its receipts could never count and the
// reserve return waited forever. When the scan has no note of the paying txid at all, the caller's own
// chain lookup (cli/host-chain.ts minedHeight, injected as `minedHeightOf` — the predicate stays pure and
// offline stubs supply it) is the depth evidence, with the SAME rule: at least 10 deep at or below the
// caller's own tip. A scan that DOES carry a note of the txid stays authoritative (a shallow or reorged
// note never falls back to the chain).
export type PaidReceipt = { party: string; amount_zats: string; txid: string; output_index: number };
export type PaidAttestation = { txid: string; party: string; output_index: number; amount_zats: string };
export type PaidScanNote = { txid: string; height: number | null; spent_in_txid: string | null };
// The ZIP-315 depth a paying transaction must reach before its receipt counts (the design's 10).
export const PAID_CONFIRMATIONS = 10;
export function paidByOwnLedger<T extends PaidReceipt>(receipts: Iterable<T>, ownLedger: Iterable<PaidAttestation>, ownScan: Iterable<PaidScanNote>, tip: number, minedHeightOf?: (txid: string) => number): T[] {
  const ledger = [...ownLedger], scan = [...ownScan];
  const counted: T[] = [];
  for (const r of receipts) {
    const approved = ledger.some(l => l.txid === r.txid && l.party === r.party && l.output_index === r.output_index && l.amount_zats === r.amount_zats);
    if (!approved) continue;
    const funded = scan.some(n => n.spent_in_txid === r.txid);
    if (!funded) continue;
    const deep = (h: number) => h > 0 && h <= tip && tip - h + 1 >= PAID_CONFIRMATIONS;
    if (scan.some(n => n.txid === r.txid)) {
      // The scan carries a note of the paying txid (its change): the scan is the evidence, full stop — a
      // shallow or reorged-out note never counts, however the chain reads.
      if (scan.some(n => n.txid === r.txid && n.height != null && deep(n.height))) counted.push(r);
      continue;
    }
    // B53 (P3-1): a zero-change batch leaves no vault note of its txid — the caller's own chain lookup is
    // then the depth evidence, at the same 10-deep-at-or-below-our-tip rule.
    const h = minedHeightOf ? minedHeightOf(r.txid) : 0;
    if (deep(h)) counted.push(r);
  }
  return counted;
}

// B49 (P2-a): ONE note identity for every approval-ledger source. Ordinary rows used to push
// `deposit:<txid>:<pool>:<idx>` (or `balance-late:…`) while the reserve-return row pushed the bare
// `<txid>:<pool>:<idx>`, so a reserve-return candidate never collision-checked against ordinary batches.
// Every source is normalized to the bare note identity `<txid>:<pool>:<action_index>` — the settle ledger's
// own refund-backing identity — so the same note is the same source under every row kind. Sources that are
// not note identities (seller, treasury, leaf-deposit:…, balance-excess:…) are left alone. Old approval
// ledgers are migrated on read (cli/commands/sign-approve.ts normalizes and rewrites them).
const LEDGER_NOTE_SOURCE = /^(?:deposit|balance-late):([0-9a-f]{64}):(sapling|orchard|ironwood):(0|[1-9][0-9]*)$/;
export function canonicalSourceId(source: string): string {
  const m = LEDGER_NOTE_SOURCE.exec(source);
  return m && Number(m[3]) <= 65535 ? `${m[1]}:${m[2]}:${m[3]}` : source;
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
