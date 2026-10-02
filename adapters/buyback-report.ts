// Public recurring-window accounting; serial intake is signed by each opened one-time seller key.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, requireThat } from "../manifest/schema";
import { verifyStatement } from "../envelope/index";
import { clearForMode } from "../clear/registry";
import type { CompletePublicAuction } from "../api/public-auction";

export function buybackReport(pub: CompletePublicAuction) {
  const m = pub.manifest, r = pub.result;
  requireThat(r.mode === "buyback" && m.series, "report requires a recurring buyback");
  const fresh = clearForMode({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen,
    opened: pub.opened, reserve_opening: pub.reserveOpening });
  requireThat(jsonBytes(fresh).equals(jsonBytes(r)), "report canonical result differs");
  const file = path.join(pub.dir, "serial-intake.json");
  requireThat(existsSync(file), "missing serial-intake.json");
  const intake = JSON.parse(readFileSync(file, "utf8"));
  requireThat(Array.isArray(intake), "serial intake array");
  const seen = new Set<number>(), leaves = new Set<number>();
  const serials = intake.map((record: any) => {
    requireThat(record && Object.keys(record).sort().join(",") === "auction_id,ciphertext_hash,serials,signature", "serial intake fields");
    const { signature, ...body } = record;
    const leaf = pub.frozen.leaves.find(l => l.ciphertext_hash === body.ciphertext_hash);
    const a = r.allocations.find(a => a.leaf_index === leaf?.leaf_index);
    requireThat(body.auction_id === m.auction_id && leaf && a && a.fill > 0 && !leaves.has(a.leaf_index), "serial intake winner binding");
    leaves.add(a!.leaf_index);
    const pt = pub.opened.find(o => o.leaf_index === a!.leaf_index)?.plaintext_hex;
    requireThat(pt && /^[0-9a-f]{256}$/.test(pt), "serial intake opening");
    requireThat(verifyStatement(Buffer.from(pt!, "hex").subarray(61,93).toString("hex"), body, signature), "serial intake owner signature");
    requireThat(Array.isArray(body.serials) && body.serials.length === a!.fill, "serial intake fill count");
    for (const s of body.serials) {
      requireThat(Number.isSafeInteger(s) && s >= 0 && !seen.has(s), "serial intake duplicate/range"); seen.add(s);
    }
    return { leaf_index: a!.leaf_index, serials: body.serials as number[] };
  }).sort((a: any,b: any) => a.leaf_index-b.leaf_index);
  requireThat(r.allocations.filter(a => a.fill > 0).length === leaves.size, "serial intake missing winner");
  const spent = BigInt(r.conservation.payout_zats) + BigInt(r.conservation.fees_zats);
  return { version: 1, auction_id: m.auction_id, series_id: m.series!.series_id, window_index: m.series!.round_index,
    result_hash: hash(pub.resultBytes), units_bought: seen.size, clearing_price_zats: r.clearing_price_zats,
    ...(r.lots ? { lots: r.lots } : {}), spent_zats: spent.toString(),
    spent_zec: `${spent / 100000000n}.${(spent % 100000000n).toString().padStart(8,"0")}`, serials_taken_in: serials };
}
export function checkBuybackReport(pub: CompletePublicAuction): void {
  const file = path.join(pub.dir, "report.json");
  if (pub.result.mode !== "buyback" || !pub.manifest.series) {
    requireThat(!existsSync(file) && !existsSync(path.join(pub.dir,"serial-intake.json")), "report without recurring buyback"); return;
  }
  requireThat(existsSync(file), "missing report.json");
  requireThat(jsonBytes(JSON.parse(readFileSync(file,"utf8"))).equals(jsonBytes(buybackReport(pub))), "buyback report differs from result/intake");
}
