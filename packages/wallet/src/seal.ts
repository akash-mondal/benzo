/**
 * Symmetric at-rest sealing for the keychain blob (distinct from the protocol's
 * X25519 note "sealed box" in @benzo/core — this is local disk encryption under
 * a single wrapping key, not a box to a recipient).
 *
 * Format "BNZW" (Benzo Wallet) || nonce(12) || ciphertext+tag — AES-256-GCM.
 * The wrapping key is HKDF-separated from whatever the device unlocks with (a
 * passkey PRF output or a passphrase), so the on-disk key is never the raw
 * secret.
 */
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, concatBytes } from "@noble/hashes/utils";

const MAGIC = Uint8Array.of(0x42, 0x4e, 0x5a, 0x57); // "BNZW"
const NONCE_LEN = 12;

/** Domain-separate the unlock key material into the AEAD key actually used. */
function aeadKey(wrappingKey: Uint8Array): Uint8Array {
  if (wrappingKey.length < 16) throw new Error("wrapping key too short (need >=16 bytes)");
  return hkdf(sha256, wrappingKey, undefined, "benzo/wallet/aead", 32);
}

/** Seal `plaintext` under `wrappingKey` → a self-describing blob. */
export function sealSecret(plaintext: Uint8Array, wrappingKey: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_LEN);
  const ct = gcm(aeadKey(wrappingKey), nonce).encrypt(plaintext);
  return concatBytes(MAGIC, nonce, ct);
}

/** Open a blob from `sealSecret`. Returns null if the key is wrong (AEAD auth
 *  fails) — callers treat null as "bad passphrase / wrong passkey". */
export function openSecret(blob: Uint8Array, wrappingKey: Uint8Array): Uint8Array | null {
  if (blob.length < MAGIC.length + NONCE_LEN || !MAGIC.every((b, i) => blob[i] === b)) return null;
  const nonce = blob.subarray(MAGIC.length, MAGIC.length + NONCE_LEN);
  const ct = blob.subarray(MAGIC.length + NONCE_LEN);
  try {
    return gcm(aeadKey(wrappingKey), nonce).decrypt(ct);
  } catch {
    return null;
  }
}
