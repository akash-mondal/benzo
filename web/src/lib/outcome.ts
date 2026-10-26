// One account of how a round ended, in a person's words, from what the round published. Used by the list of rounds,
// a round's page, the sky's hover and My activity, so the same round tells the same story everywhere.
import type { AuctionSummary } from "./types";

const z = (n: string | number) => `${Number(n).toLocaleString("en-US")} zats`;
const IN_PROGRESS: Record<string, string> = { OPEN: "Bidding closed · waiting to freeze", FROZEN: "Bids frozen · waiting to open", "SEALED-WAIT": "Bids frozen · waiting to open", OPENED: "Bids opened · clearing", CLEARED: "Cleared · paying out", SETTLING: "Paying out", REFUNDING: "Refunding deposits", DRAFT: "Not open yet" };

export function outcomeLine(a: AuctionSummary): string {
  if (a.live) return "Taking sealed bids";
  if (a.state === "CANCELLED") return "Cancelled · every deposit refunded";
  const o = a.outcome;
  if (!o) return IN_PROGRESS[a.state] ?? a.state;
  const price = a.clearing_price_zats && a.clearing_price_zats !== "0" ? a.clearing_price_zats : null;
  if (o.filled === 0) return a.mode === "launch" ? "Minimum raise not met · refunded" : a.mode === "otc" ? "No trade · the limits didn't cross" : a.mode === "rfq" ? "No quote accepted · refunded" : a.mode === "buyback" ? "No ask accepted · refunded" : "No winning bids · refunded";
  if (a.mode === "drop") return `${o.filled} of ${o.of} lots sold · ${z(o.paid_zats)} in winning bids`;
  if (a.mode === "otc") return price ? `Traded at ${z(price)}` : "Traded";
  if (a.mode === "rfq") return price ? `Quote accepted · ${z(price)}` : "Quote accepted";
  if (a.mode === "buyback") return `${o.filled} of ${o.of} units bought back${price ? ` at ${z(price)}` : ""}`;
  if (a.mode === "launch") return `Raised ${z(o.paid_zats)} · ${o.filled} of ${o.of} units`;
  return `${o.filled} of ${o.of} sold${price ? ` at ${z(price)}` : ""}`;
}
// Settled means paid out; the outcome says whether anything traded.
export const traded = (a: AuctionSummary) => Boolean(a.outcome && a.outcome.filled > 0);
