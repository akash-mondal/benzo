import { describe, expect, it } from "vitest";
import { pickBrowserProver } from "@benzo/core";

/**
 * App-level assertion of the Wallet product rule: active Wallet proof routing is
 * local-only. The app requests on-device WASM proving and never configures an
 * outside proving service.
 */
describe("wallet proving routing (local only)", () => {
  it("explicit on-device mode uses the local WASM prover", () => {
    expect(pickBrowserProver({ mode: "on-device", device: { isMobile: false, cores: 8 } }).name).toBe("wasm");
  });
});
