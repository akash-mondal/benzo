// Pure Mode B buyback clearing (DESIGN §7): sealed asks under the same C/tlock/freeze rules, with the treasury's
// budget and price floor in the signed manifest. Mirrors clear/core.ts rules, inverted: asks rank ascending (tie by
// committed leaf index), the uniform price is the highest accepted ask, and the budget caps spend at that price.
// Every leaf gets exact C back; fees come only from winner payments (PHASE-3 R2). Integers only; no clock or network.
import { hash, requireThat, validateManifest, verifyRecord, zats, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen } from "./merkle";
import type { ClearInput } from "./core";

export type Buyback = { budget_zats: string; floor_zats: string };
export type BuybackManifest = Omit<Manifest, "clearing"> & {
  clearing: Omit<Manifest["clearing"], "mode"> & { mode: "buyback" };
  buyback: Buyback;
};

// A buyback manifest is the Mode A manifest plus `buyback` and clearing.mode "buyback"; every other signed field is
// held to the unchanged Mode A rules. The signature covers the buyback fields like every other manifest byte.
export function clientBuyback(packet: Signed, trustedSigner: string): { manifest_hash: string; manifest: BuybackManifest } {
  const m = verifyRecord<any>(packet, trustedSigner);
  requireThat(m.clearing && m.clearing.mode === "buyback", "buyback clearing mode");
  requireThat(m.buyback && typeof m.buyback === "object" && !Array.isArray(m.buyback), "buyback parameters");
  requireThat(Object.keys(m.buyback).sort().join(",") === "budget_zats,floor_zats", "buyback field set");
  const base = { ...m, clearing: { ...m.clearing, mode: "uniform" as const }, buyback: undefined };
  delete base.buyback;
  validateManifest(base as Manifest);
  const tick = zats(m.tick_zats, "tick"), budget = zats(m.buyback.budget_zats, "budget"), floor = zats(m.buyback.floor_zats, "floor");
  requireThat(budget > 0n && floor >= tick && floor % tick === 0n, "buyback budget/floor");
  return { manifest_hash: hash(Buffer.from(packet.bytes, "base64")), manifest: m as BuybackManifest };
}
export const isBuyback = (m: Manifest): boolean => (m as unknown as BuybackManifest).clearing.mode === "buyback";

function calculate(input: ClearInput) {
  const { manifest: m, manifest_hash } = clientBuyback(input.manifest, input.signer);
  checkFrozen(input.frozen, m.auction_id, manifest_hash);
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const budget = zats(m.buyback.budget_zats, "budget"), floor = zats(m.buyback.floor_zats, "floor");
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
      else if (price > floor) reason = "above_floor";
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
  // Deposits fund refunds; the treasury leg funds payouts and fees.
  const total = C * BigInt(asks.length) + payout + fees;
  requireThat(total === payout + refunds + fees, "conservation");
  return { auction_id: m.auction_id, manifest_hash, freeze_root: input.frozen.root, mode: "buyback" as const,
    clearing_price_zats: clearingPrice.toString(), allocations,
    conservation: { input_zats: total.toString(), payout_zats: payout.toString(), refund_zats: refunds.toString(), fees_zats: fees.toString() } };
}

// Same result.json shape as Mode A with mode "buyback"; there is no Vickrey reference calculation.
export function clearModeB(input: ClearInput) {
  return { ...calculate(input), comparison: null };
}
