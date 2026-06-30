/**
 * Node-side TDX quote verification via @phala/dcap-qvl (native). Kept in its own
 * module so the browser graph never imports the Node `@phala/dcap-qvl` (which
 * pulls Buffer/node-fetch). Browsers use attestation-web.ts instead.
 */
import {
  DstackAttestationVerifier,
  type QuoteVerifier,
  type DstackVerifierOptions,
} from "./attestation.js";

const toHex = (u8: Uint8Array): string =>
  Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string): Uint8Array => {
  const c = (s || "").replace(/^0x/, "");
  const out = new Uint8Array(c.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16);
  return out;
};

type QvlVerifiedReport = {
  status: unknown;
  report: {
    asTd10?: () => { rtMr3: Uint8Array; mrTd: Uint8Array; mrConfigId: Uint8Array; reportData: Uint8Array } | undefined;
    asTd15?: () => { base: { rtMr3: Uint8Array; mrTd: Uint8Array; mrConfigId: Uint8Array; reportData: Uint8Array } } | undefined;
  };
};

function reduceVerifiedReport(verified: QvlVerifiedReport) {
  const td = verified.report.asTd10?.() ?? verified.report.asTd15?.()?.base;
  if (!td) throw new Error("quote is not a TDX (td10/td15) report");
  return {
    status: String(verified.status),
    rtmr3: toHex(td.rtMr3),
    mrtd: toHex(td.mrTd),
    mrConfigId: toHex(td.mrConfigId),
    reportData: Uint8Array.from(td.reportData),
  };
}

/** Default Node verifier: dcap-qvl against Intel collateral (via Phala PCCS). */
export const dcapQuoteVerifier: QuoteVerifier = async (quoteHex, collateral) => {
  const qvl = await import("@phala/dcap-qvl");
  const bytes = fromHex(quoteHex);
  const raw = Buffer.from(bytes);
  if (collateral) {
    return reduceVerifiedReport(qvl.verify(raw, collateral as never, Math.floor(Date.now() / 1000)) as QvlVerifiedReport);
  }

  let last: unknown;
  for (const pccs of [undefined, qvl.PHALA_PCCS_URL, qvl.INTEL_PCS_URL]) {
    try {
      return reduceVerifiedReport((await qvl.getCollateralAndVerify(raw, pccs)) as QvlVerifiedReport);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("quote collateral verification failed");
};

/** A `DstackAttestationVerifier` wired to the Node dcap-qvl verifier. */
export function makeNodeAttestationVerifier(
  opts: Omit<DstackVerifierOptions, "verifyQuote"> = {},
): DstackAttestationVerifier {
  return new DstackAttestationVerifier({ ...opts, verifyQuote: dcapQuoteVerifier });
}
