import type {
  CounterpartyId,
  InvoiceId,
  Money,
  OrgId,
  PaymentOrderId,
  Timestamp,
} from "./common.js";

export interface LineItem {
  description: string;
  quantity: number;
  /** unit price in minor units (string) */
  unitAmount: string;
}

/** AR lifecycle. `open` invoices are immutable (finalized). */
export type InvoiceStatus =
  | "draft"
  | "open"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export interface RecurringConfig {
  /** RFC-5545-ish cadence, e.g. "monthly" | "weekly" */
  cadence: "weekly" | "monthly" | "quarterly";
  /** ISO date the recurrence ends, or null for open-ended */
  until: string | null;
}

/**
 * A private invoice. The hosted page lives at a secret URL — that URL *is* the
 * viewing grant (the payer reconstructs only this invoice). Reconciled to a
 * shielded payment via a per-invoice memo/commitment.
 */
export interface Invoice {
  id: InvoiceId;
  orgId: OrgId;
  number: string;
  counterpartyId: CounterpartyId;
  lineItems: LineItem[];
  total: Money;
  status: InvoiceStatus;
  /** ISO date */
  dueDate?: string;
  /** secret-random hosted invoice URL (the viewing grant) */
  hostedUrl?: string;
  /** payments that settled (part of) this invoice */
  paymentOrderIds: PaymentOrderId[];
  recurring?: RecurringConfig;
  /** join key for accounting sync */
  externalId?: string;
  createdAt: Timestamp;
}
