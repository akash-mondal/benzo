// Pure auction clearing: no clock, operator choices or network. Integers only, with rules bound by the manifest.
import { client, requireThat, zats, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, type Frozen } from "./merkle";
import { balanceDue, effectiveReserve, readOrders, refundAfter, sealedReserve } from "./features";
export type Opened = { leaf_index: number; plaintext_hex: string | null; error?: string };
export type ClearInput = { manifest: Signed; signer: string; frozen: Frozen; opened: Opened[]; reserve_opening?: string | null };
export type Allocation = {
  leaf_index: number; price_zats: string | null; quantity: number; fill: number; payment_zats: string; refund_zats: string; outcome: string;
  lot?: string; balance_due_zats?: string;
};
export type ClearBody = {
  auction_id: string; manifest_hash: string; freeze_root: string; mode: string; clearing_price_zats: string;
  allocations: Allocation[];
  conservation: { input_zats: string; payout_zats: string; refund_zats: string; fees_zats: string; treasury_zats?: string; balances_zats?: string };
  lots?: { lot_id: string; clearing_price_zats: string }[];
};
// Settlement-side extras the money rules may account for (gate CF: which winners defaulted on their balance).
export type SettlementExtras = { defaults?: number[] };
export type ClearResult = ClearBody & { comparison: ClearBody | null };
function calculate(input: ClearInput, mode: "uniform" | "vickrey") {
  const {manifest:m,manifest_hash} = client(input.manifest,input.signer);
  checkFrozen(input.frozen,m.auction_id,manifest_hash);
  const C=zats(m.C_zats,"C"), fee=zats(m.fee_zats,"fee"), tick=zats(m.tick_zats,"tick"), cap=zats(m.B_max_zats,"B_max");
  // Gate CF: the sealed reserve tightens the floor; readOrders binds each order to its lot (or the auction) and
  // marks superseded revisions, so only the latest order per (owner key, lot) can rank.
  const reserve = effectiveReserve(m, sealedReserve(m, input.reserve_opening, tick));
  const orders = readOrders(input, m);
  const bids = orders.map(o => {
    let {price,quantity,reason} = o;
    if (!reason) {
      // With bond-then-pay C is only the bond and the balance is paid later, so C need not cover the order.
      if (!quantity || quantity > m.q_max || price > cap || price % tick !== 0n ||
          (m.bond === undefined && price * BigInt(quantity) + fee > C)) reason="over_cap";
      else if (price < reserve) reason="below_reserve";
    }
    // lot is null (not undefined) for single-lot rounds so per-lot maps and filters treat it as one lot.
    return {leaf_index:o.leaf_index,lot:o.lot ?? null,price,quantity,reason,fill:0};
  });
  const lotPrice = new Map<string | null, bigint>();
  for (const lot of m.lots ?? [null]) {
    const ranked=bids.filter(b=>!b.reason && b.lot===lot).sort((a,b)=>a.price !== b.price ? (a.price > b.price ? -1:1) : a.leaf_index-b.leaf_index);
    let clearingPrice=0n;
    if (mode === "vickrey") {
      if (ranked.length) { ranked[0].fill=1; clearingPrice=ranked[1]?.price ?? reserve; }
    } else {
      let left=m.supply;
      for (let start=0;start<ranked.length && left>0;) {
        let end=start+1; while (end<ranked.length && ranked[end].price === ranked[start].price) end++;
        const band=ranked.slice(start,end), demand=band.reduce((n,b)=>n+BigInt(b.quantity),0n);
        if (demand <= BigInt(left)) { for (const b of band) b.fill=b.quantity; left-=Number(demand); }
        else {
          for (const b of band) b.fill=Number(BigInt(left)*BigInt(b.quantity)/demand);
          let dust=left-band.reduce((n,b)=>n+b.fill,0);
          // Equal fractional dust is assigned by the committed leaf index, never by reveal order.
          for (const b of band) { if (dust>0 && b.fill<b.quantity) { b.fill++; dust--; } }
          left=0;
        }
        clearingPrice=band[0].price; start=end;
      }
    }
    if (bids.filter(b=>b.lot===lot).reduce((n,b)=>n+b.fill,0) < m.clearing.minimum_fill) {
      for (const b of bids) if (b.lot===lot) b.fill=0;
      clearingPrice=0n;
    }
    lotPrice.set(lot, clearingPrice);
  }
  let payout=0n, refunds=0n, balances=0n;
  const allocations=bids.map(b=> {
    const paid=(lotPrice.get(b.lot) ?? 0n)*BigInt(b.fill), refund=refundAfter(paid,fee,C), balance=m.bond ? balanceDue(paid,fee,C) : 0n;
    payout+=paid; refunds+=refund; balances+=balance;
    return {leaf_index:b.leaf_index,...(m.lots ? {lot:b.lot!} : {}),price_zats:mode === "vickrey" ? null:b.price.toString(),quantity:b.quantity,
      fill:b.fill,payment_zats:paid.toString(),refund_zats:refund.toString(),...(m.bond ? {balance_due_zats:balance.toString()} : {}),
      outcome:b.reason || (b.fill ? "winner":"unfilled")};
  });
  const total=C*BigInt(bids.length), fees=fee*BigInt(bids.length);
  requireThat(total+balances === payout+refunds+fees, "conservation");
  return {auction_id:m.auction_id,manifest_hash,freeze_root:input.frozen.root,mode,
    // Multi-lot rounds clear each lot at its own price (lots[]); the top-level price is for the single lot.
    clearing_price_zats:(lotPrice.get(null) ?? 0n).toString(),
    ...(m.lots ? {lots:(m.lots as string[]).map(lot_id => ({lot_id,clearing_price_zats:(lotPrice.get(lot_id) ?? 0n).toString()}))} : {}),
    allocations,
    conservation:{input_zats:total.toString(),payout_zats:payout.toString(),refund_zats:refunds.toString(),fees_zats:fees.toString(),
      ...(m.bond ? {balances_zats:balances.toString()} : {})}};
}

