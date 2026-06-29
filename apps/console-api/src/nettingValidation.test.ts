import { describe, expect, it } from "vitest";
import { validateNettingAmounts } from "./nettingValidation.js";

describe("validateNettingAmounts", () => {
  it("converts valid USDC inputs into stroops", () => {
    expect(validateNettingAmounts({ weOwe: "0.30", theyOwe: "0.18" })).toEqual({
      we: "3000000",
      they: "1800000",
    });
  });

  it("rejects missing, invalid, negative, zero, and equal inputs", () => {
    for (const body of [
      { weOwe: "", theyOwe: "0.18" },
      { weOwe: "abc", theyOwe: "0.18" },
      { weOwe: "-1", theyOwe: "0.18" },
      { weOwe: "0", theyOwe: "0.18" },
      { weOwe: "0.18", theyOwe: "0.18" },
    ]) {
      expect(validateNettingAmounts(body)).toHaveProperty("error");
    }
  });

  it("rejects amounts with more precision than Stellar USDC supports", () => {
    expect(validateNettingAmounts({ weOwe: "0.12345678", theyOwe: "0.18" })).toHaveProperty("error");
  });
});
