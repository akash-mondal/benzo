/**
 * Xero connector — free Demo Company + Custom Connections, full Accounting API
 * (invoices, bills, contacts, payments). Second accounting pillar (ex-US SMB).
 * Sandbox: https://developer.xero.com.
 */
import { type ConnectorConfig, type ExternalRef, isStub } from "./common.js";

const BASE = "https://api.xero.com/api.xro/2.0";

export interface XeroConnector {
  createContact(input: { name: string; email?: string }): Promise<ExternalRef>;
  createInvoice(input: { reference: string; amount: string; contactId: string }): Promise<ExternalRef>;
}

export function createXeroConnector(cfg: ConnectorConfig): XeroConnector {
  const base = cfg.baseUrl ?? BASE;
  void base;
  return {
    async createContact(input) {
      if (isStub(cfg)) return { provider: "xero", externalId: `xero_ct_${input.name}`, kind: "Contact" };
      // TODO: POST {base}/Contacts against the Demo Company.
      return { provider: "xero", externalId: `xero_ct_${input.name}`, kind: "Contact" };
    },
    async createInvoice(input) {
      if (isStub(cfg)) return { provider: "xero", externalId: `xero_inv_${input.reference}`, kind: "Invoice" };
      // TODO: POST {base}/Invoices.
      return { provider: "xero", externalId: `xero_inv_${input.reference}`, kind: "Invoice" };
    },
  };
}
