import { describe, expect, it } from "vitest";
import { fmtUsd, formatAddress, formatMoney } from "./format";

describe("console money formatting", () => {
  it("fmtUsd renders dollar-prefixed, fixed 2 decimals", () => {
    expect(fmtUsd("8423000000000")).toBe("$842,300.00");
    expect(fmtUsd("19500000")).toBe("$1.95");
    expect(fmtUsd("35000000000")).toBe("$3,500.00");
    expect(fmtUsd("0")).toBe("$0.00");
  });
  it("formatMoney keeps real precision with a code suffix", () => {
    expect(formatMoney("1240500000")).toBe("124.05 USDC");
  });
  it("formatAddress truncates long Stellar addresses", () => {
    expect(formatAddress("GA4R5FSOPHFY3EWHWILL43KEEEPKCTGC6EKVJJS3R63TMG2RYJLQ4OCS")).toBe("GA4R…4OCS");
    expect(formatAddress("short")).toBe("short");
  });
});
