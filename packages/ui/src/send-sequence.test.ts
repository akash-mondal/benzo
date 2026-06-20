import { describe, it, expect } from "vitest";
import { paymentReducer, initialPaymentState, type PaymentState } from "./payment-state.js";
import { sendCeremonyView, ceremonyPhase, SEND_PHASE_FLOOR_MS } from "./send-sequence.js";

const at = (phase: PaymentState["phase"], extra: Partial<PaymentState> = {}): PaymentState => ({ phase, ...extra });

describe("send ceremony — phase mapping (slave to the machine)", () => {
  it("maps the full happy path through the reducer", () => {
    let s = initialPaymentState;
    s = paymentReducer(s, { type: "START" }); // building
    expect(sendCeremonyView(s).phase).toBe("encrypt");
    s = paymentReducer(s, { type: "WITNESS_READY" }); // proving
    expect(sendCeremonyView(s).phase).toBe("encrypt");
    s = paymentReducer(s, { type: "PROOF_READY", provingMs: 3200 }); // submitting
    expect(sendCeremonyView(s).phase).toBe("settle");
    s = paymentReducer(s, { type: "SUBMITTED", txHash: "abc" });
    expect(sendCeremonyView(s).phase).toBe("settle");
    s = paymentReducer(s, { type: "CONFIRMED", result: 7 }); // confirmed
    const v = sendCeremonyView(s);
    expect(v.phase).toBe("verify");
    expect(v.done).toBe(true);
    expect(v.failed).toBe(false);
  });

  it("ceremonyPhase covers every payment phase", () => {
    expect(ceremonyPhase("building")).toBe("encrypt");
    expect(ceremonyPhase("proving")).toBe("encrypt");
    expect(ceremonyPhase("submitting")).toBe("settle");
    expect(ceremonyPhase("confirmed")).toBe("verify");
    expect(ceremonyPhase("failed")).toBe("error");
    expect(ceremonyPhase("idle")).toBe("encrypt");
  });

  it("the encrypt sub-line reflects the prover (device vs enclave)", () => {
    expect(sendCeremonyView(at("proving"), { prover: "local" }).sub).toMatch(/this device/i);
    expect(sendCeremonyView(at("proving"), { prover: "tee" }).sub).toMatch(/enclave/i);
  });

  it("surfaces the error message on failure and marks failed", () => {
    const v = sendCeremonyView(at("failed", { error: "ledger rejected" }));
    expect(v.phase).toBe("error");
    expect(v.failed).toBe(true);
    expect(v.sub).toContain("ledger rejected");
  });

  it("carries per-phase timing floors so fast proofs don't flash", () => {
    expect(sendCeremonyView(at("proving")).floorMs).toBe(SEND_PHASE_FLOOR_MS.encrypt);
    expect(sendCeremonyView(at("submitting")).floorMs).toBe(SEND_PHASE_FLOOR_MS.settle);
    expect(sendCeremonyView(at("confirmed")).floorMs).toBe(SEND_PHASE_FLOOR_MS.verify);
  });

  it("collapses motion under prefers-reduced-motion (mapping unchanged)", () => {
    const normal = sendCeremonyView(at("proving"), { reducedMotion: false });
    const reduced = sendCeremonyView(at("proving"), { reducedMotion: true });
    expect(normal.animate).toBe(true);
    expect(reduced.animate).toBe(false);
    expect(reduced.phase).toBe(normal.phase); // still maps the same phase
    expect(reduced.title).toBe(normal.title);
  });
});
