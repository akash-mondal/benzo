// Ruling R40 item 4 (F3, A18 item 4) as re-ruled by R41 item 1 (F7, A19 item 1): the published refund-row counts
// are host-attested PER ROW, in the approval of the batch that pays the row (its `balance_refunds` carry just the
// rows that batch pays). Reviewer R's F3 (reports/pr-a16-a17-r38.md) tampered the published counts (20,000→25,000)
// and regenerated rows/receipts/summary to agree — the lying coordinator's ordinary publish output — and
// `benzo verify` accepted it, because no host signature covered them. Post-R41 the binding is the paying batch's
// two agreeing maps: a fabricated or inflated PAID count is refused with its own error. An UNPAID row publishes
// as `pending` with counts only and verify does not count it (R41.1), so the tamper below must hit a PAID entry.
//
// Assertions (args: <corpus-dir> [verify-bundle.mjs]):
//   f3-baseline-verifies  the UNTAMPERED corpus verifies (the tamper below is the only difference);
//   f3-tamper-refused     the tampered corpus is REFUSED with the attestation error — red before (the pre-F3
//                         verifier exits 0 on it: Reviewer R's exact finding) and green after, on a corpus whose
//                         maps attest the paid rows (the A19 live run).
// Run: npx esbuild tools/repro/r40-f3-balances.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r40-f3-balances.mjs && node tmp/r40-f3-balances.mjs <corpus-dir> [verify.mjs]
import { execFileSync, spawnSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonBytes } from "../../manifest/schema";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r40-f3-balances.mjs (tools/repro/r40-f3-balances.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const [corpus, verifyBin] = process.argv.slice(2);
if (!corpus) { console.log("usage: node tmp/r40-f3-balances.mjs <corpus-dir> [verify-bundle.mjs]"); process.exit(2); }
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
const refunds = base.settlement?.balance_refunds ?? [];
if (!refunds.length) { console.log(`ERROR f3-setup corpus ${corpus} carries no balance_refunds`); process.exit(1); }
// R41.1: the tamper must inflate a PAID row (pending counts are ruled unbound); the A19 corpora always pay one.
const paidRows = refunds.filter((r: any) => r.state === "paid");
if (!paidRows.length) { console.log(`ERROR f3-setup corpus ${corpus} has no PAID refund row (R41.1: pending counts are not counted)`); process.exit(1); }
console.log(`corpus ${path.basename(corpus)} (${base.auction_id.slice(0, 8)}) balance_refunds ${JSON.stringify(refunds)}`);

// f3-baseline-verifies: the unmodified corpus is accepted by the verifier under test.
const b = runVerify(corpus, base.signer);
line("f3-baseline-verifies", b.status === 0, `verify exit ${b.status}${errors(b).length ? ` (${errors(b).slice(0, 2).join(" | ")})` : ""}`);

// The tamper: the coordinator inflates one published count and regenerates every row/receipt that refers to
// it — internally consistent, nothing else changed. (Legacy corpora merge the count into
// `leaf:<leaf_index>`'s row; new ones carry the per-note `balance-late:` party.) The projections are rewritten
// as the publisher writes them (canonical bytes).
const tampered = path.join(ROOT, `tmp/r40-f3-tamper/${base.auction_id}`);
rmSync(assertScratch(tampered), { recursive: true, force: true }); mkdirSync(tampered, { recursive: true }); cpSync(corpus, tampered, { recursive: true });
const bump = 5000;
{
  const d = doc(path.join(tampered, "auction.json"));
  const list = d.settlement.balance_refunds, rows = d.settlement.rows ?? [], receipts = d.settlement.receipts ?? [];
  for (const r of list) {
    if (r.state !== "paid") continue; // R41.1: pending counts are not counted — the tamper hits the attested rows
    const parties = r.party !== undefined ? [r.party] : [`leaf:${r.leaf_index}`];
    r.amount_zats = String(Number(r.amount_zats) + bump);
    for (const p of parties) {
      for (const row of rows) if (row.party === p) row.amount_zats = String(Number(row.amount_zats) + bump);
      for (const rec of receipts) if (rec.party === p) rec.amount_zats = String(Number(rec.amount_zats) + bump);
    }
    break; // one inflated count is the finding
  }
  writeFileSync(path.join(tampered, "auction.json"), jsonBytes(d));
  writeFileSync(path.join(tampered, "summary.json"), jsonBytes(d.settlement));
}
const t = runVerify(tampered, base.signer);
const errs = errors(t);
// Ruling R45.5-Q14 (F24): re-target, do not widen — match ONLY the entry-side wording this tamper
// deterministically hits (A20's two-sided balance-refs F13/F14).
const bound = errs.some(e => /paid refund entry .* is not attested by two agreeing host-signed approval maps of its paying batch/.test(e));
line("f3-tamper-refused", t.status !== 0 && bound,
  `tampered (+${bump} on a PAID row) verify exit ${t.status}; ${bound ? "refused with the per-row attestation error" : `no attestation error — ${errs.slice(0, 3).join(" | ") || "ACCEPTED (Reviewer R's F3)"}`}`);

console.log(all ? "RESULT PASS r40-f3-balances" : "RESULT FAIL r40-f3-balances");
process.exitCode = all ? 0 : 1;
