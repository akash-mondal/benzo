// PHASE-5 §11 gate CF core features, shared by every clearing mode through the registry (no per-mode copies):
// bid revision, multi-lot rounds, the sealed reserve/max price (R3 item 4), bond-then-pay balances and
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
export function readOrders(input: ClearInput, m: { auction_id: string; lots?: string[] }, layout: OrderLayout = LAYOUT_V0): OrderView[] {
  const lots = m.lots ?? null;
  const allowed = lots ?? [m.auction_id];
  requireThat(input.opened.length === input.frozen.leaf_count &&
    new Set(input.opened.map(o => o.leaf_index)).size === input.opened.length, "one opening per frozen leaf");
  const orders: OrderView[] = input.frozen.leaves.map(l => {
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

// The sealed price bound (gate CF, R3 item 4): a tlock ciphertext in the signed manifest whose 40-byte plaintext
// is u64be price_zats || auction_id, opened at R with the bids and re-derived by benzo verify. When present it
// tightens the mode's price bound and never loosens it: max() with the public reserve floor, min() with the
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

// Bond-then-pay (gate CF): C is the bond of bond_bps bps of the cap; a winner's balance = payment + fee - C is
// paid in the balance window. refundAfter/balanceDue generalize the Mode A identity to
// payment + refund + fee = C + balance_due and never go negative (without bond C covers the largest order).
export const balanceDue = (payment: bigint, fee: bigint, C: bigint): bigint => (payment + fee > C ? payment + fee - C : 0n);
export const refundAfter = (payment: bigint, fee: bigint, C: bigint): bigint => (C > fee + payment ? C - fee - payment : 0n);

// Part 2, collection drop (bond-then-pay with defaults): after the clear the operator publishes one fresh vault
// address per bonded winner (`balance_addresses` with the height `clear` observed, `clear_height`), and the winner
// pays balance_due_zats there within balance_window_blocks of that height. Defaults are NEVER operator input:
// every plan and every signer host derives them from its own scan with this one helper — a winner whose balance
// address received less than balance_due_zats in mined notes by clear_height + balance_window_blocks is a default.
export type BalanceBinding = { clear_height: number; balance_addresses: { leaf_index: number; ua: string }[] };
export type ScannedNote = { address: string; height: number | null; value_zats: number | string };
// One address per bonded winner, exactly: an omitted winner's payment would be invisible and its bond forfeited.
export function balanceAddressMap(
  result: { allocations: { leaf_index: number; fill: number }[] },
  bal: BalanceBinding,
): Map<number, string> {
  requireThat(Number.isSafeInteger(bal.clear_height) && bal.clear_height > 0, "clear height");
  requireThat(Array.isArray(bal.balance_addresses), "balance addresses");
  const winners = result.allocations.filter(a => a.fill > 0).map(a => a.leaf_index);
  const map = new Map<number, string>();
  for (const e of bal.balance_addresses as any[]) {
    requireThat(e && typeof e === "object" && !Array.isArray(e) && Object.keys(e).sort().join(",") === "leaf_index,ua" &&
      Number.isSafeInteger(e.leaf_index) && typeof e.ua === "string" && e.ua.length > 0, "balance address entry");
    requireThat(winners.includes(e.leaf_index) && !map.has(e.leaf_index), "balance address leaf");
    map.set(e.leaf_index, e.ua);
  }
  requireThat(map.size === winners.length, "balance addresses do not cover the bonded winners exactly");
  requireThat(new Set(map.values()).size === map.size, "duplicate balance address");
  return map;
}
export function balanceDefaults(
  m: { bond?: { balance_window_blocks: number } },
  result: { allocations: { leaf_index: number; fill: number; balance_due_zats?: string }[] },
  bal: BalanceBinding,
  notes: ScannedNote[],
  tip: number,
): number[] {
  requireThat(m.bond !== undefined, "defaults are bond-then-pay only");
  const byLeaf = balanceAddressMap(result, bal);
  const end = bal.clear_height + m.bond!.balance_window_blocks;
  requireThat(tip > end, "balance window has not passed; settlement waits");
  const defaults: number[] = [];
  for (const a of result.allocations) {
    const due = BigInt(a.balance_due_zats ?? "0");
    if (a.fill <= 0 || due === 0n) continue; // only a bonded winner owing a balance can default
    const got = notes.filter(n => n.address === byLeaf.get(a.leaf_index) && n.height && n.height <= end)
      .reduce((s, n) => s + BigInt(n.value_zats), 0n);
    if (got < due) defaults.push(a.leaf_index);
  }
  return defaults;
}

export type SeriesLink = { series_id: string; round_index: number; previous_result_hash: string | null };
// Recurring rounds (gate CF): each manifest links to the previous round's result hash; round 1 starts the chain
// with previous_result_hash null (enforced in manifest validation). checkSeriesLink checks a round against its
// predecessor (benzo verify --previous).
export function checkSeriesLink(current: SeriesLink | undefined, previous: { link: SeriesLink | undefined; result_hash: string }): void {
  requireThat(current !== undefined, "series linkage missing");
  requireThat(previous.link !== undefined && previous.link.series_id === current!.series_id, "series id");
  requireThat(current!.round_index === previous.link!.round_index + 1, "series round index");
  requireThat(current!.previous_result_hash === previous.result_hash, "series previous result hash");
}
