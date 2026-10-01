// Pure Mode B buyback clearing (DESIGN §7): sealed asks under the same C/tlock/freeze rules, with the treasury's
// budget and maximum price in the signed manifest. Mirrors clear/core.ts rules, inverted: asks rank ascending (tie by
// committed leaf index), the uniform price is the highest accepted ask, and the budget caps spend at that price.
// Every leaf gets exact C back; fees come only from winner payments (PHASE-3 R2). Integers only; no clock or network.
import { hash, requireThat, validateManifest, verifyRecord, zats, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen } from "./merkle";
import type { ClearInput } from "./core";

// R3 item 4: max_price_zats is the treasury's maximum accepted ask (was floor_zats).
export type Buyback = { budget_zats: string; max_price_zats: string };
export type BuybackManifest = Omit<Manifest, "clearing"> & {
  clearing: Omit<Manifest["clearing"], "mode"> & { mode: "buyback" };
  buyback: Buyback;
};

// A buyback manifest is the Mode A manifest plus `buyback` (with clearing.mode "buyback"); every other signed
// field is held to the unchanged Mode A rules. The signature covers the buyback fields like every manifest byte.
export function clientPhase5(packet: Signed, trustedSigner: string): { manifest_hash: string; manifest: BuybackManifest } {
  const m = verifyRecord<any>(packet, trustedSigner);
  requireThat(m.clearing && ["uniform", "vickrey", "buyback"].includes(m.clearing.mode), "clearing mode");
  requireThat((m.clearing.mode === "buyback") === (m.buyback !== undefined), "buyback parameters/mode");
  if (m.buyback !== undefined) {
    requireThat(m.buyback && typeof m.buyback === "object" && !Array.isArray(m.buyback), "buyback parameters");
    requireThat(Object.keys(m.buyback).sort().join(",") === "budget_zats,max_price_zats", "buyback field set");
  }
  const base = { ...m, clearing: { ...m.clearing, mode: m.clearing.mode === "buyback" ? "uniform" : m.clearing.mode }, buyback: undefined };
  delete base.buyback;
  validateManifest(base as Manifest);
  if (m.buyback !== undefined) {
    const tick = zats(m.tick_zats, "tick"), budget = zats(m.buyback.budget_zats, "budget"), maxPrice = zats(m.buyback.max_price_zats, "max_price");
    requireThat(budget > 0n && maxPrice >= tick && maxPrice % tick === 0n, "buyback budget/max_price");
  }
  return { manifest_hash: hash(Buffer.from(packet.bytes, "base64")), manifest: m as BuybackManifest };
}
export function clientBuyback(packet: Signed, trustedSigner: string): { manifest_hash: string; manifest: BuybackManifest } {
  const r = clientPhase5(packet, trustedSigner);
  requireThat(r.manifest.clearing.mode === "buyback" && r.manifest.buyback, "buyback clearing mode");
  return r;
}
export const isBuyback = (m: Manifest): boolean => (m as unknown as BuybackManifest).clearing.mode === "buyback";

