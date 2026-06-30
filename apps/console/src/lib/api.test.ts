import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatePaymentRequest } from "@benzo/types";
import { api, apiHref, currentGoogleCredential, storeGoogleCredential } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function callHeaders(call: unknown[]): Headers {
  return call[1] instanceof Object && "headers" in call[1]
    ? call[1].headers as Headers
    : new Headers();
}

describe("console API idempotency", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reuses a mutation idempotency key after a network failure, then clears it after a response", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ id: "pay_1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "pay_2" }));
    vi.stubGlobal("fetch", fetchMock);

    const body = {
      type: "shielded_transfer",
      fromAccountId: "acc_operating",
      toCounterpartyId: "cp_vendor",
      amount: { amount: "10000000", assetCode: "USDC" },
    } satisfies CreatePaymentRequest;

    await expect(api.createPayment(body)).rejects.toThrow("network down");
    const firstKey = callHeaders(fetchMock.mock.calls[0]).get("idempotency-key");
    expect(firstKey).toMatch(/^idem_/);

    await api.createPayment(body);
    const retryKey = callHeaders(fetchMock.mock.calls[1]).get("idempotency-key");
    expect(retryKey).toBe(firstKey);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("benzo.idempotency.console.v1:"))).toEqual([]);

    await api.createPayment(body);
    const nextKey = callHeaders(fetchMock.mock.calls[2]).get("idempotency-key");
    expect(nextKey).toMatch(/^idem_/);
    expect(nextKey).not.toBe(firstKey);
  });

  it("adds auth and idempotency headers for console money movement", async () => {
    localStorage.setItem("benzo.console.googleCredential", "google.jwt");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ invoice: { id: "inv_1" }, payment: { id: "pay_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.payInvoice("inv_1");

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/invoices/inv_1/pay"));
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBe("Bearer google.jwt");
    expect(headers.get("idempotency-key")).toMatch(/^idem_/);
  });

  it("adds idempotency headers to console mutation helpers", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchMock);
    const payment = {
      type: "shielded_transfer",
      fromAccountId: "acc_operating",
      toCounterpartyId: "cp_vendor",
      amount: { amount: "10000000", assetCode: "USDC" },
    } satisfies CreatePaymentRequest;
    const actions: Array<() => Promise<unknown>> = [
      () => api.saveOnboarding({ name: "Acme" }),
      () => api.submitKyb({ legalName: "Acme Inc." }),
      () => api.registerOwnerMvk(),
      () => api.finishOnboarding(),
      () => api.proveBalance("1"),
      () => api.proveTotal(),
      () => api.proveSolvency(),
      () => api.proveKyb(),
      () => api.periodTotalAttestation("2026-06"),
      () => api.fundTreasury("1"),
      () => api.treasurySendPublic("G".padEnd(56, "A"), "1"),
      () => api.updateCounterparty("cp_1", { status: "allowlisted" }),
      () => api.importRoster("name,handle,rate\\nA,@a,1"),
      () => api.createPayment(payment),
      () => api.approvePayment("po_1", { decision: "approved", actorMemberId: "mem_1" }),
      () => api.createPayroll({ period: "2026-06", source: "manual", lines: [] }),
      () => api.approvePayroll("pr_1", { decision: "approved", actorMemberId: "mem_1" }),
      () => api.proveFunded("pr_1"),
      () => api.proveApproval("pr_1"),
      () => api.proveComputation("pr_1"),
      () => api.provePolicy("pr_1", "5000"),
      () => api.createInvoice({ number: "INV-1", counterpartyId: "cp_1", lineItems: [], assetCode: "USDC", dueDate: "2026-07-01" }),
      () => api.payInvoice("inv_1"),
      () => api.netInvoices("10", "7"),
      () => api.createGrant({ auditorName: "Auditor", auditorPubKey: "0xaud", tier: "outgoing", scope: { label: "Q2", accountIds: [], from: null, to: null }, expiry: "2026-09-30T00:00:00Z" }),
      () => api.revokeGrant("vg_1"),
      () => api.updatePolicy("pol_1", { name: "Updated" }),
      () => api.anchorPrivateAuditRoot(),
      () => api.createInvite({ kind: "member", email: "member@example.com", role: "viewer" }),
      () => api.bulkInvite("name,email,role\\nA,a@example.com,viewer"),
      () => api.revokeInvite("invite_1"),
    ];

    for (const action of actions) await action();

    expect(fetchMock).toHaveBeenCalledTimes(actions.length);
    for (const call of fetchMock.mock.calls) {
      expect(callHeaders(call).get("idempotency-key")).toMatch(/^idem_/);
    }
  });

  it("keeps a mutation idempotency key after a 5xx response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporarily unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ invoice: { id: "inv_1" }, payment: { id: "pay_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.payInvoice("inv_1")).rejects.toThrow("temporarily unavailable");
    const firstKey = callHeaders(fetchMock.mock.calls[0]).get("idempotency-key");

    await api.payInvoice("inv_1");
    expect(callHeaders(fetchMock.mock.calls[1]).get("idempotency-key")).toBe(firstKey);
  });

  it("loads proof receipts through the authenticated RPC gateway without mutation idempotency", async () => {
    localStorage.setItem("benzo.console.googleCredential", "google.jwt");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: "prf_1", action: "payroll.policy.cap", vkId: "SPENDCAP", verified: true, createdAt: "2026-06-26T00:00:00.000Z" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.proofReceipts()).resolves.toHaveLength(1);

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/proof-receipts"));
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBe("Bearer google.jwt");
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("loads sanitized recovery status without mutation idempotency", async () => {
    localStorage.setItem("benzo.console.googleCredential", "google.jwt");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", recovery: { bound: true, status: "healthy", custody: "non-custodial", createdAt: "2026-06-26T00:00:00.000Z", lastSeenAt: "2026-06-26T00:01:00.000Z", nextSteps: ["Another owner must approve migration."] } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.recoveryStatus();
    expect(result).toMatchObject({ recovery: { bound: true } });
    expect(result.recovery.nextSteps[0]).toContain("owner");
    expect(result.recovery).not.toHaveProperty("accountFingerprint");
    expect(result.recovery).not.toHaveProperty("subjectKey");

    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/recovery/status"));
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBe("Bearer google.jwt");
    expect(headers.get("idempotency-key")).toBeNull();
  });

  it("calls the localhost verification auth endpoint without a stored credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ token: "benzo-test-v1.body.sig", tokenType: "Bearer", expiresIn: 3600 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.localVerificationAuth("local-ui-console")).resolves.toMatchObject({ tokenType: "Bearer" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(apiHref("/auth/local"));
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("authorization")).toBeNull();
  });

  it("does not clear a fresh console sign-in when an older unauthenticated request returns 401", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.dashboard();
    storeGoogleCredential("fresh.console.jwt");
    resolveFetch(jsonResponse({ error: "Unauthorized" }, 401));

    await expect(pending).rejects.toThrow("Unauthorized");
    expect(currentGoogleCredential()).toBe("fresh.console.jwt");
  });

  it("does not clear a newer console sign-in when a stale-token request returns 401", async () => {
    localStorage.setItem("benzo.console.googleCredential", "old.console.jwt");
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = api.dashboard();
    storeGoogleCredential("fresh.console.jwt");
    resolveFetch(jsonResponse({ error: "Unauthorized" }, 401));

    await expect(pending).rejects.toThrow("Unauthorized");
    expect(currentGoogleCredential()).toBe("fresh.console.jwt");
  });
});
