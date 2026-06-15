/**
 * Shared primitives for the Benzo B2B domain model.
 *
 * IDs are plain strings (aliased for documentation, not branded, to keep the
 * API/UI boundary friction-free). Money is integer MINOR UNITS encoded as a
 * string so it survives JSON without bigint loss — the on-chain truth is
 * 7-decimal USDC stroops; the product layer keeps the same convention.
 */

/** ISO-8601 timestamp string (e.g. "2026-06-15T12:00:00Z"). */
export type Timestamp = string;

/** Opaque identifier (documented per-entity via the aliases below). */
export type Id = string;
export type OrgId = Id;
export type MemberId = Id;
export type AccountId = Id;
export type CounterpartyId = Id;
export type PaymentOrderId = Id;
export type InvoiceId = Id;
export type PayrollBatchId = Id;
export type ApprovalPolicyId = Id;
export type ViewingGrantId = Id;
export type IntegrationId = Id;
export type ComplianceZoneId = Id;

/** A monetary amount in integer minor units (string-encoded) + asset code. */
export interface Money {
  /** integer minor units (USDC: 7-decimal stroops), as a base-10 string */
  amount: string;
  /** asset code, e.g. "USDC" */
  assetCode: string;
}

/** Cursor-paginated list envelope. */
export interface Page<T> {
  items: T[];
  /** opaque cursor for the next page, or null at the end */
  nextCursor: string | null;
}

/** Uniform API error shape. */
export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/** Discriminated success/failure result for SDK-style callers. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** Stellar G-address or Benzo shielded address (string forms). */
export type StellarAddress = string;
export type ShieldedAddress = string;
