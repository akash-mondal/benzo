import { base58 } from "@scure/base";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

// R71 (B37 leak audit, real findings 1–3): evidence never carries a full shielded or transparent destination — a
// refund/output address in committed evidence links a payout to its recipient. Writers that capture raw tool output
// pass it through here; the abbreviated form keeps enough to cross-reference within one evidence directory.
// R73: + P2SH t2/t3, sprout zc. R75 (Reviewer R P2 on R74): + textest1, viewing keys (uview/zxview), EVM 0x+40 hex.
// R77 (Reviewer R P2 on R76): "not alphanumeric" boundaries, so an `_` neighbour (`refund_utest1…`) cannot hide one.
const ADDRESS = /(?<![0-9A-Za-z])(?:utest1|u1|ztestsapling1|zs1|zc|tm|t1|t2|t3|tex1|textest1|uviewtest1|uview1|zxviewtestsapling1|zxviews1)[0-9a-z]{30,}(?![0-9A-Za-z])|(?<![0-9A-Za-z])0x[0-9a-f]{40}(?![0-9A-Za-z])/gi;
// R76 (Reviewer R P2 on R75): Solana keys (any base58 token that decodes to 32 bytes) and 24-word mnemonics too.
const SOLANA = /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![0-9A-Za-z])/g, MNEMONIC = /\b(?:[a-z]{3,12}[ \t\r\n]+){23}[a-z]{3,12}\b/g;
const isKey = (t: string) => { try { return base58.decode(t).length === 32; } catch { return false; } };
// R77 (Reviewer R P2 on R76): BIP39 seeds of 12/15/18/21/24 words. A run of 12+ short lowercase words is only a
// candidate; it counts when some window of a BIP39 length passes the English wordlist and checksum (audited
// @scure/bip39), so ordinary prose never matches. Returns [start, end) character spans.
const WORD_RUN = /(?<![A-Za-z])(?:[a-z]{3,8}[ \t\r\n]+){11,}[a-z]{3,8}(?![A-Za-z])/g;
export function mnemonicSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const run of text.matchAll(WORD_RUN)) {
    const words = [...run[0].matchAll(/[a-z]+/g)];
    for (let i = 0; i < words.length; i++)
      for (const n of [24, 21, 18, 15, 12]) {
        if (i + n > words.length) continue;
        if (validateMnemonic(words.slice(i, i + n).map((w) => w[0]).join(" "), wordlist)) {
          spans.push([run.index! + words[i].index!, run.index! + words[i + n - 1].index! + words[i + n - 1][0].length]); i += n - 1; break;
        }
      }
  }
  return spans;
}
const redactMnemonics = (text: string) => mnemonicSpans(text).reverse().reduce((t, [a, b]) => t.slice(0, a) + "[mnemonic redacted]" + t.slice(b), text);
export const redactAddresses = (text: string): string => redactMnemonics(text)
  .replace(ADDRESS, (a) => `${a.slice(0, 10)}…${a.slice(-6)}`)
  .replace(SOLANA, (a) => (isKey(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a))
  .replace(MNEMONIC, "[mnemonic redacted]");
