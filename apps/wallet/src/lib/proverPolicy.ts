/**
 * Prover policy - WHERE a ZK proof gets generated.
 *
 * Product direction is local-only proving. Capable desktops prove in-browser.
 * API-mediated proof actions use the local runtime prover. Weak devices fail
 * clearly instead of silently sending witness data to an outside service.
 */
import type { ProverKind } from "./api";

export interface ProverPlan {
  onDevice: boolean;
  kind: ProverKind;
  reason: string;
}

/** Coarse pointer + touch points ⇒ a phone/tablet (no mouse). */
function isTouchFirst(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const ua = /Mobi|Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || "");
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  return ua || (coarse && touch);
}

/** A desktop with enough muscle to prove on-device without a painful wait. */
function isPowerfulDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  // deviceMemory is Chromium-only; assume "enough" when the browser won't say.
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  return cores >= 4 && mem >= 4;
}

/**
 * True only when this device should grind a browser-local proof.
 */
export function preferDeviceProving(): boolean {
  if (isTouchFirst()) return false;
  return isPowerfulDesktop();
}

/** Local-only builds have no remote delegate. */
export function delegatedProverKind(_available = false): ProverKind {
  return "local";
}

/**
 * API-bound proof calls remain local-only; the API runtime must use the same
 * local prover configuration as the hosted/VPS runtime.
 */
export function apiProverKind(_kind: ProverKind, _available = false): ProverKind {
  return "local";
}

/** One-liner for UI copy / telemetry: how this device will prove. */
export function proverPlan(_available = false): ProverPlan {
  if (preferDeviceProving()) {
    return { onDevice: true, kind: "local", reason: "Local proof on this device. Witness stays here." };
  }
  return {
    onDevice: false,
    kind: "local",
    reason: "Local proof required. Use a capable desktop for heavy proof actions.",
  };
}

/**
 * UI copy for proofs that cross the wallet API boundary.
 */
export function apiBoundaryProverPlan(plan: ProverPlan, _available = false): ProverPlan {
  return { ...plan, kind: "local", reason: plan.onDevice ? plan.reason : "Proof runs on the local Benzo runtime." };
}
