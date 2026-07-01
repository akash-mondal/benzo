import { describe, expect, it } from "vitest";
import { inviteAmountToStroops, validateFundedInviteAmount } from "./inviteValidation";

describe("funded invite amount validation", () => {
  it("rejects empty, zero, and invalid amounts", () => {
    expect(validateFundedInviteAmount("", "10000000")).toMatchObject({ amountOk: false, insufficient: false, message: null });
    expect(validateFundedInviteAmount("0", "10000000")).toMatchObject({ amountOk: false, insufficient: false, message: "Enter an amount above $0." });
    expect(validateFundedInviteAmount("abc", "10000000")).toMatchObject({ amountOk: false, insufficient: false, message: "Enter an amount above $0." });
  });

  it("rejects amounts above the private balance", () => {
    expect(validateFundedInviteAmount("5", "10000000")).toMatchObject({
      amountOk: true,
      amountStroops: "50000000",
      insufficient: true,
      message: "Not enough private USDC. Add money or use a smaller amount.",
    });
  });

  it("accepts amounts within the private balance", () => {
    expect(inviteAmountToStroops("1.25")).toBe("12500000");
    expect(validateFundedInviteAmount("1.25", "12500000")).toMatchObject({
      amountOk: true,
      amountStroops: "12500000",
      insufficient: false,
      message: null,
    });
  });
});
