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
// Head (2026-10-03, live run 9: one transient drand fetch failure aborted the whole signer plan): decrypt with the
// pinned Go tle, failing over across every BNZ_DRAND_URLS endpoint for 3 rounds. A MAC failure means the
// ciphertext is not decryptable at this round (null); only a network failure on every endpoint throws.
const MAC_FAILURE = /bad header MAC|failed to decrypt and authenticate payload chunk/;
export function drandUrls(): string[] {
  return (process.env.BNZ_DRAND_URLS || "https://api.drand.sh").split(",").map(u => u.trim()).filter(Boolean);
}
export function tleDecryptFailover(tleBin: string, chainHash: string, ciphertext: Buffer): Buffer | null {
  const errors: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (const url of drandUrls()) {
      const r = spawnSync(tleBin, ["-d", "-n", url, "-c", chainHash], { input: ciphertext, maxBuffer: 1 << 20 });
      if (r.error) throw r.error;
      if (r.status === 0) return r.stdout;
      const error = r.stderr.toString();
      if (MAC_FAILURE.test(error)) return null;
      errors.push(`${url}: ${error.replace(/You've specified a non-default network endpoint[\s\S]*?--chain flag\.?/, "").trim().slice(-200) || `exit ${r.status}`}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * (round + 1));
  }
  throw new Error(`tle failed on every drand endpoint: ${errors.slice(-drandUrls().length).join(" | ")}`);
}
export function tleOpening(tleBin: string, chainHash: string, ciphertextHex: string): string | null {
  const out = tleDecryptFailover(tleBin, chainHash, Buffer.from(ciphertextHex, "hex"));
  return out === null ? null : out.toString("hex");
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
