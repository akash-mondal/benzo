import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BalanceHero } from "./money";
import { PrivateChip, ProvableChip } from "./privacy";
import { Button } from "./primitives";
import { ActivityItem } from "./ActivityItem";
import type { ActivityRow } from "../lib/api";

describe("BalanceHero", () => {
  it("renders the formatted balance (accessible label)", () => {
    render(<BalanceHero stroops="12405000000" hidden={false} />);
    expect(screen.getByLabelText("$1,240.50")).toBeInTheDocument();
  });
  it("masks the balance when hidden", () => {
    render(<BalanceHero stroops="12405000000" hidden />);
    expect(screen.getByLabelText("Balance hidden")).toBeInTheDocument();
    expect(screen.queryByLabelText("$1,240.50")).not.toBeInTheDocument();
  });
  it("shows a skeleton while loading", () => {
    render(<BalanceHero stroops="0" hidden={false} loading />);
    expect(screen.getByLabelText("Loading balance")).toBeInTheDocument();
  });
});

describe("privacy chrome", () => {
  it("PrivateChip is ambient (default copy)", () => {
    render(<PrivateChip />);
    expect(screen.getByText(/only you can see this/i)).toBeInTheDocument();
  });
  it("ProvableChip surfaces the proof badge", () => {
    render(<ProvableChip />);
    expect(screen.getByText("Provable")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("fires onClick and renders children", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    fireEvent.click(screen.getByText("Send"));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("is disabled while loading", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText("Go"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("ActivityItem", () => {
  const base: ActivityRow = {
    id: "a1", type: "receive", name: "Ravi Mehta", note: "Paid you · Design work",
    amount: "2000000000", direction: "in", status: "settled", timestamp: Math.floor(Date.now() / 1000) - 60,
  };
  it("renders a person row with a positive amount", () => {
    render(<MemoryRouter><ActivityItem row={base} /></MemoryRouter>);
    expect(screen.getByText("Ravi Mehta")).toBeInTheDocument();
    expect(screen.getByText("+$200.00")).toBeInTheDocument();
  });
  it("shows an in-flight status pill for cash-out", () => {
    render(<MemoryRouter><ActivityItem row={{ ...base, type: "cashOut", name: "Cash out", direction: "out", status: "arriving" }} /></MemoryRouter>);
    expect(screen.getByText(/Arriving/)).toBeInTheDocument();
    expect(screen.getByText("−$200.00")).toBeInTheDocument();
  });
});
