// Ruling R41 item 3 (F9) as superseded by Ruling R46 item 2 (F23): a balance-address note is CLASSIFIED only
// once matured (the R5 confirmations, m.confirmations / ZIP-315's 10 — the stricter of the two). Unmatured
// notes are invisible to the derivation (no row at all, not a `pending` row), so a reorg of an unconfirmed
// note can never leave the vault having refunded money it never received, and can never move a note across the
// window edge after it is counted.
// 1. Which behavior does it protect: the refund-row maturity gate (R41.3 → R46; N4/F2's per-note rows) — a
//    late payment's claim must not be paid from an unconfirmed note (Reviewer R's F9).
// 2. Which credible regression makes it fail: the row is derived and promoted at 1–9 confirmations (F9: a
//    late payment's claim is paid in the very next batch, then the note reorgs out — the vault is down the
//    refund and a self-dealing claimant keeps it).
// 3. Why no existing test catches it: r40-f2/r40-f5/r38-n4 drove row identity, growth and defaults only;
//    nothing drove maturity (the gate is new in R41, its invisibility form new in R46).
// 4. Production seam: none — this drives the shipped `clear/features.ts balanceSettlement` derivation, the
//    exact rule settle/plan.ts and cli/host-derive.ts consume.
// Assertions:
//   f9-late-row-not-payable             at 6 confirmations the late note is INVISIBLE to the derivation (no
//                                       row; red before: the row is derived and payable at 1 conf);
//   f9-late-row-payable-after-confirmations  at the rule's exact boundary (m.confirmations = 10) the note is
//                                       classified and its row is matured;
//   f9-gate-stricter-rule               the gate is max(m.confirmations, 10) both ways: with confirmations 20
//                                       the note is still invisible at 19 confs (strays' rule), and with
//                                       confirmations 3 it is still invisible at 6 confs (ZIP-315's 10).
// The excess-row leg of the gate is exercised by r41-f10-excess.ts (item 4) — those rows only exist there.
// Run: npx esbuild tools/repro/r41-f9-confirmations.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r41-f9-confirmations.mjs && node tmp/r41-f9-confirmations.mjs
import { execFileSync } from "node:child_process";
import { balanceSettlement, type ScannedNote } from "../../clear/features";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r41-f9-confirmations.mjs (tools/repro/r41-f9-confirmations.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// One bonded winner (leaf 0 at slot 0 / bal0) who paid their 300,000 balance in window (1000, 1100]; one
// third-party note arrived out of window at height 1200 and gets its own immutable refund row.
const base = { deposit_addresses: ["dep0"], confirmations: 10, bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0"] } } as any;
const result = { allocations: [{ leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "300000" }], conservation: { payout_zats: "0", input_zats: "200000", refund_zats: "200000", fees_zats: "0", balances_zats: "300000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }] as any;
const notes: ScannedNote[] = [
  { txid: "a1".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1050, value_zats: 300_000 },
  { txid: "dd".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1200, value_zats: 7 },
];
const lateParty = `balance-late:${"dd".repeat(32)}:ironwood:0`;

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

const rowAt = (m: any, tip: number) => balanceSettlement(m, result, leaves, notes, tip).refunds.find(r => r.party === lateParty);

line("f9-late-row-not-payable", () => {
  const row = rowAt(base, 1205); // 6 confirmations
  return [row === undefined, `row ${row ? `present amount ${row.amount_zats} matured ${String(row.matured)}` : "absent (invisible until matured; R46 F23)"} at 6 confirmations (red before: no gate at all, the row is derived and payable at 1 conf)`];
});

line("f9-late-row-payable-after-confirmations", () => {
  const early = rowAt(base, 1208), on = rowAt(base, 1209); // 9 and 10 confirmations
  return [early === undefined && on?.matured === true,
    `at 9 confs ${early ? `present matured ${String(early.matured)}` : "absent"}; at 10 confs ${on ? `matured ${String(on.matured)}` : "absent"} (m.confirmations = 10; R46 F23: classified only once matured)`];
});

line("f9-gate-stricter-rule", () => {
  const strays = rowAt({ ...base, confirmations: 20 }, 1218); // 19 confirmations, strays' rule is 20
  const sources = rowAt({ ...base, confirmations: 3 }, 1205); // 6 confirmations, sources' rule is ZIP-315's 10
  return [strays === undefined && sources === undefined,
    `confirmations 20 at 19 confs ${strays ? "classified" : "invisible"}; confirmations 3 at 6 confs ${sources ? "classified" : "invisible"} (gate = max(m.confirmations, 10))`];
});

console.log(all ? "RESULT PASS r41-f9-confirmations" : "RESULT FAIL r41-f9-confirmations");
process.exitCode = all ? 0 : 1;
