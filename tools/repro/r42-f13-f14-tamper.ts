// Ruling R42 item 3 (F13/F14, A20 item 3): `benzo verify` is TWO-SIDED over the refund rows. Reviewer R's
// H1/H2 tampers on the live drop-a19 corpus (/tmp copies only) passed the pre-fix verifier: a fabricated PAID
// refund ENTRY + receipt with NO row (F13 — F3 re-opened by omitting the row), and a refund-class RECEIPT with
// no entry and no row (F14 — T1 "nothing is silently stranded" regressed). Post-fix each is refused with its
// own specific ERROR, and the row-keeping control is refused by the per-row attestation.
//
// Assertions (args: <corpus-dir> [verify-bundle.mjs]):
//   f13-f14-baseline-verifies      the UNTAMPERED corpus verifies (the tampers are the only difference);
//   f13-entry-receipt-no-row-refused  H1 refused: `paid refund entry <party> has no settlement row with its amount`;
//   f13-control-row-attested       C1 (entry + receipt + row, no attesting maps) refused by the per-row
//                                  attestation error (the R41.1 binding is not weakened);
//   f14-receipt-only-refused       H2 refused: `unexplained refund receipt <party>: no published paid entry`.
// Red before: this driver run against a pristine fda25b4 archive's own dist/benzo-verify.mjs — H1 and H2
// exit 0 there (the defect), so f13/f14 go ERROR (r42-f13-red-before.out).
// Run: npx esbuild tools/repro/r42-f13-f14-tamper.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r42-f13-f14-tamper.mjs && node tmp/r42-f13-f14-tamper.mjs <corpus-dir> [verify.mjs]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonBytes } from "../../manifest/schema";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
for (const l of execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

const [corpus, verifyBin] = process.argv.slice(2);
if (!corpus) { console.log("usage: node tmp/r42-f13-f14-tamper.mjs <corpus-dir> [verify-bundle.mjs]"); process.exit(2); }
const verify = verifyBin ?? path.join(ROOT, "dist/benzo-verify.mjs");
const doc = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const runVerify = (dir: string, signer: string) => spawnSync(process.execPath, [verify, "--dir", dir, "--signer", signer], { encoding: "utf8", maxBuffer: 64 << 20 });
const errors = (r: { stdout: string | null; stderr: string | null }) => `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter(l => l.startsWith("ERROR"));

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};

const base = doc(path.join(corpus, "auction.json"));
if (!(base.settlement?.balance_refunds ?? []).length) { console.log(`ERROR f13-setup corpus ${corpus} carries no balance_refunds`); process.exit(1); }
console.log(`corpus ${path.basename(corpus)} (${base.auction_id.slice(0, 8)}) entries ${JSON.stringify(base.settlement.balance_refunds)}`);

// Each tamper runs against its own /tmp copy (the reviewer's rule), with the projections rewritten as the
// publisher writes them (canonical bytes) so run("projection") is never what fires.
let n = 0;
const tamper = (mutate: (d: any) => void): string => {
  const dir = path.join(ROOT, `tmp/r42-f13-tamper/${base.auction_id}-${++n}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); cpSync(corpus, dir, { recursive: true });
  const d = doc(path.join(dir, "auction.json"));
  mutate(d);
  writeFileSync(path.join(dir, "auction.json"), jsonBytes(d));
  writeFileSync(path.join(dir, "summary.json"), jsonBytes(d.settlement));
  return dir;
};

const b = runVerify(corpus, base.signer);
line("f13-f14-baseline-verifies", b.status === 0, `verify exit ${b.status}${errors(b).length ? ` (${errors(b).slice(0, 2).join(" | ")})` : ""}`);

const fabParty = `balance-late:${"ab".repeat(32)}:ironwood:2`, fabAmount = "25000", fabTxid = "cd".repeat(32);
const fabReceipt = { auction_id: base.auction_id, party: fabParty, txid: fabTxid, pool: "ironwood", output_index: 2, amount_zats: fabAmount };

// H1 (F13): fabricated PAID entry + receipt, NO settlement row.
const h1 = tamper((d) => {
  d.settlement.balance_refunds.push({ party: fabParty, leaf_index: 0, amount_zats: fabAmount, state: "paid" });
  d.settlement.receipts.push(fabReceipt);
});
const r1 = runVerify(h1, base.signer);
const e1 = errors(r1);
line("f13-entry-receipt-no-row-refused", r1.status !== 0 && e1.some(e => /paid refund entry .* has no settlement row with its amount/.test(e)),
  `H1 exit ${r1.status}; ${e1.slice(0, 3).join(" | ") || "NO ERROR (defect)"}`);

// C1 control (F13): the same fabrication WITH its row — the per-row attestation must still refuse it.
const c1 = tamper((d) => {
  d.settlement.balance_refunds.push({ party: fabParty, leaf_index: 0, amount_zats: fabAmount, state: "paid" });
  d.settlement.receipts.push(fabReceipt);
  d.settlement.rows.push({ party: fabParty, kind: "refund", amount_zats: fabAmount, state: "paid" });
});
const rc = runVerify(c1, base.signer);
const ec = errors(rc);
line("f13-control-row-attested", rc.status !== 0 && ec.some(e => /is not attested by two agreeing host-signed approval maps/.test(e)),
  `C1 exit ${rc.status}; ${ec.slice(0, 3).join(" | ") || "NO ERROR (defect)"}`);

// H2 (F14): a refund-class receipt with no entry and no row.
const h2 = tamper((d) => { d.settlement.receipts.push(fabReceipt); });
const r2 = runVerify(h2, base.signer);
const e2 = errors(r2);
line("f14-receipt-only-refused", r2.status !== 0 && e2.some(e => /unexplained refund receipt .*: no published paid entry/.test(e)),
  `H2 exit ${r2.status}; ${e2.slice(0, 3).join(" | ") || "NO ERROR (defect)"}`);

console.log(all ? "RESULT PASS r42-f13-f14-tamper" : "RESULT FAIL r42-f13-f14-tamper");
process.exitCode = all ? 0 : 1;
