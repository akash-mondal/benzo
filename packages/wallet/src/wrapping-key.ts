/**
 * Deriving the keychain wrapping key from what the device can unlock with.
 *
 * Two paths, both yielding 32 bytes:
 *   - Passkey (preferred): a WebAuthn assertion with the PRF extension returns a
 *     32-byte secret bound to the authenticator + a per-wallet salt. The private
 *     key never leaves the secure element; we just HKDF its PRF output. This is
 *     how "unlock with Face ID / a security key" works with no password to
 *     phish.
 *   - Passphrase (fallback / self-host / CLI): memory-hard scrypt over a
 *     passphrase + random salt, so a stolen blob can't be brute-forced cheaply.
 */
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { scrypt } from "@noble/hashes/scrypt";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils";

/** HKDF a 32-byte wrapping key from a WebAuthn PRF output. */
export function prfWrappingKey(prfOutput: Uint8Array): Uint8Array {
  if (prfOutput.length < 32) throw new Error("PRF output too short (need >=32 bytes)");
  return hkdf(sha256, prfOutput, undefined, "benzo/wallet/prf-wrap", 32);
}

/** A fresh 16-byte salt to persist alongside a passphrase-wrapped blob. */
export function newSalt(): Uint8Array {
  return randomBytes(16);
}

/**
 * scrypt(passphrase, salt) → 32-byte wrapping key. N=2^15 balances "interactive
 * unlock" against brute-force cost; bump for higher-value wallets.
 */
export function passphraseWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  opts: { N?: number; r?: number; p?: number } = {},
): Uint8Array {
  if (!passphrase) throw new Error("empty passphrase");
  return scrypt(utf8ToBytes(passphrase), salt, {
    N: opts.N ?? 2 ** 15,
    r: opts.r ?? 8,
    p: opts.p ?? 1,
    dkLen: 32,
  });
}

/**
 * Request a WebAuthn PRF secret (browser only). `getAssertion` is injected so
 * this stays testable and so the host app controls credential selection; in a
 * real app it calls `navigator.credentials.get({ publicKey: { …, extensions:
 * { prf: { eval: { first: salt } } } } })` and returns the resulting
 * `getClientExtensionResults().prf.results.first`. Returns the wrapping key.
 */
export async function passkeyWrappingKey(
  salt: Uint8Array,
  getAssertion: (salt: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const prfOutput = await getAssertion(salt);
  return prfWrappingKey(prfOutput);
}
