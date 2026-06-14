/**
 * @benzo/prover — ProverPort: one proving interface, many runtimes.
 *
 * The Benzo core builds witnesses; a ProverPort turns a witness into a Groth16
 * proof. NodeProver (snarkjs, headless) is the CLI/server default; WasmProver
 * runs the same isomorphic prover client-side in the browser (optionally in a
 * Web Worker). NativeProver is the one stub — it needs a native rapidsnark/mopro
 * delegate from a mobile surface. Swapping runtimes never touches core logic.
 */
import {
  NodeProver,
  prove,
  type CircuitArtifacts,
  type WitnessInput,
  type ProveResult,
  type ProverPort,
} from "@benzo/core";

// The canonical ProverPort + NodeProver live in @benzo/core (so core can type an
// injected prover without depending on this package). Re-exported here so the
// runtime surfaces import every backend from one place.
export type { CircuitArtifacts, WitnessInput, ProveResult, ProverPort };
export { NodeProver };

/** A proving backend implementation (used to delegate to a Worker/native FFI). */
export type ProveFn = (artifacts: CircuitArtifacts, input: WitnessInput) => Promise<ProveResult>;

/**
 * Browser prover. snarkjs is isomorphic: in a browser, `artifacts.wasmPath` /
 * `zkeyPath` are URLs it fetches, and the proof is generated CLIENT-SIDE — the
 * witness never leaves the device. By default it proves on the calling thread;
 * a web surface injects a Web Worker `delegate` (so a multi-second proof never
 * blocks the UI) and serves COOP/COEP for WASM threads. Either way the proving
 * call and output are byte-identical to NodeProver.
 */
export class WasmProver implements ProverPort {
  readonly name = "wasm";
  constructor(private readonly delegate?: ProveFn) {}
  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult> {
    return (this.delegate ?? prove)(artifacts, input);
  }
}

/**
 * Mobile native prover. The fast path is a native Groth16 prover
 * (rapidsnark/mopro via FFI) that a React Native surface injects as `delegate`;
 * without one it throws, since there is no pure-JS native prover to fall back to
 * (use WasmProver in a WebView instead).
 */
export class NativeProver implements ProverPort {
  readonly name = "native";
  constructor(private readonly delegate?: ProveFn) {}
  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult> {
    if (!this.delegate) {
      throw new Error(
        "NativeProver needs a native proving delegate (rapidsnark/mopro FFI) from the mobile surface.",
      );
    }
    return this.delegate(artifacts, input);
  }
}
