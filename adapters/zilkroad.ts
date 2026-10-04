// Holder receipts live in adapters/holders.ts (no import cycle through the registry); re-exported here.
export { holderOwners, type HolderReceipt } from "./holders";
import { requireThat, verifyRecord, type Signed } from "../manifest/schema";

// Collection data lives in marketplace.json. Its hash is committed by the signed manifest's existing
// lot label (zilkroad:<hash>), or every multi-lot id 5a494c4b || H({marketplace_hash,lot_index})[:56]. No upstream calls.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes } from "../manifest/schema";
import { signStatement, verifyStatement, type OwnerKey } from "../envelope/index";
import { checkSettlementStatement, type PublicAuction, type SettlementReceipt, type SettlementStatement } from "../api/public-auction";
export type Marketplace = { version: 1; adapter: "zilkroad"; collection: string; serial_range: { first: number; count: number }; metadata_commitment: string };
export function marketplace(pub: PublicAuction): Marketplace | null {
  const file = path.join(pub.dir,"marketplace.json"), m = pub.manifest;
  const pinned = m.lot?.startsWith("zilkroad:") || m.lots?.some(l=>l.startsWith("5a494c4b")) || existsSync(file);
  if (!pinned) return null;
  requireThat(existsSync(file), "missing marketplace.json");
  const p = JSON.parse(readFileSync(file,"utf8")) as Marketplace;
  requireThat(p && Object.keys(p).sort().join(",") === "adapter,collection,metadata_commitment,serial_range,version" &&
    p.version === 1 && p.adapter === "zilkroad" && typeof p.collection === "string" && p.collection.length > 0 && p.collection.length <= 256 &&
    /^[0-9a-f]{64}$/.test(p.metadata_commitment), "marketplace fields");
  const s = p.serial_range;
  requireThat(s && Object.keys(s).sort().join(",") === "count,first" && Number.isSafeInteger(s.first) && s.first >= 0 &&
    Number.isSafeInteger(s.count) && s.count > 0 && Number.isSafeInteger(s.first+s.count-1), "marketplace serial range");
  const h = hash(jsonBytes(p));
  requireThat(m.lots ? m.lots.every((lot,index) => lot === "5a494c4b" + hash(jsonBytes({ marketplace_hash:h, lot_index:index })).slice(0,56)) : m.lot === `zilkroad:${h}`, "marketplace manifest commitment");
  if (m.serials) requireThat(m.serials.first === s.first && m.serials.count === s.count, "marketplace drop range");
  return p;
}
export function checkSerialRange(pub: PublicAuction, serials: number[]): void {
  const p = marketplace(pub);
  if (p) for (const s of serials) requireThat(s >= p.serial_range.first && s < p.serial_range.first+p.serial_range.count, "marketplace serial outside range");
}
export function claimBody(pub: PublicAuction, ciphertextHash: string, receipt: SettlementReceipt, statement: SettlementStatement) {
  const p = marketplace(pub); requireThat(p && pub.result && pub.frozen, "claim marketplace/result/frozen");
  checkSettlementStatement(pub,ciphertextHash,statement);
  requireThat(statement.fill > 0 && pub.state === "SETTLED" && !pub.settlement?.defaults?.includes(statement.leaf_index) &&
    !["buyback","rfq"].includes(pub.result!.mode), "claim paid auction winner");
  const actual = pub.settlement?.receipts?.find(r => r.party === `leaf:${statement.leaf_index}`) ??
    (statement.refund_zats === "0" ? pub.settlement?.receipts?.find(r=>r.party === "seller") : undefined);
  requireThat(actual && jsonBytes(actual).equals(jsonBytes(receipt)) && /^[0-9a-f]{64}$/.test(receipt.txid) && receipt.auction_id === pub.manifest.auction_id, "claim private settlement receipt");
  // Without a shuffled drop, take consecutive committed inventory in leaf order.
  const winners = pub.result!.allocations.filter(a=>a.fill>0).sort((a,b)=>a.leaf_index-b.leaf_index);
  requireThat(winners.reduce((n,a)=>n+BigInt(a.fill),0n) <= BigInt(p!.serial_range.count), "claim inventory capacity");
  const offset = winners.filter(a=>a.leaf_index<statement.leaf_index).reduce((n,a)=>n+a.fill,0);
  const serials = pub.result!.serial_assignment?.find(a=>a.leaf_index===statement.leaf_index)?.serials ??
    Array.from({length:statement.fill},(_,i)=>p!.serial_range.first+offset+i);
  requireThat(serials && serials.length === statement.fill, "claim assigned serials"); checkSerialRange(pub,serials!);
  return { version:1, kind:"zilkroad_delivery_claim", auction_id:pub.manifest.auction_id, manifest_hash:pub.manifest_hash,
    result_hash:hash(pub.resultBytes!), ciphertext_hash:ciphertextHash, leaf_index:statement.leaf_index,
    owner_pubkey:statement.owner_pubkey, collection:p!.collection, metadata_commitment:p!.metadata_commitment,
    serials:serials!, settlement_txid:receipt.txid, receipt_hash:hash(jsonBytes(receipt)), statement_hash:hash(jsonBytes(statement)) };
}
export function deliveryClaim(pub: PublicAuction, ct: string, receipt: SettlementReceipt, statement: SettlementStatement, owner: OwnerKey) {
  const body = claimBody(pub,ct,receipt,statement); requireThat(owner.public_hex === body.owner_pubkey, "claim owner key");
  return { ...body, signature:signStatement(owner,body) };
}
export function checkDeliveryClaim(pub: PublicAuction, ct: string, receipt: SettlementReceipt, statement: SettlementStatement, claim: any): void {
  const {signature,...body} = claim;
  requireThat(jsonBytes(body).equals(jsonBytes(claimBody(pub,ct,receipt,statement))), "delivery claim binding");
  requireThat(verifyStatement(body.owner_pubkey,body,signature), "delivery claim owner signature");
}
// Public searchable queue: no destinations or private receipt/statement bodies. Owner attests non-delivery;
// this is an unresolved complaint, not proof about the token chain or authority to pay again.
export function checkDeliveryExceptions(pub: PublicAuction): void {
  marketplace(pub);
  const file=path.join(pub.dir,"delivery-exceptions.json"); if (!existsSync(file)) return;
  const queue=JSON.parse(readFileSync(file,"utf8")); requireThat(Array.isArray(queue), "delivery exception queue");
  const seen=new Set<string>();
  for (const row of queue) {
    requireThat(row && Object.keys(row).sort().join(",") === "claim,receipt,signature,statement,status" && row.status === "paid_not_delivered", "delivery exception fields/status");
    const ct=row.claim.ciphertext_hash; requireThat(!seen.has(ct), "duplicate delivery exception"); seen.add(ct);
    checkDeliveryClaim(pub,ct,row.receipt,row.statement,row.claim);
    requireThat(verifyStatement(row.claim.owner_pubkey, { auction_id:pub.manifest.auction_id,
      claim_hash:hash(jsonBytes(row.claim)), status:row.status }, row.signature), "delivery exception owner signature");
  }
}
