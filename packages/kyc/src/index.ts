/**
 * @benzo/kyc — pluggable KYC provider for the anchor's on-ramp edge (SEP-12).
 *
 * KYC legally must see PII at the regulated fiat edge — this is custodial,
 * off-chain, and NOT zero-knowledge (Benzo's ZK is in the shielded notes, not
 * the KYC). The default provider is Didit (500 free verifications/month). Swap
 * in others behind the same `KycProvider` interface. `kycFromEnv()` returns a
 * Mock provider when no API key is set, so the testnet corridor runs key-free.
 */

export type KycStatus = "not_started" | "pending" | "approved" | "declined";

export interface KycSession {
  id: string;
  /** hosted verification URL the user is sent to */
  url: string;
}

export interface KycProvider {
  readonly name: string;
  /** Begin a verification for an opaque user reference; returns a hosted session. */
  start(userRef: string): Promise<KycSession>;
  /** Current decision for a session. */
  status(sessionId: string): Promise<KycStatus>;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

function mapDidit(s: string): KycStatus {
  switch ((s || "").toLowerCase().replace(/\s+/g, "_")) {
    case "approved": return "approved";
    case "declined":
    case "expired":
    case "abandoned": return "declined";
    case "in_review":
    case "pending": return "pending";
    default: return "not_started";
  }
}

/** Didit IDV (https://didit.me). Env: DIDIT_API_KEY, optional KYC_CALLBACK_URL. */
export class DiditKyc implements KycProvider {
  readonly name = "didit";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://verification.didit.me",
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly callbackUrl = process.env.KYC_CALLBACK_URL,
  ) {}

  async start(userRef: string): Promise<KycSession> {
    const r = await this.fetchImpl(`${this.baseUrl}/v1/session/`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ vendor_data: userRef, callback: this.callbackUrl }),
    });
    if (!r.ok) throw new Error(`didit start failed: ${r.status}`);
    const j = await r.json();
    return { id: j.session_id ?? j.id, url: j.url ?? j.verification_url };
  }

  async status(sessionId: string): Promise<KycStatus> {
    const r = await this.fetchImpl(`${this.baseUrl}/v1/session/${sessionId}/decision/`, {
      headers: { "x-api-key": this.apiKey },
    });
    if (!r.ok) throw new Error(`didit status failed: ${r.status}`);
    const j = await r.json();
    return mapDidit(j.status ?? j.decision?.status);
  }
}

/** Deterministic mock for testnet/sandbox without an API key. */
export class MockKyc implements KycProvider {
  readonly name = "mock";
  async start(userRef: string): Promise<KycSession> {
    return { id: `mock-${Buffer.from(userRef).toString("hex").slice(0, 12)}`, url: "https://mock.kyc/verify" };
  }
  /** Approves unless the session id contains "fail" (lets demos force a decline). */
  async status(sessionId: string): Promise<KycStatus> {
    return sessionId.includes("fail") ? "declined" : "approved";
  }
}

/** Pick a provider from env: Didit when DIDIT_API_KEY is set, else Mock. */
export function kycFromEnv(env: NodeJS.ProcessEnv = process.env): KycProvider {
  return env.DIDIT_API_KEY ? new DiditKyc(env.DIDIT_API_KEY) : new MockKyc();
}
