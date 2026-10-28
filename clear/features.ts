// Core features, shared by every clearing mode through the registry (no per-mode copies):
// bid revision, multi-lot rounds, the sealed reserve/max price, bond-then-pay balances and
// recurring-round linkage. Pure logic only — no clock, no network. The mode calculates consume readOrders and the
// bound helpers and keep only their own ranking and money rules.
import { requireThat, zats } from "../manifest/schema";
import { LAYOUT_V0, readOrder, type OrderLayout } from "./layout";
import type { ClearInput } from "./core";

export type OrderView = {
  leaf_index: number; lot: string | null; bound_hex: string; owner_hex: string;
  price: bigint; quantity: number; reason: string; superseded: boolean;
};

// Reads every frozen leaf's opening under the layout, attributes the lot from the bound id (the manifest's lot
// ids in multi-lot rounds, else the auction_id), and applies bid revision: among binding-valid orders with the
// same (owner key, lot), only the latest admitted (highest committed leaf index) counts; earlier ones are marked
// "superseded" and refunded exactly once (they never rank, so they can never also earn an unfilled refund).
export function readOrders(input: ClearInput, m: { auction_id: string; lots?: string[]; bond?: unknown }, layout: OrderLayout = LAYOUT_V0): OrderView[] {
  const lots = m.lots ?? null;
  const allowed = lots ?? [m.auction_id];
  requireThat(input.opened.length === input.frozen.leaf_count &&
    new Set(input.opened.map(o => o.leaf_index)).size === input.opened.length, "one opening per frozen leaf");
  // In a bond-then-pay auction only the first deposit note at each deposit slot is an
  // order — a slot collision is not an order at all (it refunds through the stray path), so the clearing input
  // carries exactly one bid per slot and no rule ever attributes one address's payment among several bidders.
  const orders: OrderView[] = slotOrders(m, input.frozen.leaves).orders.map(l => {
    const o = input.opened.find(x => x.leaf_index === l.leaf_index)!;
    let price = 0n, quantity = 0, bound_hex = "", owner_hex = "", reason = "";
    if (o?.error === "reorg") reason = "reorg";
    else if (!o || o.plaintext_hex === null) reason = "undecryptable";
    else {
      const r = readOrder(layout, o.plaintext_hex, allowed);
      price = r.price; quantity = r.quantity; bound_hex = r.bound_hex; owner_hex = r.owner_hex; reason = r.reason;
    }
    return { leaf_index: l.leaf_index, lot: lots && !reason ? bound_hex : null, bound_hex, owner_hex, price, quantity, reason, superseded: false };
  });
  const latest = new Map<string, number>();
  for (const o of orders) {
    if (o.reason) continue;
    const key = `${o.owner_hex}:${o.lot ?? ""}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, o.leaf_index));
  }
  for (const o of orders) {
    if (o.reason) continue;
    if (o.leaf_index < (latest.get(`${o.owner_hex}:${o.lot ?? ""}`) ?? 0)) { o.superseded = true; o.reason = "superseded"; }
  }
  return orders;
}

// The sealed price bound: a tlock ciphertext in the signed manifest whose 40-byte plaintext
// is u64be price_zats || auction_id, opened at R with the bids and re-derived by benzo verify. When present it
// tightens the mode's price bound and never loosens it: max with the public reserve floor, min with the
// buyback max price.
export function readReserve(plaintextHex: string, auctionId: string, tick: bigint): bigint {
  requireThat(/^[0-9a-f]{80}$/.test(plaintextHex), "reserve opening length");
  const pt = Buffer.from(plaintextHex, "hex");
  requireThat(pt.subarray(8, 40).toString("hex") === auctionId, "reserve opening binding");
  const price = pt.readBigUInt64BE(0);
  requireThat(price <= 2_100_000_000_000_000n && price % tick === 0n, "reserve opening price");
  return price;
}
export function sealedReserve(m: { auction_id: string; sealed_reserve?: string }, opening: string | null | undefined, tick: bigint): bigint | null {
  if (m.sealed_reserve === undefined) {
    requireThat(opening === null || opening === undefined, "reserve opening without sealed reserve");
    return null;
  }
  requireThat(typeof opening === "string" && /^[0-9a-f]+$/.test(opening), "missing reserve opening");
  return readReserve(opening!, m.auction_id, tick);
}
export function effectiveReserve(m: { reserve_zats: string }, sealed: bigint | null): bigint {
  const r = zats(m.reserve_zats, "reserve");
  return sealed !== null && sealed > r ? sealed : r;
}
export function effectiveMaxPrice(m: { buyback: { max_price_zats: string } }, sealed: bigint | null): bigint {
  const p = zats(m.buyback.max_price_zats, "max_price");
  return sealed !== null && sealed < p ? sealed : p;
}

// Bond-then-pay: C is the bond of bond_bps bps of the cap; a winner's balance = payment + fee - C is
// paid in the balance window. refundAfter/balanceDue generalize the Mode A identity to
// payment + refund + fee = C + balance_due and never go negative (without bond C covers the largest order).
export const balanceDue = (payment: bigint, fee: bigint, C: bigint): bigint => (payment + fee > C ? payment + fee - C : 0n);
export const refundAfter = (payment: bigint, fee: bigint, C: bigint): bigint => (C > fee + payment ? C - fee - payment : 0n);

// Part 2, collection drop (bond-then-pay with defaults): the balance window and the balance addresses are fixed
// in the SIGNED manifest before bidding — the operator chooses neither after
// the clear. deposit slot i pays its balance to bond.balance_addresses[i]; a winner's slot is its frozen deposit's
// own address. A winner's balance counts only notes at its balance address with
// balance_window_start_height < height <= balance_window_start_height + balance_window_blocks (P1-1's lower bound:
// stale or pre-funded value never counts). Defaults are NEVER operator input: every plan and every signer host
// derives them from its own scan with this one helper — a winner whose in-window notes fall short of
// balance_due_zats is a default.
export type BalanceWindowM = { deposit_addresses: string[]; confirmations?: number; bond: { balance_window_start_height: number; balance_window_blocks: number; balance_addresses: string[] } };
export type FrozenLeaf = { leaf_index: number; deposit: { address: string } };
export type ScannedNote = { txid: string; pool: string; action_index: number; address: string; height: number | null; value_zats: number | string };

// One bid per deposit slot in a bond-then-pay auction. Deposit slots are a shared
// public list and a payer is unobservable on shielded Zcash, so no rule can attribute one address's payment
// among several bidders — the shared-slot cases cannot arise instead. Only the FIRST deposit note at each
// deposit address (leaf order = chain order) is an order; every later note at that slot is a slot collision
// and refunds through the stray path to its own depositor. This one helper is the rule: the clearing input
// (readOrders), the plan's stray classification (settle/deposits.ts strayNotes), every signer host and the
// witness strays statement consume it, so plan, hosts and verify can never disagree.
export function slotOrders<T extends { leaf_index: number; deposit: { address: string } }>(
  m: { bond?: unknown },
  leaves: T[],
): { orders: T[]; collisions: T[] } {
  const seen = new Set<string>(), orders: T[] = [], collisions: T[] = [];
  for (const l of [...leaves].sort((a, b) => a.leaf_index - b.leaf_index)) {
    if (m.bond !== undefined && seen.has(l.deposit.address)) { collisions.push(l); continue; }
    seen.add(l.deposit.address);
    orders.push(l);
  }
  return { orders, collisions };
}

// The bond is void when the window's start block has a header time before R's release time (winners
// must know they won before the window opens). Every party decides it from its own chain view of that one header;
// published settlements carry the value two agreeing host-signed maps attest.
export const bondVoidAt = (m: { drand: { genesis: number; period: number; R: number } }, startHeaderTime: number): boolean => {
  requireThat(Number.isSafeInteger(startHeaderTime) && startHeaderTime > 0, "balance window start header time");
  return startHeaderTime < m.drand.genesis + (m.drand.R - 1) * m.drand.period;
};
export const balanceWindow = (m: BalanceWindowM): { start: number; end: number } => {
  const start = m.bond.balance_window_start_height;
  requireThat(Number.isSafeInteger(start) && start > 0 && Number.isSafeInteger(m.bond.balance_window_blocks) && m.bond.balance_window_blocks >= 1, "balance window");
  requireThat(Number.isSafeInteger(start + m.bond.balance_window_blocks), "balance window overflow");
  return { start, end: start + m.bond.balance_window_blocks };
};
// One balance address per bonded winner, from its own frozen deposit's manifest slot.
export function balanceAddressMap(
  result: { allocations: { leaf_index: number; fill: number }[] },
  leaves: FrozenLeaf[],
  m: BalanceWindowM,
): Map<number, string> {
  requireThat(Array.isArray(m.bond?.balance_addresses) && m.bond.balance_addresses.length === m.deposit_addresses.length, "balance addresses");
  const map = new Map<number, string>();
  for (const a of result.allocations) {
    if (a.fill <= 0) continue; // only a bonded winner owes (or can default on) a balance
    const leaf = leaves.find(l => l.leaf_index === a.leaf_index);
    requireThat(leaf, "balance address leaf");
    const slot = m.deposit_addresses.indexOf(leaf!.deposit.address);
    requireThat(slot >= 0 && !map.has(a.leaf_index), "balance address leaf");
    map.set(a.leaf_index, m.bond.balance_addresses[slot]);
  }
  // One bid per deposit slot, so each balance address belongs to exactly one leaf.
  // The clearing input can no longer produce anything else; a result that shares one is refused here rather
  // than attributed by any walk (this checks the recomputed result, never chain state).
  requireThat(new Set(map.values()).size === map.size, "balance address shared by two winning leaves (one bid per deposit slot)");
  return map;
}
// A balance-address note is CLASSIFIED only once matured (the R5 confirmations,
// `confirmations: 10` — the stricter of the manifest's rule and ZIP-315's 10). Unmatured notes are invisible
// to the derivation (in-window, late and excess alike), so an in-model reorg (fewer than 10 blocks) can never
// move a note across the window edge after it is counted. This one gate is the classification rule the plan,
// every signer host and the verify-side replays all consume.
export const balanceMatured = <T extends { height: number | null }>(m: { confirmations?: number }, notes: T[], tip: number): T[] => {
  const gate = Math.max(m.confirmations ?? 10, 10);
  // One note is one note. A scan listing the same {txid, pool, action_index} twice
  // must not double-count a payment or back two refund rows; every balance rule passes through this one gate.
  const seen = new Set<string>();
  return notes.filter(n => {
    if (!n.height || tip - n.height! + 1 < gate) return false;
    const id = n as unknown as { txid?: string; pool?: string; action_index?: number };
    const k = `${id.txid}:${id.pool}:${id.action_index}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
};
export function balanceDefaults(
  m: BalanceWindowM,
  result: { allocations: { leaf_index: number; fill: number; balance_due_zats?: string }[] },
  leaves: FrozenLeaf[],
  notes: ScannedNote[],
  tip: number,
): number[] {
  requireThat(m.bond !== undefined, "defaults are bond-then-pay only");
  const byLeaf = balanceAddressMap(result, leaves, m);
  const { start, end } = balanceWindow(m);
  requireThat(tip > end, "balance window has not passed; settlement waits");
  const seen = balanceMatured(m, notes, tip); // Classified only once matured
  const inWindow = (address: string): bigint => seen.filter(n => n.address === address && n.height && n.height > start && n.height <= end)
    .reduce((s, n) => s + BigInt(n.value_zats), 0n);
  // The greedy walk is withdrawn. Each balance address belongs to exactly one
  // leaf (balanceAddressMap refuses a shared one — the clear can no longer produce it), so a winner is PAID
  // when its own address's in-window notes cover its balance_due_zats and a DEFAULT otherwise. Deterministic,
  // used by the plan, every signer host and the verify-side replays alike; one payment can never settle two
  // balances because two balances can never share one address.
  const defaults: number[] = [];
  for (const [leaf, address] of [...byLeaf].sort((a, b) => a[0] - b[0])) {
    const due = BigInt(result.allocations.find(a => a.leaf_index === leaf)?.balance_due_zats ?? "0");
    if (due === 0n) continue; // only a bonded winner owing a balance can default
    if (inWindow(address) < due) defaults.push(leaf);
  }
  return defaults;
}

// Out-of-window notes at a balance address are NEVER
// settlement sources (never swept into change) and never count as payment. Each note gets its OWN immutable
// refund row, keyed by the note — `balance-late:<txid>:<pool>:<action_index>` — at that slot's own leaf's
// refund destination ("minus the fee, like a stray": settlement requires fee_zats "0", so the row carries the
// note's full value). A newly seen note ADDS a new row and never grows an existing one: refund rows never
// change, so nothing a third party can send may make settlement refuse (the reviewer's ledger-growth wedge).
// The rows are host-derived — every plan and every signer host computes them from its own scan with this one
// rule — and claimable through the existing claim path (`benzo claim-refund --party balance-late:…`) with the
// slot leaf's owner key; only the per-note counts are ever published, never the addresses.
// `notes` names the scanned notes backing the row (`<txid>:<pool>:<action_index>`), so
// the settlement ledger can key refunds by NOTE IDENTITY — one note backs at most one refund row across all
// row classes and a reorg re-classification can never pay the same note twice. Internal derivation data:
// never published (published entries are {party, leaf_index, amount_zats, state} only) and never signed.
export type BalanceRefund = { party: string; leaf_index: number; amount_zats: string; state?: "pending" | "paid"; matured?: boolean; notes?: string[] };
const BALANCE_LATE = /^balance-late:([0-9a-f]{64}):(sapling|orchard|ironwood):(0|[1-9][0-9]*)$/;
export const balanceLateParty = (n: { txid: string; pool: string; action_index: number }): string => {
  const party = `balance-late:${n.txid}:${n.pool}:${n.action_index}`;
  requireThat(BALANCE_LATE.test(party) && Number(BALANCE_LATE.exec(party)![3]) <= 65535, "balance-late party identity");
  return party;
};
export const isBalanceLateParty = (party: string): boolean => {
  const m = BALANCE_LATE.exec(party);
  return !!m && Number(m[3]) <= 65535;
};
// In-window value above `balance_due_zats` at a balance address becomes ONE immutable
// `balance-excess:<leaf_index>` refund row to that slot's own leaf (final — settlement waits until the window has
// closed). It refunds exactly like a `balance-late:` row: parked, claimable with that leaf's owner key.
const BALANCE_EXCESS = /^balance-excess:(0|[1-9][0-9]*)$/;
export const balanceExcessParty = (leaf: number): string => {
  requireThat(Number.isSafeInteger(leaf) && leaf >= 0, "balance-excess party identity");
  return `balance-excess:${leaf}`;
};
export const isBalanceExcessParty = (party: string): boolean => BALANCE_EXCESS.test(party);
export const balanceExcessLeafIndex = (party: string): number | null => {
  const m = BALANCE_EXCESS.exec(party);
  return m ? Number(m[1]) : null;
};
// The refund rows of bond-then-pay — one immutable row per late note and one per leaf's
// in-window excess. A host attests such a row only in the approval of the batch that PAYS it; unpaid rows are
// published as `pending` with counts only and no signature ever covers a set that third parties can still grow.
export const isRefundRowParty = (party: string): boolean => isBalanceLateParty(party) || isBalanceExcessParty(party);
// The leaf a refund row refunds to: the excess row's own key, or the late note's deposit slot's own leaf.
export function refundRowLeafIndex(
  m: { deposit_addresses: string[]; bond?: unknown },
  leaves: { leaf_index: number; deposit: { address: string } }[],
  party: string,
  notes: ScannedNote[],
): number | null {
  const excess = balanceExcessLeafIndex(party);
  if (excess !== null) return excess;
  const n = balanceLateNote(notes, party);
  return n ? balanceLateLeafIndex(m, leaves, n) : null;
}
// The note a balance-late party names (the scan's own identity), or undefined. an
// unkeyable note is an ERROR, never a silent disable — a note-shaped party outside the scanner's u16 range
// can never be keyed by note identity and is refused loudly.
export function balanceLateNote<T extends { txid: string; pool: string; action_index: number }>(notes: T[], party: string): T | undefined {
  const m = BALANCE_LATE.exec(party);
  if (!m) return undefined;
  requireThat(Number(m[3]) <= 65535, `unkeyable balance-late note identity ${party}; an unkeyable note is an ERROR`);
  return notes.find(n => n.txid === m[1] && String(n.pool) === m[2] && String(n.action_index) === m[3]);
}
// The leaf a balance-late row refunds to — the deposit slot's own leaf (the first note
// at that slot in leaf order, winner or loser). One shared rule for the plan, every signer host and verify.
export function balanceLateLeafIndex(
  m: { deposit_addresses: string[]; bond?: unknown },
  leaves: { leaf_index: number; deposit: { address: string } }[],
  note: { address: string },
): number | null {
  const slot = (m as BalanceWindowM).bond !== undefined ? (m as BalanceWindowM).bond.balance_addresses.indexOf(note.address) : -1;
  if (slot < 0) return null;
  const leaf = slotOrders(m, leaves).orders.find(l => l.deposit.address === m.deposit_addresses[slot]);
  return leaf ? leaf.leaf_index : null;
}
export function balanceSettlement(
  m: BalanceWindowM,
  result: { allocations: { leaf_index: number; fill: number; balance_due_zats?: string }[] },
  leaves: FrozenLeaf[],
  notes: ScannedNote[],
  tip: number,
  bondVoid = false, // A void bond settles no balance — every in-window note refunds in full on its excess row
): { sources: string[]; refunds: BalanceRefund[] } {
  requireThat(m.bond !== undefined, "balance notes are bond-then-pay only");
  const byLeaf = balanceAddressMap(result, leaves, m);
  const { start, end } = balanceWindow(m);
  // A late or excess refund row is derived only from notes with the
  // same confirmations rule as strays and sources (m.confirmations / ZIP-315's 10 — the stricter of the two).
  // Unmatured notes are invisible to the derivation entirely (not rows in `pending`): an in-model reorg can
  // never move a note across the window edge after it is counted, so plan, hosts and verify agree forever.
  const gate = Math.max(m.confirmations ?? 10, 10);
  const matured = (n: ScannedNote): boolean => !!n.height && tip - n.height + 1 >= gate;
  const seen = balanceMatured(m, notes, tip); // Classified only once matured
  const sources: string[] = [], refunds: BalanceRefund[] = [];
  for (const n of seen) {
    if (!n.height || BigInt(n.value_zats) === 0n) continue; // zero-value notes are never obligations
    // A note at a balance address whose slot has a leaf — winner OR loser — refunds
    // to that leaf through the same per-note row (only a paid winner's in-window notes are payment). A note
    // at the balance address of a slot with NO leaf is never swept and gets no row: nobody can claim it (the
    // README honest limits list it as unrecoverable).
    const leaf = balanceLateLeafIndex(m, leaves, n);
    if (leaf === null) continue;
    if (byLeaf.has(leaf) && n.height > start && n.height <= end) { if (!bondVoid) sources.push(`balance:${n.txid}:${n.pool}:${n.action_index}`); }
    else refunds.push({ party: balanceLateParty(n), leaf_index: leaf, amount_zats: String(n.value_zats), matured: matured(n), notes: [`${n.txid}:${n.pool}:${n.action_index}`] });
  }
  // In-window value at a winner's balance address that does NOT
  // settle becomes ONE immutable `balance-excess:<leaf_index>` refund row to that slot's own leaf — a paid
  // winner settles `balance_due_zats` and refunds the excess above it; a DEFAULTED winner refunds their
  // in-window payment IN FULL (a default forfeits the bond and the lot, never the balance money the bidder
  // sent). The vault keeps nothing at a balance address beyond what settles a paid winner's due. The row is
  // final (settlement derives it only after the window closes) and refunds exactly like a `balance-late:` row
  // (parked, claimable with that leaf's owner key, under the same confirmations gate — its backing is the
  // in-window notes).
  for (const [leaf, address] of [...byLeaf].sort((a, b) => a[0] - b[0])) {
    const due = BigInt(result.allocations.find(a => a.leaf_index === leaf)?.balance_due_zats ?? "0");
    const inNotes = seen.filter(n => n.address === address && n.height && n.height > start && n.height <= end && BigInt(n.value_zats) !== 0n);
    const total = inNotes.reduce((s, n) => s + BigInt(n.value_zats), 0n);
    const settledZats = !bondVoid && due > 0n && total >= due ? due : 0n; // a default settles nothing; nor does a void bond
    const excess = total - settledZats;
    // The excess row's backing is the in-window notes it is carved from — one note backs
    // at most one refund row across all row classes, enforced by the ledger's note-identity key.
    if (excess > 0n) refunds.push({ party: balanceExcessParty(leaf), leaf_index: leaf, amount_zats: String(excess), matured: inNotes.every(matured), notes: inNotes.map(n => `${n.txid}:${n.pool}:${n.action_index}`) });
  }
  return { sources, refunds: refunds.sort((a, b) => a.party.localeCompare(b.party)) };
}

export type SeriesLink = { series_id: string; round_index: number; previous_result_hash: string | null };
// Recurring rounds: each manifest links to the previous round's result hash; round 1 starts the chain
// with previous_result_hash null (enforced in manifest validation). checkSeriesLink checks a round against its
// predecessor (benzo verify --previous).
export function checkSeriesLink(current: SeriesLink | undefined, previous: { link: SeriesLink | undefined; result_hash: string }): void {
  requireThat(current !== undefined, "series linkage missing");
  requireThat(previous.link !== undefined && previous.link.series_id === current!.series_id, "series id");
  requireThat(current!.round_index === previous.link!.round_index + 1, "series round index");
  requireThat(current!.previous_result_hash === previous.result_hash, "series previous result hash");
}
