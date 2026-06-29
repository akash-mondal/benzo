export function validateViewingGrantForm(input: { auditorName: string; auditorPubKey: string }): string | null {
  if (!input.auditorName.trim()) return "Enter the auditor's name before issuing a grant.";
  if (!input.auditorPubKey.trim()) return "Enter the auditor's public key before issuing a grant.";
  return null;
}
