/**
 * Balance display for a private wallet — selectors over shielded + pending
 * amounts with a one-switch privacy mask ("peek to reveal"). Pure; the screens
 * own the chrome, this owns the numbers and the masking rule.
 */
import { formatUsdc } from "./format.js";

export interface BalanceView {
  /** Confirmed shielded balance, base units. */
  shielded: bigint;
  /** In-flight inbound notes not yet confirmed, base units. */
  pending?: bigint;
}

/** The fixed glyph run used whenever a balance is hidden. */
export const MASK = "••••••";

/** Format a balance, or the mask when `hidden`. */
export function displayBalance(
  view: BalanceView,
  opts: { hidden?: boolean; symbol?: string } = {},
): string {
  if (opts.hidden) return opts.symbol ? `${MASK} ${opts.symbol}` : MASK;
  return formatUsdc(view.shielded, { symbol: opts.symbol });
}

/** Format the pending delta as a signed "+N" hint, or null when nothing pending. */
export function displayPending(view: BalanceView, opts: { hidden?: boolean; symbol?: string } = {}): string | null {
  if (!view.pending || view.pending === 0n) return null;
  if (opts.hidden) return null;
  const sign = view.pending > 0n ? "+" : "";
  return `${sign}${formatUsdc(view.pending, { symbol: opts.symbol })} pending`;
}

/** Spendable now = confirmed shielded only (pending is not yet spendable). */
export function spendable(view: BalanceView): bigint {
  return view.shielded;
}
