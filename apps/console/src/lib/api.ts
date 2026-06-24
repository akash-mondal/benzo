/**
 * Typed client for @benzo/console-api (Vite proxies "/api" → :8790). Screens use
 * ONLY this — typed against @benzo/types, so the UI and BFF share one contract.
 */
import type {
  Account,
  ApprovalPolicy,
  ApproveRequest,
  AuthSession,
  Counterparty,
  CreatePaymentRequest,
  CreatePayrollRequest,
  CreateViewingGrantRequest,
  DashboardSummary,
  Integration,
  Invoice,
  LedgerEntry,
  LiveStatusResponse,
  Member,
  PaymentOrder,
  PayrollBatch,
  TreasuryView,
  ViewingGrant,
} from "@benzo/types";

import type { OnChainRef } from "../ui/onchain";
export type { OnChainRef };

/** Maker-checker progress the BFF returns alongside an approve action. */
export interface ApprovalProgressView {
  required: boolean;
  satisfied: boolean;
  nextRole: string | null;
  nextKind: "approve" | "release" | null;
  steps: Array<{ stepIndex: number; role: string; need: number; have: number; satisfied: boolean; kind: "approve" | "release" }>;
}

export interface PrivateEventEnvelopeView {
  id: string;
  orgId: string;
  type: string;
  subjectId: string;
  schema: string;
  occurredAt: string;
  publicMeta: Record<string, string | number | boolean | null>;
  ciphertext: string;
  iv: string;
  tag: string;
  aadHash: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

export interface PrivateAuditPacketResponse {
  packet: {
    orgId: string;
    scope: { label: string; from?: string; to?: string; eventTypes?: string[]; subjectIds?: string[] };
    anchor: { orgId: string; eventCount: number; headHash: string; merkleRoot: string; anchoredAt: string; txHash?: string };
    envelopes: PrivateEventEnvelopeView[];
    inclusionProofs: Array<{ eventHash: string; siblings: string[]; index: number }>;
    issuedAt: string;
  };
  integrity: { ok: boolean; headHash: string; brokenAt?: number };
  disclosure: string;
}

export function apiHref(path: string): string {
  return `/api/rpc?path=${encodeURIComponent(path)}`;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiHref(path), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export interface OnboardingDraft {
  name?: string;
  legalName?: string;
  country?: string;
  entityType?: string;
  registrationNumber?: string;
  taxId?: string;
  beneficialOwners?: Array<{ name: string; ownership?: string }>;
  complianceZoneId?: string;
  team?: Array<{ email: string; role: string }>;
  kyb?: { status: "approved" | "pending" | "rejected" | "unverified"; provider: string; inquiryRef: string; checks: string[]; onChain: boolean; txHash?: string };
  mvk?: { onChain: boolean; txHash?: string; mvkRoot?: string };
}

export const api = {
  session: () => http<AuthSession>("/session"),
  // zkLogin / SSO: is real Google configured, and verify a Google ID token.
  authConfig: () => http<{ googleClientId: string | null; google: boolean }>("/auth/config"),
  googleVerify: (credential: string, nonce?: string) =>
    http<{ verified: boolean; sub?: string; email?: string; name?: string; error?: string; configured?: boolean; encPub?: string }>(
      "/auth/google",
      { method: "POST", body: JSON.stringify({ credential, nonce }) },
    ),
  onboarding: () => http<OnboardingDraft>("/onboarding"),
  saveOnboarding: (patch: OnboardingDraft) =>
    http<OnboardingDraft>("/onboarding", { method: "PATCH", body: JSON.stringify(patch) }),
  submitKyb: (patch: OnboardingDraft) =>
    http<NonNullable<OnboardingDraft["kyb"]>>("/onboarding/kyb", { method: "POST", body: JSON.stringify(patch) }),
  kybStatus: () =>
    http<{ status: "unverified" | "pending" | "approved" | "rejected"; inquiryRef: string; onChain: boolean }>("/onboarding/kyb-status"),
  registerOwnerMvk: () =>
    http<{ onChain: boolean; txHash?: string; mvkRoot?: string }>("/onboarding/register-mvk", { method: "POST", body: "{}" }),
  finishOnboarding: () => http<AuthSession>("/onboarding/finish", { method: "POST", body: "{}" }),
  live: () => http<LiveStatusResponse>("/live"),
  dashboard: () => http<DashboardSummary>("/dashboard"),
  treasury: () => http<TreasuryView>("/treasury"),
  // Prove reserves: treasury >= a chosen floor on-chain (ORGBAL); returns an on-chain ref.
  proveBalance: (min: string) =>
    http<{ holds: boolean; onChain: boolean; minStroops: string; ref?: OnChainRef }>("/treasury/prove-balance", { method: "POST", body: JSON.stringify({ min }) }),
  proveTotal: () =>
    http<{ total: string; onChain: boolean; ref?: OnChainRef }>("/treasury/prove-total", { method: "POST", body: "{}" }),
  // True solvency: prove treasury >= Σ(pending payroll + open invoices), both hidden.
  proveSolvency: () =>
    http<{ solvent: boolean; onChain: boolean; liabilities: string; ref?: OnChainRef }>("/treasury/prove-solvency", { method: "POST", body: "{}" }),
  // KYB-as-ZK credential (Z7): prove verified business + jurisdiction + tier on-chain (KYB), docs hidden.
  proveKyb: () =>
    http<{ ok: boolean; onChain: boolean; jurisdiction: string; tier: string; ref?: OnChainRef }>("/compliance/kyb-credential", { method: "POST", body: "{}" }),
  // Records export (Z2): network-verified period-total attestation (ORGSUM proof embedded).
  periodTotalAttestation: (period: string) =>
    http<{
      live: boolean; org?: string; period?: string; total?: string; onChain?: boolean;
      vkId?: string; verifier?: string; network?: string; root?: string;
      sorobanProof?: unknown; sorobanPublics?: string[]; issuedAt?: string;
    }>("/records/period-total", { method: "POST", body: JSON.stringify({ period }) }),
  // "Make private" (shield public -> pool). amount in USDC (human).
  fundTreasury: (amount: string) =>
    http<{ onChain: boolean; txHash?: string; error?: string; demo?: boolean }>("/treasury/fund", { method: "POST", body: JSON.stringify({ amount }) }),
  // Two-balance model. Public = liquid, unshielded USDC (what external wallets see).
  // The org's M-of-N shielded pool is api.treasury(). stroops are 7dp.
  treasuryPublicBalance: () =>
    http<{ stroops: string; address: string; asset: string; issuer: string; live: boolean }>("/treasury/public-balance"),
  // Receive: address + asset/issuer for a Receive QR (inbound lands in Public).
  treasuryReceive: () =>
    http<{ address: string; asset: string; issuer: string; live: boolean }>("/treasury/receive"),
  // "Send to a wallet": real on-chain USDC transfer from Public to an external
  // G-address. amount in USDC (human). Friendly trustline/balance errors in `error`.
  treasurySendPublic: (to: string, amount: string) =>
    http<{ txHash?: string; onChain: boolean; error?: string; demo?: boolean }>("/treasury/send-public", { method: "POST", body: JSON.stringify({ to, amount }) }),

  accounts: () => http<Account[]>("/accounts"),
  members: () => http<Member[]>("/members"),
  counterparties: () => http<Counterparty[]>("/counterparties"),
  updateCounterparty: (id: string, patch: { payRate?: string; status?: Counterparty["status"]; handle?: string; name?: string }) =>
    http<Counterparty>(`/counterparties/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  importRoster: (csv: string) =>
    http<{ imported: number; errors: Array<{ line: number; error: string }>; contractors: Counterparty[] }>(
      "/payrolls/import",
      { method: "POST", body: JSON.stringify({ csv }) },
    ),
  // Employer-visible pay history for one contractor across every run.
  contractorHistory: (id: string) =>
    http<Array<{ period: string; amount: string; status: string; txHash?: string; batchId: string }>>(`/contractors/${id}/history`),

  payments: () => http<PaymentOrder[]>("/payments"),
  createPayment: (body: CreatePaymentRequest & { toHandle?: string }) =>
    http<PaymentOrder>("/payments", { method: "POST", body: JSON.stringify(body) }),
  approvePayment: (id: string, body: ApproveRequest & { actorMemberId?: string }) =>
    http<PaymentOrder & { progress?: ApprovalProgressView }>(`/payments/${id}/approve`, { method: "POST", body: JSON.stringify(body) }),

  payrolls: () => http<PayrollBatch[]>("/payrolls"),
  // Amounts are COMPUTED server-side from each contractor's rate card; the caller
  // only chooses WHO is in the run.
  createPayroll: (body: { period: string; source: CreatePayrollRequest["source"]; lines: Array<{ counterpartyId: string }> }) =>
    http<PayrollBatch>("/payrolls", { method: "POST", body: JSON.stringify(body) }),
  approvePayroll: (id: string, body: { decision?: "approved" | "denied"; actorMemberId?: string } = { decision: "approved" }) =>
    http<PayrollBatch & { progress?: ApprovalProgressView }>(`/payrolls/${id}/approve`, { method: "POST", body: JSON.stringify(body) }),
  // "Payroll funded ✓" — prove ON-CHAIN (ORGBAL) the treasury covers this run's total.
  proveFunded: (id: string) =>
    http<{ runTotal: string; funded: boolean; onChain: boolean; provenAt: string; ref?: OnChainRef }>(`/payrolls/${id}/prove-funded`, { method: "POST", body: "{}" }),
  // Anonymous approver (Z5): prove >= threshold distinct approvers signed, on-chain (ORGAUTH), who hidden.
  proveApproval: (id: string) =>
    http<{ approved: boolean; onChain: boolean; approvers: number; threshold: number; memberCount: number; provenAt: string; ref?: OnChainRef }>(
      `/payrolls/${id}/prove-approval`,
      { method: "POST", body: "{}" },
    ),
  // Verifiable payroll computation (Z6): prove run total derived from the rate card, on-chain (PAYCOMP), rate card private.
  proveComputation: (id: string) =>
    http<{ ok: boolean; onChain: boolean; runTotal: string; provenAt: string; ref?: OnChainRef }>(
      `/payrolls/${id}/prove-computation`,
      { method: "POST", body: "{}" },
    ),
  // Compliance pre-flight (Z3 cap + Z4 sanctions screen) per line, on-chain, amounts/recipients hidden.
  provePolicy: (id: string, cap: string) =>
    http<{ cap: string; lines: Array<{ counterpartyId: string; capProof?: { withinCap: boolean; onChain: boolean }; screenProof?: { innocent: boolean; onChain: boolean } }> }>(
      `/payrolls/${id}/prove-policy`,
      { method: "POST", body: JSON.stringify({ cap }) },
    ),

  invoices: () => http<Invoice[]>("/invoices"),
  payInvoice: (id: string) =>
    http<{ invoice: Invoice; payment: PaymentOrder & { progress?: ApprovalProgressView } }>(`/invoices/${id}/pay`, { method: "POST", body: "{}" }),
  // Cross-entity private netting (Z8): net mutual invoices, settle the difference, grosses hidden (NETTING).
  netInvoices: (weOwe: string, theyOwe: string) =>
    http<{ onChain: boolean; net: string; wetPay: boolean; ref?: OnChainRef }>("/invoices/net", { method: "POST", body: JSON.stringify({ weOwe, theyOwe }) }),

  grants: () => http<ViewingGrant[]>("/grants"),
  createGrant: (body: CreateViewingGrantRequest) =>
    http<ViewingGrant>("/grants", { method: "POST", body: JSON.stringify(body) }),
  revokeGrant: (id: string) => http<ViewingGrant>(`/grants/${id}/revoke`, { method: "POST", body: "{}" }),

  policies: () => http<ApprovalPolicy[]>("/policies"),
  updatePolicy: (id: string, patch: Partial<Pick<ApprovalPolicy, "name" | "conditions" | "steps" | "releaseGate">>) =>
    http<ApprovalPolicy>(`/policies/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  integrations: () => http<Integration[]>("/integrations"),

  // Tamper-evident double-entry audit trail (each entry hash-chains to the prior).
  ledger: () => http<LedgerEntry[]>("/ledger"),
  // Re-walk the chain server-side and report integrity (ok / brokenAt index).
  ledgerVerify: () => http<{ ok: boolean; length: number; brokenAt?: number }>("/ledger/verify"),
  privateAuditPacket: () => http<PrivateAuditPacketResponse>("/audit/private-events"),
  // Per-contractor payslips for one run (gross, status, on-chain receipt).
  payslips: (id: string) =>
    http<Array<{ period: string; contractor: string; gross: string; status: string; txHash?: string; error?: string }>>(`/payrolls/${id}/payslips`),

  invites: () => http<OrgInvite[]>("/invites"),
  createInvite: (body: { kind: OrgInvite["kind"]; name?: string; email?: string; role?: string; handle?: string }) =>
    http<OrgInvite>("/invites", { method: "POST", body: JSON.stringify(body) }),
  bulkInvite: (csv: string) =>
    http<{ created: number; errors: Array<{ line: number; error: string }>; invites: OrgInvite[] }>("/invites/bulk", { method: "POST", body: JSON.stringify({ csv }) }),
  revokeInvite: (id: string) => http<OrgInvite>(`/invites/${id}/revoke`, { method: "POST", body: "{}" }),
};

export interface OrgInvite {
  id: string;
  kind: "member" | "contractor" | "customer";
  name?: string;
  email?: string;
  role?: string;
  counterpartyId?: string;
  link: string;
  token: string;
  status: "sent" | "accepted" | "revoked";
  createdAt: string;
}
