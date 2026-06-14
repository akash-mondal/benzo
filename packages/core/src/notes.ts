/**
 * Benzo shielded notes — the canonical cryptographic invariants.
 *
 *   commitment = Poseidon2(amount, recipient_pk, blinding, asset_id)
 *   nullifier  = Poseidon2(spend_sk, leaf_index, NULLIFIER_DOMAIN)
 *   keypair    : recipient_pk = Poseidon2(spend_sk, 0)  (domain 0x03)
 *   mvk tag    : tag = Poseidon2(mvk_pub, blinding)     (domain 0x05)
 */

import { randomBytes } from "./crypto/random.js";
import { FIELD_MODULUS, hash } from "./crypto/poseidon2.js";

export const NULLIFIER_DOMAIN = 0x02n;
export const KEYPAIR_DOMAIN = 0x03n;
export const MVK_TAG_DOMAIN = 0x05n;
export const ASP_LEAF_DOMAIN = 0x01n;

/** Uniform-enough random field element (rejection-free; 2x reduction bias is negligible at 256->254 bits ~ 2^-2... use 512-bit reduction for true uniformity). */
export function randomFieldElement(): bigint {
  // 64 bytes reduced mod p: statistical distance < 2^-256.
  const wide = BigInt("0x" + Buffer.from(randomBytes(64)).toString("hex"));
  return wide % FIELD_MODULUS;
}

export interface Keypair {
  spendSk: bigint;
  publicKey: bigint;
}

export function deriveKeypair(spendSk: bigint): Keypair {
  return { spendSk, publicKey: hash([spendSk, 0n], KEYPAIR_DOMAIN) };
}

export function randomKeypair(): Keypair {
  return deriveKeypair(randomFieldElement());
}

export interface Note {
  amount: bigint;
  recipientPk: bigint;
  blinding: bigint;
  assetId: bigint;
}

export function noteCommitment(note: Note): bigint {
  // t=4 permutation over exactly [amount, recipient_pk, blinding, asset_id]
  // (asset_id in the capacity slot) — see circuits/groth16/note.circom.
  return hash([note.amount, note.recipientPk, note.blinding], note.assetId);
}

export function noteNullifier(spendSk: bigint, leafIndex: bigint): bigint {
  return hash([spendSk, leafIndex], NULLIFIER_DOMAIN);
}

export function mvkTag(mvkPub: bigint, blinding: bigint): bigint {
  return hash([mvkPub, blinding], MVK_TAG_DOMAIN);
}

export function aspLeaf(depositorScalar: bigint, aspBlinding: bigint): bigint {
  return hash([depositorScalar, aspBlinding], ASP_LEAF_DOMAIN);
}

export function newNote(amount: bigint, recipientPk: bigint, assetId: bigint): Note {
  return { amount, recipientPk, blinding: randomFieldElement(), assetId };
}
