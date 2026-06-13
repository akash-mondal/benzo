import { describe, it, expect } from "vitest";
import { accountFromSignedMessage, accountFromClaimSecret, loginWithSigner, NOTE_KEY_MESSAGE } from "../src/account.js";

const sig = new Uint8Array(64).fill(7);
const sig2 = new Uint8Array(64).fill(9);

describe("note keys from one signed message (Railgun pattern)", () => {
  it("is deterministic — the same signature recovers the same account", () => {
    const a = accountFromSignedMessage(sig);
    const b = accountFromSignedMessage(sig);
    expect(a.spendSk).toBe(b.spendSk);
    expect(Buffer.from(a.mvkSecret)).toEqual(Buffer.from(b.mvkSecret));
    expect(Buffer.from(a.viewSecret)).toEqual(Buffer.from(b.viewSecret));
  });
  it("different signatures yield different accounts", () => {
    expect(accountFromSignedMessage(sig).spendSk).not.toBe(accountFromSignedMessage(sig2).spendSk);
  });
  it("is domain-separated from claim-link derivation (same bytes ≠ same keys)", () => {
    expect(accountFromSignedMessage(sig).spendSk).not.toBe(accountFromClaimSecret(sig).spendSk);
  });
  it("exposes the canonical signing message", () => {
    expect(NOTE_KEY_MESSAGE).toBe("BENZO-NOTE-KEY-v1");
  });
});

describe("loginWithSigner — the headless wallet login seam", () => {
  it("signs NOTE_KEY_MESSAGE and yields the same account as direct derivation", async () => {
    let signed = "";
    const signer = (m: string) => { signed = m; return sig; };
    const acct = await loginWithSigner(signer);
    expect(signed).toBe(NOTE_KEY_MESSAGE);
    expect(acct.spendSk).toBe(accountFromSignedMessage(sig).spendSk);
  });
  it("accepts an async signer (embedded wallets resolve a promise)", async () => {
    const acct = await loginWithSigner(async () => sig2);
    expect(acct.spendSk).toBe(accountFromSignedMessage(sig2).spendSk);
  });
});
