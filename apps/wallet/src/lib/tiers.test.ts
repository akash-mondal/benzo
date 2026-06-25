import { describe, it, expect } from "vitest";
import { tierOf, sendCapUsd, needsStepUp, tierForAmount, tierInfo } from "./tiers.js";

describe("verification tiers (C5 - privacy-adapted)", () => {
  it("clamps tier into 0..3", () => {
    expect(tierOf(undefined)).toBe(1); // default
    expect(tierOf(-5)).toBe(0);
    expect(tierOf(99)).toBe(3);
    expect(tierOf(2)).toBe(2);
  });

  it("exposes a capability label, never PII", () => {
    expect(tierInfo(1).label).toBe("Verified human");
    expect(tierInfo(2).label).toBe("ID verified");
    expect(tierInfo(2).cta).toBeNull(); // no step-up once ID-verified
  });

  it("gates a send only when it exceeds the current tier's cap", () => {
    // tier 1 cap = $1,000
    expect(needsStepUp(500, 1)).toBe(false);
    expect(needsStepUp(1_000, 1)).toBe(false); // at cap is fine
    expect(needsStepUp(1_001, 1)).toBe(true); // over cap -> step up
    // tier 2 cap = $40,000
    expect(needsStepUp(1_001, 2)).toBe(false);
    expect(needsStepUp(40_001, 2)).toBe(true);
    // tier 3 is the top - never blocks
    expect(needsStepUp(1_000_000, 3)).toBe(false);
    // zero/blank never gates
    expect(needsStepUp(0, 1)).toBe(false);
  });

  it("picks the lowest tier that clears an amount", () => {
    expect(tierForAmount(50)).toBe(0);
    expect(tierForAmount(500)).toBe(1);
    expect(tierForAmount(5_000)).toBe(2);
    expect(tierForAmount(100_000)).toBe(3);
  });

  it("receiving is never capped (only sending is gated)", () => {
    // sendCap is a SEND-only ramp; there is no receive cap concept in the API.
    expect(sendCapUsd(0)).toBeGreaterThan(0);
    expect(sendCapUsd(3)).toBe(250_000);
  });
});
