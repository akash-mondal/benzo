// Public quicknet client: no HTTP or checkout/state lookup. Validate before decryption.
import { bls12_381 } from "@noble/curves/bls12-381";
import { timelockDecrypt, type ChainClient } from "tlock-js";
import { QUICKNET, hash, requireThat } from "../manifest/schema";
import { memoSealedBid } from "../settle/envelopes";

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

export async function decryptPublished(ciphertextHex: string, client: ChainClient): Promise<string | null> {
  const ciphertext = Buffer.from(ciphertextHex, "hex").toString("binary");
  // tlock-js 0.9.0 does not check the stanza chain hash; bind both stanza arguments here.
  const info = await client.chain().info();
  const stanza = ciphertext.match(/\n-> tlock ([1-9][0-9]*) ([0-9a-f]{64})\n/);
  requireThat(stanza && stanza[2] === info.hash, "ciphertext tlock stanza/chain");
  await client.get(Number(stanza![1]));
  // Pinned tlock-js prints each public beacon. Keep CLI output bounded while awaiting its decrypt call.
  const log = console.log;
  console.log = () => {};
  try { return (await timelockDecrypt(ciphertext, client)).toString("hex"); }
  catch (e) {
    if (/^(The MAC did not validate for the fileKey and payload!|Error during decryption!)$/.test((e as Error).message)) return null;
    throw e;
  } finally { console.log = log; }
}

// R16 item 4 (Reviewer R F3): the one derivation of every stray claim's owner-key source — the plaintext of
// the memo the claim publishes (the scanned deposit's memo), opened against the published beacon. Returns
// the derived plaintext hex per claim index (null when the memo does not open); checkPublicAuction consumes
// this map and fails closed without it. Kept here, not in api/public-auction.ts, because that module is
// bundled into settle/plan.mjs and must not drag the tlock runtime in with it.
export async function deriveClaimOpenings(claims: { party: string; memo_hex?: string }[], beacon: { round: number; signature: string } | null): Promise<Map<number, string | null>> {
  const openings = new Map<number, string | null>();
  if (!claims.length || !claims.some(c => c.party?.startsWith("deposit:"))) return openings;
  requireThat(beacon, "claims require the published beacon");
  const local = publishedClient(beacon!);
  for (const [i, c] of claims.entries()) {
    if (!c.party.startsWith("deposit:")) continue;
    const ct = typeof c.memo_hex === "string" ? memoSealedBid(c.memo_hex)?.ciphertext_hex ?? null : null;
    openings.set(i, ct ? await decryptPublished(ct, local) : null);
  }
  return openings;
}
