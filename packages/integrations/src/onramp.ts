/**
 * Fiat → USDC on-ramp for the corridor's deposit edge (SANDBOX for the hackathon).
 *
 * Stripe's Crypto Onramp supports USDC on Stellar (verified against Stripe's
 * docs: destination network `stellar`, currency `usdc`). It is a hosted,
 * KYC-bearing widget where Stripe is the merchant of record — Benzo never
 * touches card data or PII. We use it in TEST MODE only (test API key, test
 * cards, livemode:false): it demonstrates the card → "buy USDC to your Stellar
 * address" UX. It does NOT settle real testnet USDC — the spendable testnet
 * USDC the user then shields comes from the self-hosted anchor / friendbot.
 *
 * ACCESS: even sandbox/testing requires submitting a Stripe onramp application
 * and being approved (public preview, ~48h). Geography: US/UK/EU; fiat usd/eur.
 * Until approved, onrampFromEnv() stays on MockOnramp and the corridor is
 * unaffected.
 */

export interface OnrampSession {
  id: string;
  /** hosted widget / redirect URL the user completes payment in */
  url: string;
  /** client secret for the embedded flow (Stripe crypto JS SDK) */
  clientSecret?: string;
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
 * Stripe Crypto on-ramp (https://stripe.com/crypto), TEST MODE. Env:
 * STRIPE_SECRET_KEY (use a test key, sk_test_…). Creates a session locked to
 * Stellar + USDC with the user's address pre-filled.
 */
export class StripeOnramp implements OnrampProvider {
  readonly name = "stripe";
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = "https://api.stripe.com",
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async createSession(req: OnrampQuoteRequest): Promise<OnrampSession> {
    // Stripe nests every session parameter under transaction_details[...] and
    // expects application/x-www-form-urlencoded with bracketed arrays. We lock
    // the network + currency to Stellar USDC and pre-fill the wallet address.
    const form = new URLSearchParams();
    form.set("transaction_details[wallet_addresses][stellar]", req.address);
    form.append("transaction_details[destination_networks][]", "stellar");
    form.append("transaction_details[destination_currencies][]", "usdc");
    form.set("transaction_details[destination_network]", "stellar");
    form.set("transaction_details[destination_currency]", "usdc");
    if (req.amount) form.set("transaction_details[source_amount]", req.amount);
    form.set("transaction_details[source_currency]", (req.currency ?? "usd").toLowerCase());

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
    // Hosted flow returns redirect_url; embedded flow uses client_secret with
    // Stripe's crypto JS SDK (loaded from crypto.stripe.com).
    return {
      id: j.id,
      url: j.redirect_url ?? `https://crypto.link.com?session_hash=${j.client_secret}`,
      clientSecret: j.client_secret,
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
