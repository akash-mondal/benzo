import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Invoices } from "./Invoices";

const refreshMock = vi.hoisted(() => vi.fn(async () => {}));

const apiMock = vi.hoisted(() => ({
  createInvoice: vi.fn(async (body: unknown) => ({
    id: "inv_hosted",
    orgId: "org_test",
    number: "INV-WALLET-1",
    counterpartyId: "cp_wallet",
    lineItems: [{ description: "Design", quantity: 1, unitAmount: "25000000" }],
    total: { amount: "25000000", assetCode: "USDC" },
    status: "open",
    paymentOrderIds: [],
    externalId: "wallet_inv_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    requestBody: body,
  })),
  payInvoice: vi.fn(),
  netInvoices: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/store", () => ({
  useConsole: () => ({
    invoices: [],
    counterparties: [],
    masked: false,
    refresh: refreshMock,
    loading: false,
  }),
}));

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("Invoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "/invoices");
  });

  it("imports wallet invoice handoffs through the hosted invoice API", async () => {
    const packet = {
      v: 1,
      counterpartyName: "Ava Contractor",
      handle: "@ava",
      invoice: {
        id: "wallet_inv_1",
        orgId: "org_test",
        number: "INV-WALLET-1",
        counterpartyId: "cp_wallet",
        lineItems: [{ description: "Design", quantity: 1, unitAmount: "25000000" }],
        total: { amount: "25000000", assetCode: "USDC" },
        status: "open",
        paymentOrderIds: [],
        createdAt: "2026-06-26T00:00:00.000Z",
      },
    };
    window.history.replaceState(null, "", `/invoices#import=${b64url(JSON.stringify(packet))}`);

    render(<Invoices />);

    await waitFor(() => expect(apiMock.createInvoice).toHaveBeenCalledOnce());
    expect(apiMock.createInvoice).toHaveBeenCalledWith({
      counterpartyId: "cp_wallet",
      number: "INV-WALLET-1",
      lineItems: [{ description: "Design", quantity: 1, unitAmount: "25000000" }],
      assetCode: "USDC",
      dueDate: undefined,
      externalId: "wallet_inv_1",
      counterpartyName: "Ava Contractor",
      handle: "@ava",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
    expect(localStorage.getItem("benzo.console.localInvoices")).toBeNull();
  });

  it("blocks invalid private netting inputs before calling the API", () => {
    render(<Invoices />);

    fireEvent.change(screen.getByTestId("net-we-owe"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("net-they-owe"), { target: { value: "0.18" } });
    fireEvent.click(screen.getByTestId("net-invoices"));

    expect(apiMock.netInvoices).not.toHaveBeenCalled();
    expect(screen.getByTestId("net-error")).toHaveTextContent("Enter both invoice totals");

    fireEvent.change(screen.getByTestId("net-we-owe"), { target: { value: "-1" } });
    fireEvent.click(screen.getByTestId("net-invoices"));

    expect(apiMock.netInvoices).not.toHaveBeenCalled();
    expect(screen.getByTestId("net-error")).toHaveTextContent("Use positive USDC amounts");
  });
});
