// Launch: holder tranche at the floor, main uniform auction, or a subsequent recurring round at the prior price.
// Token delivery is the project's job; this module publishes one batch of fresh destinations in standard lots.
import { hash, jsonBytes, requireThat, verifyRecord, zats, type Signed } from "../manifest/schema";
import { balanceDue, effectiveReserve, refundAfter, sealedReserve } from "./features";
import { LAYOUT_V0 } from "./layout";
import { marketClient, marketOrders, marketResult, type MarketManifest } from "./market";
import { holderOwners } from "../adapters/zilkroad";
import { verifyStatement } from "../envelope/index";
import { type ClearBody, type ClearInput, type ClearResult } from "./core";
export const LAUNCH_LAYOUT = { ...LAYOUT_V0, version: 1, pad_at: 126 }; // byte 125: 0 main, 1 holder
export type Launch = { standard_lot_size: number; minimum_raise_zats: string;
  holder?: { supply: number; collection: string; receipt_signer: string };
  follow_on?: { previous_result_hash: string; price_zats: string } };
export type LaunchManifest = MarketManifest<{ launch: Launch }>;
export type LaunchInput = { holder_receipts?: Signed[]; mined_heights?: Signed[]; previous_result?: ClearResult;
  delivery?: { leaf_index: number; destinations: string[]; signature: string }[] };
