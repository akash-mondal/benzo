/**
 * Client-side TEE attestation for the Google sign-in path. The hosted console's
 * /api/auth/* calls are proxied to the Benzo Phala dstack (Intel TDX) enclave,
 * which runs the real RS256-vs-Google-JWKS verifier. THIS is what makes it
 * "TEE-attested" rather than "just another server": before we trust any
 * /auth/google verdict, the browser fetches the enclave's TDX quote and verifies
 * it client-side (dcap-qvl WASM via @benzo/core), pins the code measurement, and
 * binds the verdict to the attested instance (the /auth/google response echoes
 * `encPub`, which must equal the attested X25519 key).
 *
 * HONEST SCOPE: this proves WHICH code verified the Google token (attested-server
 * integrity rooted in TDX hardware) — it is NOT a zero-knowledge proof, and the
 * login is not verified on-chain. The genuinely private part (sub→address, the
 * Google identity never touching the chain) is client-side and unchanged.
 */
import { makeWebAttestationVerifier } from "@benzo/core";

const ENDPOINT = (import.meta.env.VITE_BENZO_PROVER_ENDPOINT as string | undefined)?.replace(/\/$/, "");
const MEASUREMENT = import.meta.env.VITE_BENZO_PROVER_MEASUREMENT as string | undefined;

export interface EnclaveAttestation {
  /** TDX-attested compose-hash of the live enclave, if a quote verified. */
  measurement?: string;
  /** Attested X25519 pubkey; the /auth/google response's `encPub` must equal this. */
  enclavePublicKey?: string;
  /** true ONLY when a quote verified AND its measurement equals the pinned value. */
  attested: boolean;
  /** Strict mode: a measurement is pinned, so a failed/mismatched quote blocks login. */
  pinned: boolean;
  reason?: string;
}

export function authEnclaveEndpoint(): string | undefined {
  return ENDPOINT;
}

let cached: Promise<EnclaveAttestation> | null = null;

/** Attest the auth enclave once per session (cached). Safe to call repeatedly. */
export function attestAuthEnclave(): Promise<EnclaveAttestation> {
  if (!ENDPOINT) return Promise.resolve({ attested: false, pinned: false, reason: "no enclave endpoint configured" });
  if (cached) return cached;
  cached = (async () => {
    try {
      const att = await makeWebAttestationVerifier().verify(ENDPOINT);
      if (!att.ok) return { attested: false, pinned: !!MEASUREMENT, reason: `TDX quote did not verify (TCB ${att.status ?? "?"})` };
      const measurement = att.measurement;
      const enclavePublicKey = att.enclavePublicKey;
      if (!MEASUREMENT) return { attested: false, pinned: false, measurement, enclavePublicKey, reason: "measurement not pinned" };
      if (measurement !== MEASUREMENT) {
        return { attested: false, pinned: true, measurement, enclavePublicKey, reason: `measurement mismatch (got ${measurement?.slice(0, 12)}…, want ${MEASUREMENT.slice(0, 12)}…)` };
      }
      return { attested: true, pinned: true, measurement, enclavePublicKey };
    } catch (e) {
      return { attested: false, pinned: !!MEASUREMENT, reason: String((e as Error).message || e) };
    }
  })();
  return cached;
}
