/**
 * Fiat → USDC on-ramp for the corridor's deposit edge.
 *
 * This is the symmetric counterpart to the self-hosted SEP-24 anchor: where the
 * anchor simulates the fiat leg for the testnet corridor, a real on-ramp
 * (Stripe Crypto) delivers Circle USDC directly to a Stellar address from a
 * card/bank payment. The on-ramp is a hosted, KYC-bearing widget — Benzo never
 * touches card data. Once USDC lands on the public address, the user shields it.
 */

export interface OnrampSession {
  id: string;
  /** hosted widget / redirect URL the user completes payment in */
  url: string;
}

export interface OnrampQuoteRequest {
  /** destination Stellar address that receives USDC */
  address: string;
  /** fiat amount (e.g. "20.00"); optional — the widget can collect it */
  amount?: string;
  /** fiat currency, default USD */
  currency?: string;
}

export interface OnrampProvider {
  readonly name: string;
  createSession(req: OnrampQuoteRequest): Promise<OnrampSession>;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/**
 * Stripe Crypto on-ramp (https://stripe.com/crypto). Env: STRIPE_SECRET_KEY.
 * Creates an onramp session locked to Stellar + USDC and the user's address.
 */
export class StripeOnramp implements OnrampProvider {
  readonly name = "stripe";
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = "https://api.stripe.com",
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async createSession(req: OnrampQuoteRequest): Promise<OnrampSession> {
    // Stripe expects application/x-www-form-urlencoded with bracketed arrays.
    const form = new URLSearchParams();
    form.set("wallet_addresses[stellar]", req.address);
    form.append("destination_networks[]", "stellar");
    form.append("destination_currencies[]", "usdc");
    form.set("destination_currency", "usdc");
    form.set("destination_network", "stellar");
    if (req.amount) form.set("source_amount", req.amount);
    if (req.currency) form.set("source_currency", req.currency.toLowerCase());

    const r = await this.fetchImpl(`${this.baseUrl}/v1/crypto/onramp_sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!r.ok) throw new Error(`stripe onramp failed: ${r.status}`);
    const j = await r.json();
    return {
      id: j.id,
      url: j.redirect_url ?? `https://crypto.link.com/?session=${j.client_secret}`,
    };
  }
}

/** Key-free default for the testnet corridor. */
export class MockOnramp implements OnrampProvider {
  readonly name = "mock";
  async createSession(req: OnrampQuoteRequest): Promise<OnrampSession> {
    const id = `onramp-${Buffer.from(req.address).toString("hex").slice(0, 12)}`;
    return { id, url: `https://mock.onramp/buy?to=${req.address}` };
  }
}

/** Stripe when STRIPE_SECRET_KEY is set, else the key-free Mock. */
export function onrampFromEnv(env: NodeJS.ProcessEnv = process.env): OnrampProvider {
  return env.STRIPE_SECRET_KEY ? new StripeOnramp(env.STRIPE_SECRET_KEY) : new MockOnramp();
}
