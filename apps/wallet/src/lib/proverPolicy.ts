/**
 * Prover policy — WHERE a ZK proof gets generated, decided by the device.
 *
 * On-device proving (snarkjs WasmProver) is single-threaded and heavy (a transfer
 * proof is ~tens of seconds, and the proving key is 20–25 MB). That is fine on a
 * capable laptop but punishing on a phone or a weak machine. So:
 *
 *   - phones / tablets / touch-first devices  → NEVER prove on-device. Delegate
 *     to the attested enclave (TEE); if no TEE is wired, delegate to the server
 *     prover. The witness is offloaded either way — the weak device never grinds.
 *   - low-power desktops (few CPU cores / little RAM) → same: delegate.
 *   - capable desktops only → prove on-device (witness never leaves the browser).
 *
 * `delegatedProverKind` then picks the delegate: the attested TEE when it is
 * available, otherwise the server prover.
 */
import type { ProverKind } from "./api";

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
 * True only when this device should grind the proof locally. Phones, tablets and
 * weak desktops return false → the caller must delegate (TEE / server).
 */
export function preferDeviceProving(): boolean {
  if (isTouchFirst()) return false; // mobile/tablet → always delegate
  return isPowerfulDesktop(); // desktop → only if it has the cores/RAM
}

/** Which delegate to use when we're NOT proving on-device: TEE if available, else the server. */
export function delegatedProverKind(teeAvailable: boolean): ProverKind {
  return teeAvailable ? "tee" : "local";
}

/** One-liner for UI copy / telemetry: how this device will prove. */
export function proverPlan(teeAvailable: boolean): { onDevice: boolean; kind: ProverKind; reason: string } {
  if (preferDeviceProving()) return { onDevice: true, kind: "local", reason: "Capable device — proving on-device, witness stays here" };
  const kind = delegatedProverKind(teeAvailable);
  return {
    onDevice: false,
    kind,
    reason: kind === "tee"
      ? "Low-power device — delegating to the attested secure enclave (TEE)"
      : "Low-power device — delegating to the prover (enclave not wired here)",
  };
}
