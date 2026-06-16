/**
 * WorkerProver RPC test. A real Web Worker isn't available in Node, so a fake
 * worker stands in for the message-passing contract: it verifies the prover
 * resolves the prove promise with the worker's result, forwards progress, and
 * rejects on a worker error.
 */
import { describe, it, expect } from "vitest";
import { WorkerProver, type WorkerLike } from "../src/index.js";

const cannedResult = {
  proof: {} as never,
  publicSignals: ["1"],
  sorobanProof: { a: "0xa", b: "0xb", c: "0xc" },
  sorobanPublics: ["0x1"],
};

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(message: unknown): void {
    const { id } = message as { id: number };
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: "progress", stage: "proving" } });
      this.onmessage?.({ data: { type: "result", id, result: cannedResult } });
      this.onmessage?.({ data: { type: "progress", stage: "done" } });
    });
  }
}

class ErrorWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(message: unknown): void {
    const { id } = message as { id: number };
    queueMicrotask(() => this.onmessage?.({ data: { type: "error", id, error: "boom" } }));
  }
}

describe("WorkerProver", () => {
  it("resolves with the worker's result and forwards progress", async () => {
    const stages: string[] = [];
    const prover = new WorkerProver(new FakeWorker(), (s) => stages.push(s));
    const res = await prover.prove({ wasmPath: "", zkeyPath: "" }, {});
    expect(res.publicSignals).toEqual(["1"]);
    expect(stages).toContain("proving");
  });

  it("rejects when the worker reports an error", async () => {
    const prover = new WorkerProver(new ErrorWorker());
    await expect(prover.prove({ wasmPath: "", zkeyPath: "" }, {})).rejects.toThrow("boom");
  });

  it("routes concurrent proofs to their own promises by id", async () => {
    const prover = new WorkerProver(new FakeWorker());
    const [a, b] = await Promise.all([
      prover.prove({ wasmPath: "", zkeyPath: "" }, {}),
      prover.prove({ wasmPath: "", zkeyPath: "" }, {}),
    ]);
    expect(a.publicSignals).toEqual(["1"]);
    expect(b.publicSignals).toEqual(["1"]);
  });
});
