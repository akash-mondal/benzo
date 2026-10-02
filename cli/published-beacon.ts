// Public quicknet client: no HTTP or checkout/state lookup. Validate before decryption.
import { bls12_381 } from "@noble/curves/bls12-381";
import { timelockDecrypt, type ChainClient } from "tlock-js";
import { QUICKNET, hash, requireThat } from "../manifest/schema";

export function publishedClient(beacon: { round: number; signature: string }): ChainClient {
  requireThat(Number.isSafeInteger(beacon.round) && beacon.round > 0 && /^[0-9a-f]{96}$/.test(beacon.signature), "beacon round/signature");
  const round = Buffer.alloc(8); round.writeBigUInt64BE(BigInt(beacon.round));
  requireThat(bls12_381.verifyShortSignature(beacon.signature, Buffer.from(hash(round), "hex"), QUICKNET.public_key,
    { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" }), "beacon BLS signature");
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
