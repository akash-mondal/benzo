/**
 * Cross-runtime CSPRNG bytes via the Web Crypto API.
 *
 * `globalThis.crypto.getRandomValues` is available as a global in Node 20+ and
 * every browser, so core never has to import `node:crypto` — keeping the hot
 * path (note blindings, claim secrets) browser-portable. Same CSPRNG quality on
 * both runtimes.
 */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // getRandomValues fills at most 65536 bytes per call; chunk for larger sizes.
  for (let off = 0; off < n; off += 65536) {
    crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, n)));
  }
  return out;
}
