import { readFileSync } from "node:fs";
import { modeEntry } from "../../clear/registry";
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, "utf8")), m = JSON.parse(Buffer.from(d.manifest.bytes, "base64").toString("utf8"));
  const buyback = m.clearing.mode === "buyback", old = new Map<string, string>();
  for (const a of d.result.allocations) { const o = BigInt(a.refund_zats) + (buyback ? BigInt(a.payment_zats) : 0n); if (o > 0n) old.set(`leaf:${a.leaf_index}`, o.toString()); }
  if (!buyback && BigInt(d.result.conservation.payout_zats) > 0n) old.set("seller", d.result.conservation.payout_zats);
  const now = modeEntry(d.manifest).obligations(d.result, null);
  const same = JSON.stringify([...old].sort()) === JSON.stringify([...now].sort());
  console.log(`${same ? "PASS" : "FAIL"} ${m.clearing.mode} ${JSON.stringify(Object.fromEntries(now))}`);
}
