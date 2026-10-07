// Equivalence proof (gate SC offline half): `planBatches` (settle/batching.ts) must reproduce
// settle/ledger.ts `allocate()` exactly — same batch ids, same parties in the same order — for cap 13
// and cap 28, so the offline bench's batch plan is the settlement ledger's plan.
// Reference = a real Ledger over real SQLite in a temp state dir, driven through its own
// pin/eligible/allocate/stage/confirm methods with every batch marked mined; the expected values come
// from that ledger's output, never from the code under test. No live services, no network, no secrets.
// Repro: npx esbuild tools/repro/batching-equal.ts --bundle --platform=node --format=esm --outfile=tmp/batching-equal.mjs && node tmp/batching-equal.mjs
import { createHash } from "node:crypto";
import { assertScratch } from "./scratch";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Ledger, type Obligation } from "../../settle/ledger";
import { planBatches, type PlanRow } from "../../settle/batching";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// 1,000 synthetic rows. "B…" sorts before "a…" in byte order and after it under localeCompare, so the
// two groups turn any locale-aware ordering red; the last two rows are non-BMP vs BMP, where UTF-16
// code-unit order (JS string `<`) disagrees with UTF-8 byte order (SQLite BINARY).
const rows: PlanRow[] = [];
for (let i = 0; i < 1000; i++) {
  const party = i < 998 ? (i % 2 === 0 ? "B" : "a") + i.toString(16).padStart(4, "0") + "-row" : i === 998 ? "u-\u{1F600}-x" : "u-\uFFFD-x";
  rows.push({ party, amount_zats: String(1000 + i) });
}
const input = [...rows].reverse(); // input order must not matter

function driveLedger(cap: number): { id: number; parties: string[] }[] {
  const state = mkdtempSync(path.join("tmp", "batching-equal-"));
  try {
    const ledger = new Ledger(state, sha(`batching-equal:${cap}`));
    ledger.pin(input.map(r => ({ ...r, kind: "refund" }) as Obligation));
    ledger.eligible();
    const batches: { id: number; parties: string[] }[] = [];
    for (let n = 0; ; n++) {
      const alloc = ledger.allocate(cap);
      if (!alloc) break;
      const file = path.join(state, `batch-${alloc.id}.bin`);
      writeFileSync(file, Buffer.alloc(64, alloc.id));
      const txid = sha(`batching-equal:${cap}:${alloc.id}`);
      ledger.stage(alloc.id, file, txid);
      ledger.confirm(alloc.id, txid, 1000 + alloc.id,
        alloc.outputs.map((o, index) => ({ party: o.party, amount_zats: o.amount_zats, index, pool: "ironwood" })));
      batches.push({ id: alloc.id, parties: alloc.outputs.map(o => o.party) });
    }
    ledger.close();
    return batches;
  } finally {
    rmSync(assertScratch(state), { recursive: true, force: true });
  }
}

for (const cap of [13, 28]) {
  const fromLedger = driveLedger(cap), planned = planBatches(input, cap);
  const at = fromLedger.length === planned.length ? fromLedger.findIndex((b, i) => JSON.stringify(b) !== JSON.stringify(planned[i])) : -2;
  if (at === -1) process.stdout.write(`PASS batching-equal cap=${cap} batches=${planned.length} rows=${rows.length}\n`);
  else {
    const i = at === -2 ? Math.min(fromLedger.length, planned.length) : at;
    process.stderr.write(`ERROR batching-equal-cap${cap} batch ${i + 1}: ledger ${JSON.stringify(fromLedger[i] ?? null)} vs planBatches ${JSON.stringify(planned[i] ?? null)}\n`);
    process.exitCode = 1;
  }
}
