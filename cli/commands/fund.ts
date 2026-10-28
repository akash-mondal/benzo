// benzo fund quote — the funding helper: NEAR Intents 1Click QUOTE
// only. It calls the 1Click /v0/quote endpoint with `dry: true` always (real quotes, no deposit
// address, no swap, no deposit is ever made by Benzo), targets the bidder's OWN shielded UA in a
// round ZEC amount the USER chooses (never C plus a fee), and prints guidance to wait for the
// funds before bidding. Credentials, if the API ever requires one, come from the environment
// (BNZ_ONECLICK_API_KEY) and are never printed.
export const noun = "fund";
export const verb = "quote";
export const help = [
  "benzo fund quote --from <1click asset id, e.g. nep141:wrap.near> --zec <whole ZEC count> --to <shielded UA> --refund-to <origin-chain address>",
  "   NEAR Intents 1Click quote only (always dry): real quote terms for funding the bidder's own shielded",
  "   UA with a round amount the user chose; Benzo never deposits, swaps or picks the amount. The response",
  "   is printed verbatim; then wait for the funds before bidding.",
].join("\n");

import { classifyDestination } from "../../envelope/destination";

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`usage: ${help}`);
    a[k.slice(2)] = argv[i + 1]?.startsWith("--") ? "true" : (argv[++i] ?? "true");
  }
  return a;
}
const need = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string" || !v) throw new Error(`missing --${k}`);
  return v;
};

// The ZEC side of the intents quote (nep141:zec.omft.near, 8 decimals, from the 1Click /v0/tokens list).
const ZEC_ASSET = "nep141:zec.omft.near";
const ZEC_DECIMALS = 8n;

export async function run(argv: string[]): Promise<number> {
  try {
    const a = parseArgs(argv);
    const from = need(a, "from");
    const zec = need(a, "zec");
    // A round amount the USER chooses — a positive whole number of ZEC. Benzo never sizes the
    // funding (never C plus a fee); a fractional or zero amount is refused here.
    if (!/^[1-9][0-9]*$/.test(zec)) throw new Error(`--zec must be a positive whole number of ZEC (a round amount you chose), got ${zec}`);
    const to = need(a, "to");
    const cls = classifyDestination(to);
    if (cls.kind === "transparent") throw new Error("refused: transparent address (t-addr)");
    if (cls.kind === "tex") throw new Error("refused: TEX address");
    if (!cls.shielded) throw new Error("refused: not a shielded destination");
    const refundTo = need(a, "refund-to");
    const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const amount = (BigInt(zec) * 10n ** ZEC_DECIMALS).toString();
    const body = {
      dry: true, // always: a quote, never a deposit (crosschain.md §5)
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      depositType: "ORIGIN_CHAIN",
      refundType: "ORIGIN_CHAIN",
      refundTo,
      recipientType: "DESTINATION_CHAIN",
      recipient: to,
      deadline,
      originAsset: from,
      destinationAsset: ZEC_ASSET,
      amount,
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.BNZ_ONECLICK_API_KEY) headers["X-API-Key"] = process.env.BNZ_ONECLICK_API_KEY;
    const res = await fetch("https://1click.chaindefuser.com/v0/quote", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const text = await res.text();
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { /* printed verbatim below */ }
    console.log(JSON.stringify({ request: { ...body, amount_zec: zec }, status: res.status, quote: doc ?? text }, null, 2));
    if (!res.ok) {
      process.stderr.write(`ERROR fund quote refused by the 1Click API (HTTP ${res.status}): ${text.slice(0, 300)}\n`);
      return 1;
    }
    console.log("GUIDANCE this is a dry quote only: Benzo never deposits or swaps. Send the funds yourself,");
    console.log("GUIDANCE wait for them to arrive and confirm before bidding — and never fund C plus a fee;");
    console.log("GUIDANCE the amount above is the round amount you chose.");
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR fund ${(e as Error).message}\n`);
    return 1;
  }
}
