/**
 * Circle CCTP V2 attestation client — native cross-chain USDC into Stellar.
 *
 * CCTP moves *real* USDC (burn-and-mint, not a wrapped bridge asset) between
 * chains. For Benzo this is the "bring USDC from Ethereum/Base/etc. onto
 * Stellar, then shield it" path. The cross-chain crux — and the only off-chain,
 * keyable step — is fetching Circle's attestation for the burn message: the
 * source chain burns USDC and emits a message; Circle's Iris service attests
 * it; the destination chain mints against that attestation.
 *
 * This client owns that attestation step (the on-chain burn/mint are SDK calls
 * on each chain). Iris testnet (sandbox) needs no key; mainnet may.
 */

export type AttestationStatus = "pending" | "complete" | "failed";

export interface Attestation {
  status: AttestationStatus;
  /** hex attestation bytes to pass to the destination mint (when complete) */
  attestation?: string;
}

/** Circle CCTP domain ids (subset Benzo cares about). Stellar = 16. */
export const CCTP_DOMAINS = {
  ethereum: 0,
  avalanche: 1,
  base: 6,
  stellar: 16,
} as const;

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface CctpClient {
  readonly name: string;
  /** Poll Circle for the attestation of a burn message hash. */
  getAttestation(messageHash: string): Promise<Attestation>;
}

/** Circle Iris attestation service. Env: CIRCLE_API_KEY (optional on sandbox). */
export class CircleCctp implements CctpClient {
  readonly name = "circle";
  constructor(
    private readonly baseUrl = "https://iris-api-sandbox.circle.com",
    private readonly apiKey = process.env.CIRCLE_API_KEY,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async getAttestation(messageHash: string): Promise<Attestation> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const r = await this.fetchImpl(`${this.baseUrl}/v1/attestations/${messageHash}`, { headers });
    if (r.status === 404) return { status: "pending" };
    if (!r.ok) throw new Error(`circle attestation failed: ${r.status}`);
    const j = await r.json();
    const status: AttestationStatus =
      j.status === "complete" ? "complete" : j.status === "failed" ? "failed" : "pending";
    return { status, attestation: status === "complete" ? j.attestation : undefined };
  }
}

/** Key-free default: returns a complete attestation immediately. */
export class MockCctp implements CctpClient {
  readonly name = "mock";
  async getAttestation(messageHash: string): Promise<Attestation> {
    return { status: "complete", attestation: `0xmock-${messageHash.slice(0, 8)}` };
  }
}

/** Circle when CIRCLE_API_KEY is set, else the key-free Mock. */
export function cctpFromEnv(env: NodeJS.ProcessEnv = process.env): CctpClient {
  return env.CIRCLE_API_KEY ? new CircleCctp(undefined, env.CIRCLE_API_KEY) : new MockCctp();
}
