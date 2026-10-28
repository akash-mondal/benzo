// Two pinned one-time parties seal their max/min; both limits become public at R.
// Match at floor((max+min)/2) zatoshis iff max >= min; otherwise exact-C refunds, no fees.
import { requireThat, zats, type Signed } from "../manifest/schema";
import { LAYOUT_V0 } from "./layout";
import { marketClient, marketOrders, marketResult, type MarketManifest } from "./market";
import { obligationsModeB } from "./mode-b";
import type { ClearBody, ClearInput, SettlementExtras } from "./core";
export const OTC_LAYOUT = { ...LAYOUT_V0, version: 3 };
export type OTCManifest = MarketManifest<{ otc: { buyer_key: string; seller_key: string } }>;
export function clientOTC(packet: Signed, signer: string) {
  return marketClient<{ otc: OTCManifest["otc"] }>(packet, signer, "otc", m => {
    requireThat(m.otc && Object.keys(m.otc).sort().join(",")==="buyer_key,seller_key" &&
      /^[0-9a-f]{64}$/.test(m.otc.buyer_key) && /^[0-9a-f]{64}$/.test(m.otc.seller_key) &&
      m.otc.buyer_key!==m.otc.seller_key,"otc parties");
    requireThat(m.supply===1 && m.q_max===1 && !m.lots && !m.bond && !m.serials &&
      !m.sealed_reserve && m.reserve_zats==="0","otc single-unit limits");
  });
}
export function clearOTC(input: ClearInput) {
  const {manifest:m}=clientOTC(input.manifest,input.signer),orders=marketOrders(input,m,OTC_LAYOUT);
  for(const o of orders)if(!o.reason && ![m.otc.buyer_key,m.otc.seller_key].includes(o.owner_hex))o.reason="not_party";
  const buyer=orders.find(o=>!o.reason && o.owner_hex===m.otc.buyer_key),seller=orders.find(o=>!o.reason && o.owner_hex===m.otc.seller_key);
  const matched=!!buyer && !!seller && buyer.price>=seller.price,price=matched?(buyer!.price+seller!.price)/2n:0n;
  const C=zats(m.C_zats,"C"),fee=zats(m.fee_zats,"fee"),fees=matched?(fee<price?fee:price):0n;
  const allocations=orders.map(o=>{
    const isBuyer=o===buyer,isSeller=o===seller,fill=matched && (isBuyer || isSeller)?1:0;
    return {leaf_index:o.leaf_index,price_zats:o.price.toString(),quantity:o.quantity,fill,
      payment_zats:(fill && isSeller?price-fees:0n).toString(),refund_zats:(fill && isBuyer?C-price:C).toString(),
      outcome:o.reason||(fill?"winner":"no_match"),side:o.owner_hex===m.otc.buyer_key?"buyer":o.owner_hex===m.otc.seller_key?"seller":"unknown"};
  });
  return {...marketResult(input,m,allocations,price,fees),cancelled:!matched};
}
export function checkResultOTC(m: OTCManifest,r: ClearBody) {
  const winners=r.allocations.filter(a=>a.fill),price=zats(r.clearing_price_zats,"otc price"),C=zats(m.C_zats,"C"),fee=zats(m.fee_zats,"fee");
  requireThat(winners.length===(r.cancelled?0:2),"otc parties filled");
  const buyer=winners.find(a=>a.side==="buyer"),seller=winners.find(a=>a.side==="seller");
  if(!r.cancelled)requireThat(buyer && seller && buyer.price_zats!==null && seller.price_zats!==null &&
    BigInt(buyer.price_zats)>=BigInt(seller.price_zats) && price===(BigInt(buyer.price_zats)+BigInt(seller.price_zats))/2n,"otc midpoint/limits");
  else requireThat(price===0n,"otc cancelled price");
  const fees=r.cancelled?0n:(fee<price?fee:price);
  requireThat(BigInt(r.conservation.fees_zats)===fees,"otc fees");
  for(const a of r.allocations) {
    requireThat(a.fill===0 || (a.fill===1 && a.quantity===1),"otc unit fill");
    requireThat(BigInt(a.refund_zats)===(a===buyer?C-price:C) &&
      BigInt(a.payment_zats)===(a===seller?price-fees:0n),"otc payout/refund");
  }
}
export function obligationsOTC(result: ClearBody,settlement?:SettlementExtras|null) {
  requireThat(!settlement?.delivery_defaults?.length,"otc has no delivery default");
  return obligationsModeB(result,settlement);
}
