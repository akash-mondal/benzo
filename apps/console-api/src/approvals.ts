/**
 * Maker-checker engine (off-chain, BFF-enforced). Turns the well-shaped but
 * previously-inert ApprovalPolicy/Approval model into real M-of-N control:
 *  - a policy matches a proposal by its conditions (amount thresholds etc.);
 *  - each step needs `minApprovers` DISTINCT approvers holding the step's role;
 *  - the proposer can never approve their own request (segregation of duties);
 *  - the optional releaseGate is a separate "payer" step after the approve steps;
 *  - settlement is allowed only when EVERY step + the releaseGate are satisfied.
 *
 * On-chain enforcement via the org_account contract is deliberately deferred
 * (GA-hardening) — this is the 80/20 that delivers the buyer-trust value now.
 */
import type { Approval, ApprovalCondition, ApprovalPolicy, Role } from "@benzo/types";
import { db, id, now } from "./store.js";

function conditionMatches(c: ApprovalCondition, amount: bigint): boolean {
  if (c.field !== "amount") return true; // non-amount conditions: treat as matching (v1)
  const v = BigInt(String(c.value));
  switch (c.operator) {
    case "gt": return amount > v;
    case "gte": return amount >= v;
    case "lt": return amount < v;
    case "lte": return amount <= v;
    case "eq": return amount === v;
    default: return true;
  }
}

/** The first policy whose conditions all match the proposal amount (or none). */
export function matchPolicy(amount: bigint): ApprovalPolicy | undefined {
  return db.policies.find((p) => p.conditions.every((c) => conditionMatches(c, amount)));
}

export interface ApprovalStepState {
  stepIndex: number;
  role: Role;
  need: number;
  have: number;
  satisfied: boolean;
  kind: "approve" | "release";
}
export interface ApprovalProgress {
  required: boolean;
  steps: ApprovalStepState[];
  satisfied: boolean;
  /** the next role that must act, or null when fully approved */
  nextRole: Role | null;
  nextKind: "approve" | "release" | null;
}

/** Compute M-of-N progress from a policy + the approvals recorded so far. */
export function progress(policy: ApprovalPolicy | undefined, approvals: Approval[]): ApprovalProgress {
  if (!policy) return { required: false, steps: [], satisfied: true, nextRole: null, nextKind: null };
  const approved = approvals.filter((a) => a.decision === "approved");
  const haveAt = (i: number) => new Set(approved.filter((a) => a.stepIndex === i).map((a) => a.approverMemberId)).size;
  const steps: ApprovalStepState[] = policy.steps.map((s, i) => {
    const have = haveAt(i);
    return { stepIndex: i, role: s.role, need: s.minApprovers, have, satisfied: have >= s.minApprovers, kind: "approve" };
  });
  if (policy.releaseGate) {
    const ri = policy.steps.length;
    const have = haveAt(ri);
    steps.push({ stepIndex: ri, role: policy.releaseGate.role, need: policy.releaseGate.minApprovers, have, satisfied: have >= policy.releaseGate.minApprovers, kind: "release" });
  }
  const next = steps.find((s) => !s.satisfied);
  return { required: true, steps, satisfied: !next, nextRole: next?.role ?? null, nextKind: next?.kind ?? null };
}

export interface RecordResult {
  approval?: Approval;
  error?: string;
  progress: ApprovalProgress;
}

/**
 * Record one approval/denial against the next unsatisfied step. The actor is the
 * given member, or auto-picked: a member holding the step's role who is NOT the
 * proposer and has not already approved this step. Enforces segregation of duties.
 */
export function recordApproval(opts: {
  policy?: ApprovalPolicy;
  approvals: Approval[];
  proposerId: string;
  actorMemberId?: string;
  decision: "approved" | "denied";
  comment?: string;
  paymentOrderId?: string;
  payrollBatchId?: string;
}): RecordResult {
  const { policy, approvals, proposerId } = opts;
  const prog = progress(policy, approvals);
  if (!policy || prog.satisfied) return { progress: prog }; // nothing to do

  const step = prog.steps.find((s) => !s.satisfied)!;
  const alreadyAtStep = new Set(
    approvals.filter((a) => a.stepIndex === step.stepIndex && a.decision === "approved").map((a) => a.approverMemberId),
  );
  const eligible = db.members.filter(
    (m) => m.role === step.role && m.id !== proposerId && m.status === "active" && !alreadyAtStep.has(m.id),
  );
  const actor = opts.actorMemberId ? db.members.find((m) => m.id === opts.actorMemberId) : eligible[0];

  if (opts.decision === "approved") {
    if (!actor) return { error: `no eligible ${step.role} approver (the proposer cannot approve their own request)`, progress: prog };
    if (actor.id === proposerId) return { error: "segregation of duties: the proposer cannot approve their own request", progress: prog };
    if (actor.role !== step.role) return { error: `this step requires a ${step.role}; ${actor.name ?? actor.email} is a ${actor.role}`, progress: prog };
    if (alreadyAtStep.has(actor.id)) return { error: `${actor.name ?? actor.email} has already approved this step`, progress: prog };
  }

  const approval: Approval = {
    id: id("appr"), orgId: db.org.id,
    paymentOrderId: opts.paymentOrderId, payrollBatchId: opts.payrollBatchId,
    stepIndex: step.stepIndex, approverMemberId: actor?.id ?? proposerId,
    decision: opts.decision, comment: opts.comment, at: now(),
  };
  approvals.push(approval);
  return { approval, progress: progress(policy, approvals) };
}
