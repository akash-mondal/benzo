/**
 * Wallet/transaction screening for the Benzo corridor's compliant edges.
 *
 * STATUS: FUTURE — NOT ACTIVE for the hackathon. The hackathon corridor uses
 * MockScreening (screeningFromEnv returns Mock when no key is set), so NO real
 * sanctions/risk service is ever contacted. Range and Human ID are real
 * integration points kept here to show the compliance design and require the
 * provider's own account to activate. Nothing here runs against real identities.
 *
 * Screening is the ALLOW side of Benzo's two-sided compliance (the DENY side is
 * the on-chain ASP non-membership proof enforced at unshield). It runs at the
 * regulated fiat boundary — never against shielded note contents — and answers
 * one question: may this public Stellar address transact?
 *
 * Two providers, same interface:
 *  - Range  — hosted stablecoin risk/sanctions screening (env RANGE_API_KEY).
 *  - HumanId — proof-of-personhood + sanctions-exclusion read from a Soroban
 *    SBT contract; ZK-native, so the user proves "not sanctioned / unique human"
 *    without revealing identity. Address-keyed (HUMAN_ID_CONTRACT) and injected
 *    with an on-chain reader so this package stays dependency-light + testable.
 */

export type RiskLevel = "clear" | "low" | "medium" | "high" | "blocked";

export interface ScreeningResult {
  /** coarse risk band */
  risk: RiskLevel;
  /** the corridor's go/no-go decision */
  allowed: boolean;
  reason?: string;
}

export interface ScreeningProvider {
  readonly name: string;
  /** Screen a public Stellar address (G...) before it touches the fiat edge. */
  screen(address: string): Promise<ScreeningResult>;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

function bandToRisk(s: string): RiskLevel {
  switch ((s || "").toLowerCase()) {
    case "clear":
    case "none": return "clear";
    case "low": return "low";
    case "medium":
    case "moderate": return "medium";
    case "high":
    case "severe": return "high";
    case "blocked":
    case "sanctioned":
    case "prohibited": return "blocked";
    default: return "medium";
  }
}

/** Range stablecoin screening (https://www.range.org). Env: RANGE_API_KEY. */
export class RangeScreening implements ScreeningProvider {
  readonly name = "range";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.range.org",
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async screen(address: string): Promise<ScreeningResult> {
    const r = await this.fetchImpl(`${this.baseUrl}/v1/risk/address`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ address, network: "stellar" }),
    });
    if (!r.ok) throw new Error(`range screen failed: ${r.status}`);
    const j = await r.json();
    const sanctioned = Boolean(j.sanctioned ?? j.is_sanctioned);
    const risk = sanctioned ? "blocked" : bandToRisk(j.risk_level ?? j.risk ?? j.band);
    return { risk, allowed: !sanctioned && risk !== "high" && risk !== "blocked", reason: j.reason };
  }
}

/** Reads an on-chain answer for `address`; injected so we avoid an SDK dep. */
export type SbtReader = (contractId: string, address: string) => Promise<{ valid: boolean; sanctioned?: boolean }>;

/** Human ID (https://human.tech) — ZK personhood + sanctions, read from a Soroban SBT. */
export class HumanIdScreening implements ScreeningProvider {
  readonly name = "human-id";
  constructor(
    private readonly contractId: string,
    private readonly read: SbtReader,
  ) {}

  async screen(address: string): Promise<ScreeningResult> {
    const { valid, sanctioned } = await this.read(this.contractId, address);
    if (sanctioned) return { risk: "blocked", allowed: false, reason: "human-id: sanctioned" };
    if (!valid) return { risk: "medium", allowed: false, reason: "human-id: no valid personhood SBT" };
    return { risk: "clear", allowed: true };
  }
}

/** Key-free default: clears unless the address looks flagged (lets demos force a block). */
export class MockScreening implements ScreeningProvider {
  readonly name = "mock";
  async screen(address: string): Promise<ScreeningResult> {
    const flagged = /block|sanction|deny/i.test(address);
    return flagged
      ? { risk: "blocked", allowed: false, reason: "mock: flagged address" }
      : { risk: "clear", allowed: true };
  }
}

/** Range when RANGE_API_KEY is set, else the key-free Mock. */
export function screeningFromEnv(env: NodeJS.ProcessEnv = process.env): ScreeningProvider {
  return env.RANGE_API_KEY ? new RangeScreening(env.RANGE_API_KEY) : new MockScreening();
}
