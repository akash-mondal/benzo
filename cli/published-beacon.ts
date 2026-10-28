// Public quicknet client: no HTTP or checkout/state lookup. Validate before decryption.
import { bls12_381 } from "@noble/curves/bls12-381";
import type { ChainClient } from "tlock-js";
import { QUICKNET, hash, requireThat } from "../manifest/schema";
import { memoSealedBid } from "../settle/envelopes";
import { drandUrls } from "../manifest/reserve";
import { DRAND_TIMEOUT_MS } from "../settle/bounded";
import { openSealedBid } from "../envelope/opening";

// The raw tlock decrypt and its failure contract moved into envelope/opening.ts with (the one opener and
// the contract it maps live in one module). It stays re-exported here for the sealed-reserve paths — a
// reserve is a sealed price bound, not a sealed bid, so it keeps the raw decrypt without the bid shape rule.
export { decryptPublished } from "../envelope/opening";

export function publishedClient(beacon: { round: number; signature: string }): ChainClient {
  requireThat(Number.isSafeInteger(beacon.round) && beacon.round > 0 && /^[0-9a-f]{96}$/.test(beacon.signature), "beacon round/signature");
  const round = Buffer.alloc(8); round.writeBigUInt64BE(BigInt(beacon.round));
  let valid = false;
  try {
    valid = bls12_381.verifyShortSignature(beacon.signature, Buffer.from(hash(round), "hex"), QUICKNET.public_key,
      { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" });
  } catch { /* Malformed curve points are invalid signatures too. */ }
  requireThat(valid, "beacon BLS signature invalid");
  const info = { public_key: QUICKNET.public_key, period: QUICKNET.period, genesis_time: QUICKNET.genesis,
    hash: QUICKNET.chain_hash, groupHash: "", schemeID: QUICKNET.scheme, metadata: { beaconID: "quicknet" } };
  const publicBeacon = { ...beacon, randomness: hash(Buffer.from(beacon.signature, "hex")) };
  return {
    options: { disableBeaconVerification: false, noCache: true },
    chain: () => ({ baseUrl: "", info: async () => info }),
    latest: async () => publicBeacon,
    get: async requested => { requireThat(requested === beacon.round, "ciphertext beacon round"); return publicBeacon; },
  };
}

// failover-plus-verify beacon fetch, in one shared place: the round-R quicknet beacon from
// ANY endpoint in BNZ_DRAND_URLS, in order, each bounded by DRAND_TIMEOUT_MS; the first answer whose BLS
// signature verifies against the pinned quicknet key wins (publishedClient refuses every other). One dead
// relay no longer fails the open. `open`, the signer hosts and the settlement plan use this for an auction
// that carries no published beacon (cancelled before open, strays after R); when the packet publishes one,
// pass that to publishedClient instead and never fetch.
export async function fetchVerifiedBeacon(R: number): Promise<{ round: number; signature: string; chain_hash: string }> {
  for (const url of drandUrls()) {
    try {
      const response = await fetch(`${url}/${QUICKNET.chain_hash}/public/${R}`, { signal: AbortSignal.timeout(DRAND_TIMEOUT_MS) });
      if (!response.ok) continue;
      const b = await response.json() as { round: number; signature: string };
      if (b.round !== R || !/^[0-9a-f]{96}$/.test(b.signature)) continue;
      publishedClient({ round: b.round, signature: b.signature }); // BLS-check the answer; anything else is not the beacon
      return { round: b.round, signature: b.signature, chain_hash: QUICKNET.chain_hash };
    } catch {} // a dead, wrong or unverifiable answer is not the beacon; try the next endpoint
  }
  throw new Error("refused: drand opening beacon unavailable or unverified on every endpoint");
}

// The one derivation of every stray claim's owner-key source — the plaintext of
// the memo the claim publishes (the scanned deposit's memo), opened against the published beacon. Returns
// the derived plaintext hex per claim index (null when the memo does not open); checkPublicAuction consumes
// this map and fails closed without it. Since it goes through the one opener (envelope/opening.ts), so a
// griefing memo yields null instead of stopping the verify. Kept here, not in api/public-auction.ts, because
// that module is bundled into settle/plan.mjs and stays free of the tlock runtime (the plan itself now calls
// the opener directly for its own openings).
export async function deriveClaimOpenings(claims: { party: string; memo_hex?: string }[], beacon: { round: number; signature: string } | null): Promise<Map<number, string | null>> {
  const openings = new Map<number, string | null>();
  if (!claims.length || !claims.some(c => c.party?.startsWith("deposit:"))) return openings;
  requireThat(beacon, "claims require the published beacon");
  const local = publishedClient(beacon!);
  for (const [i, c] of claims.entries()) {
    if (!c.party.startsWith("deposit:")) continue;
    const ct = typeof c.memo_hex === "string" ? memoSealedBid(c.memo_hex)?.ciphertext_hex ?? null : null;
    openings.set(i, ct ? await openSealedBid(ct, local) : null);
  }
  return openings;
}
