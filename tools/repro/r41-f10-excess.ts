// Ruling R41 item 4 (F10, A19 item 4): in-window value ABOVE `balance_due_zats` at a winner's balance address
// becomes ONE immutable `balance-excess:<leaf_index>` refund row to that slot's own leaf. It is final (settlement
// waits until the window has closed), claimable with that leaf's owner key, and it sits under the same
// confirmations gate as every refund row (R41.3 — its backing is the in-window notes).
// 1. Which behavior does it protect: the bond-then-pay refund rows (PHASE-5 part 2 / N4, F2, R41.4) — nobody's
//    money sent to their manifest-fixed balance address is kept by the vault beyond what settles the balance.
// 2. Which credible regression makes it fail: the excess is swept into vault change again (Reviewer R's F10:
//    "an overpayment's excess backs the seller payout and returns as vault change — it is neither settled beyond
//    the due nor refunded"), or the row grows/changes with later chain state (F2's wedge class).
// 3. Why no existing test catches it: r40-f5's winner fixture pays exactly the due, so the above-due case was
//    never driven; nothing exercised a second in-window note at a winner's address.
// 4. Production seam: none — this drives the shipped `clear/features.ts balanceSettlement` derivation and the
//    shipped `clear/core.ts obligationsModeA` money rule. (`Ledger`'s refund-row immutability is r40-f2's
//    `f2-no-amount-change`/`f2-reorg-drop`, which cover this row kind too via isRefundRowParty.)
// Assertions:
//   f10-excess-row            a 350,000 in-window payment against a 300,000 due yields exactly ONE
//                             `balance-excess:0` row of 50,000 to leaf 0 (counted by the money rule) while the
//                             notes stay payment sources (red before: no row — the excess is swept);
//   f10-excess-row-gated      the row's maturity follows its backing in-window notes (R41.3 excess leg: red
//                             before — no row at all);
//   f10-no-excess-at-exact-due  a payment of exactly the due yields no excess row (the settled drop's shape);
//   f10-default-no-excess     a defaulted winner (in-window total below the due) yields no excess row — their
//                             partial payment settles toward the balance they forfeited (README honest limit).
// Run: npx esbuild tools/repro/r41-f10-excess.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r41-f10-excess.mjs && node tmp/r41-f10-excess.mjs
import { execFileSync } from "node:child_process";
import { balanceSettlement, isRefundRowParty, refundRowLeafIndex, type ScannedNote } from "../../clear/features";
import { obligationsModeA } from "../../clear/core";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r41-f10-excess.mjs (tools/repro/r41-f10-excess.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Three deposit slots (dep0/dep1/dep2 -> bal0/bal1/bal2); leaf 0 wins owing 300,000, leaf 1 loses, slot 2 has no
// bid. The window is (1000, 1100]; every note is at a real height so the excess is derived from a closed window.
const m = { deposit_addresses: ["dep0", "dep1", "dep2"], confirmations: 10, bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0", "bal1", "bal2"] } } as any;
const result = { allocations: [
  { leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "300000" },
  { leaf_index: 1, fill: 0, refund_zats: "200000", balance_due_zats: "0" },
], conservation: { payout_zats: "0", input_zats: "400000", refund_zats: "400000", fees_zats: "0", balances_zats: "300000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }, { leaf_index: 1, deposit: { address: "dep1" } }] as any;
const overpaid: ScannedNote[] = [
  { txid: "a1".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1050, value_zats: 200_000 },
  { txid: "a2".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1051, value_zats: 150_000 },
  { txid: "a3".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1200, value_zats: 9 }, // out of window: its own balance-late row
];
const excessParty = "balance-excess:0";

let all = true;
const line = (id: string, f: () => [boolean, string]) => {
  try {
    const [ok, d] = f();
    console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
    if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; }
  } catch (e) {
    console.log(`FAIL ${id} threw ${(e as Error).message}`);
    console.log(`ERROR ${id} threw ${(e as Error).message}`);
    all = false;
  }
};

line("f10-excess-row", () => {
  const settled = balanceSettlement(m, result, leaves, overpaid, 1300);
  const excess = settled.refunds.filter(r => r.party === excessParty);
  const late = settled.refunds.filter(r => r.party.startsWith("balance-late:"));
  const owed = obligationsModeA(result, { defaults: [], balance_refunds: settled.refunds });
  return [excess.length === 1 && excess[0].leaf_index === 0 && excess[0].amount_zats === "50000" &&
    late.length === 1 && settled.sources.length === 2 && owed.get(excessParty) === "50000" &&
    refundRowLeafIndex(m, leaves, excessParty, overpaid) === 0,
    `excess ${JSON.stringify(excess.map(r => ({ party: r.party, amount: r.amount_zats })))} late ${late.length} sources ${settled.sources.length} owed ${owed.get(excessParty)} (in-window 350,000 above the 300,000 due refunds as one immutable row to leaf 0; red before: swept into vault change)`];
});

line("f10-excess-row-gated", () => {
  const young = balanceSettlement(m, result, leaves, overpaid, 1052).refunds.find(r => r.party === excessParty); // a2 has 2 confs
  const old = balanceSettlement(m, result, leaves, overpaid, 1300).refunds.find(r => r.party === excessParty);
  return [young?.matured === false && old?.matured === true,
    `matured at 2 confs on the backing note ${String(young?.matured)}; after the gate ${String(old?.matured)} (R41.3 excess leg: the row stays pending until its in-window notes confirm)`];
});

line("f10-no-excess-at-exact-due", () => {
  const exact = [{ ...overpaid[0], value_zats: 300_000 }] as ScannedNote[];
  const settled = balanceSettlement(m, result, leaves, exact, 1300);
  return [settled.refunds.length === 0 && settled.sources.length === 1,
    `refunds ${JSON.stringify(settled.refunds)} sources ${settled.sources.length} (exactly the due: no excess row — the settled drop's shape)`];
});

line("f10-default-no-excess", () => {
  const partial = [{ ...overpaid[0], value_zats: 100_000 }] as ScannedNote[]; // below the due: leaf 0 defaults
  const settled = balanceSettlement(m, result, leaves, partial, 1300);
  return [settled.refunds.length === 0 && settled.sources.length === 1,
    `refunds ${JSON.stringify(settled.refunds)} sources ${settled.sources.length} (a defaulted winner's below-due payment settles toward the balance they forfeited — R41.4's literal rule, README honest limit)`];
});

console.log(all ? "RESULT PASS r41-f10-excess" : "RESULT FAIL r41-f10-excess");
process.exitCode = all ? 0 : 1;
