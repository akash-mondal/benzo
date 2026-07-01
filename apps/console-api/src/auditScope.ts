export function auditOrgIdForScope(input: {
  authKey?: string | null;
  tenantKey?: string | null;
  hosted: boolean;
  localOrgId: string;
}): string {
  if (input.authKey) return `org-${input.authKey}`;
  if (input.tenantKey) {
    const subjectKey = input.tenantKey.startsWith("console:")
      ? input.tenantKey.slice("console:".length)
      : input.tenantKey;
    return `org-${subjectKey}`;
  }
  if (input.hosted) throw new Error("Hosted console requires Google account auth");
  return input.localOrgId;
}
