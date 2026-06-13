import { describe, it, expect } from "vitest";
import {
  RangeScreening, HumanIdScreening, MockScreening, screeningFromEnv,
  StripeOnramp, MockOnramp, onrampFromEnv,
  CircleCctp, MockCctp, cctpFromEnv, CCTP_DOMAINS,
  anchorPreset, ANCHOR_PRESETS, MONEYGRAM,
} from "./index.js";

const stub = (body: any, ok = true, status?: number): any =>
  async () => ({ ok, status: status ?? (ok ? 200 : 500), json: async () => body });

describe("screening", () => {
  it("Range maps a clean address to allowed", async () => {
    const s = new RangeScreening("k", "https://x", stub({ risk_level: "low", sanctioned: false }));
    expect(await s.screen("GABC")).toEqual({ risk: "low", allowed: true, reason: undefined });
  });
  it("Range blocks a sanctioned address", async () => {
    const s = new RangeScreening("k", "https://x", stub({ sanctioned: true, reason: "OFAC" }));
    const r = await s.screen("GBAD");
    expect(r).toMatchObject({ risk: "blocked", allowed: false });
  });
  it("Range denies high risk even if not sanctioned", async () => {
    const s = new RangeScreening("k", "https://x", stub({ risk_level: "high" }));
    expect((await s.screen("GX")).allowed).toBe(false);
  });
  it("Range throws on non-OK", async () => {
    await expect(new RangeScreening("k", "https://x", stub({}, false)).screen("G")).rejects.toThrow();
  });
  it("HumanId clears a valid, non-sanctioned SBT and denies a missing one", async () => {
    const ok = new HumanIdScreening("C1", async () => ({ valid: true, sanctioned: false }));
    expect((await ok.screen("G")).allowed).toBe(true);
    const none = new HumanIdScreening("C1", async () => ({ valid: false }));
    expect((await none.screen("G")).allowed).toBe(false);
  });
  it("Mock clears normal addresses and blocks flagged ones", async () => {
    expect((await new MockScreening().screen("GNORMAL")).allowed).toBe(true);
    expect((await new MockScreening().screen("Gblocked")).allowed).toBe(false);
  });
  it("screeningFromEnv picks Range with a key, else Mock", () => {
    expect(screeningFromEnv({} as any).name).toBe("mock");
    expect(screeningFromEnv({ RANGE_API_KEY: "k" } as any).name).toBe("range");
  });
});

describe("onramp", () => {
  it("Stripe creates a Stellar+USDC session and surfaces a url", async () => {
    const o = new StripeOnramp("sk", "https://x", stub({ id: "cos_1", redirect_url: "https://pay/cos_1" }));
    expect(await o.createSession({ address: "GDEST", amount: "20" })).toEqual({ id: "cos_1", url: "https://pay/cos_1" });
  });
  it("Stripe falls back to a client_secret link when no redirect_url", async () => {
    const o = new StripeOnramp("sk", "https://x", stub({ id: "cos_2", client_secret: "cs_2" }));
    expect((await o.createSession({ address: "G" })).url).toContain("cs_2");
  });
  it("Stripe throws on non-OK", async () => {
    await expect(new StripeOnramp("sk", "https://x", stub({}, false)).createSession({ address: "G" })).rejects.toThrow();
  });
  it("Mock returns a deterministic session", async () => {
    expect((await new MockOnramp().createSession({ address: "GDEST" })).url).toContain("GDEST");
  });
  it("onrampFromEnv picks Stripe with a key, else Mock", () => {
    expect(onrampFromEnv({} as any).name).toBe("mock");
    expect(onrampFromEnv({ STRIPE_SECRET_KEY: "sk" } as any).name).toBe("stripe");
  });
});

describe("cctp", () => {
  it("Circle returns a complete attestation", async () => {
    const c = new CircleCctp("https://x", undefined, stub({ status: "complete", attestation: "0xabc" }));
    expect(await c.getAttestation("0xhash")).toEqual({ status: "complete", attestation: "0xabc" });
  });
  it("Circle treats a 404 as still pending", async () => {
    const c = new CircleCctp("https://x", undefined, stub({}, false, 404));
    expect(await c.getAttestation("0xhash")).toEqual({ status: "pending" });
  });
  it("Circle throws on a real error", async () => {
    const c = new CircleCctp("https://x", undefined, stub({}, false, 500));
    await expect(c.getAttestation("0xh")).rejects.toThrow();
  });
  it("knows the Stellar CCTP domain", () => {
    expect(CCTP_DOMAINS.stellar).toBe(16);
  });
  it("Mock completes immediately; cctpFromEnv picks by key", async () => {
    expect((await new MockCctp().getAttestation("0xdeadbeef")).status).toBe("complete");
    expect(cctpFromEnv({} as any).name).toBe("mock");
    expect(cctpFromEnv({ CIRCLE_API_KEY: "k" } as any).name).toBe("circle");
  });
});

describe("anchor presets", () => {
  it("defaults to the self-hosted benzo anchor", () => {
    expect(anchorPreset(undefined).key).toBe("benzo");
    expect(anchorPreset("benzo").requiresOnboarding).toBe(false);
  });
  it("knows MoneyGram + Alfred and flags them as onboarding-gated", () => {
    expect(ANCHOR_PRESETS.moneygram).toBe(MONEYGRAM);
    expect(anchorPreset("moneygram").requiresOnboarding).toBe(true);
    expect(anchorPreset("alfred").network).toBe("public");
  });
  it("throws on an unknown preset", () => {
    expect(() => anchorPreset("nope")).toThrow(/unknown anchor preset/);
  });
});
