export interface NettingAmountValidation {
  we: string;
  they: string;
}

function parsePositiveUsdcInput(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const amount = BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0"));
  return amount > 0n ? amount.toString() : null;
}

export function validateNettingAmounts(input: { weOwe?: unknown; theyOwe?: unknown }): NettingAmountValidation | { error: string } {
  const we = parsePositiveUsdcInput(input.weOwe);
  const they = parsePositiveUsdcInput(input.theyOwe);
  if (!we || !they) return { error: "Both invoice totals must be positive USDC amounts." };
  if (we === they) return { error: "There is no net difference to settle." };
  return { we, they };
}
