/**
 * format.ts — money parse/format round-trips and identifier truncation. The
 * parse path must refuse to silently drop a user's cents (over-precision throws).
 */
import { describe, it, expect } from "vitest";
import {
  formatUsdc,
  parseUsdc,
  truncateAddress,
  truncateHash,
  formatHandle,
  USDC_DECIMALS,
} from "../src/format.js";

describe("formatUsdc", () => {
  it("formats base units with grouping and >=2 decimals", () => {
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(10_000_000n)).toBe("1.00"); // 1 USDC = 1e7 base units
    expect(formatUsdc(12_345_500_000n)).toBe("1,234.55");
    expect(formatUsdc(1_500_000n)).toBe("0.15");
    expect(formatUsdc(10_000_000n, { symbol: "USDC" })).toBe("1.00 USDC");
  });
  it("keeps full precision when present and handles negatives", () => {
    expect(formatUsdc(10_000_001n)).toBe("1.0000001");
    expect(formatUsdc(-2_500_000n)).toBe("-0.25");
  });
});

describe("parseUsdc", () => {
  it("round-trips with formatUsdc through base units", () => {
    for (const s of ["0", "1", "1234.55", "0.15", "9999999.9999999"]) {
      const base = parseUsdc(s);
      expect(parseUsdc(formatUsdc(base))).toBe(base);
    }
    expect(parseUsdc("1,234.50")).toBe(12_345_000_000n);
    expect(USDC_DECIMALS).toBe(7);
  });
  it("throws on malformed input and on over-precision", () => {
    expect(() => parseUsdc("")).toThrow();
    expect(() => parseUsdc("abc")).toThrow();
    expect(() => parseUsdc("1.23456789")).toThrow(/decimal places/); // 8 > 7
  });
});

describe("truncation + handle", () => {
  it("middle-truncates long ids but leaves short ones", () => {
    expect(truncateAddress("GABCDEFGHIJKLMNOP")).toBe("GABCD…MNOP");
    expect(truncateAddress("GABC")).toBe("GABC");
    expect(truncateHash("a".repeat(64))).toBe("aaaaaa…aaaa");
  });
  it("normalizes a handle to a single @", () => {
    expect(formatHandle("alice")).toBe("@alice");
    expect(formatHandle("@@bob ")).toBe("@bob");
  });
});
