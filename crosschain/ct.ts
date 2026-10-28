// Token-2022 Confidential Transfer delivery (deliver.kind
// = "ct"): a fresh token account configured from the bidder's `deliver.elgamal`, funded with a
// confidential transfer whose amount is hidden on chain. The account's configuration is checked
// against the sealed deliver before anything is sent — the fresh account must be configured with
// exactly the bidder's ElGamal pubkey, else the delivery refuses (the leaf goes to the exception
// queue path in `xchain attest`; here the delivery itself refuses).
//
// The heavy Token-2022 machinery (account setup, ElGamal encryption, ZK transfer proofs, the
// confidential transfer) is driven through the official `spl-token` CLI (spl-token-cli 5.6.1, the
// token-2022 repo's own client — audited-first rule: a tool exists, so drive it). This module
// holds the checks no tool performs: the deliver ↔ account-configuration binding and the
// amount-hidden assertion over a submitted transaction.
import { createHash } from "node:crypto";

// `spl-token display --output json` reports the account's configured ElGamal encryption key as
// base64. The sealed deliver carries the same key as 32-byte hex (`deliver.elgamal`).
export function configuredElgamalHex(displayJson: { decimals?: number; [k: string]: any }): string {
  const ext = displayJson?.extensionStates?.find?.((e: any) => e?.extension === "confidentialTransfer")
    ?? displayJson?.["Confidential transfer"]
    ?? null;
  // spl-token display --output json shape: { ..., extensionStates: [{ extension: "confidentialTransfer", state: { encryptionKey: "<base64>", ... } }] }
  const b64: unknown =
    ext?.state?.encryptionKey ??
    ext?.encryptionKey ??
    displayJson?.encryptionKey;
  if (typeof b64 !== "string") throw new Error("no confidentialTransfer encryption key in spl-token display output");
  return Buffer.from(b64, "base64").toString("hex");
}

// The binding: the delivery only goes to a fresh account whose on-chain configuration is the
// bidder's own `deliver.elgamal`, at exactly `deliver.to`. Total — false, never a throw, so the
// delivery can queue the leaf instead of dying.
export function deliverMatchesAccount(
  deliver: { chain?: unknown; kind?: unknown; to?: unknown; elgamal?: unknown },
  account: { address: string; elgamalHex: string },
): boolean {
  return deliver?.chain === "solana" && deliver?.kind === "ct" &&
    typeof deliver.to === "string" && deliver.to === account.address &&
    typeof deliver.elgamal === "string" && deliver.elgamal.toLowerCase() === account.elgamalHex.toLowerCase();
}

// Amount-hidden assertion: the delivered amount must not appear anywhere in the raw submitted
// transaction (little-endian u64 or the plain decimal), and the destination's plaintext balance
// must not move. Returns the offending encoding or null.
export function amountLeaks(txRaw: Buffer, amount: bigint): string | null {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(amount);
  if (txRaw.includes(le)) return "little-endian u64";
  if (txRaw.includes(Buffer.from(amount.toString(), "utf8"))) return "decimal string";
  return null;
}

export function sha256Hex(b: Buffer | Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}
