/**
 * `pickProver` — local-only proving policy for browser/runtime artifact routing.
 * The selector never sends a witness outside the local runtime. Weak devices are a
 * UX and capability problem, not a reason to move private witness data elsewhere.
 */

export interface DeviceProfile {
  isMobile: boolean;
  /** navigator.deviceMemory (GB), if known */
  memoryGB?: number;
  /** navigator.hardwareConcurrency, if known */
  cores?: number;
}

export type ProverChoice = "wasm";

export interface RoutePolicy {
  /** Force on-device proving (witness never leaves the device). */
  onDeviceOnly?: boolean;
  /** Circuits treated as heavy by UX. They still use local proving. */
  heavyCircuits: string[];
  /** zkey byte ceiling used for warnings. Proving still stays local. */
  maxOnDeviceBytes: number;
}

/** Force on-device proving (the user's witness never leaves their device). */
export const ON_DEVICE_POLICY: RoutePolicy = {
  onDeviceOnly: true,
  heavyCircuits: [],
  maxOnDeviceBytes: Number.MAX_SAFE_INTEGER,
};

/**
 * The user's proving preference. The accepted values are intentionally local
 * aliases for backward-compatible UI plumbing. Every mode resolves to local.
 */
export type ProvingMode = "on-device" | "local" | "auto";

export function policyForMode(mode: ProvingMode): RoutePolicy {
  switch (mode) {
    case "auto":
      return HYBRID_POLICY;
    case "on-device":
    case "local":
      return ON_DEVICE_POLICY;
    default:
      return ON_DEVICE_POLICY;
  }
}

/** Hybrid policy keeps heavy-circuit metadata for warnings, not delegation. */
export const HYBRID_POLICY: RoutePolicy = {
  heavyCircuits: [
    "joinsplit",
    "proof_of_balance",
    "proof_of_sum",
    "passport_register",
    "passport_register_rsa256",
    "passport_register_rsa1",
  ],
  maxOnDeviceBytes: 30 * 1024 * 1024, // 30 MB
};

/** Default policy = local-only. */
export const DEFAULT_POLICY: RoutePolicy = ON_DEVICE_POLICY;

/** A device is "weak" if mobile, low-memory, or low-core. */
export function isWeakDevice(d: DeviceProfile): boolean {
  return (
    d.isMobile ||
    (d.memoryGB != null && d.memoryGB < 4) ||
    (d.cores != null && d.cores < 4)
  );
}

/**
 * Pick the prover for `circuit` on `device`. It always returns local WASM.
 */
export function pickProver(
  _circuit: string,
  _sizeBytes: number,
  _device: DeviceProfile,
  _policy: RoutePolicy = DEFAULT_POLICY,
): ProverChoice {
  return "wasm";
}
