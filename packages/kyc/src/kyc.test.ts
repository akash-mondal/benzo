import { describe, it, expect } from "vitest";
import { DiditKyc, MockKyc, kycFromEnv } from "./index.js";

describe("MockKyc (key-free testnet default)", () => {
  it("starts a session and approves by default", async () => {
    const k = new MockKyc();
    const s = await k.start("user-abc");
    expect(s.id).toContain("mock-");
    expect(await k.status(s.id)).toBe("approved");
  });
  it("force-declines a session id containing 'fail'", async () => {
    expect(await new MockKyc().status("mock-fail-1")).toBe("declined");
  });
});

describe("DiditKyc (stubbed fetch — no network/key needed)", () => {
  const stub = (body: any, ok = true): any => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

  it("parses a created session", async () => {
    const k = new DiditKyc("sk_test", "https://verification.didit.me", stub({ session_id: "sess_1", url: "https://didit/v/sess_1" }));
    const s = await k.start("benzo-user-1");
    expect(s).toEqual({ id: "sess_1", url: "https://didit/v/sess_1" });
  });
  it("maps Didit decision statuses to KycStatus", async () => {
    const k = (status: string) => new DiditKyc("sk", "https://x", stub({ status }));
    expect(await k("Approved").status("s")).toBe("approved");
    expect(await k("Declined").status("s")).toBe("declined");
    expect(await k("In Review").status("s")).toBe("pending");
    expect(await k("Not Started").status("s")).toBe("not_started");
  });
  it("throws on a non-OK response", async () => {
    const k = new DiditKyc("sk", "https://x", stub({}, false));
    await expect(k.start("u")).rejects.toThrow();
  });
});

describe("kycFromEnv", () => {
  it("returns Mock without a key and Didit with one", () => {
    expect(kycFromEnv({} as any).name).toBe("mock");
    expect(kycFromEnv({ DIDIT_API_KEY: "sk_test" } as any).name).toBe("didit");
  });
});
