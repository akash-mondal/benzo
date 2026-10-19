// B55 item 2 (docs/design/phase7-b55-cancel-before-r-and-rg-harness.md §2): the ONE spec-side helper for the
// settle worker's H19 fee-reserve preflight (settle/cli.ts worker, the `shortfall` block — R105, with B51's
// extra spend per batch). The preflight refuses a run when
//   obligations + 5000 · (spendable notes + unpaid rows + 2 · remaining batches) > spendable value
// and prints `fee reserve short: pay N zats … and run benzo settle again`. That bound is a deliberate WORST
// case — every output in a pool other than the spends — and about twice the real ZIP-317 fee of a same-pool
// batch, so the live specs fund the fee reserve at max(old reserve, bound + 5000) (one fee slot of slack,
// R109's shape), never at the real fee: settle-crash's exact-fee 30,000 reserve made the first worker exit
// before allocating (the canary's L1/J1/J2/K1/N1 cascade). `notes` is every spendable vault note at settle
// time, `rows` the unpaid rows the preflight counts, `batchCap` the configured batch cap and
// `remainingBatches` the preflight's allocated-batches + ceil(eligible rows / cap) figure — defaulted here
// to the fresh-run value ceil(rows / batchCap) when a spec funds before any batch exists. Counts may round
// UP (a larger bound only over-funds; the preflight fails only when underfunded).
export function h19FeeBound(input: { notes: number; rows: number; batchCap: number; remainingBatches?: number }): number {
  const remaining = input.remainingBatches ?? Math.ceil(input.rows / input.batchCap);
  return 5000 * (input.notes + input.rows + 2 * remaining);
}
