/**
 * React bindings — thin `useReducer`/`useState` wrappers over the pure state
 * machines in this package. All real logic lives in the reducers (tested
 * headlessly); these just connect them to React so a screen consumes one hook.
 * `react` is an optional peer dependency — import these only in a React app.
 */
import { useCallback, useReducer, useState } from "react";
import { Keychain, type KVStore, type WalletSecrets } from "@benzo/wallet";
import {
  initialPaymentState,
  paymentReducer,
  paymentLabel,
  paymentProgress,
  isInFlight,
  isTerminal,
  type PaymentState,
  type PaymentEvent,
} from "./payment-state.js";
import {
  initialProvingStatus,
  provingStatusFromStage,
  type ProvingStatus,
} from "./proving-state.js";
import {
  initialWalletState,
  walletReducer,
  isUnlocked,
  type WalletState,
} from "./wallet-state.js";

/** The shielded-payment lifecycle wired to a screen. */
export function usePaymentMachine() {
  const [state, dispatch] = useReducer(paymentReducer, initialPaymentState);
  return {
    state,
    dispatch: dispatch as (e: PaymentEvent) => void,
    label: paymentLabel(state),
    progress: paymentProgress(state),
    inFlight: isInFlight(state),
    terminal: isTerminal(state),
    reset: useCallback(() => dispatch({ type: "RESET" }), []),
  };
}

/**
 * Proving progress for a screen. `onStage` is handed straight to a
 * `WasmProver`/`WorkerProver` `onProgress` callback; the hook keeps the latest
 * interpreted status.
 */
export function useProvingStatus() {
  const [status, setStatus] = useState<ProvingStatus>(initialProvingStatus);
  const onStage = useCallback((stage: string) => setStatus(provingStatusFromStage(stage)), []);
  const reset = useCallback(() => setStatus(initialProvingStatus), []);
  return { status, onStage, reset };
}

/**
 * Keychain lock screen state + actions. Drives `walletReducer` and holds the
 * unlocked `Keychain` (whose `.signer()` then signs writes). `unlock`/`create`
 * are async because deriving the wrapping key (scrypt/passkey) is not instant.
 */
export function useWalletLock(opts: { kv: KVStore; storeKey?: string }) {
  const [state, dispatch] = useReducer(walletReducer, initialWalletState);
  const [keychain, setKeychain] = useState<Keychain | null>(null);

  const refresh = useCallback(async () => {
    dispatch({ type: "DISCOVERED", exists: await Keychain.exists(opts.kv, opts.storeKey) });
  }, [opts.kv, opts.storeKey]);

  const unlock = useCallback(
    async (wrappingKey: Uint8Array) => {
      dispatch({ type: "UNLOCK_START" });
      try {
        const kc = await Keychain.unlock({ kv: opts.kv, wrappingKey, storeKey: opts.storeKey });
        setKeychain(kc);
        dispatch({ type: "UNLOCKED" });
        return kc;
      } catch (e) {
        dispatch({ type: "UNLOCK_FAILED", error: (e as Error).message });
        return null;
      }
    },
    [opts.kv, opts.storeKey],
  );

  const create = useCallback(
    async (wrappingKey: Uint8Array, secrets: WalletSecrets) => {
      const kc = await Keychain.create({ kv: opts.kv, wrappingKey, secrets, storeKey: opts.storeKey });
      setKeychain(kc);
      dispatch({ type: "CREATED" });
      return kc;
    },
    [opts.kv, opts.storeKey],
  );

  const lock = useCallback(() => {
    keychain?.lock();
    setKeychain(null);
    dispatch({ type: "LOCK" });
  }, [keychain]);

  return { state, keychain, unlocked: isUnlocked(state), refresh, unlock, create, lock };
}

export type { WalletState };
