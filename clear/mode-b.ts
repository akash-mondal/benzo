// Pure Mode B buyback clearing (DESIGN §7): sealed asks under the same C/tlock/freeze rules, with the treasury's
// budget and maximum price in the signed manifest. Mirrors clear/core.ts rules, inverted: asks rank ascending (tie by
// committed leaf index), the uniform price is the highest accepted ask, and the budget caps spend at that price.
// Every leaf gets exact C back; fees come only from winner payments (PHASE-3 R2). Integers only; no clock or network.
import { hash, requireThat, validateManifest, verifyRecord, zats, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen } from "./merkle";
import { effectiveMaxPrice, readOrders, sealedReserve } from "./features";
import type { ClearBody, ClearInput, SettlementExtras } from "./core";

// R3 item 4: max_price_zats is the treasury's maximum accepted ask (was floor_zats). Design §6.1: treasury_ua is where
// unspent budget returns; funding_ua is the vault address the treasury funds (not a deposit address, so it is never a
// bid or a stray). Both are signed, so every signer derives the treasury row from signed data and its own scan.
export type Buyback = { budget_zats: string; max_price_zats: string; treasury_ua: string; funding_ua: string };
export type BuybackManifest = Omit<Manifest, "clearing"> & {
  clearing: Omit<Manifest["clearing"], "mode"> & { mode: "buyback" };
  buyback: Buyback;
};

// A buyback manifest is the Mode A manifest plus `buyback` (with clearing.mode "buyback"); every other signed
// field is held to the unchanged Mode A rules. The signature covers the buyback fields like every manifest byte.
export function clientPhase5(packet: Signed, trustedSigner: string): { manifest_hash: string; manifest: BuybackManifest } {
  const m = verifyRecord<any>(packet, trustedSigner);
  validatePhase5(m);
  return { manifest_hash: hash(Buffer.from(packet.bytes, "base64")), manifest: m as BuybackManifest };
}
// The unsigned-manifest rules (also `benzo auction create` for a buyback draft).
export function validatePhase5(m: any): void {
  requireThat(m.clearing && ["uniform", "vickrey", "buyback"].includes(m.clearing.mode), "clearing mode");
  requireThat((m.clearing.mode === "buyback") === (m.buyback !== undefined), "buyback parameters/mode");
  if (m.buyback !== undefined) {
    requireThat(m.buyback && typeof m.buyback === "object" && !Array.isArray(m.buyback), "buyback parameters");
    requireThat(Object.keys(m.buyback).sort().join(",") === "budget_zats,funding_ua,max_price_zats,treasury_ua", "buyback field set");
    const ua = m.network === "main" ? /^u1[0-9a-z]+$/ : /^utest1[0-9a-z]+$/;
    requireThat(ua.test(m.buyback.treasury_ua) && ua.test(m.buyback.funding_ua), "buyback treasury_ua/funding_ua");
    requireThat(m.buyback.treasury_ua !== m.buyback.funding_ua && !(m.deposit_addresses ?? []).includes(m.buyback.funding_ua) && !(m.deposit_addresses ?? []).includes(m.buyback.treasury_ua), "buyback funding_ua must be a non-deposit vault address distinct from treasury_ua");
    // Bond-then-pay is buyer-side (a defaulter's bond goes to the seller); a buyback winner is a seller.
    requireThat(m.bond === undefined, "bond-then-pay is auction-side");
    requireThat(m.serials === undefined, "serials are uniform auction-side");
  }
  const base = { ...m, clearing: { ...m.clearing, mode: m.clearing.mode === "buyback" ? "uniform" : m.clearing.mode }, buyback: undefined };
  delete base.buyback;
  validateManifest(base as Manifest);
  if (m.buyback !== undefined) {
    const tick = zats(m.tick_zats, "tick"), budget = zats(m.buyback.budget_zats, "budget"), maxPrice = zats(m.buyback.max_price_zats, "max_price");
    requireThat(budget > 0n && maxPrice >= tick && maxPrice % tick === 0n, "buyback budget/max_price");
  }
}
// Design §6.1: what the treasury must fund (budget per lot) and what returns to it. `funded` counts every mined note
// ever received at funding_ua (spent or not: a later batch must see the same number). A cancelled round (no result)
// returns everything funded.
// Part 2: the treasury leg of any mode that has one — a buyback, or an RFQ whose buyer funds the budget. Its signed
// treasury_ua/funding_ua play the same role in both.
export type TreasuryBlock = { budget_zats: string; treasury_ua: string; funding_ua: string; lots: number };
export function treasuryBlock(m: any): TreasuryBlock | null {
  const b = m?.clearing?.mode === "buyback" ? m.buyback : m?.clearing?.mode === "rfq" && m.rfq?.treasury_ua ? m.rfq : null;
  return b ? { budget_zats: b.budget_zats, treasury_ua: b.treasury_ua, funding_ua: b.funding_ua, lots: m.lots?.length ?? 1 } : null;
}
export const treasuryRequired = (m: any): bigint => { const t = treasuryBlock(m)!; return zats(t.budget_zats, "budget") * BigInt(t.lots); };
export function treasuryFunded(m: any, notes: { address: string; height: number | null; value_zats: number | string }[], confirmedAt?: number): bigint {
  return notes.filter(n => n.address === treasuryBlock(m)!.funding_ua && n.height && (confirmedAt === undefined || confirmedAt - n.height + 1 >= m.confirmations))
    .reduce((s, n) => s + BigInt(n.value_zats), 0n);
}
export function treasuryReturn(m: any, result: ClearBody | null, funded: bigint): bigint {
  const spent = result ? zats(result.conservation.treasury_zats ?? "0", "treasury") : 0n;
  requireThat(funded >= spent, "treasury funding below the cleared spend");
  return funded - spent;
}
export function clientBuyback(packet: Signed, trustedSigner: string): { manifest_hash: string; manifest: BuybackManifest } {
  const r = clientPhase5(packet, trustedSigner);
  requireThat(r.manifest.clearing.mode === "buyback" && r.manifest.buyback, "buyback clearing mode");
  return r;
}

