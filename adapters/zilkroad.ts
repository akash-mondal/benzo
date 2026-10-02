// Offline holder-receipt boundary: the manifest pins the marketplace's Ed25519 attestation key.
import { requireThat, verifyRecord, type Signed } from "../manifest/schema";
export type HolderReceipt = { auction_id: string; collection: string; serial: number; owner_pubkey: string };
export function holderOwners(receipts: Signed[], auctionId: string, collection: string, signer: string): Set<string> {
  const serials = new Set<number>(), owners = new Set<string>();
  for (const packet of receipts) {
    const r = verifyRecord<HolderReceipt>(packet, signer);
    requireThat(Object.keys(r).sort().join(",") === "auction_id,collection,owner_pubkey,serial" &&
      r.auction_id === auctionId && r.collection === collection && /^[0-9a-f]{64}$/.test(r.owner_pubkey) &&
      Number.isSafeInteger(r.serial) && r.serial >= 0, "holder receipt binding");
    requireThat(!serials.has(r.serial), "duplicate holder serial"); serials.add(r.serial); owners.add(r.owner_pubkey);
  }
  return owners;
}
