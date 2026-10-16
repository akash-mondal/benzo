// R77 proof (Reviewer G G-1): tamper the settlement receipts of a host-custody document that publishes approval maps.
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
const DIR = "docs/evidence/phase-6/markets/launch-r34/launch-cold";
const cases: [string, (r: any[]) => void][] = [
  ["honest", () => {}],
  ["fabricated-txid", (r) => { r[0].txid = "a".repeat(64); }],
  ["swapped-output-index", (r) => { const t = r[0].output_index; r[0].output_index = r[1].output_index; r[1].output_index = t; }],
  ["duplicate-output", (r) => { r[1].output_index = r[0].output_index; }],
];
for (const [name, mutate] of cases) {
  const pub = loadPublicAuction(DIR);
  const receipts = JSON.parse(JSON.stringify(pub.settlement!.receipts));
  mutate(receipts);
  const errs = checkPublicAuction({ ...pub, settlement: { ...pub.settlement!, receipts } }, {}).filter((c) => c.error);
  console.log(`${name}: ${errs.length ? "REFUSED " + errs.map((c) => `${c.id}: ${c.error!.slice(0, 110)}`).join(" | ") : "ACCEPTED"}`);
}
