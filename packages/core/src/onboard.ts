/**
 * Sponsored onboarding — assemble + sign + submit the CAP-33 reserve sandwich
 * from reserves.ts so a brand-new user gets a usable account at ZERO XLM with a
 * USDC trustline, both reserves paid by the sponsor. The user funds nothing and
 * signs once.
 *
 * reserves.ts builds the operations; this is the missing piece that loads the
 * sponsor, batches the create-account + trustline sandwiches into one
 * transaction, collects both signatures (sponsor pays; the new account
 * authorizes the end of its own sponsorship + its trustline), and submits.
 *
 * Browser surfaces call a sponsor HTTP endpoint that runs this (the sponsor
 * secret never leaves the server); the CLI runs it directly. Uses only
 * @stellar/stellar-sdk, so it is browser-portable.
 */

import { Asset, BASE_FEE, Horizon, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { sponsoredCreateAccountOps, sponsoredTrustlineOps } from "./reserves.js";

export interface OnboardParams {
  horizonUrl: string;
  networkPassphrase: string;
  /** sponsor account secret — pays both reserves (the deployer/relayer) */
  sponsorSecret: string;
  asset: { code: string; issuer: string };
  /** reuse an existing keypair, or omit to generate a fresh account */
  newAccountSecret?: string;
}

export interface OnboardResult {
  publicKey: string;
  secret: string;
  txHash: string;
}

export async function sponsoredOnboard(params: OnboardParams): Promise<OnboardResult> {
  const sponsor = Keypair.fromSecret(params.sponsorSecret);
  const account = params.newAccountSecret
    ? Keypair.fromSecret(params.newAccountSecret)
    : Keypair.random();
  const server = new Horizon.Server(params.horizonUrl);
  const sponsorAccount = await server.loadAccount(sponsor.publicKey());
  const asset = new Asset(params.asset.code, params.asset.issuer);

  const builder = new TransactionBuilder(sponsorAccount, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  });
  // create the account (reserve sponsored) then add the USDC trustline (reserve
  // sponsored) — both in one atomic transaction; the new account exists by the
  // time its later ops execute.
  for (const op of sponsoredCreateAccountOps({
    sponsor: sponsor.publicKey(),
    newAccount: account.publicKey(),
  })) {
    builder.addOperation(op);
  }
  for (const op of sponsoredTrustlineOps(
    { sponsor: sponsor.publicKey(), account: account.publicKey(), asset: params.asset },
    asset,
  )) {
    builder.addOperation(op);
  }
  const tx = builder.setTimeout(120).build();
  tx.sign(sponsor, account); // sponsor pays reserves; new account authorizes its sponsorship + trustline
  const res = await server.submitTransaction(tx);
  return { publicKey: account.publicKey(), secret: account.secret(), txHash: res.hash };
}