function calculate(input: ClearInput) {
  const { manifest: m, manifest_hash } = clientBuyback(input.manifest, input.signer);
  checkFrozen(input.frozen, m.auction_id, manifest_hash);
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const budget = zats(m.buyback.budget_zats, "budget"), maxPrice = zats(m.buyback.max_price_zats, "max_price");
  requireThat(input.opened.length === input.frozen.leaf_count && new Set(input.opened.map(o => o.leaf_index)).size === input.opened.length, "one opening per frozen leaf");
  const asks = input.frozen.leaves.map(l => {
    const o = input.opened.find(o => o.leaf_index === l.leaf_index)!;
    let price = 0n, quantity = 0, reason = "";
    if (o?.error === "reorg") reason = "reorg";
    else if (!o || o.plaintext_hex === null) reason = "undecryptable";
    else if (!/^[0-9a-f]{256}$/.test(o.plaintext_hex)) reason = "plaintext_length";
    else {
      const pt = Buffer.from(o.plaintext_hex, "hex"); price = pt.readBigUInt64BE(33); quantity = pt.readUInt32BE(41);
      if (pt[0] !== 0 || !pt.subarray(125).equals(Buffer.alloc(3)) || pt.subarray(1, 33).toString("hex") !== m.auction_id) reason = "plaintext_binding";
      else if (!price || !quantity || quantity > m.q_max || price > cap || price % tick !== 0n || price * BigInt(quantity) + fee > C) reason = "over_cap";
      else if (price > maxPrice) reason = "above_max_price";
    }
    return { leaf_index: l.leaf_index, price, quantity, reason, fill: 0 };
  });
  // Lowest asks first; equal asks tie by the committed leaf index, never by reveal order.
  const ranked = asks.filter(a => !a.reason).sort((a, b) => a.price !== b.price ? (a.price < b.price ? -1 : 1) : a.leaf_index - b.leaf_index);
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
  if (asks.reduce((n, b) => n + b.fill, 0) < m.clearing.minimum_fill) { for (const b of asks) b.fill = 0; clearingPrice = 0n; }
  let payout = 0n, refunds = 0n, fees = 0n;
  const allocations = asks.map(a => {
    const gross = clearingPrice * BigInt(a.fill), feeShare = a.fill ? (fee < gross ? fee : gross) : 0n;
    const payment = gross - feeShare, refund = C;
    payout += payment; refunds += refund; fees += feeShare;
    return { leaf_index: a.leaf_index, price_zats: a.price.toString(), quantity: a.quantity, fill: a.fill,
      payment_zats: payment.toString(), refund_zats: refund.toString(), outcome: a.reason || (a.fill ? "winner" : "unfilled") };
  });
  // Real invariants (R4 item 3) on the computed result: the uniform-price spend fits the budget, no fill exceeds
  // its ask's quantity, and no winner's ask exceeds the clearing price. Deposits fund refunds; the treasury leg
  // funds payouts and fees, and conservation names it explicitly as treasury_zats = payout + fees.
  const treasury = payout + fees, totalFill = asks.reduce((n, a) => n + a.fill, 0);
  requireThat(clearingPrice * BigInt(totalFill) <= budget, "budget exceeded");
  for (const a of asks) {
    requireThat(a.fill <= a.quantity, `allocation ${a.leaf_index} fill exceeds quantity`);
    if (a.fill) requireThat(a.price <= clearingPrice, `allocation ${a.leaf_index} ask above clearing price`);
  }
  return { auction_id: m.auction_id, manifest_hash, freeze_root: input.frozen.root, mode: "buyback" as const,
    clearing_price_zats: clearingPrice.toString(), allocations,
    conservation: { input_zats: (C * BigInt(asks.length) + treasury).toString(), payout_zats: payout.toString(), refund_zats: refunds.toString(), fees_zats: fees.toString(), treasury_zats: treasury.toString() } };
}

// Same result.json shape as Mode A with mode "buyback"; there is no Vickrey reference calculation.
export function clearModeB(input: ClearInput) {
  return { ...calculate(input), comparison: null };
}

// Verify-side money invariants for a published Mode B result (R4 item 3): the same invariants calculate enforces,
// plus the recorded treasury leg and the exact-C refunds with fees taken only from winner payments. benzo verify's
// accounting check runs this on the published result, so a corrupted one is refused on its own numbers.
export function checkResultBuyback(m: BuybackManifest, result: {
  clearing_price_zats: string;
  allocations: { leaf_index: number; price_zats: string | null; quantity: number; fill: number; payment_zats: string; refund_zats: string }[];
  conservation: { input_zats: string; payout_zats: string; refund_zats: string; fees_zats: string; treasury_zats?: string };
}): void {
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), budget = zats(m.buyback.budget_zats, "budget");
  const price = zats(result.clearing_price_zats, "clearing price");
  const c = result.conservation;
  requireThat(c.treasury_zats !== undefined && zats(c.treasury_zats, "treasury") === zats(c.payout_zats, "payout") + zats(c.fees_zats, "fees"), "treasury_zats is not payout + fees");
  let totalFill = 0;
  for (const a of result.allocations) {
    requireThat(Number.isInteger(a.fill) && a.fill >= 0 && a.fill <= a.quantity, `allocation ${a.leaf_index} fill exceeds quantity`);
    const gross = price * BigInt(a.fill), feeShare = a.fill ? (fee < gross ? fee : gross) : 0n;
    requireThat(BigInt(a.payment_zats) + feeShare === gross, `allocation ${a.leaf_index} payment`);
    requireThat(BigInt(a.refund_zats) === C, `allocation ${a.leaf_index} refund is not exact C`);
    if (a.fill) requireThat(a.price_zats !== null && BigInt(a.price_zats) <= price, `allocation ${a.leaf_index} ask above clearing price`);
    totalFill += a.fill;
  }
  requireThat(price * BigInt(totalFill) <= budget, "budget exceeded");
}
