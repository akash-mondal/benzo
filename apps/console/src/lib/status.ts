/**
 * Payment/invoice/payroll status → named, plain-English meaning (B2/B7).
 *
 * Mirrors Deel's STABLECOIN status vocabulary almost verbatim (the closest
 * competitor analogue): "Payment in progress" → "Pending review" → "Paid" →
 * "Failed". Privacy-honest: the ETA is amount-INDEPENDENT (never leak size via a
 * longer ETA) and rail-honest (we settle on Stellar in seconds, so no multi-day
 * bank ETAs); the only real wait is maker-checker, whose "ETA" is which role is
 * next, not a clock. Pure functions, fully client-side.
 */
export type Tone = "success" | "warning" | "danger" | "muted" | "primary";

export interface StatusMeta {
  label: string;
  tone: Tone;
  tooltip: string;
  /** Honest, amount-independent ETA copy. "" when terminal. */
  eta: string;
}

export function statusMeta(status: string, ctx: { nextRole?: string | null } = {}): StatusMeta {
  switch (status) {
    case "needs_approval":
    case "pending":
      return {
        label: "Pending review",
        tone: "warning",
        tooltip: "Waiting for an approver — maker-checker keeps spends dual-controlled.",
        eta: ctx.nextRole ? `Waiting on ${ctx.nextRole} to approve` : "Waiting on an approver",
      };
    case "awaiting_kyc":
      return { label: "Awaiting verification", tone: "warning", tooltip: "A compliance check is in progress.", eta: "Usually a few minutes" };
    case "awaiting_deposit":
      return { label: "Awaiting funds", tone: "warning", tooltip: "Waiting for the deposit to arrive.", eta: "Settling soon" };
    case "approved":
    case "proving":
    case "submitting":
    case "submitted_onchain":
    case "processing":
      return { label: "Payment in progress", tone: "warning", tooltip: "Proving privately and settling on-chain — amount and recipient stay hidden.", eta: "Settling now" };
    case "confirmed":
    case "settled":
    case "paid":
      return { label: "Paid", tone: "success", tooltip: "Settled privately on-chain. People can see a payment happened, never who or how much.", eta: "" };
    case "partially_paid":
      return { label: "Partially paid", tone: "warning", tooltip: "Part of this invoice has been paid.", eta: "Arrives in seconds once paid" };
    case "open":
      return { label: "Awaiting", tone: "warning", tooltip: "Not paid yet.", eta: "Arrives in seconds once paid" };
    case "failed":
      return { label: "Failed", tone: "danger", tooltip: "Rejected or reversed — retry available.", eta: "" };
    case "overdue":
      return { label: "Overdue", tone: "danger", tooltip: "Past its due date.", eta: "" };
    case "cancelled":
      return { label: "Cancelled", tone: "danger", tooltip: "This payment was cancelled.", eta: "" };
    case "expired":
      return { label: "Expired", tone: "danger", tooltip: "This request expired.", eta: "" };
    case "created":
    case "draft":
      return { label: status === "draft" ? "Draft" : "Created", tone: "muted", tooltip: "Not submitted yet.", eta: "" };
    default:
      return { label: status.replace(/_/g, " "), tone: "muted", tooltip: "", eta: "" };
  }
}

export type StepState = "done" | "active" | "todo";
export interface Step {
  label: string;
  hint: string;
  state: StepState;
}

/**
 * The lifecycle timeline for a payment-shaped status (ported from the wallet's
 * TxDetail). Same Step model the console Timeline renders.
 */
export function buildTimeline(status: string, ctx: { nextRole?: string | null } = {}): Step[] {
  const terminalPaid = status === "paid" || status === "settled" || status === "confirmed";
  const failed = status === "failed";
  const pendingReview = status === "needs_approval" || status === "pending";
  const inProgress = status === "approved" || status === "proving" || status === "submitting" || status === "submitted_onchain" || status === "processing";

  const created: Step = { label: "Created", hint: "Payment created", state: "done" };
  const review: Step = {
    label: "Pending review",
    hint: ctx.nextRole ? `Waiting on ${ctx.nextRole} to approve` : "Maker-checker approval",
    state: pendingReview ? "active" : terminalPaid || inProgress ? "done" : "todo",
  };
  const proved: Step = {
    label: "Proved private",
    hint: "Amount and recipient stayed hidden",
    state: terminalPaid ? "done" : inProgress ? "active" : "todo",
  };
  const paid: Step = {
    label: failed ? "Failed" : "Paid",
    hint: failed ? "Rejected or reversed — retry available" : "Settled privately on-chain",
    state: terminalPaid ? "done" : failed ? "active" : "todo",
  };
  return [created, review, proved, paid];
}
