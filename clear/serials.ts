// PHASE-5 R3.5: serials are assigned after clearing from the manifest's future quicknet beacon.
import { bls12_381 } from "@noble/curves/bls12-381";
import { createHash } from "node:crypto";
import { QUICKNET, requireThat } from "../manifest/schema";

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


// Uniform multi-lot clearing is unchanged; the future beacon only decorates its winning allocations.
export function attachSerials(result: import("./core").ClearResult, m: { drand: { R: number }; serials?: { first: number; count: number; seed_round_offset: number } }, beacon?: { round: number; signature: string } | null) {
  if (!m.serials) { requireThat(!beacon, "serial beacon without manifest serials"); return result; }
  const round = m.drand.R + m.serials.seed_round_offset;
  requireThat(beacon && beacon.round === round, "serial beacon round");
  const roundBytes = Buffer.alloc(8); roundBytes.writeBigUInt64BE(BigInt(round));
  requireThat(/^[0-9a-f]{96}$/.test(beacon!.signature) && bls12_381.verifyShortSignature(
    beacon!.signature, createHash("sha256").update(roundBytes).digest(), QUICKNET.public_key,
    { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" }), "serial beacon BLS signature");
  return { ...result, serial_beacon_round: round, serial_assignment: assignSerials(
    result.allocations.filter(a => a.fill > 0).map(a => ({ leaf_index: a.leaf_index, units: a.fill })),
    m.serials, beacon!.signature) };
}
