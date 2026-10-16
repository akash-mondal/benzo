// R71 (B37 leak audit, real findings 1–3): evidence never carries a full destination — a refund/output address in
// committed evidence links a payout to its recipient. R73–R77 widened what counts; R78 moved the definition to the
// one shared module (envelope/leak-patterns.ts) that verify's guard and the export audit use too. Addresses keep
// their first 10/last 6 characters (Solana 6/4) so a reader can cross-reference within one evidence directory.
import { findSensitive } from "../../envelope/leak-patterns";

const redactShared = (text: string): string =>
  findSensitive(text)
    .sort((a, b) => b.index - a.index)
    .reduce((t, m, i, all) => {
      if (all.slice(0, i).some((o) => m.index + m.value.length > o.index && m.index < o.index + o.value.length)) return t; // overlap: already redacted
      const short = m.rule === "mnemonic-bip39" ? "[mnemonic redacted]" : m.rule === "solana-address" ? `${m.value.slice(0, 6)}…${m.value.slice(-4)}` : `${m.value.slice(0, 10)}…${m.value.slice(-6)}`;
      return t.slice(0, m.index) + short + t.slice(m.index + m.value.length);
    }, text);
// The 24-word shape heuristic (any 24 lowercase words, even off the BIP39 list) is redacted too: over-redaction is
// harmless in evidence.
const MNEMONIC_SHAPE = /(?<![A-Za-z])(?:[a-z]{3,12}[ \t\r\n]+){23}[a-z]{3,12}(?![A-Za-z])/g;
export const redactAddresses = (text: string): string => redactShared(text).replace(MNEMONIC_SHAPE, "[mnemonic redacted]");
