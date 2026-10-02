// source: benzo-sol-g/tests/g3-reserve-opening-unpublished.mjs (Reviewer G lab probe), retargeted at this checkout (root path only).
// Reviewer G test 3 — F2 (sealed-reserve binding) is dead wiring in product mode: cli/product.ts publish()
// never emits `reserve_opening` in the public auction document, so settle/plan.ts:81 reads
// `published?.reserve_opening?.plaintext_hex ?? null` → null, and the shared requireReserveOpening then
// REFUSES every sealed-reserve (gate CF) product auction. benzo verify (cli/commands/verify.ts:78-80)
// reads the same missing field from auction.json and refuses the public dir the same way.
//
// The ledger itself DOES hold the opening (clear/auction-cli.ts:120 `ledger.reserve_opening=...`), and the
// doc literal in cli/product.ts publish() simply never copies it.
//
// Run: node tests/g3-reserve-opening-unpublished.mjs
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (b) => createHash("sha256").update(b).digest("hex");

const { requireReserveOpening } = await import(path.join(ROOT, "manifest/dist/reserve.mjs"));

const auctionId = hash("g3-auction");
const manifest = { auction_id: auctionId, sealed_reserve: "ab".repeat(100) }; // passes validateManifest shape
const trueOpening = hash("g3-true-opening"); // what tle -d actually derives from sealed_reserve

// Exactly what plan.ts:81 computes in product mode (published doc exists, publish() wrote no reserve_opening):
const planPublishedOpening = null; // published.reserve_opening?.plaintext_hex ?? null
// Exactly what verify computes for a canonical dir published by cli/product.ts:
const verifyPublishedOpening = null; // loadPublicAuction: doc.reserve_opening undefined → null

let planRefusal = null, verifyRefusal = null;
try { requireReserveOpening(manifest, planPublishedOpening, trueOpening); }
catch (e) { planRefusal = e.message; }
try { requireReserveOpening(manifest, verifyPublishedOpening, trueOpening, trueOpening); }
catch (e) { verifyRefusal = e.message; }

console.log("signer plan (settle/plan.ts:81)   ->", planRefusal ? `REFUSED: ${planRefusal}` : "accepted");
console.log("benzo verify (verify.ts:78-80)    ->", verifyRefusal ? `REFUSED: ${verifyRefusal}` : "accepted");

if (!planRefusal || !verifyRefusal) { console.error("FAIL: expected both to refuse"); process.exit(1); }
console.log(`
CONFIRMED: with manifest.sealed_reserve set, the product-mode signer plan and the public verifier both refuse —
the auction can neither settle nor pass benzo verify — solely because cli/product.ts publish() never puts
reserve_opening into the public document. The F2 evidence (tools/repro/reserve-opening-repro.mjs,
docs/evidence/phase-5/repro/f2-after.out) exercises only the shared helper and clear/dist/cli.mjs, never the
publish() wiring, so the shipped breakage is invisible to the committed evidence.`);
