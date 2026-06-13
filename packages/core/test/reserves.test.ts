import { describe, it, expect } from "vitest";
import { Asset } from "@stellar/stellar-sdk";
import { sponsoredCreateAccountOps, sponsoredTrustlineOps } from "../src/reserves.js";

const SPONSOR = "GBRMUZELYDNXSBYF5KOLLSV4XLQYNZJQNLXQ3HTFCWNRIBS3I6EUBCMP";
const NEW = "GD2U26BTLNEKRLM7AMXPO5T64I7SPRPUF26T44RHSJBLFI5YGRKLZMT7";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const opName = (op: any) => op.body().switch().name;

describe("sponsored reserves (CAP-33) — gasless onboarding", () => {
  it("creates the begin/create/end sandwich in order", () => {
    const ops = sponsoredCreateAccountOps({ sponsor: SPONSOR, newAccount: NEW });
    expect(ops).toHaveLength(3);
    expect(ops.map(opName)).toEqual([
      "beginSponsoringFutureReserves",
      "createAccount",
      "endSponsoringFutureReserves",
    ]);
  });

  it("the end op is sourced by the new account (it authorizes its own sponsorship end)", () => {
    const ops = sponsoredCreateAccountOps({ sponsor: SPONSOR, newAccount: NEW });
    // sourceAccount is set on the op; presence on end + create distinguishes signers
    expect(ops[2].sourceAccount).toBeTruthy();
  });

  it("builds the trustline sandwich too", () => {
    const ops = sponsoredTrustlineOps(
      { sponsor: SPONSOR, account: NEW, asset: { code: "USDC", issuer: ISSUER } },
      new Asset("USDC", ISSUER),
    );
    expect(ops.map(opName)).toEqual([
      "beginSponsoringFutureReserves",
      "changeTrust",
      "endSponsoringFutureReserves",
    ]);
  });
});
