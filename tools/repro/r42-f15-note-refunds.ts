// Ruling R42 item 4 (F15, A20 item 4): one note backs at most ONE refund row across all row classes (stray,
// late, excess, collision) — the settlement ledger keys refunds by NOTE IDENTITY (`<txid>:<pool>:<action_index>`),
// so a reorg re-classification (Reviewer R's F15: an >=11-block reorg re-classifying an already-refunded note
// into the other refund-row class) can never pay the same note twice. Stray/collision rows (`deposit:<note>`)
// and late rows (`balance-late:<note>`) are keyed by their own party; the excess row's backing is its
// derivation's in-window notes (clear/features.ts balanceSettlement carries them; the ledger enforces).
// 1. Which behavior does it protect: refund-row conservation (PHASE-5 part 2; DESIGN refund rules) — the vault
//    never refunds one note's value twice, whatever sequence of reorgs re-classifies it.
// 2. Which credible regression makes it fail: the per-class key (party uniqueness per class only) — an excess
//    row paid for note N, then N reorged out of the window, re-derives a `balance-late:<N>` row that pays N
//    again (the F15 double refund; and its mirror image in the other order).
// 3. Why no existing test catches it: r40-f2/r41-f10 exercise one class per scenario; nothing drove a note
//    through TWO classes across a reorg, and the ledger had no cross-class key.
// 4. Production seam: none — this drives the shipped balanceSettlement derivation and the shipped Ledger
//    (pin/eligible/allocate/stage/confirm), the same primitives the worker drives.
// Assertions (mutation A20-F15 "the per-class key restored" turns the first two red):
//   f15-late-after-paid-excess     an already-refunded note re-classified out of the window gets NO second
//                                  refund row (the note key refuses it) and is never paid twice;
//   f15-excess-after-paid-late     the mirror order (late row refunded first, note re-classified in-window):
//                                  the excess row that would carry the same note's value again is not created;
//   f15-unrelated-note-rows        a note backing nothing keeps its own row (the key never blocks unrelated
//                                  notes) and the refunded row's history is untouched.
// Run: npx esbuild tools/repro/r42-f15-note-refunds.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r42-f15-note-refunds.mjs && node tmp/r42-f15-note-refunds.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ledger, type Obligation } from "../../settle/ledger";
import { balanceSettlement, isBalanceLateParty, type ScannedNote } from "../../clear/features";
import { obligationsModeA } from "../../clear/core";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r42-f15-note-refunds.mjs (tools/repro/r42-f15-note-refunds.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// One slot (dep0 -> bal0), window (1000, 1100], leaf 0 owing 300,000. Note N1 in-window at 1050 (100,000 —
// below the due: a default whose whole payment refunds as `balance-excess:0`, R41.6); note N2 out of window
// at 1200 (its own `balance-late:` row).
const m = { deposit_addresses: ["dep0"], confirmations: 10, bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0"] } } as any;
const result = { allocations: [{ leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "300000" }], conservation: { payout_zats: "0", input_zats: "200000", refund_zats: "200000", fees_zats: "0", balances_zats: "300000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }] as any;
const N1: ScannedNote = { txid: "a1".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1050, value_zats: 100_000 };
const N1reorged: ScannedNote = { ...N1, height: 1200 }; // >=11 blocks below the window: re-classified late
const N2: ScannedNote = { txid: "b2".repeat(32), pool: "ironwood", action_index: 1, address: "bal0", height: 1201, value_zats: 5_000 };
const idOf = (n: ScannedNote) => `${n.txid}:${n.pool}:${n.action_index}`;
const lateParty = (n: ScannedNote) => `balance-late:${idOf(n)}`;
const excessParty = "balance-excess:0";

// Exactly the plan's derivation: the shared rule's rows split into ready and parked sets, carrying their
// backing notes into the ledger as the worker does (settle/cli.ts `keyed`).
const rowsFor = (notes: ScannedNote[]): { ready: Obligation[]; parked: Obligation[] } => {
  const settled = balanceSettlement(m, result, leaves, notes, 1300);
  const owed = obligationsModeA(result, { defaults: [0], balance_refunds: settled.refunds });
  const backing = new Map(settled.refunds.map(r => [r.party, r.notes ?? []]));
  const mk = (party: string, amount: string): Obligation => ({ party, kind: "refund", amount_zats: amount, ...(backing.has(party) ? { notes: backing.get(party) } : {}) });
  return {
    ready: [...owed].filter(([p]) => !isBalanceLateParty(p)).map(([p, v]) => mk(p, v)),
    parked: [...owed].filter(([p]) => isBalanceLateParty(p)).map(([p, v]) => mk(p, v)),
  };
};

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};
const st = mkdtempSync(path.join(tmpdir(), "benzo-r42-f15-"));
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(st, "b.pczt");
writeFileSync(fakePczt, Buffer.from("r42-f15 fixture batch"));
// Pin, promote (as a claim would), allocate and SETTLE every payable row of a derivation (each batch gets
// its own txid, as in the real worker).
const settleAll = (l: Ledger, d: { ready: Obligation[]; parked: Obligation[] }): void => {
  l.pin([...d.ready, ...d.parked], []); l.eligible();
  for (let b; (b = l.allocate(13)); ) {
    const txid = b.id.toString(16).padStart(2, "0").repeat(32);
    l.stage(b.id, fakePczt, txid);
    l.confirm(b.id, txid, 100, b.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
  }
};

// f15-late-after-paid-excess: N1's `balance-excess:0` row is refunded; the reorg re-classifies N1 out of the
// window and the derivation now produces a `balance-late:<N1>` row for the same note. The note key refuses
// it: N1 backs one refund row and was refunded once. Red with A20-F15 (the per-class key restored): the
// second row is created and settled — the same value refunded twice.
{
  const l = new Ledger(st, uid(1));
  settleAll(l, rowsFor([N1]));
  const excess = l.rows().find(r => r.party === excessParty);
  settleAll(l, rowsFor([N1reorged, N2]));
  const second = l.rows().find(r => r.party === lateParty(N1reorged));
  const refundsForN1 = l.rows().filter(r => (r.party === excessParty || r.party === lateParty(N1reorged)) && ["refunded", "paid", "allocated", "staged"].includes(r.state));
  line("f15-late-after-paid-excess",
    excess?.state === "refunded" && !second && refundsForN1.length === 1,
    `excess row ${excess?.state} (${excess?.amount_zats}) refunded for note ${idOf(N1)}; re-classified late row ${second ? `CREATED and ${second.state} (DOUBLE REFUND)` : "not created (note key)"}; refund rows for the note: ${refundsForN1.length}`);
  l.close();
}

// f15-excess-after-paid-late: the mirror order — the `balance-late:<N1>` row is refunded first, then the reorg
// re-classifies N1 in-window and the derivation produces the excess row whose value includes N1 again.
{
  const l = new Ledger(st, uid(2));
  settleAll(l, rowsFor([N1reorged]));
  const late = l.rows().find(r => r.party === lateParty(N1reorged));
  settleAll(l, rowsFor([N1]));
  const excess = l.rows().find(r => r.party === excessParty);
  line("f15-excess-after-paid-late",
    late?.state === "refunded" && !excess,
    `late row ${late?.state} (${late?.amount_zats}) refunded for note ${idOf(N1)}; re-classified excess row ${excess ? `CREATED and ${excess.state} (DOUBLE REFUND)` : "not created (note key)"}`);
  l.close();
}

// f15-unrelated-note-rows: the key never blocks a note that backs nothing else.
{
  const l = new Ledger(st, uid(3));
  settleAll(l, rowsFor([N2]));
  const n2 = l.rows().find(r => r.party === lateParty(N2));
  settleAll(l, rowsFor([N1reorged, N2]));
  const n1 = l.rows().find(r => r.party === lateParty(N1reorged));
  line("f15-unrelated-note-rows",
    n2?.state === "refunded" && n1?.state === "refunded",
    `note ${idOf(N2)} keeps its own refunded row (${n2?.amount_zats}); the newly seen note ${idOf(N1)} gets its own row (${n1?.state}) — the key never blocks unrelated notes`);
  l.close();
}

rmSync(assertScratch(st), { recursive: true, force: true });
console.log(all ? "RESULT PASS r42-f15-note-refunds" : "RESULT FAIL r42-f15-note-refunds");
process.exitCode = all ? 0 : 1;
