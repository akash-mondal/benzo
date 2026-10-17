// Ruling R79 (Reviewer R N-1/N-2 and residuals on R78): each case prints ACCEPTED or REFUSED. Offline.
// Build+run: npx esbuild tools/repro/r79-leak-guard.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r79.mjs && node tmp/r79.mjs
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
import { redactAddresses } from "../../e2e/lib/redact";
import * as modeB from "../../clear/mode-b";

const MAPS = "docs/evidence/phase-6/markets/launch-r34/launch-cold";
const verdict = (f: (s: any) => void) => {
  const pub = loadPublicAuction(MAPS); const s = JSON.parse(JSON.stringify(pub.settlement)); f(s);
  const e = checkPublicAuction({ ...pub, settlement: s }).filter((c) => c.error);
  return e.length ? "REFUSED " + e.map((c) => `${c.id}: ${c.error!.slice(0, 80)}`).join(" | ") : "ACCEPTED";
};
const UA = "utest1" + "q".repeat(60);
console.log(`honest:  ${verdict(() => {})}`);
console.log(`N-1 rows[0].state = UTEST1Q… (uppercase):  ${verdict((s) => { s.rows[0].state = UA.toUpperCase(); })}`);
console.log(`N-1 rows[0].state = UVIEWTEST1… (uppercase viewing key):  ${verdict((s) => { s.rows[0].state = ("uviewtest1" + "q".repeat(60)).toUpperCase(); })}`);
console.log(`N-2 batches[0].inspect = {"<address>": "paid"}:  ${verdict((s) => { s.batches[0].inspect = { [UA]: "paid" }; })}`);
console.log(`N-2 batches[0].signing = {"x": {"<ADDRESS>": 1}} (nested key, uppercase):  ${verdict((s) => { s.batches[0].signing = { x: { [UA.toUpperCase()]: 1 } }; })}`);
console.log(`values rows[0].pool = "banana":  ${verdict((s) => { s.rows[0].pool = "banana"; })}`);
console.log(`values rows[0].txid = "zz":  ${verdict((s) => { s.rows[0].txid = "zz"; })}`);
console.log(`values rows[0].kind = "junk":  ${verdict((s) => { s.rows[0].kind = "junk"; })}`);
console.log(`values batches[0].pczt_hash = "zz":  ${verdict((s) => { s.batches[0].pczt_hash = "zz"; })}`);
console.log(`R80 N-3 honest set-aside batch (pczt_hash null, txid null, state exception):  ${verdict((s) => { s.batches.push({ id: 99, pczt_hash: null, txid: null, height: null, state: "exception", inspect: null, signing: null }); })}`);
console.log(`redactor on uppercase UA: ${redactAddresses(`refund ${UA.toUpperCase()}`).includes(UA.toUpperCase()) ? "KEPT (leak)" : "redacted"}`);
const m = { confirmations: 1, clearing: { mode: "buyback" }, buyback: { budget_zats: "1", treasury_ua: "utest1t", funding_ua: "utest1fund" } } as any;
const bare = { address: "utest1fund", height: 10, value_zats: 1000 };
console.log(`F-6 treasuryFunded([bare, same bare]) = ${modeB.treasuryFunded(m, [bare, { ...bare }], 20)} (one note is 1000)`);
