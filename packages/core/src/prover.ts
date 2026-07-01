/**
 * Headless Groth16 proving (Node — never a browser).
 *
 * Wraps snarkjs `groth16.fullProve` over the compiled circuit artifacts
 * (witness-generator WASM + proving zkey) and returns both the snarkjs JSON
 * and the Soroban-encoded forms.
 */

// snarkjs has no bundled types; the surface we use is tiny.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import * as snarkjs from "snarkjs";
import { proofToSoroban, publicsToSoroban, type SnarkjsProof } from "./crypto/groth16.js";

export type CircuitName = "shield" | "joinsplit" | "unshield";

export interface CircuitArtifacts {
  /** Path (Node) or URL (browser fetch) of the witness-generator WASM. */
  wasmPath: string;
  /** Path (Node) or URL (browser fetch) of the proving zkey. */
  zkeyPath: string;
  /** Browser-portable: preloaded WASM bytes (fetched once); used over wasmPath. */
  wasm?: Uint8Array;
  /** Browser-portable: preloaded zkey bytes (fetched once); used over zkeyPath. */
  zkey?: Uint8Array;
  /** Opaque circuit id used by local runtime manifests and diagnostics. */
  circuit?: string;
}

export interface ProveResult {
  proof: SnarkjsProof;
  publicSignals: string[];
  sorobanProof: { a: string; b: string; c: string };
  sorobanPublics: string[];
}

type WitnessValue = string | WitnessValue[];
type BigNest = bigint | BigNest[];
export type WitnessInput = Record<string, WitnessValue>;

/** Recursively serialize bigints (any nesting depth — the org join-split needs
 *  3D `mPathElements`) into snarkjs input form. */
function serWitness(v: BigNest): WitnessValue {
  return typeof v === "bigint" ? v.toString() : v.map(serWitness);
}
export function toWitnessInput(values: Record<string, BigNest>): WitnessInput {
  const out: WitnessInput = {};
  for (const [k, v] of Object.entries(values)) out[k] = serWitness(v);
  return out;
}

export async function prove(
  artifacts: CircuitArtifacts,
  input: WitnessInput,
): Promise<ProveResult> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    artifacts.wasmPath,
    artifacts.zkeyPath,
  );
  return {
    proof,
    publicSignals,
    sorobanProof: proofToSoroban(proof),
    sorobanPublics: publicsToSoroban(publicSignals),
  };
}

/** Local verification against a snarkjs verification_key.json object. */
export async function verifyLocal(
  vk: unknown,
  publicSignals: string[],
  proof: SnarkjsProof,
): Promise<boolean> {
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

/**
 * A pluggable proving backend: turns a witness into a Groth16 proof. Core builds
 * witnesses and calls a `ProverPort`; the runtime (Node / browser WASM / native)
 * decides *where* the proof is generated — so swapping runtimes never touches
 * protocol logic. This is the seam that lets the same `BenzoClient` run headless
 * on the CLI and client-side in the browser.
 */
export interface ProverPort {
  readonly name: string;
  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult>;
}

/** Headless Groth16 proving via snarkjs (Node/server). The default backend. */
export class NodeProver implements ProverPort {
  readonly name = "node";
  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult> {
    return prove(artifacts, input);
  }
}

/**
 * On-device Groth16 proving via snarkjs — the same proof output as NodeProver,
 * but it accepts preloaded `Uint8Array` artifacts (fetched once in the browser)
 * and never assumes `node:fs`, so it runs in a Web Worker on the user's device.
 * The witness and proving key never leave the device. `packages/proving-worker`
 * wraps this in a Worker so a multi-second proof never freezes the UI thread.
 */
export class WasmProver implements ProverPort {
  readonly name = "wasm";
  constructor(private readonly onProgress?: (stage: string) => void) {}
  async prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult> {
    const wasm = artifacts.wasm ?? artifacts.wasmPath;
    const zkey = artifacts.zkey ?? artifacts.zkeyPath;
    // snarkjs doesn't expose proof-progress, so we mark the meaningful UI
    // boundaries ("proving" → "done") plus forward any internal info logs.
    this.onProgress?.("proving");
    const logger = this.onProgress
      ? { debug: () => {}, info: (m: string) => this.onProgress?.(m), error: () => {} }
      : undefined;
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey, logger);
    this.onProgress?.("done");
    return {
      proof,
      publicSignals,
      sorobanProof: proofToSoroban(proof),
      sorobanPublics: publicsToSoroban(publicSignals),
    };
  }
}
