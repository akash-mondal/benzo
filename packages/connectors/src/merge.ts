/**
 * Merge.dev unified-API connector (accounting + HRIS in ONE integration).
 * The highest-leverage connector: a single self-serve sandbox key + test Linked
 * Accounts cover NetSuite/Gusto/Deel/Rippling/QBO/Xero — sidestepping every
 * per-provider partner gate. Sandbox: https://docs.merge.dev (test Linked Accounts).
 */
import { type ConnectorConfig, type ExternalRef, isStub } from "./common.js";

const DEFAULT_BASE = "https://api.merge.dev/api";

/** A payroll-roster entry (HRIS), mapped by the BFF to a counterparty + amount. */
export interface RosterMember {
  externalId: string;
  name: string;
  email?: string;
  type: "employee" | "contractor";
  /** gross pay in minor units (string), if available */
  payAmount?: string;
}

/** A journal entry / bill / invoice push result. */
export interface AccountingPushResult extends ExternalRef {
  status: "synced" | "queued";
}

export interface MergeConnector {
  /** create a Merge Link token to connect a customer's accounting/HRIS account */
  createLinkToken(orgId: string): Promise<{ linkToken: string }>;
  /** pull the HRIS roster for confidential payroll */
  listRoster(): Promise<RosterMember[]>;
  /** push a private invoice as a journal entry / invoice into the linked book */
  pushInvoice(input: { number: string; amount: string; counterparty: string }): Promise<AccountingPushResult>;
  /** push a settled payment as a journal entry */
  pushJournalEntry(input: { memo: string; amount: string; account: string }): Promise<AccountingPushResult>;
}

export function createMergeConnector(cfg: ConnectorConfig): MergeConnector {
  const base = cfg.baseUrl ?? DEFAULT_BASE;
  void base;
  return {
    async createLinkToken(orgId) {
      if (isStub(cfg)) return { linkToken: `stub-merge-link-${orgId}` };
      // TODO: POST {base}/integrations/create-link-token with the sandbox key.
      return { linkToken: `sandbox-merge-link-${orgId}` };
    },
    async listRoster() {
      if (isStub(cfg)) {
        return [
          { externalId: "emp_1", name: "Ada Lovelace", type: "employee", payAmount: "65000000000" },
          { externalId: "emp_2", name: "Alan Turing", type: "employee", payAmount: "72000000000" },
          { externalId: "ctr_1", name: "Grace Hopper", type: "contractor", payAmount: "40000000000" },
        ];
      }
      // TODO: GET {base}/hris/v1/employees (test Linked Account).
      return [];
    },
    async pushInvoice(input) {
      if (isStub(cfg)) {
        return { provider: "merge", externalId: `je_${input.number}`, kind: "invoice", status: "queued" };
      }
      // TODO: POST {base}/accounting/v1/invoices.
      return { provider: "merge", externalId: `je_${input.number}`, kind: "invoice", status: "synced" };
    },
    async pushJournalEntry(input) {
      if (isStub(cfg)) {
        return { provider: "merge", externalId: `je_${input.account}`, kind: "journal_entry", status: "queued" };
      }
      // TODO: POST {base}/accounting/v1/journal-entries.
      return { provider: "merge", externalId: `je_${input.account}`, kind: "journal_entry", status: "synced" };
    },
  };
}
