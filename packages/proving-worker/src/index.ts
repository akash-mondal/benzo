/**
 * `WorkerProver` — a `ProverPort` that runs `WasmProver` inside a Web Worker
 * (`./worker`), so a multi-second on-device Groth16 proof never blocks the UI
 * thread. Drop-in wherever a `ProverPort` is expected (e.g. `BenzoClient`).
 *
 * Usage:
 *   const worker = new Worker(new URL("@benzo/proving-worker/worker", import.meta.url), { type: "module" });
 *   const prover = new WorkerProver(worker, (stage) => setStatus(stage));
 *   client.useProver(prover);   // proofs now generate off the UI thread
 */
import type { CircuitArtifacts, ProverPort, ProveResult, WitnessInput } from "@benzo/core";

/** The minimal Worker surface `WorkerProver` needs (a real DOM `Worker` fits). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

type WorkerMsg =
  | { type: "progress"; stage: string }
  | { type: "result"; id: number; result: ProveResult }
  | { type: "error"; id: number; error: string };

export class WorkerProver implements ProverPort {
  readonly name = "worker";
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (r: ProveResult) => void; reject: (e: Error) => void }
  >();

  constructor(
    private readonly worker: WorkerLike,
    private readonly onProgress?: (stage: string) => void,
  ) {
    this.worker.onmessage = (e) => {
      const msg = e.data as WorkerMsg;
      if (msg.type === "progress") {
        this.onProgress?.(msg.stage);
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === "result") p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    };
  }

  prove(artifacts: CircuitArtifacts, input: WitnessInput): Promise<ProveResult> {
    const id = ++this.seq;
    return new Promise<ProveResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, artifacts, input });
    });
  }
}
