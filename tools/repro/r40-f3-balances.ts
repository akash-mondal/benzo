// Ruling R40 item 4 (F3, A18 item 4): `settlement.balance_refunds` is host-signed data, exactly like
// `defaults`. Reviewer R's F3 (reports/pr-a16-a17-r38.md) tampered the published counts (20,000→25,000) and
// regenerated rows/receipts/summary to agree — the lying coordinator's ordinary publish output — and
// `benzo verify` accepted it (`== verify exit: 0`), because the accounting replays the published values
// self-referentially and no host signature covered them. R40: the counts join the G-4 approval map body and
// verify requires them to equal two agreeing verified maps from distinct pinned signers.
//
// Assertions (args: <corpus-dir> [verify-bundle.mjs]):
//   f3-baseline-verifies  the UNTAMPERED corpus verifies (the tamper below is the only difference);
//   f3-tamper-refused     the tampered corpus is REFUSED with the F3 binding error — red before (the pre-F3
//                         verifier exits 0 on it: Reviewer R's exact finding) and green after, on a corpus
//                         whose maps carry the counts (the A18 live run).
// Run: npx esbuild tools/repro/r40-f3-balances.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r40-f3-balances.mjs && node tmp/r40-f3-balances.mjs <corpus-dir> [verify.mjs]
import { execFileSync, spawnSync } from "node:child_process";
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
console.log(`corpus ${path.basename(corpus)} (${base.auction_id.slice(0, 8)}) balance_refunds ${JSON.stringify(refunds)}`);

// f3-baseline-verifies: the unmodified corpus is accepted by the verifier under test.
const b = runVerify(corpus, base.signer);
line("f3-baseline-verifies", b.status === 0, `verify exit ${b.status}${errors(b).length ? ` (${errors(b).slice(0, 2).join(" | ")})` : ""}`);

// The tamper: the coordinator inflates one published count and regenerates every row/receipt that refers to
// it — internally consistent, nothing else changed. (Legacy corpora merge the count into
// `leaf:<leaf_index>`'s row; new ones carry the per-note `balance-late:` party.) The projections are rewritten
// as the publisher writes them (canonical bytes).
const tampered = path.join(ROOT, `tmp/r40-f3-tamper/${base.auction_id}`);
rmSync(tampered, { recursive: true, force: true }); mkdirSync(tampered, { recursive: true }); cpSync(corpus, tampered, { recursive: true });
const bump = 5000;
{
  const d = doc(path.join(tampered, "auction.json"));
  const list = d.settlement.balance_refunds, rows = d.settlement.rows ?? [], receipts = d.settlement.receipts ?? [];
  for (const [i, r] of list.entries()) {
    const parties = r.party !== undefined ? [r.party] : [`leaf:${r.leaf_index}`];
    r.amount_zats = String(Number(r.amount_zats) + bump);
    for (const p of parties) {
      for (const row of rows) if (row.party === p) row.amount_zats = String(Number(row.amount_zats) + bump);
      for (const rec of receipts) if (rec.party === p) rec.amount_zats = String(Number(rec.amount_zats) + bump);
    }
    if (i === 0) break; // one inflated count is the finding
  }
  writeFileSync(path.join(tampered, "auction.json"), jsonBytes(d));
  writeFileSync(path.join(tampered, "summary.json"), jsonBytes(d.settlement));
}
const t = runVerify(tampered, base.signer);
const errs = errors(t);
const bound = errs.some(e => /balance_refunds (differ from the host-signed approval maps|are not carried by two agreeing host-signed approval maps)/.test(e));
line("f3-tamper-refused", t.status !== 0 && bound,
  `tampered (+${bump}) verify exit ${t.status}; ${bound ? "refused with the F3 binding error" : `no F3 binding error — ${errs.slice(0, 3).join(" | ") || "ACCEPTED (Reviewer R's F3)"}`}`);

console.log(all ? "RESULT PASS r40-f3-balances" : "RESULT FAIL r40-f3-balances");
process.exitCode = all ? 0 : 1;
