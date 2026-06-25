/**
 * Approval-policy helpers (B4 - Ramp parity). Turns an ApprovalPolicy into a
 * human-readable one-liner, and labels its conditions/steps for the builder.
 *
 * The privacy crux (and the differentiator): conditions on amount/counterparty
 * are routing logic the BFF evaluates over the PLAINTEXT proposal (Benzo hides
 * those on-chain). The approve steps' `minApprovers` and the `releaseGate` are
 * the part that maps onto the GENUINELY-ENFORCED dual-control: org_account
 * threshold + the in-circuit joinsplit_org M-of-N (JSPLITORG, verified on testnet).
 */
import type { ApprovalPolicy, ApprovalCondition, ApprovalStep } from "@benzo/types";
import { fmtUsd } from "./format";

export function conditionLabel(c: ApprovalCondition): string {
  const op = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "is", in: "in" }[c.operator];
  if (c.field === "amount") return `amount ${op} ${fmtUsd(String(c.value))}`;
  if (c.field === "counterparty") return `counterparty ${op} ${Array.isArray(c.value) ? `${c.value.length} selected` : c.value}`;
  if (c.field === "payment_type") return `type ${op} ${c.value}`;
  return `${c.field} ${op} ${c.value}`;
}

export function stepLabel(s: ApprovalStep): string {
  const n = s.minApprovers;
  const noun = n === 1 ? "approval" : "approvals";
  const mode = s.mode === "all" ? "all" : "any";
  return `${n} ${noun} (${mode} of ${s.role})`;
}

/** One-line plain-English summary, e.g. "amount ≥ $5,000 → 1 approval (any of approver) → release by treasurer". */
export function policySummary(p: ApprovalPolicy): string {
  const when = p.conditions.length ? p.conditions.map(conditionLabel).join(" and ") : "every payment";
  const steps = p.steps.length ? p.steps.map(stepLabel).join(" → ") : "no approval";
  const release = p.releaseGate ? ` → release by ${p.releaseGate.role}` : "";
  return `${when} → ${steps}${release}`;
}

/** Total distinct human approvals this policy requires (steps + release gate). */
export function totalApprovers(p: ApprovalPolicy): number {
  return p.steps.reduce((n, s) => n + s.minApprovers, 0) + (p.releaseGate?.minApprovers ?? 0);
}
