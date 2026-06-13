/**
 * Sponsored reserves (CAP-33) — gasless onboarding.
 *
 * A new Stellar account normally needs ~1 XLM of base reserve before it can
 * exist or hold a USDC trustline. That is the single biggest friction for a
 * web2 user who has never heard of XLM. With sponsored reserves, Benzo's
 * sponsor account pays the reserve while the user's account starts at a 0 XLM
 * balance — the user funds nothing and signs once.
 *
 * The on-chain shape is a three-operation sandwich:
 *   beginSponsoringFutureReserves(sponsoredId = newAccount)   [signed by sponsor]
 *   createAccount(destination = newAccount, startingBalance 0) [signed by sponsor]
 *   endSponsoringFutureReserves()                              [signed by newAccount]
 *
 * Both the sponsor and the new account must sign the resulting transaction
 * (the new account authorizes the end of its own sponsorship). The same pattern
 * extends to sponsoring the USDC trustline and the shielded-note data entries.
 */

import { Operation, type xdr } from "@stellar/stellar-sdk";

export interface SponsoredCreateAccountParams {
  /** sponsor account that pays the base reserve (the tx source) */
  sponsor: string;
  /** the brand-new account being created at zero balance */
  newAccount: string;
  /** starting XLM balance for the new account; "0" since the sponsor covers reserves */
  startingBalance?: string;
}

/**
 * Build the begin/create/end operation sandwich that creates `newAccount`
 * with its base reserve paid by `sponsor`. Pure — returns operations to drop
 * into a TransactionBuilder; the caller loads the source account, sets fee +
 * timebounds, and collects both signatures.
 */
export function sponsoredCreateAccountOps(params: SponsoredCreateAccountParams): xdr.Operation[] {
  const { sponsor, newAccount, startingBalance = "0" } = params;
  return [
    Operation.beginSponsoringFutureReserves({ sponsoredId: newAccount, source: sponsor }),
    Operation.createAccount({ destination: newAccount, startingBalance, source: sponsor }),
    Operation.endSponsoringFutureReserves({ source: newAccount }),
  ];
}

export interface SponsoredTrustlineParams {
  sponsor: string;
  account: string;
  asset: { code: string; issuer: string };
  /** optional trustline limit; omit for the max */
  limit?: string;
}

/**
 * Build a begin/changeTrust/end sandwich so the user's USDC trustline reserve
 * is also paid by the sponsor. Requires importing Asset at the call site to
 * construct the asset; kept here as the canonical operation order.
 */
export function sponsoredTrustlineOps(
  params: SponsoredTrustlineParams,
  asset: Parameters<typeof Operation.changeTrust>[0]["asset"],
): xdr.Operation[] {
  const { sponsor, account, limit } = params;
  return [
    Operation.beginSponsoringFutureReserves({ sponsoredId: account, source: sponsor }),
    Operation.changeTrust({ asset, limit, source: account }),
    Operation.endSponsoringFutureReserves({ source: account }),
  ];
}
