// Ruling R45 (F20): the pure decision of what a failed `sign build` means — extracted from settle/cli.ts so
// the lab repro (tools/repro/r45-f20.ts) drives the exact shipped rule at its real boundary.
// A host counts as REFUSING only on its typed refusal (`sign build` exit 3 listing the rows it cannot derive);
// a timeout, kill or any other failure is "unreachable" and the batch is retried, never condemned. The batch
// is unbuildable only when EVERY reached host gave a typed refusal, and only the rows NO reached host derives
// (the intersection of the typed refusals) are set aside: a refund row becomes a claimable exception
// (recorded in unbuildable.json), a payout row (seller, treasury) is deferred for this run only and re-derived
// on the next settle. Every iteration removes at least one row from the eligible set, so the loop terminates.
export type BuildOutcome = { status: number | null; stderr: string };
// R46 (Reviewer R F25): when every reached host typed-refused but no row is refused by ALL of them (disjoint refusal
// sets, or names outside the batch), nothing is set aside — the batch is ISOLATED instead: its rows are retried one
// per batch, so a singleton refused by every reached host is set aside by name. Every iteration therefore either
// builds a batch or removes a row, and the loop terminates.
export function classifyBuildAttempts(attempts: BuildOutcome[], batchParties?: string[]): { unbuildable: boolean; isolate: boolean; refusedRows: string[] } {
  let refused = 0;
  let refusedRows: Set<string> | undefined;
  for (const b of attempts) {
    if (b.status === 0) continue;
    const m = b.status === 3 ? /ERROR sign build refused-rows (\[.*\])/.exec(b.stderr || "") : null;
    if (m) {
      refused++;
      const mine = new Set<string>(JSON.parse(m[1]));
      refusedRows = refusedRows ? new Set([...refusedRows].filter((p) => mine.has(p))) : mine;
    }
  }
  const reached = attempts.length, allTyped = reached > 0 && refused === reached;
  const inBatch = [...(refusedRows ?? [])].filter((p) => !batchParties || batchParties.includes(p));
  const unbuildable = allTyped && inBatch.length > 0;
  return { unbuildable, isolate: allTyped && !unbuildable, refusedRows: unbuildable ? inBatch : [] };
}
export function setAsideRows(outputs: { party: string; kind: string }[], refusedRows: string[]): { condemned: string[]; deferred: string[] } {
  const named = new Set(refusedRows);
  const condemned: string[] = [], deferred: string[] = [];
  for (const o of outputs.filter((o) => named.has(o.party))) (o.kind === "refund" ? condemned : deferred).push(o.party);
  return { condemned, deferred };
}
// H3 (B50, docs/design/phase7-b50-p2-sweep.md): the one-pool rule (R81 R-1/R-4) as a typed set-aside
// decision, shared by every build path (local build, custody hostBuild, sign build, sign approve). A batch
// whose payments span two pools cannot attribute its receipts by {party, output_index} (the index is a
// per-pool action index), so no such batch may be signed. The refusal NAMES the rows outside the kept pool
// — the kept pool is the one with the most payment outputs, ties going to the pool of the earliest output —
// and those rows wait in the exception queue with their reason while the batch's other rows settle next
// (an R46-style set-aside). A one-row batch can never span two pools, so re-planning terminates.
export function onePoolRefusal(outputs: { party: string; pool: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const o of outputs) counts.set(o.pool, (counts.get(o.pool) ?? 0) + 1);
  if (counts.size <= 1) return [];
  let kept = outputs[0].pool;
  for (const [pool, n] of counts) if (n > (counts.get(kept) ?? 0)) kept = pool;
  return outputs.filter((o) => o.pool !== kept).map((o) => o.party);
}
