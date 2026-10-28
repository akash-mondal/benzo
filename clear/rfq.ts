// Reverse-Vickrey procurement; at least two allowlisted valid quotes or exact-C cancellation.
import { jsonBytes, requireThat, uaShape, verifyRecord, zats, type Signed } from "../manifest/schema";
import { LAYOUT_V0 } from "./layout";
import { sealedReserve } from "./features";
import { marketClient, marketOrders, marketResult, type MarketManifest } from "./market";
import { checkResultBuyback, obligationsModeB } from "./mode-b";
import type { ClearBody, ClearInput, SettlementExtras } from "./core";
export const RFQ_LAYOUT = { ...LAYOUT_V0, version: 2 };
export type RFQ = { dealer_keys: string[]; max_price_zats: string; budget_zats: string; delivery_deadline_height: number; delivery_signers: string[]; treasury_ua?: string; treasury_ua_commitment?: string; funding_ua?: string };
export type RFQManifest = MarketManifest<{ rfq: RFQ }>;
export function clientRFQ(packet: Signed, signer: string) {
  return marketClient<{ rfq: RFQ }>(packet, signer, "rfq", m => {
    const r=m.rfq;
    const keys=Object.keys(r??{}).sort().join(","),base="budget_zats,dealer_keys,delivery_deadline_height,delivery_signers,max_price_zats";
    // Part 2: the buyer's signed treasury return and funding addresses (both or neither; host custody needs both).
    requireThat(r && (keys===base || keys==="budget_zats,dealer_keys,delivery_deadline_height,delivery_signers,funding_ua,max_price_zats,treasury_ua" || keys==="budget_zats,dealer_keys,delivery_deadline_height,delivery_signers,funding_ua,max_price_zats,treasury_ua_commitment"), "rfq fields");
    if(r.treasury_ua!==undefined){const f=r.funding_ua as string,t=r.treasury_ua as string;
      requireThat(uaShape(t,m.network as string)&&uaShape(f,m.network as string)&&t!==f&&!m.deposit_addresses.includes(f)&&!m.deposit_addresses.includes(t),"rfq treasury_ua/funding_ua")}
    if(r.treasury_ua_commitment!==undefined){const f=r.funding_ua as string;
      requireThat(/^[0-9a-f]{64}$/.test(r.treasury_ua_commitment)&&uaShape(f,m.network as string)&&!m.deposit_addresses.includes(f),"rfq treasury_ua_commitment/funding_ua")}
    requireThat(!m.bond && !m.lots && !m.serials && m.supply===1 && m.q_max===1, "rfq single quote/lot");
    requireThat(Array.isArray(r.dealer_keys) && r.dealer_keys.length>=2 && r.dealer_keys.every(k=>/^[0-9a-f]{64}$/.test(k)) && new Set(r.dealer_keys).size===r.dealer_keys.length,"rfq dealer keys");
    requireThat(Array.isArray(r.delivery_signers) && r.delivery_signers.length===3 && r.delivery_signers.every(k=>/^[0-9a-f]{88}$/.test(k)) && new Set(r.delivery_signers).size===3,"rfq delivery signers");
    requireThat(Number.isSafeInteger(r.delivery_deadline_height) && r.delivery_deadline_height>0 && r.delivery_deadline_height<=0xffffffff,"rfq delivery deadline");
    const max=zats(r.max_price_zats,"rfq max price");
    requireThat(max>0n && max<=zats(m.B_max_zats,"cap") && max%zats(m.tick_zats,"tick")===0n && zats(r.budget_zats,"rfq budget")>=max,"rfq budget/max price");
  });
}
export function clearRFQ(input: ClearInput) {
  const {manifest:m}=clientRFQ(input.manifest,input.signer),orders=marketOrders(input,m,RFQ_LAYOUT);
  const sealed=sealedReserve(m,input.reserve_opening,zats(m.tick_zats,"tick"));
  const publicMax=zats(m.rfq.max_price_zats,"rfq max price"),max=sealed!==null && sealed<publicMax?sealed:publicMax;
  for(const o of orders) if(!o.reason) {
    if(!m.rfq.dealer_keys.includes(o.owner_hex))o.reason="not_allowlisted";
    else if(o.quantity!==1 || !o.price)o.reason="over_cap";
    else if(o.price>max)o.reason="above_max_price";
  }
  const quotes=orders.filter(o=>!o.reason).sort((a,b)=>a.price===b.price?a.leaf_index-b.leaf_index:a.price<b.price?-1:1);
  const cancelled=quotes.length<2,price=cancelled?0n:quotes[1].price;
  if(!cancelled)quotes[0].fill=1;
  const C=zats(m.C_zats,"C"),fee=zats(m.fee_zats,"fee"),feeShare=cancelled?0n:(fee<price?fee:price);
  const allocations=orders.map(o=>({leaf_index:o.leaf_index,price_zats:o.price.toString(),quantity:o.quantity,fill:o.fill,
    payment_zats:(o.fill?price-feeShare:0n).toString(),refund_zats:C.toString(),outcome:o.reason||(cancelled?"cancelled":o.fill?"winner":"unfilled")}));
  const result=marketResult(input,m,allocations,price,feeShare,price);
  // Treasury is explicit even on cancellation, matching the existing buyback accounting boundary.
  result.conservation.treasury_zats=price.toString();
  return {...result,cancelled,rfq_delivery:{deadline_height:m.rfq.delivery_deadline_height,signers:m.rfq.delivery_signers}};
}
export function checkResultRFQ(m: RFQManifest,r: ClearBody) {
  checkResultBuyback({...m,buyback:{budget_zats:m.rfq.budget_zats,max_price_zats:m.rfq.max_price_zats}} as any,r);
  requireThat(r.allocations.filter(a=>a.fill).length===(r.cancelled?0:1),"rfq winner count");
  requireThat(!r.cancelled || (r.clearing_price_zats==="0" && r.allocations.every(a=>a.refund_zats===m.C_zats)),"rfq cancellation");
}
export function obligationsRFQ(result: ClearBody,settlement?: SettlementExtras|null):Map<string,string> {
  requireThat(!(settlement?.defaults?.length),"rfq needs signed delivery default");
  const map=obligationsModeB(result),packets=settlement?.delivery_defaults??[];
  if(!packets.length)return map;
  const policy=result.rfq_delivery,winner=result.allocations.find(a=>a.fill);
  requireThat(policy && winner && !result.cancelled,"rfq default without winner");
  const seen=new Set<string>();let body:Buffer|null=null;
  for(const p of packets){
    requireThat(policy!.signers.includes(p.signer) && !seen.has(p.signer),"rfq delivery default signer");
    const r=verifyRecord<{auction_id:string;leaf_index:number;deadline_height:number;observed_height:number;status:string}>(p,p.signer);
    requireThat(Object.keys(r).sort().join(",")==="auction_id,deadline_height,leaf_index,observed_height,status" &&
      r.auction_id===result.auction_id && r.leaf_index===winner!.leaf_index && r.deadline_height===policy!.deadline_height &&
      Number.isSafeInteger(r.observed_height) && r.observed_height>r.deadline_height && r.status==="delivery_missed","rfq delivery default binding/deadline");
    const bytes=jsonBytes(r);requireThat(!body || body.equals(bytes),"rfq delivery default disagreement");body=bytes;seen.add(p.signer);
  }
  requireThat(seen.size>=2,"rfq delivery default quorum");
  // The defaulting dealer receives neither procurement payment nor bond; buyer receives both, net of fees.
  const owed=map.get(`leaf:${winner!.leaf_index}`)!;map.delete(`leaf:${winner!.leaf_index}`);map.set("buyer",owed);
  return map;
}
