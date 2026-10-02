// PHASE-5 R3.5: serials are assigned after clearing from the manifest's future quicknet beacon.
import { createHash } from "node:crypto";
import { requireThat } from "../manifest/schema";

export function assignSerials(
  winners: { leaf_index: number; units: number }[],
  serials: { first: number; count: number },
  beaconSignatureHex: string,
): { leaf_index: number; serials: number[] }[] {
  requireThat(Number.isSafeInteger(serials.first) && serials.first >= 0 &&
    Number.isSafeInteger(serials.count) && serials.count > 0 && serials.count <= 0xffffffff &&
    Number.isSafeInteger(serials.first + serials.count - 1), "serial range");
  requireThat(/^[0-9a-f]{96}$/.test(beaconSignatureHex), "serial beacon signature");
  requireThat(winners.every(w => Number.isSafeInteger(w.leaf_index) && w.leaf_index >= 0 &&
    Number.isSafeInteger(w.units) && w.units > 0) &&
    new Set(winners.map(w => w.leaf_index)).size === winners.length, "serial winners");
  requireThat(winners.reduce((n, w) => n + BigInt(w.units), 0n) <= BigInt(serials.count), "serial units exceed count");
  const pool = Array.from({ length: serials.count }, (_, i) => serials.first + i);
  const signature = Buffer.from(beaconSignatureHex, "hex");
  for (let i = pool.length - 1; i > 0; i--) {
    const index = Buffer.alloc(4); index.writeUInt32BE(i);
    const digest = createHash("sha256").update("benzo-serials-v1").update(signature).update(index).digest();
    const j = Number(digest.readBigUInt64BE(0) % BigInt(i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let offset = 0;
  return [...winners].sort((a, b) => a.leaf_index - b.leaf_index).map(w => {
    const assigned = pool.slice(offset, offset + w.units); offset += w.units;
    return { leaf_index: w.leaf_index, serials: assigned };
  });
}
