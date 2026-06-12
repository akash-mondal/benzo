/**
 * Poseidon2 over the BN254 scalar field — TypeScript mirror.
 *
 * The parameterization (d=5, RF=8, RP=56, round constants, internal matrix
 * diagonals for t = 2/3/4) is loaded from the pinned canonical JSON
 * (circuits/poseidon_params/poseidon2_bn254.json), the same constants used
 * by the circom templates and the Soroban CAP-0075 host-function calls in
 * the contracts. Byte-identity across all three implementations is asserted
 * by tests against the on-chain zero-hash table.
 */

import params from "./poseidon2_bn254.json" with { type: "json" };

export const FIELD_MODULUS = BigInt(params.modulus);
const P = FIELD_MODULUS;

type Instance = {
  partialRoundConstants: string[];
  fullRoundConstants: string[][];
  internalMatDiag: string[];
};

const instances = new Map<number, { prc: bigint[]; frc: bigint[][]; diag: bigint[] }>();
for (const [t, inst] of Object.entries(params.instances as Record<string, Instance>)) {
  instances.set(Number(t), {
    prc: inst.partialRoundConstants.map(BigInt),
    frc: inst.fullRoundConstants.map((row) => row.map(BigInt)),
    diag: inst.internalMatDiag.map(BigInt),
  });
}

function mod(x: bigint): bigint {
  const r = x % P;
  return r < 0n ? r + P : r;
}

function pow5(x: bigint): bigint {
  const x2 = mod(x * x);
  const x4 = mod(x2 * x2);
  return mod(x4 * x);
}

/** The 4x4 efficient external matrix (Poseidon2 paper §5.1). */
function matM4(s: bigint[]): bigint[] {
  const t0 = mod(s[0] + s[1]);
  const t1 = mod(s[2] + s[3]);
  const t2 = mod(2n * s[1] + t1);
  const t3 = mod(2n * s[3] + t0);
  const t4 = mod(4n * t1 + t3);
  const t5 = mod(4n * t0 + t2);
  const t6 = mod(t3 + t5);
  const t7 = mod(t2 + t4);
  return [t6, t5, t7, t4];
}

function externalLinear(s: bigint[]): bigint[] {
  if (s.length === 4) return matM4(s);
  const total = mod(s.reduce((a, b) => a + b, 0n));
  return s.map((x) => mod(total + x));
}

/** The Poseidon2 permutation for t = state.length in {2, 3, 4}. */
export function permutation(state: bigint[]): bigint[] {
  const t = state.length;
  const inst = instances.get(t);
  if (!inst) throw new Error(`unsupported Poseidon2 width t=${t}`);
  let s = state.map(mod);

  // Initial linear layer.
  s = externalLinear(s);

  const external = (k: number) => {
    s = externalLinear(s.map((x, j) => pow5(mod(x + inst.frc[k][j]))));
  };
  const internal = (i: number) => {
    const sb = pow5(mod(s[0] + inst.prc[i]));
    let total = sb;
    for (let j = 1; j < t; j++) total = mod(total + s[j]);
    const out = new Array<bigint>(t);
    out[0] = mod(total + sb * inst.diag[0]);
    for (let j = 1; j < t; j++) out[j] = mod(total + s[j] * inst.diag[j]);
    s = out;
  };

  for (let k = 0; k < 4; k++) external(k);
  for (let i = 0; i < 56; i++) internal(i);
  for (let k = 4; k < 8; k++) external(k);
  return s;
}

/**
 * Two-to-one compression (Merkle nodes): perm([l, r])[0] + l.
 * Mirrors `PoseidonCompress` (circom) and `poseidon2_compress` (Soroban).
 */
export function compress(left: bigint, right: bigint): bigint {
  const out = permutation([mod(left), mod(right)]);
  return mod(out[0] + left);
}

/**
 * Fixed-width hash with a capacity/domain slot:
 * hash(inputs, domain) = perm([...inputs, domain])[0].
 * Mirrors the circom `Poseidon2(n)` template.
 */
export function hash(inputs: bigint[], domain: bigint = 0n): bigint {
  return permutation([...inputs.map(mod), mod(domain)])[0];
}

/**
 * The Merkle zero table. zeros[0] = Poseidon2("XLM") (t=4, inputs
 * [88, 76, 77], domain 0); zeros[i+1] = compress(zeros[i], zeros[i]).
 * Must match `get_zeroes` in contracts/common/soroban-utils.
 */
export function merkleZeros(levels: number): bigint[] {
  const zeros: bigint[] = [hash([88n, 76n, 77n], 0n)];
  for (let i = 0; i < levels; i++) {
    zeros.push(compress(zeros[i], zeros[i]));
  }
  return zeros;
}
