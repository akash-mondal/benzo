// B55 item 2 offline proof (docs/design/phase7-b55-cancel-before-r-and-rg-harness.md §2): unit-check the one
// spec-side helper (e2e/lib/h19.ts h19FeeBound) against the settle worker's H19 fee-reserve preflight
// (settle/cli.ts worker, the `shortfall` block) over a few worlds — offline, no chain, no network:
//   - the helper's bound is exactly the preflight's bound term (5000 · (spendable notes + unpaid rows +
//     2 · remaining batches)) and its remaining-batches default is the preflight's fresh-run figure
//     (allocated batches 0 + ceil(eligible rows / batch cap));
//   - the OLD amounts reproduce the canary's refusals: settle-crash's 30,000 reserve asks for exactly the
//     35,000 top-up the canary printed, and cli-auction's second auction (no reserve at all) asks for
//     40,000;
//   - the specs' NEW funding (max(old reserve, bound + 5000)) makes the preflight pass in every world — and
//     for ANY obligations/extras, since spendable = obligations + extras + bound + 5000 leaves the
//     preflight short by −5000 − extras.
// The `preflight` function below is a transcription of settle/cli.ts's inline formula for this check only —
// the shipped formula stays inline in the worker (it reads the ledger, the wallet and the settings around it).
// Build+run:
//   npx esbuild tools/repro/b55-h19-bound.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b55-h19.mjs
//   node tmp/b55-h19.mjs
import { h19FeeBound } from "../../e2e/lib/h19";

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);

// The H19 preflight exactly as settle/cli.ts's worker computes it (B51's +2 × remaining batches included).
const preflight = (w: { obligations: number; notes: number; rows: number; remainingBatches: number; spendable: number }) => {
  const shortfall = w.obligations + 5000 * (w.notes + w.rows + w.remainingBatches * 2) - w.spendable;
  return { shortfall, topUp: shortfall > 0 ? shortfall + Math.max(Math.ceil(shortfall / 10), 5000) : 0 };
};

console.log("=== the helper is the preflight's own bound term, and its default is the fresh-run batches figure");
{
  let term = true, fresh = true;
  for (let notes = 0; notes <= 60; notes += 7) for (let rows = 0; rows <= 60; rows += 11) for (const cap of [1, 13, 14, 28]) {
    const bound = h19FeeBound({ notes, rows, batchCap: cap });
    if (bound !== 5000 * (notes + rows + 2 * Math.ceil(rows / cap))) term = false;
    // the preflight's fresh run: allocatedBatches 0 + ceil(eligibleRows / batch_cap)
    const preflightRem = 0 + Math.ceil(rows / cap);
    if (h19FeeBound({ notes, rows, batchCap: cap }) !== 5000 * (notes + rows + 2 * preflightRem)) fresh = false;
    if (h19FeeBound({ notes, rows, batchCap: cap, remainingBatches: 7 }) !== 5000 * (notes + rows + 14)) term = false;
  }
  check("helper-equals-preflight-bound", term, "5000 · (notes + rows + 2 · remainingBatches) over the sweep, explicit remainingBatches included");
  check("helper-default-batches-is-fresh-run", fresh, "default remainingBatches = ceil(rows / batchCap) = the preflight's allocated-0 + ceil(eligible/cap)");
}

console.log("=== the OLD funding reproduces the canary's top-ups");
{
  // settle-crash's main drill: 4 deposits + the fee-reserve note (5 spendable notes), the 5-row batch
  // (4C total obligations), 1 remaining batch at batch_cap 13. The bound is 60,000 — the design's figure.
  const bound = h19FeeBound({ notes: 5, rows: 5, batchCap: 13 });
  check("settle-crash-bound-is-60000", bound === 60_000, `bound ${bound} (5000 · (5 + 5 + 2))`);
  const old = preflight({ obligations: 4 * 500_000, notes: 5, rows: 5, remainingBatches: 1, spendable: 4 * 500_000 + 30_000 });
  check("settle-crash-old-30000-asks-35000", old.shortfall === 30_000 && old.topUp === 35_000,
    `shortfall ${old.shortfall}, top-up ${old.topUp} — the canary's exact \`fee reserve short: pay 35000 zats\` (C = 500000; the figure is C-independent)`);
  // cli-auction's second (cancelled) auction settles 2 rows after R from 3 notes with NO reserve funded.
  const b2 = h19FeeBound({ notes: 3, rows: 2, batchCap: 13 });
  const old2 = preflight({ obligations: 2 * 500_000, notes: 3, rows: 2, remainingBatches: 1, spendable: 2 * 500_000 + 0 });
  check("cli-auction-second-old-0-asks-40000", b2 === 35_000 && old2.shortfall === 35_000 && old2.topUp === 40_000,
    `bound ${b2}, shortfall ${old2.shortfall}, top-up ${old2.topUp} — the design's "and its second auction"`);
}

