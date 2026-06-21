/**
 * Consumer-facing money formatting. The wallet speaks dollars, never stroops or
 * "7-decimal USDC": amounts come off the wire as base units (1 USDC = 1e7) and
 * render as "$1,240.50". Two decimals by default (cents); more only when the
 * trailing precision is real.
 */

/** "12405000000" -> "1,240.50" (grouped, ≥2 decimals, trailing zeros trimmed past cents). */
export function usdFromStroops(minor: string | bigint, decimals = 7): string {
  let n: bigint;
  try {
    n = typeof minor === "bigint" ? minor : BigInt(minor || "0");
  } catch {
    return String(minor);
  }
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** "$1,240.50" — the headline form. */
export function fmtUsd(minor: string | bigint): string {
  const s = usdFromStroops(minor);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** Signed, with explicit + for credits: "+$200.00" / "−$50.00" (true minus glyph). */
export function fmtSigned(minor: string | bigint, direction: "in" | "out"): string {
  const s = usdFromStroops(typeof minor === "bigint" ? (minor < 0n ? -minor : minor) : minor.replace(/^-/, ""));
  return direction === "in" ? `+$${s}` : `−$${s}`;
}

/** Parse a typed human amount ("25", "25.50") into stroops; throws past 7 dp. */
export function usdcToStroops(amount: string): bigint {
  const clean = amount.trim().replace(/[$,]/g, "");
  const neg = clean.startsWith("-");
  const [whole, frac = ""] = clean.replace(/^[-+]/, "").split(".");
  if (frac.length > 7) throw new Error("USDC has at most 7 decimals");
  const stroops = BigInt(whole || "0") * 10_000_000n + BigInt(frac.padEnd(7, "0") || "0");
  return neg ? -stroops : stroops;
}

/** Split a money string into [bigPart, centsPart] so the hero can size them differently. */
export function splitAmount(minor: string | bigint): { dollars: string; cents: string } {
  const s = usdFromStroops(minor);
  const [d, c = "00"] = s.split(".");
  return { dollars: d, cents: c.slice(0, 2) };
}

/** "now" / "2 min ago" / "Jun 18" — relative for recent, calendar for older. */
export function relativeTime(tsSeconds: number, nowMs = Date.now()): string {
  const diff = Math.floor(nowMs / 1000) - tsSeconds;
  if (diff < 45) return "now";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 7 * 86_400) return `${Math.round(diff / 86_400)}d ago`;
  return new Date(tsSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Day bucket label for grouping the activity feed: Today / Yesterday / date. */
export function dayBucket(tsSeconds: number, nowMs = Date.now()): string {
  const d = new Date(tsSeconds * 1000);
  const today = new Date(nowMs);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(nowMs - 86_400_000);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/** Full, human date + time for a receipt: "Jun 21, 2026 at 3:04 PM". */
export function fullDateTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} at ${time}`;
}

/** Deterministic initials for an avatar from a name or @handle. */
export function initials(nameOrHandle: string): string {
  const s = nameOrHandle.replace(/^@/, "").trim();
  if (!s) return "?";
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
