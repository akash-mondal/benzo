// Gate EN: one dispatch point on the signed manifest's clearing.mode. A new market type is a registry entry —
// pure clear + manifest rules + verify-side money rules + its versioned plaintext layout — never a copy of the
// verify path. `benzo verify`, the read API and signer recomputation all come through here.
import { client, hash, requireThat, type Manifest, type Signed } from "../manifest/schema";
import { clear, checkResultModeA, obligationsModeA, type ClearInput, type ClearResult, type ClearBody, type SettlementExtras } from "./core";
import { clearModeB, clientBuyback, checkResultBuyback, obligationsModeB, type BuybackManifest } from "./mode-b";
import { OTC_LAYOUT, clientOTC, clearOTC, checkResultOTC, obligationsOTC, type OTCManifest } from "./otc";
import { RFQ_LAYOUT, clientRFQ, clearRFQ, checkResultRFQ, obligationsRFQ, type RFQManifest } from "./rfq";
import { LAUNCH_LAYOUT, clientLaunch, clearLaunch, checkResultLaunch, type LaunchManifest } from "./launch";
import { attachSerials } from "./serials";
import { LAYOUT_V0, type OrderLayout } from "./layout";

export type ModeEntry = {
  layout: OrderLayout; // the versioned plaintext layout this mode's sealed orders use
  client: (packet: Signed, signer: string) => { manifest_hash: string; manifest: unknown };
  clear: (input: ClearInput) => ClearResult;
  checkResult: (manifest: unknown, result: ClearBody) => void;
  obligations: (result: ClearBody, settlement?: SettlementExtras | null) => Map<string, string>;
};

// Ruling R63 (Reviewer R P1-1 on R61): a bond (bond-then-pay, R33/R61 void) is a mode-A feature (uniform/vickrey).
// Every other mode refuses a manifest that carries one — launch delivery, OTC, RFQ and buyback never read the bond.
const noBond = <T extends { manifest: unknown }>(c: (p: Signed, s: string) => T) => (p: Signed, s: string): T => {
  const r = c(p, s);
  requireThat((r.manifest as { bond?: unknown }).bond === undefined, "bond is a uniform/vickrey (mode A) feature only");
  return r;
};
export const registry: Record<string, ModeEntry> = {
  uniform: { layout: LAYOUT_V0, client, clear: input => attachSerials(clear(input), client(input.manifest, input.signer).manifest, input.serial_beacon), checkResult: (m, r) => checkResultModeA(m as Manifest, r), obligations: obligationsModeA },
  vickrey: { layout: LAYOUT_V0, client, clear, checkResult: (m, r) => checkResultModeA(m as Manifest, r), obligations: obligationsModeA },
  otc: { layout: OTC_LAYOUT, client: noBond(clientOTC), clear: clearOTC, checkResult: (m,r) => checkResultOTC(m as OTCManifest,r), obligations: obligationsOTC },
  rfq: { layout: RFQ_LAYOUT, client: noBond(clientRFQ), clear: clearRFQ, checkResult: (m,r) => checkResultRFQ(m as RFQManifest,r), obligations: obligationsRFQ },
  launch: { layout: LAUNCH_LAYOUT, client: noBond(clientLaunch), clear: clearLaunch, checkResult: (m,r) => checkResultLaunch(m as LaunchManifest,r), obligations: obligationsModeA },
  buyback: {
    layout: LAYOUT_V0,
    client: noBond(clientBuyback),
    clear: clearModeB,
    checkResult: (m, r) => checkResultBuyback(m as BuybackManifest, r),
    obligations: obligationsModeB,
  },
};

// The mode is read from the signed bytes; entry.client re-verifies them against the same --signer anchor, so the
// peek and the signed content can never disagree.
export function modeEntry(packet: Signed): ModeEntry {
  // The bytes' integrity is checked before peeking (the same rule and message as verifyRecord), so a tampered packet
  // is refused as "manifest byte hash", never as a JSON parse error (live regression P1 after product moved here).
  const raw = typeof packet?.bytes === "string" ? Buffer.from(packet.bytes, "base64") : Buffer.alloc(0);
  requireThat(typeof packet?.bytes === "string" && raw.toString("base64") === packet.bytes && hash(raw) === packet.sha256, "manifest byte hash");
  const m = JSON.parse(raw.toString("utf8"));
  const mode = m?.clearing?.mode;
  requireThat(typeof mode === "string" && registry[mode] !== undefined, `unknown clearing mode ${String(mode)}`);
  return registry[mode]!;
}
export const clientForMode = (packet: Signed, signer: string) => modeEntry(packet).client(packet, signer);
// H10 (docs/design/phase7-h10-h11.md item 4): the modes whose settlement obligations can include a `seller`
// payout row — every mode using obligationsModeA above (uniform, vickrey, launch). Mainnet `auction create`
// refuses such a manifest without seller_ua_commitment; the modes below (buyback, otc, rfq) never pay a seller row.
export const modePaysSeller = (mode: string): boolean => ["uniform", "vickrey", "launch"].includes(mode);
export const clearForMode = (input: ClearInput): ClearResult => modeEntry(input.manifest).clear(input);
// Design §6.1: the product path (admission, freeze, open, settlement) reads only the fields every mode shares, through
// the mode's own verifying client; the mode-specific fields stay behind the registry entry.
export const clientCommon = (packet: Signed, signer: string) => clientForMode(packet, signer) as { manifest_hash: string; manifest: Manifest };
