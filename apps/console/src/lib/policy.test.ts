import { describe, it, expect } from "vitest";
import type { ApprovalPolicy } from "@benzo/types";
import { policySummary, conditionLabel, stepLabel, totalApprovers } from "./policy";

const policy = (over: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  id: "pol_1",
  orgId: "org_1",
  name: "Large payments",
  conditions: [{ field: "amount", operator: "gte", value: "50000000000" }], // $5,000
  steps: [{ role: "approver", mode: "any", minApprovers: 1 }],
  releaseGate: { role: "treasurer", mode: "all", minApprovers: 2 },
  reApprovalTriggers: ["amount", "counterparty"],
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("approval policy helpers (B4)", () => {
  it("labels an amount condition in dollars", () => {
    expect(conditionLabel({ field: "amount", operator: "gte", value: "50000000000" })).toBe("amount ≥ $5,000.00");
  });

  it("labels a step with count, mode, and role", () => {
    expect(stepLabel({ role: "approver", mode: "any", minApprovers: 1 })).toBe("1 approval (any of approver)");
    expect(stepLabel({ role: "admin", mode: "all", minApprovers: 2 })).toBe("2 approvals (all of admin)");
  });

  it("summarizes the whole policy in one honest line", () => {
    expect(policySummary(policy())).toBe("amount ≥ $5,000.00 → 1 approval (any of approver) → release by treasurer");
  });

  it("'every payment' when there are no conditions", () => {
    expect(policySummary(policy({ conditions: [] }))).toMatch(/^every payment →/);
  });

  it("counts total approvals across steps + release gate (maps to on-chain threshold)", () => {
    expect(totalApprovers(policy())).toBe(3); // 1 approve + 2 release
    expect(totalApprovers(policy({ releaseGate: undefined }))).toBe(1);
  });
});