console.log("=== the NEW funding (max(old, bound + 5000)) passes the preflight in every spec world");
type World = { name: string; notes: number; rows: number; batchCap: number; old: number; obligations: number; extras: number };
const C = 500_000; // BNZ_COLLATERAL_ZATS from .env.example; every result below is C-independent or swept
const worlds: World[] = [
  // settle-crash (e2e/settle-crash.spec.ts): main drill then the cancel leg.
  { name: "settle-crash-main", notes: 5, rows: 5, batchCap: 13, old: 30_000, obligations: 4 * C, extras: 0 },
  { name: "settle-crash-cancel", notes: 3, rows: 0, batchCap: 13, old: 15_000, obligations: 0, extras: 2 * C },
  // cli-auction (e2e/cli-auction.spec.ts): 10 deposits + 2 strays + the reserve note; 10 payable rows
  // (8 leaf refunds + seller + the memo stray) and 3 exception-row deposits (the extras).
  { name: "cli-auction-main", notes: 13, rows: 10, batchCap: 13, old: 70_000, obligations: 10 * C, extras: 3 * C + 1 },
  // its second (cancelled) auction: 2 deposits + the reserve note, the claim + envelope refunds after R.
  { name: "cli-auction-second", notes: 3, rows: 2, batchCap: 13, old: 0, obligations: 2 * C, extras: 0 },
  // buyback-mode (e2e/buyback-mode.spec.ts): 3 deposits + the 600,000 reserve + the 430 treasury leg;
  // rows = 3 leaves + the treasury return.
  { name: "buyback-mode", notes: 5, rows: 4, batchCap: 13, old: 600_000, obligations: 3 * C + 440, extras: 430 },
  // markets (tools/repro/markets.ts) each leg's shape: scale-8/27/55 and the collection drop (4 deposits +
  // reserve + the 300,000 balance payment + the late balance note + the stray claim note; 5 paid rows).
  { name: "markets-scale-8", notes: 9, rows: 9, batchCap: 13, old: 60_000, obligations: 8 * C, extras: 0 },
  { name: "markets-scale-27", notes: 28, rows: 28, batchCap: 28, old: 200_000, obligations: 27 * C, extras: 0 },
  { name: "markets-scale-55", notes: 56, rows: 56, batchCap: 14, old: 400_000, obligations: 55 * C, extras: 0 },
  { name: "markets-drop", notes: 8, rows: 7, batchCap: 13, old: 60_000, obligations: 1_100_000 + 280, extras: C + 300_000 },
];
for (const w of worlds) {
  const bound = h19FeeBound({ notes: w.notes, rows: w.rows, batchCap: w.batchCap });
  const fund = Math.max(w.old, bound + 5000);
  const green = preflight({ obligations: w.obligations, notes: w.notes, rows: w.rows, remainingBatches: Math.ceil(w.rows / w.batchCap), spendable: w.obligations + w.extras + fund });
  const oldRun = preflight({ obligations: w.obligations, notes: w.notes, rows: w.rows, remainingBatches: Math.ceil(w.rows / w.batchCap), spendable: w.obligations + w.extras + w.old });
  check(`${w.name}-funded-passes`, green.shortfall <= 0,
    `bound ${bound}, fund ${fund} (old ${w.old}) → shortfall ${green.shortfall} <= 0${oldRun.shortfall > 0 ? `; the old ${w.old} would ask for ${oldRun.topUp}` : `; the old ${w.old} also passed (shortfall ${oldRun.shortfall})`}`);
}

console.log("=== the funding rule passes for ANY obligations and extras (the design's +5000 slot)");
{
  let ok = true, worst = 0;
  for (const obligations of [0, 1, 7 * C, 123_456_789]) for (const extras of [0, 1, 3 * C]) for (const w of worlds) {
    const bound = h19FeeBound({ notes: w.notes, rows: w.rows, batchCap: w.batchCap });
    const p = preflight({ obligations, notes: w.notes, rows: w.rows, remainingBatches: Math.ceil(w.rows / w.batchCap), spendable: obligations + extras + (bound + 5000) });
    worst = Math.min(worst, p.shortfall);
    if (p.shortfall > 0) ok = false;
  }
  check("bound-plus-5000-always-passes", ok, `shortfall <= 0 in every world; worst shortfall ${worst} (= -(5000 + extras), the one fee slot)`);
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
