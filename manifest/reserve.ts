// R6 (Reviewer R F2): one shared sealed-reserve binding for `benzo verify` and the signer plan
// (settle/plan.ts), so the two cannot drift. Every caller derives the opening fresh from
// manifest.sealed_reserve with its own transport — the signer with the pinned Go tle, verify with
// tlock-js over the authenticated published beacon and Go tle as an independent cross-check — and
// the published opening is accepted only when it equals that fresh derivation. This helper never
// decrypts: it owns the presence and equality rules only.
import { spawnSync } from "node:child_process";
import { requireThat } from "./schema";

// Go tle decryption of one tlock ciphertext; null when the ciphertext is authentic but undecryptable
// (wrong round/chain or tampered), matching the signer's leaf handling and verify's cross-check.
export function tleOpening(tleBin: string, chainHash: string, ciphertextHex: string): string | null {
  const r = spawnSync(tleBin, ["-d", "-c", chainHash],
    { input: Buffer.from(ciphertextHex, "hex"), maxBuffer: 1 << 20 });
  if (r.error) throw r.error;
  if (r.status === 0) return r.stdout.toString("hex");
  const error = r.stderr.toString().trim();
  if (/bad header MAC|failed to decrypt and authenticate payload chunk/.test(error)) return null;
  throw new Error(`tle: ${error || `exit ${r.status}`}`);
}

export function requireReserveOpening(
  m: { sealed_reserve?: string },
  publishedOpening: string | null | undefined,
  derived: string | null,
  tleDerived?: string | null,
): string | null {
  if (m.sealed_reserve === undefined) {
    requireThat(publishedOpening === null || publishedOpening === undefined, "reserve opening without sealed reserve");
    return null;
  }
  requireThat(derived !== null && publishedOpening === derived, "reserve opening published differs from re-derived");
  if (tleDerived !== undefined) requireThat(tleDerived === derived, "reserve opening tle differs");
  return derived!;
}
