import { describe, expect, it } from "vitest";
import { pickBrowserProver } from "@benzo/core";

/**
 * App-level assertion of the device-aware proving routing the wallet relies on:
 * proving "locally" (on-device WASM) for capable desktops, and the attested TEE
 * for mobile / weak / no-WASM devices. (Soundness is identical; only WHERE the
 * witness is handled differs.) Core's own suites prove each backend in depth.
 */
const tee = { endpoint: "https://enclave.example", measurement: "0".repeat(64) };

describe("wallet proving routing (local + TEE)", () => {
  it("auto: strong desktop proves LOCALLY (on-device WASM)", () => {
    expect(pickBrowserProver({ mode: "auto", device: { isMobile: false, cores: 8, memoryGB: 16 }, tee }).name).toBe("wasm");
  });
  it("auto: mobile delegates to the attested TEE", () => {
    expect(pickBrowserProver({ mode: "auto", device: { isMobile: true }, tee }).name).toBe("phala");
  });
  it("explicit on-device mode → WASM (local)", () => {
    expect(pickBrowserProver({ mode: "on-device", device: { isMobile: false, cores: 8 }, tee }).name).toBe("wasm");
  });
  it("explicit tee mode → Phala (attested enclave)", () => {
    expect(pickBrowserProver({ mode: "tee", device: { isMobile: false, cores: 8 }, tee }).name).toBe("phala");
  });
});
