/**
 * The pure state machines: payment lifecycle, proving status, wallet lock, and
 * balance masking. These encode the protocol-aware UX (the proving wait, the
 * privacy mask) once, for both apps.
 */
import { describe, it, expect } from "vitest";
import {
  initialPaymentState,
  paymentReducer,
  paymentLabel,
  paymentProgress,
  isInFlight,
  isTerminal,
  type PaymentState,
} from "../src/payment-state.js";
import { initialProvingStatus, provingStatusFromStage } from "../src/proving-state.js";
import { initialWalletState, walletReducer, isUnlocked } from "../src/wallet-state.js";
import { displayBalance, displayPending, spendable, MASK } from "../src/balance.js";

describe("paymentReducer", () => {
  const run = (...events: Parameters<typeof paymentReducer>[1][]): PaymentState =>
    events.reduce(paymentReducer, initialPaymentState);

  it("walks the full happy path build→prove→submit→confirm", () => {
    const s = run(
      { type: "START" },
      { type: "WITNESS_READY" },
      { type: "PROOF_READY", provingMs: 3200 },
      { type: "SUBMITTED", txHash: "deadbeef" },
      { type: "CONFIRMED", result: 42 },
    );
    expect(s.phase).toBe("confirmed");
    expect(s.txHash).toBe("deadbeef");
    expect(s.result).toBe(42);
    expect(s.provingMs).toBe(3200);
    expect(isTerminal(s)).toBe(true);
    expect(paymentProgress(s)).toBe(1);
  });

  it("ignores out-of-order events and double-starts mid-flight", () => {
    const proving = run({ type: "START" }, { type: "WITNESS_READY" });
    expect(proving.phase).toBe("proving");
    expect(isInFlight(proving)).toBe(true);
    // a stray START while proving is a no-op
    expect(paymentReducer(proving, { type: "START" })).toBe(proving);
    // CONFIRMED only lands from "submitting"
    expect(paymentReducer(proving, { type: "CONFIRMED" }).phase).toBe("proving");
  });

  it("fails from any phase and resets", () => {
    const failed = paymentReducer(run({ type: "START" }), { type: "FAIL", error: "no funds" });
    expect(failed.phase).toBe("failed");
    expect(paymentLabel(failed)).toMatch(/no funds/);
    expect(paymentReducer(failed, { type: "RESET" })).toEqual(initialPaymentState);
  });
});

describe("provingStatusFromStage", () => {
  it("maps prover stages to calm phases", () => {
    expect(initialProvingStatus.phase).toBe("idle");
    expect(provingStatusFromStage("proving").phase).toBe("proving");
    expect(provingStatusFromStage("done").phase).toBe("done");
    // a forwarded snarkjs info line stays in proving but keeps the raw detail
    const info = provingStatusFromStage("building witness");
    expect(info.phase).toBe("proving");
    expect(info.raw).toBe("building witness");
  });
});

describe("walletReducer", () => {
  it("discovers, unlocks, and locks", () => {
    let s = walletReducer(initialWalletState, { type: "DISCOVERED", exists: true });
    expect(s.phase).toBe("locked");
    s = walletReducer(s, { type: "UNLOCK_START" });
    expect(s.phase).toBe("unlocking");
    s = walletReducer(s, { type: "UNLOCKED" });
    expect(isUnlocked(s)).toBe(true);
    expect(walletReducer(s, { type: "LOCK" }).phase).toBe("locked");
  });
  it("records an unlock failure and allows retry", () => {
    const err = walletReducer({ phase: "locked" }, { type: "UNLOCK_FAILED", error: "bad pass" });
    expect(err).toEqual({ phase: "error", error: "bad pass" });
    expect(walletReducer(err, { type: "UNLOCK_START" }).phase).toBe("unlocking");
  });
});

describe("balance masking", () => {
  it("masks when hidden and formats when revealed", () => {
    const view = { shielded: 12_345_500_000n, pending: 5_000_000n };
    expect(displayBalance(view, { hidden: true })).toBe(MASK);
    expect(displayBalance(view, { hidden: false, symbol: "USDC" })).toBe("1,234.55 USDC");
    expect(displayPending(view, { hidden: false })).toBe("+0.50 pending");
    expect(displayPending(view, { hidden: true })).toBeNull();
    expect(displayPending({ shielded: 1n }, {})).toBeNull();
    expect(spendable(view)).toBe(12_345_500_000n); // pending not spendable
  });
});
