/**
 * Interpreting a `ProverPort`'s `onProgress(stage)` stream for the UI. snarkjs
 * exposes no real percentage, so we model proving as discrete, honest phases and
 * map the raw stage strings (`"proving"`, `"done"`, or a forwarded snarkjs info
 * line) into a calm status. Pairs with the payment machine: the prover's
 * `"proving"`/`"done"` boundaries drive WITNESS_READY/PROOF_READY.
 */

export type ProvingPhase = "idle" | "proving" | "done";

export interface ProvingStatus {
  phase: ProvingPhase;
  /** A user-facing line (never raw snarkjs jargon on the happy path). */
  label: string;
  /** The most recent raw stage, for diagnostics/telemetry. */
  raw?: string;
}

export const initialProvingStatus: ProvingStatus = { phase: "idle", label: "Ready" };

/** Fold a raw prover stage into the next status. */
export function provingStatusFromStage(stage: string): ProvingStatus {
  if (stage === "done") return { phase: "done", label: "Proof ready", raw: stage };
  if (stage === "proving") return { phase: "proving", label: "Generating proof on your device…", raw: stage };
  // A forwarded internal info log — stay in "proving" but keep the detail.
  return { phase: "proving", label: "Generating proof on your device…", raw: stage };
}
