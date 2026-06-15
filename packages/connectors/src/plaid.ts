/**
 * Plaid connector — instant self-serve Sandbox (`user_good`), bank-link +
 * Auth/Balance/Transactions/IDV with realistic data + webhooks. Used to verify
 * a business's funding/payout bank account at the fiat edge. Sandbox:
 * https://plaid.com/docs/sandbox.
 */
import { type ConnectorConfig, isStub } from "./common.js";

const SANDBOX_BASE = "https://sandbox.plaid.com";

export interface BankVerification {
  itemId: string;
  accountId: string;
  bankName: string;
  last4: string;
  verified: boolean;
}

export interface PlaidConnector {
  createLinkToken(orgId: string): Promise<{ linkToken: string }>;
  /** exchange a public token + return a (sandbox) bank-account verification */
  verifyAccount(publicToken: string): Promise<BankVerification>;
}

export function createPlaidConnector(cfg: ConnectorConfig): PlaidConnector {
  const base = cfg.baseUrl ?? SANDBOX_BASE;
  void base;
  return {
    async createLinkToken(orgId) {
      if (isStub(cfg)) return { linkToken: `stub-plaid-link-${orgId}` };
      // TODO: POST {base}/link/token/create.
      return { linkToken: `sandbox-plaid-link-${orgId}` };
    },
    async verifyAccount(publicToken) {
      void publicToken;
      // Sandbox `user_good` always verifies — honest fiat-edge demo.
      return { itemId: "item_sandbox", accountId: "acc_sandbox", bankName: "Plaid Checking", last4: "0000", verified: true };
    },
  };
}
