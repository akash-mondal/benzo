/**
 * Device-aware browser prover hints: all browser proving stays local. Weak
 * devices return a capability warning, but the prover selector never delegates.
 */
import { describe, it, expect } from "vitest";
import { canProveOnDevice, pickBrowserProver } from "../src/browser-prover.js";

const pick = (device: Parameters<typeof canProveOnDevice>[0]) =>
  pickBrowserProver({ device }).name;

describe("canProveOnDevice (capability gate)", () => {
  it("capable desktop → on-device", () => {
    expect(canProveOnDevice({ isMobile: false, cores: 8, memoryGB: 16, hasWasm: true })).toBe(true);
  });
  it("desktop with cores/mem unknown but not mobile → on-device (optimistic)", () => {
    expect(canProveOnDevice({ isMobile: false })).toBe(true);
  });
  it("any mobile is not considered heavy-proving capable", () => {
    expect(canProveOnDevice({ isMobile: true, cores: 8, memoryGB: 16 })).toBe(false);
  });
  it("WASM unsupported is not considered heavy-proving capable", () => {
    expect(canProveOnDevice({ isMobile: false, hasWasm: false, cores: 8 })).toBe(false);
  });
  it("too few cores is not considered heavy-proving capable", () => {
    expect(canProveOnDevice({ isMobile: false, cores: 2 })).toBe(false);
  });
  it("too little RAM is not considered heavy-proving capable", () => {
    expect(canProveOnDevice({ isMobile: false, cores: 8, memoryGB: 4 })).toBe(false);
  });
});

describe("pickBrowserProver", () => {
  it("strong desktop uses wasm", () => expect(pick({ isMobile: false, cores: 8, memoryGB: 16, hasWasm: true })).toBe("wasm"));
  it("mobile still uses local wasm", () => expect(pick({ isMobile: true })).toBe("wasm"));
  it("weak desktop still uses local wasm", () => expect(pick({ isMobile: false, cores: 2 })).toBe("wasm"));
  it("explicit local mode uses wasm", () => expect(pickBrowserProver({ mode: "local" }).name).toBe("wasm"));
});
