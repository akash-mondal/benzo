/**
 * @benzo/prover — ProverPort: one proving interface, many runtimes.
 *
 * The Benzo core builds witnesses; a ProverPort turns a witness into a Groth16
 * proof. NodeProver (snarkjs, headless) is the working default used by the CLI
 * and servers. WasmProver / NativeProver are typed stubs the browser and mobile
 * surfaces fill in later — so swapping runtimes never touches core logic.
 */
import {
  prove as nodeProve,
  type CircuitArtifacts,
  type WitnessInput,
  type ProveResult,
} from "@benzo/core";

export type { CircuitArtifacts, WitnessInput, ProveResult };

export interface ProverPort {
  readonly name: string;
  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult>;
}

/** Headless Groth16 proving via snarkjs (Node). The working default. */
export class NodeProver implements ProverPort {
  readonly name = "node";
  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult> {
    return nodeProve(artifacts, input);
  }
}

/** Browser Web Worker (WASM) prover. Stub — provided by apps/web. */
export class WasmProver implements ProverPort {
  readonly name = "wasm";
  async prove(): Promise<ProveResult> {
    throw new Error(
      "WasmProver not implemented yet — the web surface (apps/web) will provide a Web Worker WASM prover.",
    );
  }
}

/** Mobile native prover. Stub — provided by a future React Native surface. */
export class NativeProver implements ProverPort {
  readonly name = "native";
  async prove(): Promise<ProveResult> {
    throw new Error(
      "NativeProver not implemented yet — the mobile surface will provide a native prover.",
    );
  }
}
