import { describe, expect, it } from "vitest";
import { dayBucket, fmtSigned, fmtUsd, initials, relativeTime, splitAmount, usdFromStroops, usdcToStroops } from "./format";

describe("money formatting (stroops ⇄ dollars)", () => {
  it("formats stroops to grouped dollars with ≥2 decimals", () => {
    expect(usdFromStroops("12405000000")).toBe("1,240.50");
    expect(usdFromStroops("19500000")).toBe("1.95");
    expect(usdFromStroops("0")).toBe("0.00");
    expect(usdFromStroops("100000000000")).toBe("10,000.00");
  });

  it("trims trailing precision past cents but keeps real precision", () => {
    expect(usdFromStroops("12345670")).toBe("1.234567");
    expect(usdFromStroops("10000000")).toBe("1.00");
  });

  it("fmtUsd adds the $ and handles negatives", () => {
    expect(fmtUsd("12405000000")).toBe("$1,240.50");
    expect(fmtUsd("-500000")).toBe("-$0.05");
  });

  it("fmtSigned signs by direction with a true minus glyph", () => {
    expect(fmtSigned("2000000000", "in")).toBe("+$200.00");
    expect(fmtSigned("500000", "out")).toBe("−$0.05");
  });

  it("usdcToStroops round-trips and rejects >7 decimals", () => {
    expect(usdcToStroops("1240.50")).toBe(12405000000n);
    expect(usdcToStroops("$1,240.50")).toBe(12405000000n);
    expect(usdcToStroops("0.0000001")).toBe(1n);
    expect(() => usdcToStroops("1.00000001")).toThrow();
  });

  it("splitAmount separates dollars and cents", () => {
    expect(splitAmount("12405000000")).toEqual({ dollars: "1,240", cents: "50" });
  });
});

describe("time + identity helpers", () => {
  const now = 1_700_000_000_000; // fixed clock
  it("relativeTime buckets correctly", () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe("now");
    expect(relativeTime(now / 1000 - 120, now)).toBe("2 min ago");
    expect(relativeTime(now / 1000 - 7200, now)).toBe("2h ago");
    expect(relativeTime(now / 1000 - 3 * 86400, now)).toBe("3d ago");
  });
  it("dayBucket labels today/yesterday", () => {
    expect(dayBucket(now / 1000, now)).toBe("Today");
    expect(dayBucket(now / 1000 - 86400, now)).toBe("Yesterday");
  });
  it("initials derive from names + handles", () => {
    expect(initials("Ravi Mehta")).toBe("RM");
    expect(initials("@mara")).toBe("MA");
    expect(initials("")).toBe("?");
  });
});
