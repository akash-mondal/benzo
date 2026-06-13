/**
 * SEP-1 / SEP-10 / SEP-24 client for driving a Benzo (or any) anchor.
 *
 * Used by the corridor e2e to authenticate and open deposit/withdraw flows
 * against the self-hosted anchor. All Stellar signing uses the user's
 * Ed25519 key (Benzo contracts stay auth-agnostic; this is the SEP-10 leg).
 */

import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export interface AnchorClientConfig {
  baseUrl: string; // e.g. http://localhost:8888
  horizonUrl: string;
  networkPassphrase: string;
  usdcCode: string;
  usdcIssuer: string;
}

export interface Sep24Transaction {
  id: string;
  kind: "deposit" | "withdrawal";
  status: string;
  amount_in?: string;
  amount_out?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  stellar_transaction_id?: string;
  message?: string;
}

export class AnchorClient {
  constructor(readonly cfg: AnchorClientConfig) {}

  async toml(): Promise<Record<string, string>> {
    const res = await fetch(`${this.cfg.baseUrl}/.well-known/stellar.toml`);
    const text = await res.text();
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const m = /^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  /** SEP-10: challenge -> sign -> JWT. */
  async authenticate(userSecret: string): Promise<string> {
    const kp = Keypair.fromSecret(userSecret);
    const chRes = await fetch(`${this.cfg.baseUrl}/auth?account=${kp.publicKey()}`);
    const { transaction } = (await chRes.json()) as { transaction: string };
    const tx = TransactionBuilder.fromXDR(transaction, this.cfg.networkPassphrase);
    tx.sign(kp);
    const res = await fetch(`${this.cfg.baseUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: tx.toXDR() }),
    });
    const body = (await res.json()) as { token?: string; error?: string };
    if (!body.token) throw new Error(`SEP-10 failed: ${body.error}`);
    return body.token;
  }

  private auth(jwt: string) {
    return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  }

  async startDeposit(jwt: string, account: string, amount: string): Promise<{ id: string; url: string }> {
    const res = await fetch(`${this.cfg.baseUrl}/sep24/transactions/deposit/interactive`, {
      method: "POST",
      headers: this.auth(jwt),
      body: JSON.stringify({ asset_code: this.cfg.usdcCode, account, amount }),
    });
    return (await res.json()) as { id: string; url: string };
  }

  async startWithdraw(jwt: string, account: string, amount: string): Promise<Sep24Transaction & { url: string }> {
    const res = await fetch(`${this.cfg.baseUrl}/sep24/transactions/withdraw/interactive`, {
      method: "POST",
      headers: this.auth(jwt),
      body: JSON.stringify({ asset_code: this.cfg.usdcCode, account, amount }),
    });
    const r = (await res.json()) as { id: string; url: string };
    const tx = await this.getTransaction(jwt, r.id);
    return { ...tx, url: r.url };
  }

  /** Drive the SIMULATED fiat step. */
  async sim(jwt: string, id: string, payload: Record<string, unknown>): Promise<Sep24Transaction> {
    const res = await fetch(`${this.cfg.baseUrl}/sep24/sim/${id}`, {
      method: "POST",
      headers: this.auth(jwt),
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { transaction?: Sep24Transaction; error?: string };
    if (!body.transaction) throw new Error(`sim failed: ${body.error}`);
    return body.transaction;
  }

  async getTransaction(jwt: string, id: string): Promise<Sep24Transaction> {
    const res = await fetch(`${this.cfg.baseUrl}/sep24/transaction?id=${id}`, {
      headers: this.auth(jwt),
    });
    const body = (await res.json()) as { transaction: Sep24Transaction };
    return body.transaction;
  }

  /** User sends USDC to the anchor's withdraw account with the SEP-24 memo. */
  async sendUsdcToAnchor(
    userSecret: string,
    anchorAccount: string,
    amount: string,
    memo: string,
  ): Promise<string> {
    const horizon = new Horizon.Server(this.cfg.horizonUrl);
    const kp = Keypair.fromSecret(userSecret);
    const acct = await horizon.loadAccount(kp.publicKey());
    const tx = new TransactionBuilder(acct, {
      fee: "10000",
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: anchorAccount,
          asset: new Asset(this.cfg.usdcCode, this.cfg.usdcIssuer),
          amount,
        }),
      )
      .addMemo(Memo.text(memo.slice(0, 28)))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    const res = await horizon.submitTransaction(tx);
    return res.hash;
  }
}

export function anchorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnchorClientConfig {
  const port = env.ANCHOR_PORT ?? "8888";
  return {
    baseUrl: env.ANCHOR_BASE_URL ?? `http://localhost:${port}`,
    horizonUrl: env.HORIZON_URL ?? "https://horizon-testnet.stellar.org",
    networkPassphrase: env.NETWORK_PASSPHRASE ?? Networks.TESTNET,
    usdcCode: env.USDC_CODE ?? "USDC",
    usdcIssuer: env.USDC_ISSUER!,
  };
}
