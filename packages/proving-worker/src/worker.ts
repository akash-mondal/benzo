/**
 * Web Worker entry: runs `WasmProver` off the UI thread so a multi-second Groth16
 * proof never freezes the tab. The witness and proving key never leave the
 * device. Messages back to the main thread are `{type:"progress"|"result"|"error"}`.
 *
 * In an app:
 *   new Worker(new URL("@benzo/proving-worker/worker", import.meta.url), { type: "module" })
 *
 * For multithreaded snarkjs the host must serve the worker cross-origin-isolated
 * (COOP: same-origin, COEP: require-corp) so SharedArrayBuffer is available.
 */
import { WasmProver, type CircuitArtifacts, type WitnessInput } from "@benzo/core";

/** Minimal worker global surface (avoids requiring the DOM/WebWorker lib). */
interface WorkerCtx {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
}
const ctx = globalThis as unknown as WorkerCtx;

const prover = new WasmProver((stage) => ctx.postMessage({ type: "progress", stage }));

ctx.onmessage = async (e) => {
  const { id, artifacts, input } = e.data as {
    id: number;
    artifacts: CircuitArtifacts;
    input: WitnessInput;
  };
  try {
    const result = await prover.prove(artifacts, input);
    ctx.postMessage({ type: "result", id, result });
  } catch (err) {
    ctx.postMessage({ type: "error", id, error: String((err as { message?: string })?.message ?? err) });
  }
};
