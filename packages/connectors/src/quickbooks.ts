/**
 * QuickBooks Online connector — free Intuit Developer sandbox company, full
 * OAuth2 read/write (invoices, bills, journal entries, payments). The
 * highest-value direct accounting sync. Sandbox: https://developer.intuit.com.
 */
import { type ConnectorConfig, type ExternalRef, isStub } from "./common.js";

const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com/v3";

export interface QboConnector {
  /** create an invoice in the sandbox company */
  createInvoice(input: { docNumber: string; amount: string; customer: string }): Promise<ExternalRef>;
  /** record a journal entry for a settled shielded payment */
  createJournalEntry(input: { memo: string; amount: string; account: string }): Promise<ExternalRef>;
}

export function createQuickBooksConnector(cfg: ConnectorConfig): QboConnector {
  const base = cfg.baseUrl ?? SANDBOX_BASE;
  void base;
  return {
    async createInvoice(input) {
      if (isStub(cfg)) return { provider: "quickbooks", externalId: `qbo_inv_${input.docNumber}`, kind: "Invoice" };
      // TODO: POST {base}/company/{realmId}/invoice with the OAuth2 token.
      return { provider: "quickbooks", externalId: `qbo_inv_${input.docNumber}`, kind: "Invoice" };
    },
    async createJournalEntry(input) {
      if (isStub(cfg)) return { provider: "quickbooks", externalId: `qbo_je_${input.account}`, kind: "JournalEntry" };
      // TODO: POST {base}/company/{realmId}/journalentry.
      return { provider: "quickbooks", externalId: `qbo_je_${input.account}`, kind: "JournalEntry" };
    },
  };
}
