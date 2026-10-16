// Ruling R78 (Reviewer R F-1/F-2/F-3/F-6/F-7 on R77): each case prints ACCEPTED or REFUSED/THROWS. Offline.
// Build+run: npx esbuild tools/repro/r78-verify-hardening.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r78.mjs && node tmp/r78.mjs
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
import * as modeB from "../../clear/mode-b";
import { Destination } from "../../settle/destination";

const verdict = (pub: any, opts: any = {}) => {
  const e = checkPublicAuction(pub, opts).filter((c) => c.error);
  return e.length ? "REFUSED " + e.map((c) => `${c.id}: ${c.error!.slice(0, 90)}`).join(" | ") : "ACCEPTED";
};
const tamper = (dir: string, f: (s: any) => void) => { const pub = loadPublicAuction(dir); const s = JSON.parse(JSON.stringify(pub.settlement)); f(s); return { ...pub, settlement: s }; };
const NOMAPS = "docs/evidence/phase-5/y2-r28/cold", MAPS = "docs/evidence/phase-6/markets/launch-r34/launch-cold";
// F-1: G's scenario A on a document without host maps.
const fab = (s: any) => { s.receipts[0].txid = "a".repeat(64); s.receipts[0].output_index = 7; };
console.log(`F-1 no-maps fabricated receipt, default (strict):  ${verdict(tamper(NOMAPS, fab))}`);
console.log(`F-1 same, --legacy-unattested (pre-R42 evidence):   ${verdict(tamper(NOMAPS, fab), { allowUnattested: true })}`);
// F-2: destinations the old guard missed, nested in a row.
for (const [k, v] of [["d_t2", "t2" + "N".repeat(33)], ["d_zc", "zc" + "N".repeat(91)], ["note", "refund_utest1" + "q".repeat(40)], ["d_tex", "textest1" + "q".repeat(40)], ["d_vk", "refund_uviewtest1" + "q".repeat(40)]] as const)
  console.log(`F-2 rows[0].${k}:  ${verdict(tamper(MAPS, (s) => { s.rows[0][k] = v; }))}`);
console.log(`F-2 rows[0].reason (a destination in a known field):  ${verdict(tamper(MAPS, (s) => { s.rows[0].state = "t3" + "N".repeat(33); }))}`);
// F-3: pool.
console.log(`F-3 receipts[0].pool = "banana":  ${verdict(tamper(MAPS, (s) => { s.receipts[0].pool = "banana"; }))}`);
console.log(`honest (maps):  ${verdict(loadPublicAuction(MAPS))}`);
// F-6: a duplicated treasury funding scan line.
const m = { confirmations: 1, clearing: { mode: "buyback" }, buyback: { budget_zats: "1", treasury_ua: "utest1t", funding_ua: "utest1fund" } } as any;
const note = { address: "utest1fund", height: 10, value_zats: 1000, txid: "ab".repeat(32), pool: "ironwood", action_index: 0 };
let funded: string; try { funded = String(modeB.treasuryFunded(m, [note, { ...note }], 20)); } catch (e) { funded = `THROWS ${(e as Error).message}`; }
console.log(`F-6 treasuryFunded([note, same note]) = ${funded} (one note is 1000)`);
// F-7: Destination coercion.
const a = new Destination("utest1" + "a".repeat(60)), b = new Destination("utest1" + "b".repeat(60));
const t = (f: () => unknown) => { try { return `= ${String(f())}`; } catch (e) { return `THROWS (${(e as Error).message.slice(0, 40)}…)`; } };
console.log(`F-7 destA + "" ${t(() => (a as any) + "")}; destA == "x" ${t(() => (a as any) == "x")}; +destA ${t(() => +(a as any))}; \`\${destA}\` = ${`${a}`}; destA.equals(destB) = ${a.equals(b)}`);
