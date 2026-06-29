import { describe, expect, it } from "vitest";
import { validateViewingGrantForm } from "./grants";

describe("viewing grant validation", () => {
  it("blocks blank auditor fields before issuing a grant", () => {
    expect(validateViewingGrantForm({ auditorName: "", auditorPubKey: "" })).toBe("Enter the auditor's name before issuing a grant.");
    expect(validateViewingGrantForm({ auditorName: "Codex Auditor", auditorPubKey: "" })).toBe("Enter the auditor's public key before issuing a grant.");
    expect(validateViewingGrantForm({ auditorName: "Codex Auditor", auditorPubKey: "0xabc" })).toBeNull();
  });
});
