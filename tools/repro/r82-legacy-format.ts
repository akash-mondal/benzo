// Ruling R82 (Reviewer R R-3 on R81): the legacy projection format skips no settlement guard. On the real Phase 3
// evidence (docs/evidence/phase-3/settle/main, a legacy dir) a smuggled row field must be REFUSED, exactly as on a
// current document; and a manifest using any Phase-5+ feature cannot be read as legacy. Offline.
// Build+run: npx esbuild tools/repro/r82-legacy-format.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r82.mjs && node tmp/r82.mjs
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
const SRC = "docs/evidence/phase-3/settle", P3 = "tmp/r82-phase3";
rmSync(P3, { recursive: true, force: true }); mkdirSync(P3, { recursive: true });
for (const f of ["manifest.json", "frozen.json", "result.json", "summary.json"]) copyFileSync(path.join(SRC, "main", f), path.join(P3, f));
copyFileSync(path.join(SRC, "signer.json"), path.join(P3, "signer.json"));
// `clear` needs the beacon-derived openings that `benzo verify --fetch-beacon` supplies (this probe is offline; the real
// Phase 3 verify passes: r15-phase2-4 / mr-verify-phase2-4), so only the settlement checks are judged here.
const errs = (pub: any) => checkPublicAuction(pub, { allowUnattested: true }).filter((c) => c.error && !["claims", "envelope", "clear"].includes(c.id));
const verdict = (pub: any) => { const e = errs(pub); return e.length ? "REFUSED " + e.map((c) => `${c.id}: ${c.error!.slice(0, 90)}`).join(" | ") : "ACCEPTED"; };
const base = loadPublicAuction(P3);
const with_ = (f: (s: any) => void, m?: (x: any) => void) => { const s = JSON.parse(JSON.stringify(base.settlement)); f(s); const man = { ...base.manifest }; m?.(man); return { ...base, manifest: man, settlement: s }; };
console.log(`phase-3 legacy, honest:  ${verdict(base)}`);
console.log(`phase-3 legacy, rows[0].note = "x" (smuggled field):  ${verdict(with_((s) => { s.rows[0].note = "x"; }))}`);
console.log(`phase-3 legacy, rows[0].state = "<UA>":  ${verdict(with_((s) => { s.rows[0].state = "utest1" + "q".repeat(60); }))}`);
console.log(`phase-3 legacy, settlement.auction_id = another id:  ${verdict(with_((s) => { s.auction_id = "ab".repeat(32); }))}`);
console.log(`legacy dir with a Phase-5 feature (bond) in its manifest:  ${verdict(with_(() => {}, (m) => { m.bond = { window_blocks: 1 }; }))}`);
// R83 (Reviewer R R82-1/R82-3): the worker summary's lwd_endpoints is a known field; a receipt names this auction.
console.log(`R83 phase-3 legacy + lwd_endpoints (current worker-summary field):  ${verdict(with_((s) => { s.lwd_endpoints = ["https://testnet.zec.rocks:443"]; }))}`);
console.log(`R83 receipts[0].auction_id = another id:  ${verdict(with_((s) => { s.receipts[0].auction_id = "ab".repeat(32); }))}`);