export type DeliveryBatch = { version: 1; auction_id: string; delivery: "project_on_token_chain"; rows: { destination: string; amount: number }[] };
export function clientLaunch(packet: Signed, signer: string) {
  return marketClient<{ launch: Launch }>(packet, signer, "launch", m => {
    const l = m.launch;
    requireThat(l && Object.keys(l).every(k => ["standard_lot_size", "minimum_raise_zats", "holder", "follow_on"].includes(k)), "launch fields");
    requireThat(Number.isSafeInteger(l.standard_lot_size) && l.standard_lot_size > 0 && m.supply % l.standard_lot_size === 0 && m.q_max % l.standard_lot_size === 0, "launch standard lot size");
    zats(l.minimum_raise_zats, "minimum raise");
    requireThat(!m.lots && !m.serials, "launch uses one lot");
    if (l.holder) requireThat(Object.keys(l.holder).sort().join(",") === "collection,receipt_signer,supply" &&
      Number.isSafeInteger(l.holder.supply) && l.holder.supply > 0 && l.holder.supply <= m.supply && l.holder.supply % l.standard_lot_size === 0 &&
      typeof l.holder.collection === "string" && l.holder.collection.length > 0 && /^[0-9a-f]{88}$/.test(l.holder.receipt_signer), "launch holder tranche");
    if (l.follow_on) {
      requireThat(!l.holder && Object.keys(l.follow_on).sort().join(",") === "previous_result_hash,price_zats" &&
        m.series?.previous_result_hash === l.follow_on.previous_result_hash && /^[0-9a-f]{64}$/.test(l.follow_on.previous_result_hash), "launch follow-on linkage");
      requireThat(zats(l.follow_on.price_zats, "follow-on price") % zats(m.tick_zats, "tick") === 0n, "follow-on tick");
    }
  });
}
export function deliveryBatch(m: LaunchManifest, result: ClearResult, orders: ReturnType<typeof marketOrders>, records: NonNullable<LaunchInput["delivery"]>): DeliveryBatch {
  const rows: DeliveryBatch["rows"] = [], seen = new Set<string>();
  requireThat(new Set(records.map(r => r.leaf_index)).size === records.length, "duplicate launch delivery");
  const winners = result.allocations.filter(a => a.fill);
  requireThat(records.length === winners.length, "launch delivery count");
  for (const a of winners) {
    const r = records.find(r => r.leaf_index === a.leaf_index), owner = orders.find(o => o.leaf_index === a.leaf_index)!.owner_hex;
    requireThat(r && r.destinations.length === a.fill / m.launch.standard_lot_size &&
      verifyStatement(owner, { auction_id: m.auction_id, leaf_index: a.leaf_index, destinations: r.destinations }, r.signature), "launch delivery owner signature/count");
    for (const destination of r!.destinations) {
      requireThat(typeof destination === "string" && destination.length > 0 && destination.length <= 256 && !seen.has(destination), "launch fresh destination");
      seen.add(destination); rows.push({ destination, amount: m.launch.standard_lot_size });
    }
  }
  return { version: 1, auction_id: m.auction_id, delivery: "project_on_token_chain", rows };
}
export function clearLaunch(input: ClearInput): ClearResult {
  const { manifest: m } = clientLaunch(input.manifest, input.signer), data = input.launch ?? {};
  const orders = marketOrders(input, m, LAUNCH_LAYOUT), lot = m.launch.standard_lot_size;
  const floor = effectiveReserve(m, sealedReserve(m, input.reserve_opening, zats(m.tick_zats, "tick")));
  const holders = m.launch.holder ? holderOwners(data.holder_receipts ?? [], m.auction_id, m.launch.holder.collection, m.launch.holder.receipt_signer) : new Set<string>();
  requireThat(m.launch.holder || !(data.holder_receipts?.length), "holder receipts without tranche");
  for (const o of orders) {
    const pt = input.opened.find(x => x.leaf_index === o.leaf_index)?.plaintext_hex;
    const tranche = pt ? Buffer.from(pt, "hex")[125] : 0;
    if (!o.reason && (o.quantity % lot !== 0 || tranche > 1 || (tranche === 1 && (!m.launch.holder || !holders.has(o.owner_hex))))) o.reason = "invalid_tranche";
    if (!o.reason && o.price < floor) o.reason = "below_reserve";
  }
  const trancheOf = (i: number) => Buffer.from(input.opened.find(x => x.leaf_index === i)?.plaintext_hex ?? "", "hex")[125] ?? 0;
  let price = 0n, left = m.supply;
  const holder = orders.filter(o => !o.reason && trancheOf(o.leaf_index) === 1).sort((a,b) => a.leaf_index-b.leaf_index);
  let holderLeft = m.launch.holder?.supply ?? 0;
  for (const o of holder) { o.fill = Math.min(o.quantity, holderLeft); holderLeft -= o.fill; left -= o.fill; }
  const main = orders.filter(o => !o.reason && trancheOf(o.leaf_index) === 0);
  if (m.launch.follow_on) {
    const previous = data.previous_result;
    requireThat(previous && hash(jsonBytes(previous)) === m.launch.follow_on.previous_result_hash && previous.mode === "launch" &&
      !previous.cancelled && previous.clearing_price_zats === m.launch.follow_on.price_zats, "launch previous result/price");
    requireThat(Number.isSafeInteger(previous!.launch_supply) && m.supply <= previous!.launch_supply! - previous!.allocations.reduce((n,a)=>n+a.fill,0), "launch follow-on remaining supply");
    price = zats(m.launch.follow_on.price_zats, "follow-on price");
    requireThat(price >= floor, "follow-on below floor");
    const heights = new Map<number, number>();
    for (const p of data.mined_heights ?? []) {
      const r = verifyRecord<{ auction_id: string; leaf_index: number; txid: string; height: number }>(p, input.signer);
      requireThat(Object.keys(r).sort().join(",") === "auction_id,height,leaf_index,txid" && r.auction_id === m.auction_id &&
        input.frozen.leaves[r.leaf_index]?.deposit.txid === r.txid && Number.isSafeInteger(r.height) && r.height > 0 && !heights.has(r.leaf_index), "launch mined-height binding");
      heights.set(r.leaf_index, r.height);
    }
    requireThat(main.every(o => heights.has(o.leaf_index)), "launch follow-on needs mined heights");
    main.sort((a,b) => heights.get(a.leaf_index)!-heights.get(b.leaf_index)! || a.leaf_index-b.leaf_index);
    for (const o of main) { if (o.price < price) continue; o.fill = Math.min(o.quantity, left); left -= o.fill; }
  } else {
    requireThat(!data.previous_result && !data.mined_heights?.length, "follow-on data without tranche");
    main.sort((a,b) => a.price === b.price ? a.leaf_index-b.leaf_index : a.price > b.price ? -1 : 1);
    for (let start=0; start<main.length && left>0;) {
      let end=start+1; while(end<main.length && main[end].price===main[start].price)end++;
      const band=main.slice(start,end), demand=band.reduce((n,o)=>n+BigInt(o.quantity / lot),0n), room=left / lot;
      if(demand<=BigInt(room)) for(const o of band)o.fill=o.quantity;
      else { for(const o of band)o.fill=Number(BigInt(room)*BigInt(o.quantity / lot)/demand)*lot;
        let dust=left-band.reduce((n,o)=>n+o.fill,0);for(const o of band)if(dust>=lot && o.fill<o.quantity){o.fill+=lot;dust-=lot;} }
      left-=band.reduce((n,o)=>n+o.fill,0);price=band[0].price;start=end;
    }
  }
  const paid = (o: typeof orders[number]) => (trancheOf(o.leaf_index) === 1 ? floor : price)*BigInt(o.fill);
  const cancelled = orders.reduce((n,o)=>n+o.fill,0)<m.clearing.minimum_fill || orders.reduce((n,o)=>n+paid(o),0n)<zats(m.launch.minimum_raise_zats,"minimum raise");
  if(cancelled){for(const o of orders)o.fill=0;price=0n;}
  const C=zats(m.C_zats,"C"),fee=cancelled?0n:zats(m.fee_zats,"fee");
  const allocations=orders.map(o=>{const payment=paid(o);return {leaf_index:o.leaf_index,price_zats:o.price.toString(),quantity:o.quantity,fill:o.fill,payment_zats:payment.toString(),refund_zats:refundAfter(payment,fee,C).toString(),...(m.bond?{balance_due_zats:balanceDue(payment,fee,C).toString()}:{}),outcome:cancelled?"cancelled":o.reason||(o.fill?"winner":"unfilled"),tranche:trancheOf(o.leaf_index)===1?"holder":"main"};});
  const result = { ...marketResult(input,m,allocations,price,fee*BigInt(orders.length)), cancelled, launch_supply: m.supply, holder_price_zats: floor.toString() };
  const batch = deliveryBatch(m,result,orders,data.delivery ?? []);
  return { ...result, allocation_file_hash: hash(jsonBytes(batch)) };
}
export function checkResultLaunch(m: LaunchManifest, r: ClearBody) {
  // Holder payments use their floor, so enforce per-leaf C and actual tranche prices directly.
  const C=zats(m.C_zats,"C"),fee=r.cancelled?0n:zats(m.fee_zats,"fee");
  for(const a of r.allocations){const price=a.tranche==="holder"?zats(r.holder_price_zats,"holder price"):zats(r.clearing_price_zats,"price");
    requireThat(a.fill % m.launch.standard_lot_size===0 && BigInt(a.payment_zats)===price*BigInt(a.fill),"launch lot/payment");
    requireThat(BigInt(a.refund_zats)===refundAfter(BigInt(a.payment_zats),fee,C),"launch refund");
    requireThat(BigInt(a.balance_due_zats??"0")===balanceDue(BigInt(a.payment_zats),fee,C),"launch balance");}
  requireThat(r.cancelled ? r.allocations.every(a=>a.fill===0 && a.refund_zats===m.C_zats) : BigInt(r.conservation.payout_zats)>=zats(m.launch.minimum_raise_zats,"minimum raise"),"launch minimum raise");
}
