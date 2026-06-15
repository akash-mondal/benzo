import type {
  ComplianceZoneId,
  OrgId,
  Timestamp,
  ViewingGrantId,
} from "./common.js";

/**
 * Disclosure tiers mirror Penumbra/Zcash key hierarchy:
 *  - full     = full-history read (FVK)
 *  - incoming = only payments the scope RECEIVED (IVK) — e.g. show a supplier
 *  - outgoing = only payments the scope SENT (OVK) — e.g. show payroll outflows
 */
export type DisclosureTier = "full" | "incoming" | "outgoing";

/** What a viewing grant is scoped to. */
export interface GrantScope {
  /** account ids in scope (empty = all) */
  accountIds: string[];
  /** ISO date range, inclusive (null = open) */
  from: string | null;
  to: string | null;
  /** human label, e.g. "Q2 payroll" */
  label?: string;
}

export type GrantStatus = "active" | "revoked" | "expired";

/**
 * A scoped, expiring, revocable Transaction Viewing Key (TVK) grant for an
 * auditor/regulator. The auditor reads, never signs. The key hash is committed
 * on-chain for tamper-evidence (Aleo pattern).
 */
export interface ViewingGrant {
  id: ViewingGrantId;
  orgId: OrgId;
  auditorName: string;
  /** auditor's public key the TVK ciphertext is sealed to (hex) */
  auditorPubKey: string;
  tier: DisclosureTier;
  scope: GrantScope;
  /** TVK ciphertext (sealed to auditorPubKey) — delivered via the portal */
  tvkCiphertext?: string;
  /** on-chain hash commitment of the scoped key (tamper-evidence) */
  onChainKeyHash?: string;
  /** ISO timestamp after which the grant is void */
  expiry: Timestamp;
  status: GrantStatus;
  /** read-only portal URL handed to the auditor (not a raw key paste) */
  portalUrl?: string;
  createdAt: Timestamp;
}

/**
 * A per-jurisdiction compliance partition — the ASP allow/deny root set the
 * org's deposits/withdrawals are screened against (maps to Benzo asp_registry).
 */
export interface ComplianceZone {
  id: ComplianceZoneId;
  orgId: OrgId;
  name: string;
  /** ISO-3166 / region label, e.g. "US", "EU" */
  jurisdiction: string;
  /** current ASP allow-set Merkle root (hex) */
  allowRoot?: string;
  /** current ASP deny-set (proof-of-innocence) root (hex) */
  denyRoot?: string;
}
