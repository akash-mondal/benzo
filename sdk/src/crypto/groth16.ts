/**
 * snarkjs Groth16 artifacts -> Soroban byte encodings.
 *
 *   Fr / Fq : 32-byte big-endian
 *   G1      : x || y                        (64 bytes)
 *   G2      : x.c1 || x.c0 || y.c1 || y.c0  (128 bytes; Soroban's c1||c0,
 *             while snarkjs JSON stores [c0, c1])
 */

export function feHex(dec: string | bigint): string {
  return BigInt(dec).toString(16).padStart(64, "0");
}

export function g1Hex(pt: string[]): string {
  if (BigInt(pt[2]) !== 1n) throw new Error("G1 point not affine (z != 1)");
  return feHex(pt[0]) + feHex(pt[1]);
}

export function g2Hex(pt: string[][]): string {
  if (BigInt(pt[2][0]) !== 1n || BigInt(pt[2][1]) !== 0n) {
    throw new Error("G2 point not affine (z != [1,0])");
  }
  return feHex(pt[0][1]) + feHex(pt[0][0]) + feHex(pt[1][1]) + feHex(pt[1][0]);
}

export interface SnarkjsVk {
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}

export interface SnarkjsProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

/** VerificationKeyBytes argument for BenzoVerifier.set_vk (CLI JSON form). */
export function vkToSoroban(vk: SnarkjsVk) {
  return {
    alpha: g1Hex(vk.vk_alpha_1),
    beta: g2Hex(vk.vk_beta_2),
    gamma: g2Hex(vk.vk_gamma_2),
    delta: g2Hex(vk.vk_delta_2),
    ic: vk.IC.map(g1Hex),
  };
}

/** Groth16Proof argument (CLI JSON form). */
export function proofToSoroban(proof: SnarkjsProof) {
  return {
    a: g1Hex(proof.pi_a),
    b: g2Hex(proof.pi_b),
    c: g1Hex(proof.pi_c),
  };
}

/** Public inputs as decimal U256 strings (Bn254Fr CLI form). */
export function publicsToSoroban(publics: (string | bigint)[]): string[] {
  return publics.map((p) => BigInt(p).toString());
}
