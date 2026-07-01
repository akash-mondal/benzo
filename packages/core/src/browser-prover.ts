import { type ProverPort, WasmProver } from "./prover.js";

export interface DeviceProfile {
  /** phone/tablet, from user agent when available */
  isMobile?: boolean;
  /** navigator.deviceMemory (GB), if the browser exposes it */
  memoryGB?: number;
  /** navigator.hardwareConcurrency (logical cores), if known */
  cores?: number;
  /** WebAssembly available, required for browser proving */
  hasWasm?: boolean;
}

export interface BrowserProverOptions {
  /** Local-only proving mode. Kept explicit so callers cannot silently select an outside service. */
  mode?: "on-device" | "local";
  /** Device hints; auto-detected from the browser when omitted. */
  device?: DeviceProfile;
  /** Min logical cores for the "capable" hint. Proving is still local if lower. */
  minCores?: number;
  /** Min memory (GB) for the "capable" hint. Proving is still local if lower. */
  minMemoryGB?: number;
}

const DEFAULT_MIN_CORES = 4;
const DEFAULT_MIN_MEMORY_GB = 8;

/** Best-effort device profile from the browser, safe off-browser. */
export function detectDevice(): DeviceProfile {
  const nav = (globalThis as { navigator?: { userAgent?: string; deviceMemory?: number; hardwareConcurrency?: number } }).navigator;
  const ua = nav?.userAgent ?? "";
  return {
    isMobile: /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua),
    memoryGB: nav?.deviceMemory,
    cores: nav?.hardwareConcurrency,
    hasWasm: typeof WebAssembly !== "undefined",
  };
}

/**
 * Capability hint for heavy browser proving. A false result means the UI should
 * warn or defer heavy actions, not send the witness outside the local runtime.
 */
export function canProveOnDevice(
  device: DeviceProfile,
  minCores = DEFAULT_MIN_CORES,
  minMemoryGB = DEFAULT_MIN_MEMORY_GB,
): boolean {
  if (device.isMobile) return false;
  if (device.hasWasm === false) return false;
  if (device.cores != null && device.cores < minCores) return false;
  if (device.memoryGB != null && device.memoryGB < minMemoryGB) return false;
  return true;
}

/**
 * Local-only browser prover selection. It always returns the WASM prover; weak
 * devices are handled by UX and explicit failure, never by outside proving.
 */
export function pickBrowserProver(_opts: BrowserProverOptions = {}): ProverPort {
  return new WasmProver();
}
