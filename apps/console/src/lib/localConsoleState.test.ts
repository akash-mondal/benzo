import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalPolicy, AuthSession, Counterparty, PaymentOrder } from "@benzo/types";
import { __resetLocalConsoleMemoryForTests, localConsole, type ConsoleSeed } from "./localConsoleState";

const now = "2026-06-25T00:00:00.000Z";

function usd(n: number): string {
  return Math.round(n * 1e7).toString();
}

function seed(): ConsoleSeed {
  const session: AuthSession = {
    org: { id: "org_test", name: "Test Org", kybStatus: "approved", baseAssetCode: "USDC", createdAt: now },
    member: { id: "mem_owner", orgId: "org_test", email: "owner@test", role: "owner", status: "active", createdAt: now },
    permissions: [],
  };
  const policy: ApprovalPolicy = {
    id: "pol_default",
    orgId: "org_test",
    name: "Anything over one dollar",
    conditions: [{ field: "amount", operator: "gte", value: usd(1) }],
    steps: [{ role: "approver", mode: "all", minApprovers: 1 }],
    releaseGate: { role: "treasurer", mode: "all", minApprovers: 1 },
    reApprovalTriggers: ["amount", "counterparty", "bank_details"],
    createdAt: now,
  };
  const contractor: Counterparty = {
    id: "cp_grace",
    orgId: "org_test",
    name: "Grace Hopper",
    type: "contractor",
    status: "allowlisted",
    paymentAddress: { shielded: "@grace", spendPub: "spend", viewPub: "view", mvkScalar: "mvk" },
    externalAccounts: [],
    payRate: { amount: usd(2), assetCode: "USDC" },
    payCadence: "monthly",
    createdAt: now,
  };
  return {
    session,
    accounts: [{ id: "acc_op", orgId: "org_test", name: "Operating", type: "operating", assetCode: "USDC", createdAt: now }],
    members: [
      session.member,
      { id: "mem_appr", orgId: "org_test", email: "approver@test", role: "approver", status: "active", createdAt: now },
      { id: "mem_treas", orgId: "org_test", email: "treasurer@test", role: "treasurer", status: "active", createdAt: now },
    ],
    counterparties: [contractor],
    payments: [],
    payrolls: [],
    invoices: [],
    grants: [],
    policies: [policy],
    invites: [],
  };
}

describe("localConsole encrypted state", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetLocalConsoleMemoryForTests();
  });

  it("persists contractor mutations encrypted rather than plaintext JSON", async () => {
    await localConsole.importRoster(() => Promise.resolve(seed()), "Name,Handle,Monthly USDC\nAda Lovelace,@ada,7");

    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("\n");
    expect(stored).not.toContain("Ada Lovelace");
    expect(stored).not.toContain("@ada");

    __resetLocalConsoleMemoryForTests();
    const rows = await localConsole.counterparties(() => Promise.reject(new Error("seed should not be needed")));
    expect(rows.some((c) => c.name === "Ada Lovelace" && c.paymentAddress?.shielded === "@ada")).toBe(true);
  });

  it("settles a payment only after approve and release gates are satisfied", async () => {
    const settle = vi.fn(async () => ({ onChain: true, txHash: "tx_test" }));
    const payment = await localConsole.createPayment(
      () => Promise.resolve(seed()),
      { type: "shielded_transfer", fromAccountId: "acc_op", toCounterpartyId: "cp_grace", amount: { amount: usd(2), assetCode: "USDC" } },
      settle,
    );
    expect(payment.status).toBe("needs_approval");
    expect(settle).not.toHaveBeenCalled();

    const first = await localConsole.approvePayment(() => Promise.resolve(seed()), payment.id, { decision: "approved" }, settle);
    expect(first.progress?.satisfied).toBe(false);
    expect(first.progress?.nextRole).toBe("treasurer");
    expect(settle).not.toHaveBeenCalled();

    const second = await localConsole.approvePayment(() => Promise.resolve(seed()), payment.id, { decision: "approved" }, settle);
    expect(second.status).toBe("confirmed");
    expect((second as PaymentOrder).settlement.txHash).toBe("tx_test");
    expect(settle).toHaveBeenCalledOnce();
  });
});
