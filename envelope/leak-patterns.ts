// R78 (Reviewer R F-2/F-4 on R77): ONE definition of "a destination, viewing key or seed in text", shared by verify's
// no-destinations guard (api/public-auction.ts), the evidence redactor (e2e/lib/redact.ts) and the export audit
// (tools/leak-audit.ts). Three copies drifted three times (R75, R76, R77); now there is one. Boundaries are "not
// alphanumeric", so an `_` neighbour never hides a match. Audited decoders only (@scure/base, @scure/bip39).
import { base58 } from "@scure/base";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const B = "(?<![0-9A-Za-z])", E = "(?![0-9A-Za-z])";
// Zcash unified/Sapling/TEX/regtest (bech32m, lowercase), transparent P2PKH/P2SH, Sprout; viewing keys; EVM.
export const ZCASH_ADDRESS = `(?:(?:utest1|uregtest1|u1|ztestsapling1|zs1|textest1|tex1)[0-9a-z]{20,}|(?:t1|t2|t3|tm)[1-9A-HJ-NP-Za-km-z]{33}|z[ct][1-9A-HJ-NP-Za-km-z]{90,})`;
export const VIEWING_KEY = `(?:uviewtest1|uview1|uview|zxviewtestsapling1|zxviews1|zxview)[a-zA-Z0-9]{20,}`;
export const EVM_ADDRESS = `0[xX][0-9a-fA-F]{40}`;
export const SOLANA_CANDIDATE = `[1-9A-HJ-NP-Za-km-z]{32,44}`;
// R79 (Reviewer R N-1 on R78): bech32/bech32m strings are case-insensitive by spec — `UTEST1…` is the same address —
// so the Zcash and viewing-key patterns match any case (over-matching base58 t-addrs is harmless). Solana stays exact:
// base58 is case-sensitive and isSolanaKey decodes the candidate.
export const patterns = {
  address: new RegExp(`${B}${ZCASH_ADDRESS}${E}`, "gi"),
  "viewing-key": new RegExp(`${B}${VIEWING_KEY}${E}`, "gi"),
  "evm-address": new RegExp(`${B}${EVM_ADDRESS}${E}`, "g"),
  "solana-address": new RegExp(`${B}${SOLANA_CANDIDATE}${E}`, "g"), // a candidate; isSolanaKey decides
};
// A Solana address is exactly a base58-encoded 32-byte public key.
export function isSolanaKey(token: string): boolean {
  try { return base58.decode(token).length === 32; } catch { return false; }
}
// BIP39 seeds of 12/15/18/21/24 words: a run of 12+ short lowercase words is a candidate, and a window counts when it
// passes the English wordlist and checksum, so prose never matches. Returns [start, end) character spans.
const WORD_RUN = /(?<![A-Za-z])(?:[a-z]{3,8}[ \t\r\n]+){11,}[a-z]{3,8}(?![A-Za-z])/g;
export function mnemonicSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const run of text.toLowerCase().matchAll(WORD_RUN)) { // R79: an uppercased seed is the same seed (ASCII: same offsets)
    const words = [...run[0].matchAll(/[a-z]+/g)];
    for (let i = 0; i < words.length; i++)
      for (const n of [24, 21, 18, 15, 12]) {
        if (i + n > words.length || !validateMnemonic(words.slice(i, i + n).map((w) => w[0]).join(" "), wordlist)) continue;
        spans.push([run.index! + words[i].index!, run.index! + words[i + n - 1].index! + words[i + n - 1][0].length]); i += n - 1; break;
      }
  }
  return spans;
}
// Every sensitive match in text: { rule, index, value }. Solana candidates are kept only when they decode to a key.
export function findSensitive(text: string): { rule: string; index: number; value: string }[] {
  const out: { rule: string; index: number; value: string }[] = [];
  for (const [rule, re] of Object.entries(patterns))
    for (const m of text.matchAll(re)) if (rule !== "solana-address" || isSolanaKey(m[0])) out.push({ rule, index: m.index!, value: m[0] });
  for (const [a, b] of mnemonicSpans(text)) out.push({ rule: "mnemonic-bip39", index: a, value: text.slice(a, b) });
  return out;
}
