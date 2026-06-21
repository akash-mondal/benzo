import { describe, it, expect } from "vitest";
import { roleHas, PERMISSION_GROUPS, ROLES } from "./permissions";

describe("roles & permissions matrix (B5)", () => {
  it("owner has every permission", () => {
    const all = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    expect(all.every((p) => roleHas("owner", p))).toBe(true);
  });

  it("auditor is read-only: can read, can NEVER move money or manage", () => {
    expect(roleHas("auditor", "ledger.read")).toBe(true);
    expect(roleHas("auditor", "audit.read")).toBe(true);
    expect(roleHas("auditor", "payment.initiate")).toBe(false);
    expect(roleHas("auditor", "payment.approve")).toBe(false);
    expect(roleHas("auditor", "payment.release")).toBe(false);
    expect(roleHas("auditor", "members.manage")).toBe(false);
  });

  it("separation of authority: only treasurer/owner can release on-chain", () => {
    expect(roleHas("treasurer", "payment.release")).toBe(true);
    expect(roleHas("owner", "payment.release")).toBe(true);
    expect(roleHas("admin", "payment.release")).toBe(false); // admin runs the org but doesn't hold the signer
    expect(roleHas("approver", "payment.release")).toBe(false);
  });

  it("approver can approve but not initiate or release (maker-checker)", () => {
    expect(roleHas("approver", "payment.approve")).toBe(true);
    expect(roleHas("approver", "payment.initiate")).toBe(false);
    expect(roleHas("approver", "payment.release")).toBe(false);
  });

  it("covers all 5 roles and 13 permissions", () => {
    expect(ROLES).toHaveLength(5);
    expect(PERMISSION_GROUPS.flatMap((g) => g.items)).toHaveLength(13);
  });
});
