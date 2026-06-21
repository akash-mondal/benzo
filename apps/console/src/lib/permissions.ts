/**
 * Roles & permissions matrix (B5 — Brex/Ramp parity). The matrix is DRIVEN by
 * ROLE_PERMISSIONS (packages/types/src/org.ts) — the BFF's source of truth — so
 * the UI can never claim authority the backend doesn't grant. Privacy-native
 * differentiator: `auditor` is a scoped VIEWING-KEY holder (read-only, never a
 * signer), a role no Ramp/Brex equivalent has.
 */
import { ROLES, ROLE_PERMISSIONS, type Permission, type Role } from "@benzo/types";

export { ROLES, type Role, type Permission };

export function roleHas(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** Human-readable, grouped permission rows in display order. */
export const PERMISSION_GROUPS: { group: string; items: { key: Permission; label: string }[] }[] = [
  {
    group: "Organization",
    items: [
      { key: "org.manage", label: "Manage org settings" },
      { key: "members.manage", label: "Manage members & roles" },
      { key: "policy.manage", label: "Edit approval policies" },
    ],
  },
  {
    group: "Money movement",
    items: [
      { key: "payment.initiate", label: "Start a payment" },
      { key: "payment.approve", label: "Approve a payment" },
      { key: "payment.release", label: "Sign & release (on-chain)" },
      { key: "payroll.run", label: "Run payroll" },
      { key: "invoice.manage", label: "Manage invoices" },
      { key: "counterparty.manage", label: "Manage vendors/contractors" },
    ],
  },
  {
    group: "Data & privacy",
    items: [
      { key: "viewkey.grant", label: "Grant auditor viewing keys" },
      { key: "integration.manage", label: "Manage integrations" },
      { key: "ledger.read", label: "Read the ledger" },
      { key: "audit.read", label: "Read the audit trail" },
    ],
  },
];

/** One-line description of what each role IS (capability, plus on-chain authority). */
export const ROLE_BLURB: Record<Role, string> = {
  owner: "Full control",
  admin: "Runs the org day-to-day",
  treasurer: "Holds a signer · releases money on-chain",
  approver: "Approves spends (maker-checker)",
  auditor: "Read-only viewing key · never a signer",
};
