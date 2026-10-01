// Gate EN: one dispatch point on the signed manifest's clearing.mode. A new market type is a registry entry —
// pure clear + manifest rules + verify-side money rules + its versioned plaintext layout — never a copy of the
// verify path. `benzo verify`, the read API and signer recomputation all come through here.
import { client, requireThat, type Manifest, type Signed } from "../manifest/schema";
import { clear, checkResultModeA, obligationsModeA, type ClearInput, type ClearResult, type ClearBody } from "./core";
import { clearModeB, clientBuyback, checkResultBuyback, obligationsModeB, type BuybackManifest } from "./mode-b";
import { LAYOUT_V0, type OrderLayout } from "./layout";

export type ModeEntry = {
  layout: OrderLayout; // the versioned plaintext layout this mode's sealed orders use
  client: (packet: Signed, signer: string) => { manifest_hash: string; manifest: unknown };
  clear: (input: ClearInput) => ClearResult;
  checkResult: (manifest: unknown, result: ClearBody) => void;
  obligations: (result: ClearBody) => Map<string, string>;
};

export const registry: Record<string, ModeEntry> = {
  uniform: { layout: LAYOUT_V0, client, clear, checkResult: (m, r) => checkResultModeA(m as Manifest, r), obligations: obligationsModeA },
  vickrey: { layout: LAYOUT_V0, client, clear, checkResult: (m, r) => checkResultModeA(m as Manifest, r), obligations: obligationsModeA },
  buyback: {
    layout: LAYOUT_V0,
    client: clientBuyback,
    clear: clearModeB,
    checkResult: (m, r) => checkResultBuyback(m as BuybackManifest, r),
    obligations: obligationsModeB,
  },
};

// The mode is read from the signed bytes; entry.client re-verifies them against the same --signer anchor, so the
// peek and the signed content can never disagree.
export function modeEntry(packet: Signed): ModeEntry {
  const m = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
  const mode = m?.clearing?.mode;
  requireThat(typeof mode === "string" && registry[mode] !== undefined, `unknown clearing mode ${String(mode)}`);
  return registry[mode]!;
}
export const clientForMode = (packet: Signed, signer: string) => modeEntry(packet).client(packet, signer);
export const clearForMode = (input: ClearInput): ClearResult => modeEntry(input.manifest).clear(input);
