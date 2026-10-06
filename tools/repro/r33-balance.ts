// R33 items 1-2 lab repro of Reviewer R's P1-1 and P1-2 (benzo-sol/reports/pr-r29-r30-a14.md "case1/case2"):
//   case 1 — a pre-window note (2000 at the winner's balance address, mined before the window opened) must NOT
//            count as balance payment: that winner never paid in-window and defaults. Pre-change `balanceDefaults`
//            has no lower bound, counts it and reports no default (the reviewer's "case1 defaults: []").
//   case 2 — payments mined inside the balance window must count, whatever the operator did after the clear. The
//            pre-change window starts at the operator's post-clear `clear_height`, so a late binding puts every
//            payment outside it and forces every winner to forfeit (the reviewer's "case2 defaults: [ 0, 1 ]").
// One file, red on the pre-change commit and green after: it probes the shipped balanceAddressMap binding shape
// and feeds each API the same scenario in its own terms (old: clear_height + [{leaf_index, ua}]; new: the
// manifest-fixed balance_window_start_height + bond.balance_addresses aligned index-for-index with
// deposit_addresses). The expected values are the semantics above — API-independent. The reviewer's case-1
// annotation says "expected [1]" while its own parenthetical says "leaf 0 never paid in window"; leaf 0 is the
// pre-funded one, so the expected default list is [0].
// Run: npx esbuild tools/repro/r33-balance.ts --bundle --platform=node --format=esm --outfile=tmp/r33-balance.mjs && node tmp/r33-balance.mjs
import { execFileSync } from "node:child_process";
import { balanceDefaults, balanceAddressMap } from "../../clear/features";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r33-balance.mjs (tools/repro/r33-balance.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// The scenario: two bonded winners each owe 1000 (equal balances, the reviewer's P1-3 shape) at balance
// addresses aligned with their deposit slots; leaf 2 is not a winner.
const deposits = ["depA", "depB", "depC"], uas = ["uaA", "uaB", "uaC"];
const result = { allocations: [
  { leaf_index: 0, fill: 1, balance_due_zats: "1000" },
  { leaf_index: 1, fill: 1, balance_due_zats: "1000" },
  { leaf_index: 2, fill: 0, balance_due_zats: "0" },
] } as any;
const leaves = deposits.map((address, i) => ({ leaf_index: i, deposit: { address } })) as any;
const winners = [{ leaf_index: 0, ua: "uaA" }, { leaf_index: 1, ua: "uaB" }];

// Probe the shipped binding shape: the new balanceAddressMap(result, leaves, manifest) succeeds on this fixture;
// the pre-change one takes (result, bal) and refuses `leaves` as a binding.
const probeM = { deposit_addresses: deposits, bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: uas } } as any;
const newApi = (() => { try { balanceAddressMap(result, leaves, probeM); return true; } catch { return false; } })();
console.log(`api ${newApi ? "manifest window (post-R33)" : "operator clear_height (pre-R33)"}`);

type Scenario = { notes: { address: string; height: number; value_zats: number }[]; oldStart: number; newStart: number; blocks: number; oldTip: number; newTip: number; expect: number[] };
const defaultsFor = (s: Scenario): number[] => newApi
  ? balanceDefaults({ deposit_addresses: deposits, bond: { bond_bps: 500, balance_window_blocks: s.blocks, balance_window_start_height: s.newStart, balance_addresses: uas } } as any, result, leaves, s.notes as any, s.newTip)
  : balanceDefaults({ bond: { bond_bps: 500, balance_window_blocks: s.blocks } } as any, result, { clear_height: s.oldStart, balance_addresses: winners } as any, s.notes as any, s.oldTip);

let all = true;
const line = (id: string, s: Scenario) => {
  try {
    const got = defaultsFor(s);
    const ok = JSON.stringify(got) === JSON.stringify(s.expect);
    console.log(`${ok ? "PASS" : "FAIL"} ${id} expected ${JSON.stringify(s.expect)} got ${JSON.stringify(got)}`);
    if (!ok) console.log(`ERROR ${id} expected ${JSON.stringify(s.expect)} got ${JSON.stringify(got)}`);
    all &&= ok;
  } catch (e) {
    console.log(`FAIL ${id} threw ${(e as Error).message}`);
    console.log(`ERROR ${id} threw ${(e as Error).message}`);
    all = false;
  }
};
// Case 1 (reviewer's input): 2000 at uaA mined at 900 — before the window opened; uaB was genuinely paid 1000 at
// 1050, inside (1000, 1100]. Leaf 0 never paid in-window and must default.
line("case1", { notes: [{ address: "uaA", height: 900, value_zats: 2000 }, { address: "uaB", height: 1050, value_zats: 1000 }],
  oldStart: 1000, newStart: 1000, blocks: 100, oldTip: 1200, newTip: 1200, expect: [0] });
// Case 2 (reviewer's input): both winners pay in full at 1210. The operator's late binding (window ended 1100)
// forfeits both; the manifest-fixed window (1200, 1300] counts both — no forced default.
line("case2", { notes: [{ address: "uaA", height: 1210, value_zats: 1000 }, { address: "uaB", height: 1210, value_zats: 1000 }],
  oldStart: 1000, newStart: 1200, blocks: 100, oldTip: 1300, newTip: 1310, expect: [] });

// Case 3 (Ruling R38 item 2, Reviewer R's N1 shared-slot case): two winning leaves share ONE deposit slot (R26 F1
// makes two notes at one deposit address two distinct leaves) and so one balance address. Each owes 300,000 and
// exactly one 300,000 payment arrives in-window at their shared address. The per-slot greedy walk in leaf_index
// order (clear/features.ts balanceDefaults) pays leaf 0's balance and defaults leaf 1 — exactly one default, and
// one payment can never settle two balances. The pre-change helper summed the same notes once per leaf and
// reported NO default; that behavior is restored by docs/evidence/phase-5/mutations/A17-N1.patch (red).
const shared = { allocations: [
  { leaf_index: 0, fill: 1, balance_due_zats: "300000" },
  { leaf_index: 1, fill: 1, balance_due_zats: "300000" },
  { leaf_index: 2, fill: 0, balance_due_zats: "0" },
] } as any;
const sharedLeaves = [0, 1, 2].map(i => ({ leaf_index: i, deposit: { address: i < 2 ? "depS" : "depC" } })) as any;
const sharedM = { deposit_addresses: ["depS", "depC"], bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["uaS", "uaC"] } } as any;
{
  const map = balanceAddressMap(shared, sharedLeaves, sharedM);
  console.log(`shared-slot balance map ${JSON.stringify([...map])} -> ${map.get(0) === map.get(1) ? "CONFIRMED leaves 0 and 1 share one balance address" : "slots differ"}`);
  const got = balanceDefaults(sharedM, shared, sharedLeaves, [{ address: "uaS", height: 1050, value_zats: 300_000 }] as any, 1200);
  const ok = JSON.stringify(got) === "[1]";
  console.log(`${ok ? "PASS" : "FAIL"} case3 expected [1] got ${JSON.stringify(got)} (one 300,000 payment for two 300,000 balances settles exactly one: leaf 0 paid, leaf 1 default)`);
  if (!ok) console.log(`ERROR case3 one payment settled more than one balance (or none): defaults ${JSON.stringify(got)}`);
  all &&= ok;
}

console.log(all ? "RESULT PASS r33-balance" : "RESULT FAIL r33-balance");
process.exitCode = all ? 0 : 1;
