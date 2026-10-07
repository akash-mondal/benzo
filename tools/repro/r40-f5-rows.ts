// Ruling R40 item 5 (F5, A18 item 4): a note at a balance address whose slot has a (losing) leaf refunds to
// that leaf through the same per-note row, and a note at the balance address of a slot with NO leaf is never
// swept (unrecoverable — the README honest limits say so). Reviewer R's cross-owner repro leg showed the
// pre-F5 helper silently stranded both (`balanceSettlement(note at a non-winner slot): {"sources":[],…} ->
// silently stranded (no row)`); nothing is silently stranded for deposit strays and nothing should be here.
//
// Green assertions over the shipped balanceSettlement/obligationsModeA (three deposit slots; leaf 0 wins with
// a 300,000 balance due, leaf 1 LOSES (fill 0), slot 2 has no bid at all):
//   f5-winner-matrix     a paid winner's in-window note is a payment source; its out-of-window note is its
//                        own immutable row (F2), both to leaf 0;
//   f5-losing-leaf       ANY note at the losing leaf's balance address refunds to that leaf as its own
//                        per-note row — it is never a payment source and never swept;
//   f5-no-leaf-slot      a note at the balance address of a slot with no bid is never swept and gets no row
//                        (unrecoverable; honest limit) — it can never be credited to another slot's leaf.
// Run: npx esbuild tools/repro/r40-f5-rows.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r40-f5-rows.mjs && node tmp/r40-f5-rows.mjs
import { execFileSync } from "node:child_process";
import { balanceSettlement, isBalanceLateParty, type ScannedNote } from "../../clear/features";
import { obligationsModeA } from "../../clear/core";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r40-f5-rows.mjs (tools/repro/r40-f5-rows.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Three deposit slots (dep0/dep1/dep2 -> bal0/bal1/bal2); leaf 0 wins (owing 300,000), leaf 1 loses, and
// nobody ever bid at slot 2. The window is (1000, 1100].
const m = { deposit_addresses: ["dep0", "dep1", "dep2"], bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0", "bal1", "bal2"] } } as any;
const result = { allocations: [
  { leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "300000" },
  { leaf_index: 1, fill: 0, refund_zats: "200000", balance_due_zats: "0" },
], conservation: { payout_zats: "0", input_zats: "400000", refund_zats: "400000", fees_zats: "0", balances_zats: "300000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }, { leaf_index: 1, deposit: { address: "dep1" } }] as any;
const notes = [
  { txid: "a1".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1050, value_zats: 300_000 }, // in-window payment
  { txid: "a2".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1200, value_zats: 7 },       // late at the winner
  { txid: "b1".repeat(32), pool: "ironwood", action_index: 1, address: "bal1", height: 1050, value_zats: 11 },      // in-window at the LOSER
  { txid: "b2".repeat(32), pool: "ironwood", action_index: 2, address: "bal1", height: 1200, value_zats: 13 },      // late at the LOSER
  { txid: "c1".repeat(32), pool: "ironwood", action_index: 3, address: "bal2", height: 1050, value_zats: 17 },      // at a slot with NO bid
] as ScannedNote[];

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};
const row = (n: ScannedNote, leaf: number) => ({ party: `balance-late:${n.txid}:${n.pool}:${n.action_index}`, leaf_index: leaf, amount_zats: String(n.value_zats) });
// Ruling R41 item 3 (F9): rows carry the maturity flag; these assertions are about row identity, so they compare
// the published fields only (r41-f9-confirmations.ts owns the maturity gate).
const shape = (rs: typeof settled.refunds) => rs.map(r => ({ party: r.party, leaf_index: r.leaf_index, amount_zats: r.amount_zats }));
const settled = balanceSettlement(m, result, leaves, notes, 1300);
const owed = obligationsModeA(result, { defaults: [], balance_refunds: settled.refunds });

line("f5-winner-matrix",
  JSON.stringify(settled.sources) === JSON.stringify([`balance:${"a1".repeat(32)}:ironwood:0`]) &&
    JSON.stringify(shape(settled.refunds.filter(r => r.leaf_index === 0))) === JSON.stringify([row(notes[1], 0)]) &&
    owed.get(row(notes[1], 0).party) === "7",
  `sources ${JSON.stringify(settled.sources)}; refunds ${JSON.stringify(settled.refunds)} (the winner's in-window note pays; its late note is its own row)`);

line("f5-losing-leaf",
  JSON.stringify(shape(settled.refunds.filter(r => r.leaf_index === 1)).sort((a, b) => a.party.localeCompare(b.party))) === JSON.stringify([row(notes[2], 1), row(notes[3], 1)].sort((a, b) => a.party.localeCompare(b.party))) &&
    !settled.sources.some(s => s.includes("b1".repeat(32))) &&
    owed.get(row(notes[2], 1).party) === "11" && owed.get(row(notes[3], 1).party) === "13",
  `losing-leaf rows ${JSON.stringify(settled.refunds.filter(r => r.leaf_index === 1))} (every note at a losing leaf's balance address refunds to that leaf, one immutable row per note)`);

const orphan = settled.refunds.some(r => r.party.includes("c1".repeat(32))) || settled.sources.some(s => s.includes("c1".repeat(32)));
line("f5-no-leaf-slot", !orphan && !JSON.stringify([...owed.keys()]).includes("c1".repeat(32)),
  `the note at the no-bid slot produced ${orphan ? "a row or a source (it must be unrecoverable and never swept)" : "neither a row nor a source — unrecoverable (README honest limits)"}`);

console.log(all ? "RESULT PASS r40-f5-rows" : "RESULT FAIL r40-f5-rows");
process.exitCode = all ? 0 : 1;
