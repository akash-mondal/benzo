/**
 * @benzo/kyc — pluggable KYC provider for the anchor's on-ramp edge (SEP-12).
 *
 * STATUS for the hackathon: MOCK ONLY. `kycFromEnv()` returns MockKyc when no
 * key is set (the default), so NO real identity verification happens and NO PII
 * is collected — the testnet corridor runs entirely on the Mock. There is no
 * real KYC in this project.
 *
 * DiditKyc is an OPTIONAL, FUTURE sandbox integration kept behind the same
 * interface to show where regulated KYC would plug in. It only activates if you
 * deliberately set DIDIT_API_KEY. KYC, when real, must see PII at the regulated
 * fiat edge — it is custodial, off-chain, and NOT zero-knowledge (Benzo's ZK is
 * in the shielded notes, never the KYC).
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
