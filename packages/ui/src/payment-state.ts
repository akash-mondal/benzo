/**
 * The shielded-payment lifecycle as a pure state machine, shared by both apps so
 * "what's happening to my money right now" is modeled once. A private payment is
 * not one network call — it is build-witness → prove (seconds, on-device) →
 * submit → confirm, and the UI must show each phase honestly (especially the
 * proving wait, which is the unfamiliar part for a Cash-App-shaped user).
 *
 * Pure reducer + selectors; the React hook in `hooks.ts` is a thin wrapper.
 */

export type PaymentPhase =
  | "idle"
  | "building" // assembling the witness (notes, Merkle paths)
  | "proving" // generating the Groth16 proof (on-device)
  | "submitting" // signed + sent to the chain
  | "confirmed"
  | "failed";

export interface PaymentState {
  phase: PaymentPhase;
  txHash?: string;
  /** Contract return value on success (e.g. a leaf index). */
  result?: unknown;
  error?: string;
  /** ms spent proving, surfaced once known (honest "took 3.2s" UX). */
  provingMs?: number;
}

export type PaymentEvent =
  | { type: "START" }
  | { type: "WITNESS_READY" }
  | { type: "PROOF_READY"; provingMs?: number }
  | { type: "SUBMITTED"; txHash: string }
  | { type: "CONFIRMED"; result?: unknown }
  | { type: "FAIL"; error: string }
  | { type: "RESET" };

export const initialPaymentState: PaymentState = { phase: "idle" };

const ORDER: PaymentPhase[] = ["idle", "building", "proving", "submitting", "confirmed"];

export function paymentReducer(state: PaymentState, event: PaymentEvent): PaymentState {
  switch (event.type) {
    case "START":
      // Only startable from a rest state — ignore double-submits mid-flight.
      return state.phase === "idle" || state.phase === "failed" || state.phase === "confirmed"
        ? { phase: "building" }
        : state;
    case "WITNESS_READY":
      return state.phase === "building" ? { ...state, phase: "proving" } : state;
    case "PROOF_READY":
      return state.phase === "proving"
        ? { ...state, phase: "submitting", provingMs: event.provingMs }
        : state;
    case "SUBMITTED":
      return state.phase === "submitting" ? { ...state, txHash: event.txHash } : state;
    case "CONFIRMED":
      return state.phase === "submitting"
        ? { ...state, phase: "confirmed", result: event.result }
        : state;
    case "FAIL":
      // A failure can interrupt any in-flight phase.
      return { ...state, phase: "failed", error: event.error };
    case "RESET":
      return initialPaymentState;
    default:
      return state;
  }
}

/** No further automatic transitions — the flow has settled. */
export function isTerminal(state: PaymentState): boolean {
  return state.phase === "confirmed" || state.phase === "failed";
}

export function isInFlight(state: PaymentState): boolean {
  return state.phase === "building" || state.phase === "proving" || state.phase === "submitting";
}

/** A user-facing line for the current phase (calm, never alarming on success). */
export function paymentLabel(state: PaymentState): string {
  switch (state.phase) {
    case "idle":
      return "Ready";
    case "building":
      return "Preparing your private payment…";
    case "proving":
      return "Proving on your device…";
    case "submitting":
      return "Sending…";
    case "confirmed":
      return "Sent privately";
    case "failed":
      return state.error ? `Couldn't send: ${state.error}` : "Couldn't send";
  }
}

/** 0–1 coarse progress for a determinate bar (proving has no real %, so phases). */
export function paymentProgress(state: PaymentState): number {
  if (state.phase === "failed") return 1;
  const i = ORDER.indexOf(state.phase);
  return i < 0 ? 0 : i / (ORDER.length - 1);
}