function calculate(input: ClearInput) {
  const { manifest: m, manifest_hash } = clientBuyback(input.manifest, input.signer);
  checkFrozen(input.frozen, m.auction_id, manifest_hash);
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const budget = zats(m.buyback.budget_zats, "budget");
  // Gate CF: the sealed max price (R3 item 4) tightens the treasury cap; readOrders marks superseded revisions
  // and binds each ask to its lot. Bond-then-pay is buyer-side and refused for buyback manifests.
  const maxPrice = effectiveMaxPrice(m, sealedReserve(m, input.reserve_opening, tick));
  const orders = readOrders(input, m);
  const asks = orders.map(o => {
    let { price, quantity, reason } = o;
    if (!reason) {
      if (!price || !quantity || quantity > m.q_max || price > cap || price % tick !== 0n || price * BigInt(quantity) + fee > C) reason = "over_cap";
      else if (price > maxPrice) reason = "above_max_price";
    }
    // lot is null (not undefined) for single-lot rounds so per-lot maps and filters treat it as one lot.
    return { leaf_index: o.leaf_index, lot: o.lot ?? null, price, quantity, reason, fill: 0 };
  });
  const lotPrice = new Map<string | null, bigint>();
  for (const lot of m.lots ?? [null]) {
    // Lowest asks first; equal asks tie by the committed leaf index, never by reveal order. Each lot is its own
    // buyback leg with the manifest's budget (multi-lot rounds clear distinct lots in one round).
    const ranked = asks.filter(a => !a.reason && a.lot === lot).sort((a, b) => a.price !== b.price ? (a.price < b.price ? -1 : 1) : a.leaf_index - b.leaf_index);
    let clearingPrice = 0n, filled = 0;
    for (let start = 0; start < ranked.length;) {
      let end = start + 1; while (end < ranked.length && ranked[end].price === ranked[start].price) end++;
      const band = ranked.slice(start, end), p = band[0].price, demand = band.reduce((n, b) => n + BigInt(b.quantity), 0n);
      // At uniform price p the treasury pays p for every accepted unit, so the budget allows floor(budget/p) in total.
      const room = budget / p - BigInt(filled);
      if (room <= 0n) break;
      if (demand <= room) for (const b of band) b.fill = b.quantity;
      else {
        for (const b of band) b.fill = Number(room * BigInt(b.quantity) / demand);
        let dust = Number(room) - band.reduce((n, b) => n + b.fill, 0);
        for (const b of band) { if (dust > 0 && b.fill < b.quantity) { b.fill++; dust--; } }
      }
      filled += band.reduce((n, b) => n + b.fill, 0);
      clearingPrice = p; start = end;
      if (demand > room) break;
    }
    if (asks.filter(a => a.lot === lot).reduce((n, a) => n + a.fill, 0) < m.clearing.minimum_fill) {
      for (const a of asks) if (a.lot === lot) a.fill = 0;
      clearingPrice = 0n;
    }
    lotPrice.set(lot, clearingPrice);
  }
  let payout = 0n, refunds = 0n, fees = 0n;
  const allocations = asks.map(a => {
    const clearingPrice = lotPrice.get(a.lot) ?? 0n;
    const gross = clearingPrice * BigInt(a.fill), feeShare = a.fill ? (fee < gross ? fee : gross) : 0n;
    const payment = gross - feeShare, refund = C;
    payout += payment; refunds += refund; fees += feeShare;
    return { leaf_index: a.leaf_index, ...(m.lots ? { lot: a.lot! } : {}), price_zats: a.price.toString(), quantity: a.quantity, fill: a.fill,
      payment_zats: payment.toString(), refund_zats: refund.toString(), outcome: a.reason || (a.fill ? "winner" : "unfilled") };
  });
  // Real invariants (R4 item 3) on the computed result: the uniform-price spend fits the budget, no fill exceeds
  // its ask's quantity, and no winner's ask exceeds the clearing price. Deposits fund refunds; the treasury leg
  // funds payouts and fees, and conservation names it explicitly as treasury_zats = payout + fees.
  const treasury = payout + fees, totalFill = asks.reduce((n, a) => n + a.fill, 0);
  for (const lot of m.lots ?? [null]) {
    const lotFill = asks.filter(a => a.lot === lot).reduce((n, a) => n + a.fill, 0);
    requireThat((lotPrice.get(lot) ?? 0n) * BigInt(lotFill) <= budget, "budget exceeded");
    for (const a of asks.filter(x => x.lot === lot && x.fill))
      requireThat(a.price <= (lotPrice.get(lot) ?? 0n), `allocation ${a.leaf_index} ask above clearing price`);
  }
  for (const a of asks) requireThat(a.fill <= a.quantity, `allocation ${a.leaf_index} fill exceeds quantity`);
  return { auction_id: m.auction_id, manifest_hash, freeze_root: input.frozen.root, mode: "buyback" as const,
    clearing_price_zats: (lotPrice.get(null) ?? 0n).toString(),
    ...(m.lots ? { lots: (m.lots as string[]).map(lot_id => ({ lot_id, clearing_price_zats: (lotPrice.get(lot_id) ?? 0n).toString() })) } : {}),
    allocations,
    conservation: { input_zats: (C * BigInt(asks.length) + treasury).toString(), payout_zats: payout.toString(), refund_zats: refunds.toString(), fees_zats: fees.toString(), treasury_zats: treasury.toString() } };
}