// The signed manifest selects settlement; the reference Vickrey calculation is deterministic too.
export function clear(input: ClearInput) {
  const mode=client(input.manifest,input.signer).manifest.clearing.mode;
  return {...calculate(input,mode),comparison:mode === "uniform" ? calculate(input,"vickrey") : null};
}

// Mode A money rules, verify-side: every allocation accounts for C (payment + refund + fee) and the payout is the
// seller's row. With bond-then-pay the identity becomes payment + refund + fee = C + balance_due_zats with exact
// balances and refunds; with multi-lot rounds every allocation names its lot and pays that lot's price. benzo
// verify's accounting check reaches this through the mode registry, never a per-mode copy.
export function checkResultModeA(m: Manifest, result: ClearBody): void {
  const fee = zats(m.fee_zats, "fee"), C = zats(m.C_zats, "C");
  requireThat((m.bond !== undefined) === result.allocations.every(a => a.balance_due_zats !== undefined) &&
    (m.bond !== undefined) === (result.conservation.balances_zats !== undefined), "bond/balance fields");
  let balances = 0n;
  for (const a of result.allocations) {
    const payment = BigInt(a.payment_zats), refund = BigInt(a.refund_zats);
    if (m.bond !== undefined) {
      const balance = balanceDue(payment, fee, C);
      requireThat(a.balance_due_zats !== undefined && BigInt(a.balance_due_zats) === balance, `allocation ${a.leaf_index} balance due`);
      requireThat(refund === refundAfter(payment, fee, C), `allocation ${a.leaf_index} refund`);
      balances += balance;
    } else {
      requireThat(payment + refund + fee === C, `allocation ${a.leaf_index} does not account C`);
    }
  }
  if (m.bond !== undefined)
    requireThat(result.conservation.balances_zats !== undefined && BigInt(result.conservation.balances_zats) === balances, "balances total");
  if (m.lots !== undefined) {
    requireThat(Array.isArray(result.lots) && result.lots.map(l => l.lot_id).join(",") === m.lots.join(","), "lots");
    for (const a of result.allocations) {
      const lot = result.lots!.find(l => l.lot_id === a.lot);
      requireThat(lot, `allocation ${a.leaf_index} lot`);
      requireThat(BigInt(a.payment_zats) === zats(lot!.clearing_price_zats, "lot clearing price") * BigInt(a.fill), `allocation ${a.leaf_index} payment`);
    }
  } else {
    requireThat(result.lots === undefined && result.allocations.every(a => a.lot === undefined), "lots without manifest lots");
    for (const a of result.allocations)
      requireThat(BigInt(a.payment_zats) === zats(result.clearing_price_zats, "clearing price") * BigInt(a.fill), `allocation ${a.leaf_index} payment`);
  }
}
export function obligationsModeA(result: ClearBody, settlement?: SettlementExtras | null): Map<string, string> {
  const map = new Map<string, string>();
  const defaults = settlement?.defaults ?? [];
  requireThat(new Set(defaults).size === defaults.length, "duplicate default");
  requireThat(defaults.length === 0 || result.allocations.every(a => a.balance_due_zats !== undefined), "defaults without bond");
  let seller = BigInt(result.conservation.payout_zats);
  for (const a of result.allocations) {
    if (defaults.includes(a.leaf_index)) {
      // Forfeit (gate CF): the defaulter never pays their balance and their fill yields the vaulted bond net of
      // fees to the seller instead of the payment (payment + refund - balance_due = C - fee). Since payout already
      // counts their would-be payment, the seller row moves by refund - balance_due; the fill is never re-cleared.
      requireThat(a.fill > 0 && BigInt(a.balance_due_zats ?? "0") > 0n, `default for leaf ${a.leaf_index} that owes no balance`);
      seller += BigInt(a.refund_zats) - BigInt(a.balance_due_zats!);
      continue;
    }
    const owed = BigInt(a.refund_zats);
    if (owed > 0n) map.set(`leaf:${a.leaf_index}`, owed.toString());
  }
  if (seller > 0n) map.set("seller", seller.toString());
  return map;
}
