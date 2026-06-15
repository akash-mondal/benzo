import type { MemberId, OrgId, Timestamp } from "./common.js";

/** Privileged actions captured in the tamper-evident audit log. */
export type AuditAction =
  | "member.invited"
  | "member.role_changed"
  | "policy.changed"
  | "payment.initiated"
  | "payment.approved"
  | "payment.denied"
  | "payment.released"
  | "payroll.run"
  | "viewkey.granted"
  | "viewkey.revoked"
  | "viewkey.accessed"
  | "integration.connected"
  | "config.changed";

/**
 * One append-only, hash-chained audit entry (each binds the prior hash). The
 * chain head is anchored to Stellar for regulator-grade tamper-evidence.
 */
export interface AuditLogEntry {
  id: string;
  orgId: OrgId;
  actorMemberId?: MemberId;
  action: AuditAction;
  /** the affected resource, e.g. "payment_order:po_123" */
  target?: string;
  at: Timestamp;
  /** sha-256 of the previous entry (hash chain) */
  prevHash: string;
  /** sha-256 of this entry's canonical content */
  hash: string;
  /** on-chain tx/root the chain head was anchored to, if anchored */
  onChainAnchor?: string;
}

/** Webhook event types emitted via the transactional outbox. */
export type WebhookEventType =
  | "payment_order.updated"
  | "payroll_batch.updated"
  | "invoice.updated"
  | "deposit.updated"
  | "withdrawal.updated"
  | "viewing_grant.updated";

/**
 * A webhook event. PRIVACY RULE: payloads are metadata-only by default;
 * consumers fetch detail with an authorized viewing key.
 */
export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  orgId: OrgId;
  createdAt: Timestamp;
  /** metadata-only reference; no shielded amounts/counterparties */
  data: { resourceId: string; status?: string };
}
