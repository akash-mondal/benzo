import { afterEach, describe, expect, it, vi } from "vitest";
import { orgApi } from "./orgApi";

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

describe("wallet org API", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("submits contractor invoices with an idempotency key and scoped invite token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: "inv_1",
      number: "INV-1",
      counterpartyId: "cp_1",
      total: { amount: "120000000", assetCode: "USDC" },
      status: "open",
      lineItems: [{ description: "Design", quantity: 1, unitAmount: "120000000" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await orgApi.submitInvoice("cp_1", "12", "Design", "tok_invite");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/rpc?path=%2Finvoices");
    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("x-benzo-org-invite-token")).toBe("tok_invite");
    expect(headers.get("idempotency-key")).toMatch(/^idem_/);
  });

  it("loads contractor invoices with only the scoped invite token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await orgApi.invoices("tok_invite");

    const headers = callHeaders(fetchMock.mock.calls[0]);
    expect(headers.get("x-benzo-org-invite-token")).toBe("tok_invite");
    expect(headers.get("idempotency-key")).toBeNull();
  });
});
