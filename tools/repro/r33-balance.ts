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
import { readFileSync } from "node:fs";
import path from "node:path";
import { balanceDefaults, balanceAddressMap, slotOrders } from "../../clear/features";
import { validateManifest } from "../../manifest/schema";

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

// Case 3 (Ruling R40 item 1, superseding R38 item 2's greedy rule): two winning leaves at ONE deposit slot
// can no longer exist. The reviewer's cross-owner repro (tools/repro/r40-f1-crossowner.ts) showed the greedy
// walk credits whichever co-slot leaf has the lower leaf_index regardless of who paid; R40 withdraws it — in a
// bond auction only the first deposit note at each slot is an order and a later note is a stray (refunded to
// its own depositor). The shipped helpers hold the invariant: the shared helper splits the fixture's leaves
// into one order and one collision, and balanceAddressMap REFUSES a result where two winning leaves share one
// balance address (the clear can no longer produce one). Red with the A18 F1 mutation (multi-order slots +
// greedy restored): the fixture is accepted again and one payment settles two balances.
const shared = { allocations: [
  { leaf_index: 0, fill: 1, balance_due_zats: "300000" },
  { leaf_index: 1, fill: 1, balance_due_zats: "300000" },
  { leaf_index: 2, fill: 0, balance_due_zats: "0" },
] } as any;
const sharedLeaves = [0, 1, 2].map(i => ({ leaf_index: i, deposit: { address: i < 2 ? "depS" : "depC" } })) as any;
const sharedM = { deposit_addresses: ["depS", "depC"], bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["uaS", "uaC"] } } as any;
{
  const { orders, collisions } = slotOrders(sharedM, sharedLeaves);
  let refused: string | null = null;
  try { balanceAddressMap(shared, sharedLeaves, sharedM); } catch (e) { refused = (e as Error).message; }
  const ok = JSON.stringify(orders.map((o: any) => o.leaf_index)) === "[0,2]" && JSON.stringify(collisions.map((o: any) => o.leaf_index)) === "[1]" &&
    refused === "refused: balance address shared by two winning leaves (one bid per deposit slot)";
  console.log(`${ok ? "PASS" : "FAIL"} case3 orders ${JSON.stringify(orders.map((o: any) => o.leaf_index))} collisions ${JSON.stringify(collisions.map((o: any) => o.leaf_index))} shared result -> ${JSON.stringify(refused)}`);
  if (!ok) console.log(`ERROR case3 one deposit slot must hold exactly one bid; got orders ${JSON.stringify(orders.map((o: any) => o.leaf_index))} collisions ${JSON.stringify(collisions.map((o: any) => o.leaf_index))} shared refusal ${JSON.stringify(refused)}`);
  all &&= ok;
}

// Case 4 (Ruling R38 item 3, N3): validateManifest requires balance_window_blocks >= 40, so an operator cannot
// pre-commit a one-block window that guarantees every winner defaults (Reviewer R's N3). The fixture is the real
// drop-r33 signed manifest (its own window was 12 blocks, pre-floor — historical) with only the block count
// varied: 39 must be refused with its own bond error and 40 must validate.
{
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const packet = JSON.parse(readFileSync(path.join(root, "docs/evidence/phase-5/markets/drop-r33/drop-cold/manifest.json"), "utf8"));
  const m = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
  const tryValidate = (blocks: number): string | null => { try { validateManifest({ ...m, bond: { ...m.bond, balance_window_blocks: blocks } }); return null; } catch (e) { return (e as Error).message; } };
  const refused = tryValidate(39), accepted = tryValidate(40) === null;
  const ok = refused === "refused: bond" && accepted;
  console.log(`${ok ? "PASS" : "FAIL"} case4 expected refused: bond at 39 and validation at 40; got ${JSON.stringify(refused)} at 39, ${accepted ? "validated" : `refused (${tryValidate(40)})`} at 40`);
  if (!ok) console.log(`ERROR case4 balance_window_blocks floor: 39 -> ${JSON.stringify(refused)}, 40 -> ${accepted}`);
  all &&= ok;
}

console.log(all ? "RESULT PASS r33-balance" : "RESULT FAIL r33-balance");
process.exitCode = all ? 0 : 1;
