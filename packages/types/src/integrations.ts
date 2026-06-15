import type { IntegrationId, OrgId, Timestamp } from "./common.js";

/**
 * Third-party connectors with self-serve PUBLIC SANDBOXES (verified). Merge is
 * the unified-API leverage point (accounting + HRIS in one) that sidesteps the
 * per-provider partner gates for NetSuite/Gusto/Deel/Rippling.
 */
export type IntegrationProvider =
  | "merge"
  | "quickbooks"
  | "xero"
  | "plaid"
  | "slack"
  | "gusto";

export type IntegrationCategory = "accounting" | "hris" | "banking_data" | "notifications";

export const PROVIDER_CATEGORY: Record<IntegrationProvider, IntegrationCategory> = {
  merge: "accounting",
  quickbooks: "accounting",
  xero: "accounting",
  plaid: "banking_data",
  slack: "notifications",
  gusto: "hris",
};

export type IntegrationStatus = "disconnected" | "connected" | "error";

/** A connected (sandbox) integration for an org. */
export interface Integration {
  id: IntegrationId;
  orgId: OrgId;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** true while pointed at the provider's sandbox/test environment */
  sandbox: boolean;
  /** provider-side ids (linked account / company / item), non-secret */
  externalRefs?: Record<string, string>;
  connectedAt?: Timestamp;
  lastSyncAt?: Timestamp;
  lastError?: string;
}
