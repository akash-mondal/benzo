/**
 * friendlyError — never put raw CLI/stack/XDR text in front of a person. The BFF
 * already returns plain-English copy (RampError etc.); this is defense in depth so
 * a leaked stellar-cli string or HTTP code can't surface in a toast. Generalizes
 * the looksRaw scrub that started in Cash.tsx.
 */

// Smells of machine output: cli invocations, hex, panics, xdr, sequence/contract jargon.
const RAW = /command failed|stellar |invoke|\s--|0x[0-9a-f]|error\(|panic|sequence|xdr|contract|fetch failed|networkerror|timeout|HTTP \d{3}/i;

/** Human-safe message for any thrown error. Logs the raw cause for debugging. */
export function friendlyError(e: unknown, fallback = "Something went wrong. Your money is safe — please try again."): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!m || RAW.test(m)) {
    if (e) console.error("[benzo]", e); // keep the raw cause for the console
    return fallback;
  }
  return m;
}
