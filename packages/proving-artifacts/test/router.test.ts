/**
 * pickProver — Benzo is local-only. The policy can still describe weak devices
 * and heavy circuits for UX warnings, but witness routing stays local.
 */
import { describe, it, expect } from "vitest";
import { pickProver, isWeakDevice, HYBRID_POLICY, ON_DEVICE_POLICY, policyForMode } from "../src/router.js";

const desktop = { isMobile: false, memoryGB: 16, cores: 8 };
const phone = { isMobile: true, memoryGB: 3, cores: 4 };
const SMALL = 5 * 1024 * 1024;
const HUGE = 50 * 1024 * 1024;

describe("pickProver — local-only default", () => {
  it("routes every circuit to wasm regardless of device or size", () => {
    expect(pickProver("shield", SMALL, desktop)).toBe("wasm");
    expect(pickProver("joinsplit", HUGE, desktop)).toBe("wasm");
    expect(pickProver("shield", SMALL, phone)).toBe("wasm");
    expect(pickProver("shield", SMALL, desktop, ON_DEVICE_POLICY)).toBe("wasm");
  });
});

describe("pickProver — user choice aliases", () => {
  it("local aliases all resolve to wasm", () => {
    expect(pickProver("joinsplit", HUGE, phone, policyForMode("on-device"))).toBe("wasm");
    expect(pickProver("joinsplit", HUGE, desktop, policyForMode("auto"))).toBe("wasm");
    expect(pickProver("joinsplit", SMALL, phone, policyForMode("auto"))).toBe("wasm");
    expect(pickProver("joinsplit", HUGE, phone, policyForMode("local"))).toBe("wasm");
  });
});

describe("pickProver — hybrid metadata", () => {
  it("strong device proves on-device", () => {
    expect(pickProver("joinsplit", HUGE, desktop, HYBRID_POLICY)).toBe("wasm");
    expect(pickProver("shield", SMALL, desktop, HYBRID_POLICY)).toBe("wasm");
  });
  it("weak devices still prove locally", () => {
    expect(pickProver("joinsplit", SMALL, phone, HYBRID_POLICY)).toBe("wasm");
    expect(pickProver("some_big_circuit", HUGE, phone, HYBRID_POLICY)).toBe("wasm");
    expect(pickProver("shield", SMALL, phone, HYBRID_POLICY)).toBe("wasm");
  });
  it("classifies weak devices by mobile / memory / cores", () => {
    expect(isWeakDevice({ isMobile: true })).toBe(true);
    expect(isWeakDevice({ isMobile: false, memoryGB: 2 })).toBe(true);
    expect(isWeakDevice({ isMobile: false, cores: 2 })).toBe(true);
    expect(isWeakDevice({ isMobile: false, memoryGB: 16, cores: 8 })).toBe(false);
  });
});
