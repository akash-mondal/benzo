// Pure settlement batching — no state, no .env, no wallet, no I/O — so the offline scale bench
// (tools/bench.ts stage `batch-plan`) can plan batches without importing settle/plan.ts (which reads
// live state on import). It reproduces settle/ledger.ts `allocate` exactly: the
// eligible rows ordered by party in SQLite's BINARY (UTF-8 byte) order, cut into batches of `cap`,
// ids from 1, batch-for-batch the same as a real Ledger (byte order, never localeCompare).
import { requireThat } from "../manifest/schema";

export type PlanRow = { party: string; amount_zats: string };
export type PlannedBatch = { id: number; parties: string[] };

export function planBatches(obligations: PlanRow[], cap: number): PlannedBatch[] {
  requireThat(Number.isInteger(cap) && cap >= 1, "batch cap");
  const parties = obligations.map(o => o.party);
  requireThat(parties.every(p => typeof p === "string" && p.length > 0), "settlement party");
  requireThat(new Set(parties).size === parties.length, "unique settlement parties");
  // SQLite `ORDER BY party` is BINARY collation: memcmp over the stored UTF-8 bytes. Buffer.compare
  // over the UTF-8 encoding is that order exactly (JS string `<` is UTF-16 code-unit order and
  // disagrees for non-BMP rows; localeCompare disagrees even for plain ASCII).
  const sorted = [...obligations].sort((a, b) => Buffer.compare(Buffer.from(a.party, "utf8"), Buffer.from(b.party, "utf8")));
  const batches: PlannedBatch[] = [];
  for (let i = 0; i < sorted.length; i += cap)
    batches.push({ id: batches.length + 1, parties: sorted.slice(i, i + cap).map(o => o.party) });
  return batches;
}
