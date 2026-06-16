/**
 * Display/parse helpers for money and identifiers — pure, framework-agnostic, so
 * pay.benzo.xyz and work.benzo.xyz render amounts and addresses identically.
 *
 * On Stellar, USDC carries 7 decimals; the protocol moves base units (i128), so
 * the UI converts at the edges only.
 */

export const USDC_DECIMALS = 7;

/** Format base-unit `amount` as a human string (no symbol unless asked). */
export function formatUsdc(
  amount: bigint,
  opts: { decimals?: number; symbol?: string; grouping?: boolean } = {},
): string {
  const decimals = opts.decimals ?? USDC_DECIMALS;
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  let wholeStr = whole.toString();
  if (opts.grouping !== false) wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Trim trailing zeros in the fraction but keep at least 2 places (cents).
  let fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fracStr.length < 2) fracStr = fracStr.padEnd(2, "0");

  const body = `${neg ? "-" : ""}${wholeStr}.${fracStr}`;
  return opts.symbol ? `${body} ${opts.symbol}` : body;
}

/**
 * Parse a human-typed amount ("1,234.5") into base units. Throws on malformed
 * input or more fractional digits than the asset supports (silently truncating
 * a user's cents is a footgun in a payments app).
 */
export function parseUsdc(input: string, decimals = USDC_DECIMALS): bigint {
  const cleaned = input.trim().replace(/,/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === "." || cleaned === "-")
    throw new Error(`not a valid amount: "${input}"`);
  const neg = cleaned.startsWith("-");
  const [whole, frac = ""] = (neg ? cleaned.slice(1) : cleaned).split(".");
  if (frac.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  const base = 10n ** BigInt(decimals);
  const value = BigInt(whole || "0") * base + BigInt(frac.padEnd(decimals, "0") || "0");
  return neg ? -value : value;
}

/** "GABCD…WXYZ" — middle-truncate a Stellar address/contract id. */
export function truncateAddress(addr: string, head = 5, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Short form of a 64-hex tx hash. */
export function truncateHash(hash: string, head = 6, tail = 4): string {
  return truncateAddress(hash, head, tail);
}

/** Normalize a payment handle to a single leading "@". */
export function formatHandle(handle: string): string {
  return `@${handle.trim().replace(/^@+/, "")}`;
}
