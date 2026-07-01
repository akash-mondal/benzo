import { describe, expect, it } from "vitest";
import { convertQuickAmounts } from "./Convert";

describe("convertQuickAmounts", () => {
  it("offers usable small presets for judge-scale testnet balances", () => {
    expect(convertQuickAmounts("50000000")).toEqual(["1", "5"]);
    expect(convertQuickAmounts("100000000")).toEqual(["1", "5", "10"]);
  });

  it("keeps the largest valid presets for larger balances", () => {
    expect(convertQuickAmounts("500000000")).toEqual(["10", "20", "50"]);
    expect(convertQuickAmounts("1000000000")).toEqual(["20", "50", "100"]);
  });

  it("does not offer impossible presets for empty balances", () => {
    expect(convertQuickAmounts("0")).toEqual([]);
  });
});
