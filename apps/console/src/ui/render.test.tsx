import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, ShieldedBadge, StatusPill, Stat } from "./primitives";

describe("console primitives", () => {
  it("StatusPill maps settled/needs_approval/failed to calm tones (text)", () => {
    const { rerender } = render(<StatusPill status="settled" />);
    expect(screen.getByText("sent")).toBeInTheDocument(); // STATUS_LABEL maps settled -> "sent"
    rerender(<StatusPill status="needs_approval" />);
    expect(screen.getByText("needs approval")).toBeInTheDocument();
    rerender(<StatusPill status="failed" />);
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("ShieldedBadge shows the private label", () => {
    render(<ShieldedBadge />);
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("Stat renders label + value", () => {
    render(<Stat label="Pending approvals" value={3} />);
    expect(screen.getByText("Pending approvals")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("Button fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Approve</Button>);
    fireEvent.click(screen.getByText("Approve"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
