/**
 * On-device passkey signing (S3) - the consumer wallet's keys live on THIS
 * device, gated by the platform passkey check. No server-side custodial signer.
 *
 * How it works: a WebAuthn passkey with the PRF extension can deterministically
 * derive a stable 32-byte secret for a given salt - the modern "encrypt/derive
 * with a passkey" primitive. We hash the message Benzo signs (NOTE_KEY_MESSAGE)
 * into that salt, take the PRF output as the "signature", and feed it to
 * `accountFromSignedMessage` (the same Railgun-style derivation the rest of the
 * app uses). Same passkey → same shielded account, every unlock, no seed phrase.
 *
 * Fallbacks (kept honest, still non-custodial - the secret never leaves the
 * device): if the authenticator lacks PRF, we generate a device-local random
 * secret at registration and gate access behind a passkey presence check; if
 * WebAuthn is entirely unavailable, we fall back to a device-local secret with
 * no user-verification gate (and the UI hides the lock affordance).
 */
import {
  loginWithSigner,
  NOTE_KEY_MESSAGE,
  type BenzoAccount,
  type SignMessage,
} from "@benzo/core";

const LS_KEY = "benzo.passkey.v1";

interface StoredPasskey {
  /** base64url WebAuthn credential id, or "local" when no authenticator */
  credentialId: string;
  /** hex device-local secret - only set when PRF is unavailable */
  fallbackSecret?: string;
}

// ---- small byte helpers (no extra deps) -----------------------------------
function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
}

// ---- capability detection --------------------------------------------------
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---- local registration record --------------------------------------------
function loadStored(): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as StoredPasskey) : null;
  } catch {
    return null;
  }
}
function saveStored(s: StoredPasskey): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
export function hasPasskey(): boolean {
  return !!loadStored();
}
export function clearPasskey(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when a real (non-"local") authenticator exists on this device to gate
 * access with - i.e. the app lock (Cash App "Security Lock" parity) can require
 * the platform passkey prompt. When false the lock toggles stay disabled (there is
 * nothing to verify against).
 */
export function lockCapable(): boolean {
  const s = loadStored();
  return !!s && s.credentialId !== "local" && isWebAuthnAvailable();
}

/**
 * Passkey presence check for the app lock. Resolves on a successful
 * platform prompt (biometric, device PIN, pattern, or security key), throws if cancelled or failed.
 * No-op (resolves) when there is no authenticator to gate against.
 */
export async function verifyPresence(): Promise<void> {
  const s = loadStored();
  if (!s || s.credentialId === "local" || !isWebAuthnAvailable()) return;
  await assertPresence(s.credentialId);
}

async function saltFor(message: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode("benzo/passkey/v1/" + message));
}

// ---- register --------------------------------------------------------------
/** Create (or adopt) a passkey for this device. Idempotent-ish: re-registers. */
export async function registerPasskey(opts: { userName: string; displayName?: string }): Promise<void> {
  if (!isWebAuthnAvailable()) {
    // No WebAuthn at all - device-local secret, non-custodial, no user-verification gate.
    saveStored({ credentialId: "local", fallbackSecret: toHex(crypto.getRandomValues(new Uint8Array(32))) });
    return;
  }
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Benzo", id: typeof location !== "undefined" ? location.hostname || undefined : undefined },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: opts.userName,
        displayName: opts.displayName ?? opts.userName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      // ask for PRF so we can derive a stable secret
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled");

  const credentialId = toB64url(new Uint8Array(cred.rawId));
  const ext = (cred.getClientExtensionResults?.() ?? {}) as AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean };
  };
  const stored: StoredPasskey = { credentialId };
  if (!ext.prf?.enabled) {
    // Authenticator created but PRF unsupported → device-local secret gated by it.
    stored.fallbackSecret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  }
  saveStored(stored);
}

// ---- derive ----------------------------------------------------------------
async function assertPresence(credentialId: string): Promise<void> {
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: fromB64url(credentialId) as BufferSource }],
      userVerification: "preferred",
      timeout: 60_000,
    },
  });
}

/**
 * Derive a stable per-(device, message) 32-byte secret. The Benzo account is
 * derived from this via `accountFromSignedMessage`. Throws if no passkey exists.
 */
export async function derivePasskeySecret(message: string = NOTE_KEY_MESSAGE): Promise<Uint8Array> {
  const stored = loadStored();
  if (!stored) throw new Error("No passkey on this device. Register first.");

  if (stored.fallbackSecret) {
    // require a platform presence check when an authenticator is present
    if (stored.credentialId !== "local" && isWebAuthnAvailable()) await assertPresence(stored.credentialId);
    return sha256(concat(fromHex(stored.fallbackSecret), new TextEncoder().encode(message)));
  }

  const salt = await saltFor(message);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: fromB64url(stored.credentialId) as BufferSource }],
      userVerification: "preferred",
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey unlock was cancelled");

  const results = (assertion.getClientExtensionResults?.() ?? {}) as AuthenticationExtensionsClientOutputs & {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prfOut = results.prf?.results?.first;
  if (!prfOut) throw new Error("This passkey can't derive keys (PRF unsupported)");
  return new Uint8Array(prfOut);
}

/** A SignMessage backed by the on-device passkey - drop-in for loginWithSigner. */
export const passkeySignMessage: SignMessage = (message) => derivePasskeySecret(message);

/** Unlock (or first-derive) the Benzo shielded account from the device passkey. */
export async function loginWithPasskey(label = "wallet"): Promise<BenzoAccount> {
  return loginWithSigner(passkeySignMessage, label);
}