// Same result.json shape as Mode A with mode "buyback"; there is no Vickrey reference calculation.
export function clearModeB(input: ClearInput) {
  return { ...calculate(input), comparison: null };
}

// Verify-side money invariants for a published Mode B result (R4 item 3): the same invariants calculate enforces,
// plus the recorded treasury leg and the exact-C refunds with fees taken only from winner payments. benzo verify's
// accounting check runs this on the published result, so a corrupted one is refused on its own numbers.
export function checkResultBuyback(m: BuybackManifest, result: ClearBody): void {
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), budget = zats(m.buyback.budget_zats, "budget");
  const c = result.conservation;
  requireThat(c.treasury_zats !== undefined && zats(c.treasury_zats, "treasury") === zats(c.payout_zats, "payout") + zats(c.fees_zats, "fees"), "treasury_zats is not payout + fees");
  // Multi-lot buyback rounds clear each lot at its own price with the manifest's budget per lot.
  const priceOf = (a: ClearBody["allocations"][number]): bigint => {
    if (m.lots === undefined) { requireThat(a.lot === undefined && result.lots === undefined, "lots without manifest lots"); return zats(result.clearing_price_zats, "clearing price"); }
    requireThat(Array.isArray(result.lots) && result.lots.map(l => l.lot_id).join(",") === m.lots.join(","), "lots");
    const lot = result.lots!.find(l => l.lot_id === a.lot);
    requireThat(lot, `allocation ${a.leaf_index} lot`);
    return zats(lot!.clearing_price_zats, "lot clearing price");
  };
  const fillByLot = new Map<string | null, bigint>();
  for (const a of result.allocations) {
    requireThat(Number.isInteger(a.fill) && a.fill >= 0 && a.fill <= a.quantity, `allocation ${a.leaf_index} fill exceeds quantity`);
    const price = priceOf(a);
    const gross = price * BigInt(a.fill), feeShare = a.fill ? (fee < gross ? fee : gross) : 0n;
    requireThat(BigInt(a.payment_zats) + feeShare === gross, `allocation ${a.leaf_index} payment`);
    requireThat(BigInt(a.refund_zats) === C, `allocation ${a.leaf_index} refund is not exact C`);
    if (a.fill) requireThat(a.price_zats !== null && BigInt(a.price_zats) <= price, `allocation ${a.leaf_index} ask above clearing price`);
    fillByLot.set(a.lot ?? null, (fillByLot.get(a.lot ?? null) ?? 0n) + BigInt(a.fill));
    requireThat(price * (fillByLot.get(a.lot ?? null) ?? 0n) <= budget, "budget exceeded");
  }
}

// Mode B settlement rows: one obligation per leaf for refund + payment (the treasury is the funding leg).
// Bond-then-pay is auction-side: a buyback settlement carries no defaults.
export function obligationsModeB(result: ClearBody, settlement?: SettlementExtras | null): Map<string, string> {
  requireThat((settlement?.defaults ?? []).length === 0, "defaults are auction-side");
  const map = new Map<string, string>();
  for (const a of result.allocations) {
    const owed = BigInt(a.refund_zats) + BigInt(a.payment_zats);
    if (owed > 0n) map.set(`leaf:${a.leaf_index}`, owed.toString());
  }
  return map;
}
