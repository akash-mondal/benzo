import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerPasskey,
  loginWithPasskey,
  hasPasskey,
  clearPasskey,
  createDeviceAuthProof,
  isWebAuthnAvailable,
} from "./passkey.js";
import { verifyStellarSignature } from "@benzo/core";

// ---- a deterministic, PRF-capable mock authenticator ----------------------
function b64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
}

interface MockAuth {
  keys: Map<string, Uint8Array>; // credentialId(b64url) -> internal PRF key
  prf: boolean;
}

function installAuthenticator(prf = true): MockAuth {
  const state: MockAuth = { keys: new Map(), prf };
  (globalThis as any).window = globalThis;
  (globalThis as any).location = { hostname: "localhost" };
  (window as any).PublicKeyCredential = function () {};
  (window as any).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  (globalThis as any).navigator = {
    credentials: {
      async create() {
        const id = crypto.getRandomValues(new Uint8Array(16));
        const key = crypto.getRandomValues(new Uint8Array(32));
        state.keys.set(b64url(id), key);
        return {
          rawId: id.buffer,
          getClientExtensionResults: () => (state.prf ? { prf: { enabled: true } } : {}),
        };
      },
      async get(opts: any) {
        const idBytes = new Uint8Array(opts.publicKey.allowCredentials[0].id);
        const key = state.keys.get(b64url(idBytes));
        const salt = opts.publicKey.extensions?.prf?.eval?.first;
        const results: any = {};
        if (state.prf && key && salt) {
          const out = await sha256(new Uint8Array([...key, ...new Uint8Array(salt)]));
          results.prf = { results: { first: out.buffer } };
        }
        return { getClientExtensionResults: () => results };
      },
    },
  };
  return state;
}

beforeEach(() => {
  // jsdom localStorage persists across tests in a worker - clear it
  try {
    localStorage.clear();
  } catch {
    (globalThis as any).localStorage = {
      _m: new Map<string, string>(),
      getItem(k: string) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k: string, v: string) {
        this._m.set(k, v);
      },
      removeItem(k: string) {
        this._m.delete(k);
      },
      clear() {
        this._m.clear();
      },
    };
  }
  clearPasskey();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("passkey on-device signing (PRF)", () => {
  it("registers, then derives the same Benzo account on every unlock", async () => {
    installAuthenticator(true);
    expect(hasPasskey()).toBe(false);
    await registerPasskey({ userName: "alex" });
    expect(hasPasskey()).toBe(true);

    const a = await loginWithPasskey();
    const b = await loginWithPasskey();
    expect(a.spendSk).toBe(b.spendSk);
    expect(a.spendPub).toBe(b.spendPub);
    expect([...a.mvkSecret]).toEqual([...b.mvkSecret]);
  });

  it("two different passkeys derive different accounts", async () => {
    installAuthenticator(true);
    await registerPasskey({ userName: "alex" });
    const a = await loginWithPasskey();
    clearPasskey();
    await registerPasskey({ userName: "sam" });
    const b = await loginWithPasskey();
    expect(b.spendSk).not.toBe(a.spendSk);
  });

  it("never logs secret material", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    installAuthenticator(true);
    await registerPasskey({ userName: "alex" });
    await loginWithPasskey();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("creates a signed device-auth proof from the derived account", async () => {
    (globalThis as any).location = { hostname: "localhost", origin: "http://localhost:5175" };
    installAuthenticator(true);
    await registerPasskey({ userName: "alex" });
    const account = await loginWithPasskey();

    const proof = createDeviceAuthProof(account, { origin: "http://localhost:5175", ttlSeconds: 3600 });

    expect(proof.address).toBe(account.stellarAddress);
    expect(proof.message).toContain(`address=${account.stellarAddress}`);
    expect(proof.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyStellarSignature(proof.address, proof.message, fromB64url(proof.signature))).toBe(true);
  });
});

describe("passkey fallbacks (still non-custodial)", () => {
  it("derives a stable account when the authenticator lacks PRF", async () => {
    installAuthenticator(false); // authenticator present, no PRF
    await registerPasskey({ userName: "alex" });
    const a = await loginWithPasskey();
    const b = await loginWithPasskey();
    expect(a.spendSk).toBe(b.spendSk);
  });

  it("falls back to a device-local secret with no WebAuthn at all", async () => {
    delete (globalThis as any).window;
    delete (globalThis as any).navigator;
    expect(isWebAuthnAvailable()).toBe(false);
    await registerPasskey({ userName: "alex" });
    const a = await loginWithPasskey();
    const b = await loginWithPasskey();
    expect(a.spendSk).toBe(b.spendSk);
  });
});
