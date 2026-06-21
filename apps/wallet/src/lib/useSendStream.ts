/**
 * useSendStream — drives the 3-phase send ceremony from real BFF phase events.
 * It feeds the shared payment state machine (@benzo/ui) so the animation is a
 * slave to the machine, never a timer. Event mapping is prefix-idempotent: each
 * incoming phase dispatches the whole prefix it implies, so a missing
 * intermediate event (e.g. a fast path that skips "proving") never strands the
 * machine.
 */
import { useCallback, useReducer, useState } from "react";
import { paymentReducer, initialPaymentState, type PaymentState } from "@benzo/ui/payment-state";
import { api, type ProverKind, type SettleResult, type SendPhaseEvent } from "./api";
import { clientSideReadsAvailable, sendClientSide } from "./benzoClient";
import { preferDeviceProving } from "./proverPolicy";
import { usdcToStroops } from "./format";

/** A bare @handle send (not a G-address or an off-Benzo invite) can settle fully client-side. */
function isHandleSend(to: string): boolean {
  const t = to.trim();
  if (/^G[A-Z2-7]{55}$/.test(t)) return false; // public address → unshield (BFF)
  return t.startsWith("@") || /^[a-z0-9_.]{3,20}$/i.test(t);
}

export function useSendStream() {
  const [state, dispatch] = useReducer(paymentReducer, initialPaymentState);
  const [receipt, setReceipt] = useState<SettleResult | null>(null);

  const apply = useCallback((e: SendPhaseEvent) => {
    if (e.phase === "failed") {
      dispatch({ type: "FAIL", error: e.error ?? "Couldn't send" });
      return;
    }
    // prefix-idempotent advance (reducer guards make re-dispatch safe)
    dispatch({ type: "START" });
    if (e.phase === "building") return;
    dispatch({ type: "WITNESS_READY" });
    if (e.phase === "proving") return;
    dispatch({ type: "PROOF_READY", provingMs: e.provingMs });
    if (e.txHash) dispatch({ type: "SUBMITTED", txHash: e.txHash });
    if (e.phase === "submitting") return;
    dispatch({ type: "CONFIRMED" });
  }, []);

  const run = useCallback(
    async (to: string, amount: string, memo: string | undefined, prover: ProverKind) => {
      dispatch({ type: "RESET" });
      setReceipt(null);
      dispatch({ type: "START" }); // building immediately (snappy first frame)
      try {
        // Preferred (CAPABLE DESKTOPS ONLY): prove + submit the shielded transfer
        // FULLY CLIENT-SIDE (WasmProver on-device, witness never leaves; stateless
        // gas relay submits). Phones/tablets/weak desktops skip this entirely
        // (`preferDeviceProving()` is false) and delegate to the enclave/server via
        // the BFF path below — a weak device never grinds a transfer proof.
        if (isHandleSend(to) && preferDeviceProving()) {
          try {
            if (await clientSideReadsAvailable()) {
              apply({ phase: "proving" }); // on-device proving (~tens of seconds for the transfer circuit)
              const cs = await sendClientSide(to, usdcToStroops(amount).toString());
              if (cs?.txHash) {
                const r: SettleResult = { status: "settled", txHash: cs.txHash, prover: "local", amount: usdcToStroops(amount).toString(), onChain: true };
                setReceipt(r);
                apply({ phase: "confirmed", txHash: cs.txHash, onChain: true });
                return r;
              }
            }
          } catch {
            /* fall through to the BFF send path */
          }
        }
        const r = await api.sendStream({ to, amount, memo, prover }, apply);
        setReceipt(r);
        // ensure terminal even if the done event raced ahead of the last phase
        if (r.status !== "failed") apply({ phase: "confirmed", txHash: r.txHash, provingMs: r.provingMs, onChain: r.onChain });
        else dispatch({ type: "FAIL", error: r.error ?? "Couldn't send" });
        return r;
      } catch (err) {
        dispatch({ type: "FAIL", error: (err as Error).message });
        return null;
      }
    },
    [apply],
  );

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    setReceipt(null);
  }, []);

  return { state: state as PaymentState, receipt, run, reset };
}
