/**
 * The 3-phase send ceremony, modeled as a pure projection of the payment state
 * machine (payment-state.ts). The animation is a SLAVE to the machine, never a
 * timer: phase 1 ("encrypt") holds through building+proving, phase 2 ("settle")
 * through submitting, phase 3 ("verify") on confirmed. This is the line between a
 * credible ZK demo and a progress-bar lie — so the mapping lives here, tested,
 * and both apps render it (warm coin-ceremony in the wallet, condensed strip in
 * the console).
 *
 * Pure + framework-agnostic: no React, no framer. The presentational components
 * import this to know WHAT to show; HOW is per-app.
 */
import type { PaymentPhase, PaymentState } from "./payment-state.js";

export type CeremonyPhase = "encrypt" | "settle" | "verify" | "error";

/** Minimum on-screen time per phase so a fast local proof never flashes. */
export const SEND_PHASE_FLOOR_MS: Record<Exclude<CeremonyPhase, "error">, number> = {
  encrypt: 1200,
  settle: 800,
  verify: 1000,
};

/** Reassurance copy when a phase runs long (proving/ledger close can be slow). */
export const SEND_PHASE_SLOW_MS = { encrypt: 6000, settle: 8000 } as const;

export interface CeremonyView {
  phase: CeremonyPhase;
  /** 0..2 segment index for the 3-step rail (error → -1, component keeps last). */
  step: number;
  title: string;
  sub: string;
  /** minimum ms this phase should stay visible */
  floorMs: number;
  /** whether to play motion (false under prefers-reduced-motion) */
  animate: boolean;
  /** settled — render the verifiable receipt */
  done: boolean;
  /** failed — render the error state */
  failed: boolean;
}

export function ceremonyPhase(p: PaymentPhase): CeremonyPhase {
  switch (p) {
    case "building":
    case "proving":
      return "encrypt";
    case "submitting":
      return "settle";
    case "confirmed":
      return "verify";
    case "failed":
      return "error";
    default:
      return "encrypt"; // idle → pre-roll
  }
}

export interface CeremonyOpts {
  prover?: "local";
  reducedMotion?: boolean;
}

/** Project a payment state into everything the ceremony UI needs to render. */
export function sendCeremonyView(state: PaymentState, opts: CeremonyOpts = {}): CeremonyView {
  const reducedMotion = opts.reducedMotion ?? false;
  const phase = ceremonyPhase(state.phase);

  let step: number;
  let title: string;
  let sub: string;
  let floorMs: number;
  switch (phase) {
    case "encrypt":
      step = 0;
      title = "Encrypting your payment";
      sub = "Proving privately with the local prover";
      floorMs = SEND_PHASE_FLOOR_MS.encrypt;
      break;
    case "settle":
      step = 1;
      title = "Settling securely";
      sub = "Writing your private payment to the ledger";
      floorMs = SEND_PHASE_FLOOR_MS.settle;
      break;
    case "verify":
      step = 2;
      title = "Sent privately";
      sub = "Here's your receipt";
      floorMs = SEND_PHASE_FLOOR_MS.verify;
      break;
    case "error":
      step = -1;
      title = "Couldn't send";
      sub = state.error ?? "Nothing left your wallet. Try again.";
      floorMs = 0;
      break;
  }

  return {
    phase,
    step,
    title,
    sub,
    floorMs,
    animate: !reducedMotion,
    done: phase === "verify",
    failed: phase === "error",
  };
}

/** The three rail labels (for the reduced-motion / a11y step list). */
export const SEND_RAIL_LABELS = ["Encrypting", "Settling", "Sent"] as const;
