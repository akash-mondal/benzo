// Pure auction clearing: no clock, operator choices or network. Integers only, with rules bound by the manifest.
import { client, requireThat, zats, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, type Frozen } from "./merkle";
import { LAYOUT_V0, readOrder } from "./layout";
export type Opened = { leaf_index: number; plaintext_hex: string | null; error?: string };
export type ClearInput = { manifest: Signed; signer: string; frozen: Frozen; opened: Opened[] };
export type Allocation = { leaf_index: number; price_zats: string | null; quantity: number; fill: number; payment_zats: string; refund_zats: string; outcome: string };
export type ClearBody = {
  auction_id: string; manifest_hash: string; freeze_root: string; mode: string; clearing_price_zats: string;
  allocations: Allocation[];
  conservation: { input_zats: string; payout_zats: string; refund_zats: string; fees_zats: string; treasury_zats?: string };
};
export type ClearResult = ClearBody & { comparison: ClearBody | null };
function calculate(input: ClearInput, mode: "uniform" | "vickrey") {
  const {manifest:m,manifest_hash} = client(input.manifest,input.signer);
  checkFrozen(input.frozen,m.auction_id,manifest_hash);
  const C=zats(m.C_zats,"C"), fee=zats(m.fee_zats,"fee"), reserve=zats(m.reserve_zats,"reserve"), tick=zats(m.tick_zats,"tick"), cap=zats(m.B_max_zats,"B_max");
  requireThat(input.opened.length === input.frozen.leaf_count && new Set(input.opened.map(o=>o.leaf_index)).size === input.opened.length, "one opening per frozen leaf");
  const bids = input.frozen.leaves.map(l => {
    const o=input.opened.find(o=>o.leaf_index === l.leaf_index)!;
    let price=0n, quantity=0, reason="";
    if (o?.error === "reorg") reason="reorg";
    else if (!o || o.plaintext_hex === null) reason="undecryptable";
    else {
      const order=readOrder(LAYOUT_V0,o.plaintext_hex,m.auction_id); price=order.price; quantity=order.quantity; reason=order.reason;
      if (!reason) {
        if (!quantity || quantity > m.q_max || price > cap || price % tick !== 0n || price * BigInt(quantity) + fee > C) reason="over_cap";
        else if (price < reserve) reason="below_reserve";
      }
    }
    return {leaf_index:l.leaf_index,price,quantity,reason,fill:0};
  });
  const ranked=bids.filter(b=>!b.reason).sort((a,b)=>a.price !== b.price ? (a.price > b.price ? -1:1) : a.leaf_index-b.leaf_index);
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
    if (bids.reduce((n,b)=>n+b.fill,0) < m.clearing.minimum_fill) { for (const b of bids) b.fill=0; clearingPrice=0n; }
  }
  let payout=0n, refunds=0n;
  const allocations=bids.map(b=> {
    const paid=clearingPrice*BigInt(b.fill), refund=C-fee-paid; payout+=paid; refunds+=refund;
    return {leaf_index:b.leaf_index,price_zats:mode === "vickrey" ? null:b.price.toString(),quantity:b.quantity,
      fill:b.fill,payment_zats:paid.toString(),refund_zats:refund.toString(),outcome:b.reason || (b.fill ? "winner":"unfilled")};
  });
  const total=C*BigInt(bids.length), fees=fee*BigInt(bids.length);
  requireThat(total === payout+refunds+fees, "conservation");
  return {auction_id:m.auction_id,manifest_hash,freeze_root:input.frozen.root,mode,clearing_price_zats:clearingPrice.toString(),allocations,
    conservation:{input_zats:total.toString(),payout_zats:payout.toString(),refund_zats:refunds.toString(),fees_zats:fees.toString()}};
}

// The signed manifest selects settlement; the reference Vickrey calculation is deterministic too.
export function clear(input: ClearInput) {
  const mode=client(input.manifest,input.signer).manifest.clearing.mode;
  return {...calculate(input,mode),comparison:mode === "uniform" ? calculate(input,"vickrey") : null};
}

// Mode A money rules, verify-side: every allocation accounts for C (payment + refund + fee) and the payout is the
// seller's row. benzo verify's accounting check reaches this through the mode registry, never a per-mode copy.
export function checkResultModeA(m: Manifest, result: ClearBody): void {
  const fee = zats(m.fee_zats, "fee"), C = zats(m.C_zats, "C");
  for (const a of result.allocations)
    requireThat(BigInt(a.payment_zats) + BigInt(a.refund_zats) + fee === C, `allocation ${a.leaf_index} does not account C`);
}
export function obligationsModeA(result: ClearBody): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of result.allocations) {
    const owed = BigInt(a.refund_zats);
    if (owed > 0n) map.set(`leaf:${a.leaf_index}`, owed.toString());
  }
  if (BigInt(result.conservation.payout_zats) > 0n) map.set("seller", result.conservation.payout_zats);
  return map;
}
