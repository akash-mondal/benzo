/**
 * App lock (C4 — Cash App "Security Lock" parity). Two independent, device-local
 * toggles, each gated by the on-device passkey / Face ID / fingerprint:
 *   - onOpen: require an unlock when the app opens
 *   - onSend: require an unlock before each payment
 *
 * Fully client-side: settings live in localStorage, the check is a WebAuthn
 * presence assertion (lib/passkey). No server, no custodial anything.
 */
import { lockCapable, verifyPresence } from "./passkey";

const LS = "benzo.lock.v1";

export interface LockSettings {
  onOpen: boolean;
  onSend: boolean;
}

export function getLockSettings(): LockSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || "{}");
    return { onOpen: !!raw.onOpen, onSend: !!raw.onSend };
  } catch {
    return { onOpen: false, onSend: false };
  }
}

export function setLockSettings(s: LockSettings): void {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export { lockCapable };

/** Run the biometric/passkey check. Returns true on success, false if cancelled. */
export async function requireUnlock(): Promise<boolean> {
  try {
    await verifyPresence();
    return true;
  } catch {
    return false;
  }
}

/** Should the app present the open-lock gate right now? */
export function shouldLockOnOpen(): boolean {
  return getLockSettings().onOpen && lockCapable();
}

/** Should this payment require an unlock first? */
export function shouldLockOnSend(): boolean {
  return getLockSettings().onSend && lockCapable();
}
