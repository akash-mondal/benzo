import { describe, it, expect } from "vitest";
import { statusMeta, buildTimeline } from "./status";

describe("console status vocabulary (B2 - Deel-mirrored, privacy-honest)", () => {
  it("maps the in-progress states to one plain label", () => {
    for (const s of ["approved", "proving", "submitting", "submitted_onchain", "processing"]) {
      expect(statusMeta(s).label).toBe("Payment in progress");
      expect(statusMeta(s).tone).toBe("warning");
    }
  });

  it("maps settled states to Paid (terminal, no ETA clock)", () => {
    for (const s of ["confirmed", "settled", "paid"]) {
      expect(statusMeta(s).label).toBe("Paid");
      expect(statusMeta(s).tone).toBe("success");
      expect(statusMeta(s).eta).toBe(""); // terminal - no clock
    }
  });

  it("needs_approval shows WHICH role is next, not a time clock", () => {
    expect(statusMeta("needs_approval").label).toBe("Pending review");
    expect(statusMeta("needs_approval", { nextRole: "treasurer" }).eta).toBe("Waiting on treasurer to approve");
  });

  it("ETA is amount-independent and rail-honest (seconds, never bank days)", () => {
    // open invoice -> "arrives in seconds once paid", never a multi-day estimate
    expect(statusMeta("open").eta).toMatch(/seconds/i);
    expect(statusMeta("proving").eta).toBe("Settling now");
    // no status returns a day-scale ETA
    for (const s of ["open", "proving", "needs_approval", "paid", "failed"]) {
      expect(statusMeta(s).eta).not.toMatch(/day|business/i);
    }
  });

  it("failure is the only red, with a retry hint", () => {
    expect(statusMeta("failed").tone).toBe("danger");
    expect(statusMeta("failed").tooltip).toMatch(/retry/i);
  });

  it("buildTimeline marks the right active step per status", () => {
    expect(buildTimeline("needs_approval").find((s) => s.label === "Pending review")?.state).toBe("active");
    expect(buildTimeline("paid").every((s) => s.state === "done")).toBe(true);
    expect(buildTimeline("proving").find((s) => s.label === "Proved private")?.state).toBe("active");
    expect(buildTimeline("failed").find((s) => s.label === "Failed")?.state).toBe("active");
  });
});
