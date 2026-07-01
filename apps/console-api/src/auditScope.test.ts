import { describe, expect, it } from "vitest";
import { auditOrgIdForScope } from "./auditScope.js";

describe("audit org scope", () => {
  it("keeps authenticated hosted audit ids stable", () => {
    expect(auditOrgIdForScope({
      authKey: "owner-key",
      tenantKey: "console:owner-key",
      hosted: true,
      localOrgId: "local-org",
    })).toBe("org-owner-key");
  });

  it("uses the routed console tenant for public invite-token writes", () => {
    expect(auditOrgIdForScope({
      authKey: null,
      tenantKey: "console:inviter-key",
      hosted: true,
      localOrgId: "local-org",
    })).toBe("org-inviter-key");
  });

  it("still fails closed for hosted writes with no auth or routed tenant", () => {
    expect(() => auditOrgIdForScope({
      authKey: null,
      tenantKey: null,
      hosted: true,
      localOrgId: "local-org",
    })).toThrow("Hosted console requires Google account auth");
  });
});
