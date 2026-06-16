/**
 * Keychain lock/unlock lifecycle as a pure reducer — the UI side of
 * @benzo/wallet's `Keychain`. Models the states a lock screen needs: no wallet
 * yet, locked, unlocking (deriving the wrapping key — scrypt/passkey is not
 * instant), unlocked, or a failed attempt.
 */

export type WalletPhase = "absent" | "locked" | "unlocking" | "unlocked" | "error";

export interface WalletState {
  phase: WalletPhase;
  error?: string;
}

export type WalletEvent =
  | { type: "DISCOVERED"; exists: boolean }
  | { type: "UNLOCK_START" }
  | { type: "UNLOCKED" }
  | { type: "UNLOCK_FAILED"; error: string }
  | { type: "LOCK" }
  | { type: "CREATED" };

export const initialWalletState: WalletState = { phase: "absent" };

export function walletReducer(state: WalletState, event: WalletEvent): WalletState {
  switch (event.type) {
    case "DISCOVERED":
      return { phase: event.exists ? "locked" : "absent" };
    case "UNLOCK_START":
      return state.phase === "locked" || state.phase === "error"
        ? { phase: "unlocking" }
        : state;
    case "UNLOCKED":
    case "CREATED":
      return { phase: "unlocked" };
    case "UNLOCK_FAILED":
      return { phase: "error", error: event.error };
    case "LOCK":
      return { phase: "locked" };
    default:
      return state;
  }
}

export const isUnlocked = (s: WalletState): boolean => s.phase === "unlocked";
