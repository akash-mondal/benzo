import { describe, it, expect, afterEach, vi } from "vitest";
import { preferDeviceProving, delegatedProverKind, apiProverKind, proverPlan, apiBoundaryProverPlan } from "./proverPolicy";

/** Stub navigator + matchMedia to simulate a given device, run fn, restore. */
function asDevice(
  opts: { ua?: string; cores?: number; mem?: number; coarse?: boolean; touch?: number },
  fn: () => void,
) {
  const nav = navigator as unknown as Record<string, unknown>;
  const orig = {
    ua: Object.getOwnPropertyDescriptor(nav, "userAgent"),
    cores: Object.getOwnPropertyDescriptor(nav, "hardwareConcurrency"),
    mem: Object.getOwnPropertyDescriptor(nav, "deviceMemory"),
    touch: Object.getOwnPropertyDescriptor(nav, "maxTouchPoints"),
    mm: window.matchMedia,
  };
  Object.defineProperty(nav, "userAgent", { configurable: true, value: opts.ua ?? "Mozilla/5.0 (Macintosh)" });
  Object.defineProperty(nav, "hardwareConcurrency", { configurable: true, value: opts.cores ?? 8 });
  Object.defineProperty(nav, "deviceMemory", { configurable: true, value: opts.mem ?? 8 });
  Object.defineProperty(nav, "maxTouchPoints", { configurable: true, value: opts.touch ?? 0 });
  window.matchMedia = ((q: string) => ({ matches: q.includes("coarse") ? !!opts.coarse : false })) as unknown as typeof window.matchMedia;
  try {
    fn();
  } finally {
    if (orig.ua) Object.defineProperty(nav, "userAgent", orig.ua);
    if (orig.cores) Object.defineProperty(nav, "hardwareConcurrency", orig.cores);
    if (orig.mem) Object.defineProperty(nav, "deviceMemory", orig.mem);
    if (orig.touch) Object.defineProperty(nav, "maxTouchPoints", orig.touch);
    window.matchMedia = orig.mm;
  }
}

afterEach(() => vi.restoreAllMocks());

describe("proverPolicy - where the proof runs", () => {
  it("phone (mobile UA) NEVER proves on-device → delegates", () => {
    asDevice({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", coarse: true, touch: 5 }, () => {
      expect(preferDeviceProving()).toBe(false);
    });
  });

  it("Android phone delegates", () => {
    asDevice({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", coarse: true, touch: 5, cores: 8 }, () => {
      expect(preferDeviceProving()).toBe(false);
    });
  });

  it("touch-first device (coarse pointer + touch points) delegates even without a mobile UA", () => {
    asDevice({ ua: "Mozilla/5.0 (Macintosh)", coarse: true, touch: 10 }, () => {
      expect(preferDeviceProving()).toBe(false);
    });
  });

  it("weak desktop (few cores) delegates", () => {
    asDevice({ ua: "Mozilla/5.0 (Windows NT 10.0)", cores: 2, mem: 8 }, () => {
      expect(preferDeviceProving()).toBe(false);
    });
  });

  it("weak desktop (little RAM) delegates", () => {
    asDevice({ ua: "Mozilla/5.0 (Windows NT 10.0)", cores: 8, mem: 2 }, () => {
      expect(preferDeviceProving()).toBe(false);
    });
  });

  it("powerful desktop proves on-device", () => {
    asDevice({ ua: "Mozilla/5.0 (Macintosh)", cores: 10, mem: 16, coarse: false, touch: 0 }, () => {
      expect(preferDeviceProving()).toBe(true);
    });
  });

  it("delegate selection stays local because outside proving is disabled", () => {
    expect(delegatedProverKind(true)).toBe("local");
    expect(delegatedProverKind(false)).toBe("local");
  });

  it("API boundary keeps proof requests on the local prover", () => {
    expect(apiProverKind("local", true)).toBe("local");
    expect(apiProverKind("local", false)).toBe("local");
  });

  it("API-bound UI copy says local runtime when a weak-device plan crosses the API boundary", () => {
    const plan = { onDevice: false, kind: "local" as const, reason: "Local proof required. Use a capable desktop for heavy proof actions." };
    const apiPlan = apiBoundaryProverPlan(plan, true);
    expect(apiPlan).toMatchObject({ onDevice: false, kind: "local" });
    expect(apiPlan.reason).toContain("local Benzo runtime");
  });

  it("proverPlan: phone still stays local-only and asks for capable desktop/runtime", () => {
    asDevice({ ua: "Mozilla/5.0 (iPhone)", coarse: true, touch: 5 }, () => {
      const plan = proverPlan(true);
      expect(plan.onDevice).toBe(false);
      expect(plan.kind).toBe("local");
      expect(plan.reason).toContain("Local proof required");
    });
  });

  it("proverPlan: phone without outside proving also stays local-only", () => {
    asDevice({ ua: "Mozilla/5.0 (iPhone)", coarse: true, touch: 5 }, () => {
      const plan = proverPlan(false);
      expect(plan.onDevice).toBe(false);
      expect(plan.kind).toBe("local");
    });
  });

  it("proverPlan: powerful desktop → on-device", () => {
    asDevice({ ua: "Mozilla/5.0 (Macintosh)", cores: 10, mem: 16 }, () => {
      const plan = proverPlan(true);
      expect(plan.onDevice).toBe(true);
    });
  });
});
