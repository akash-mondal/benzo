import { base58 } from "@scure/base";

// R71 (B37 leak audit, real findings 1–3): evidence never carries a full shielded or transparent destination — a
// refund/output address in committed evidence links a payout to its recipient. Writers that capture raw tool output
// pass it through here; the abbreviated form keeps enough to cross-reference within one evidence directory.
// R73: + P2SH t2/t3, sprout zc. R75 (Reviewer R P2 on R74): + textest1, viewing keys (uview/zxview), EVM 0x+40 hex.
// R77 (Reviewer R P2 on R76): "not alphanumeric" boundaries, so an `_` neighbour (`refund_utest1…`) cannot hide one.
const ADDRESS = /(?<![0-9A-Za-z])(?:utest1|u1|ztestsapling1|zs1|zc|tm|t1|t2|t3|tex1|textest1|uviewtest1|uview1|zxviewtestsapling1|zxviews1)[0-9a-z]{30,}(?![0-9A-Za-z])|(?<![0-9A-Za-z])0x[0-9a-f]{40}(?![0-9A-Za-z])/gi;
// R76 (Reviewer R P2 on R75): Solana keys (any base58 token that decodes to 32 bytes) and 24-word mnemonics too.
const SOLANA = /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![0-9A-Za-z])/g, MNEMONIC = /\b(?:[a-z]{3,12}[ \t\r\n]+){23}[a-z]{3,12}\b/g;
const isKey = (t: string) => { try { return base58.decode(t).length === 32; } catch { return false; } };
export const redactAddresses = (text: string): string => text
  .replace(ADDRESS, (a) => `${a.slice(0, 10)}…${a.slice(-6)}`)
  .replace(SOLANA, (a) => (isKey(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a))
  .replace(MNEMONIC, "[mnemonic redacted]");
