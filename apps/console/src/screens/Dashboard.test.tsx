import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

const stateRef = vi.hoisted(() => ({ current: {} as any }));

vi.mock("../lib/store", () => ({
  useConsole: () => stateRef.current,
}));

describe("Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    stateRef.current = {
      dashboard: {
        live: true,
        totalPosition: { amount: "1230000000", assetCode: "USDC" },
        pendingApprovals: 0,
        openInvoices: 0,
        scheduledPayrolls: 0,
        recentActivity: [],
      },
      treasury: {
        totalHidden: { amount: "1230000000", assetCode: "USDC" },
      },
      payments: [],
      members: [],
      policies: [],
      counterparties: [],
      payrolls: [],
      masked: true,
      loading: false,
      error: null,
      refresh: vi.fn(async () => true),
    };
  });

  it("masks the primary treasury total when amount masking is enabled", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("treasury-total")).toHaveTextContent("••••••");
    expect(screen.queryByText("$123.00")).not.toBeInTheDocument();
  });

  it("offers first-run routes for treasury, invites, policies, contractors, and payroll", () => {
    function PathProbe() {
      return <span data-testid="path">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
        <Routes>
          <Route path="*" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("firstrun-fund"));
    expect(screen.getByTestId("path")).toHaveTextContent("/treasury");
    fireEvent.click(screen.getByTestId("firstrun-approver"));
    expect(screen.getByTestId("path")).toHaveTextContent("/invites");
    fireEvent.click(screen.getByTestId("firstrun-policy"));
    expect(screen.getByTestId("path")).toHaveTextContent("/policies");
    fireEvent.click(screen.getByTestId("firstrun-contractors"));
    expect(screen.getByTestId("path")).toHaveTextContent("/contractors");
    fireEvent.click(screen.getByTestId("firstrun-payroll"));
    expect(screen.getByTestId("path")).toHaveTextContent("/payroll");
  });
});
