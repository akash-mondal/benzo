// Ruling R46 item 2 (Reviewer R F23, `benzo-sol/reports/pr-a23-r45.md` §3, probes p2a/p2b/p3 in his lab
// `/tmp/r45lab/tools/repro/r45a23-probes.ts`): balance-address notes are classified only once matured, and
// `Ledger.pin` replaces an unpaid refund row whose derivation differs (delete + recreate, releasing its notes),
// never subtracts an unpaid taking row's amount, and asserts conservation at pin.
// 1. Which behavior does it protect: refund-row reconciliation under an in-model reorg (DESIGN refund rules;
//    R41's conservation property) — a shallow reorg that moves a note across the window edge must never leave
//    the vault owing a stale amount (stranded: probes p2b/p3) or refund more than was received (probe p2a).
// 2. Which credible regression makes it fail: the pre-F23 pin — "the pinned row stands" for unpaid rows with a
//    changed derivation, and the F18 skip subtracted an UNPAID taking row's amount and then dropped that row,
//    destroying its value (Reviewer R's exact probes: +50,000 over-refund in non-custody p2a, permanent
//    stranding p2b/p3); and the pre-F23 classification, which counted immature notes so a ~3-block reorg
//    flipped a note across the window edge after it was counted.
// 3. Why no existing test catches it: r44-f18/r42-f15 drive re-classification only with MONEY-MOVED taking
//    rows (they settle first — the F18 rule's own case); r40-f2's `f2-no-amount-change` cemented the old
//    stands rule for unpaid rows; nothing drove an unpaid derivation drift or an immature note's classification.
// 4. Production seam: none — this drives the shipped `clear/features.ts balanceSettlement`/`balanceDefaults`
//    and the shipped `Ledger` (pin/eligible/allocate/stage/confirm), the worker's exact shape (settle/cli.ts).
// Assertions (mutation A24-F23stand — the pre-R46 pinned-row-stands rule restored — turns all of these red):
//   f23a-matured-only                an immature note is invisible to the derivation (equal to the
//                                    note-absent derivation) and is classified only once matured;
//   f23a-flip-in-replaced            probe p2a: a late row's note reorged in-window — the unpaid late row is
//                                    released and the excess row REPLACED at the fresh 10,000, which settles
//                                    at 10,000 (red before: 60,000 settled — +50,000 of others' funds);
//   f23b-rederive-eligible           probe p2b: three pins — the corrected row is eligible at the derived
//                                    amount (red before: parked `exception` at the stale 60,000 forever);
//   f23c-flip-out-both-rows          probe p3: an in-window note reorged out — BOTH the new late row and the
//                                    corrected excess row exist (110,000 total; red before: the late row is
//                                    skipped every run and the excess stands at 10,000);
//   f23-unpaid-taking-not-subtracted an unpaid taking row's amount is never subtracted from a fresh row.
// Run: npx esbuild tools/repro/r46-f23.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r46-f23.mjs && node tmp/r46-f23.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ledger, type Obligation } from "../../settle/ledger";
import { balanceDefaults, balanceSettlement, type ScannedNote } from "../../clear/features";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r46-f23.mjs (tools/repro/r46-f23.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// One bonded winner (leaf 0 at deposit slot 0 -> bal0) owing balance_due 100,000 over the manifest-fixed
// window (1000, 1100]. n2 = 60,000 in-window at 1050. n1 = 50,000, out of window at 1201 in the default case
// (pin 1) and reorged in-window at 1095 in the paid case (the reviewer's p2a/p2b flip-in).
const m = { deposit_addresses: ["dep0"], confirmations: 10, bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0"] } } as any;
const result = { allocations: [{ leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "100000" }], conservation: { payout_zats: "0", input_zats: "200000", refund_zats: "200000", fees_zats: "0", balances_zats: "110000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }] as any;
const n1Out: ScannedNote = { txid: "a1".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1201, value_zats: 50_000 };
const n1In: ScannedNote = { ...n1Out, height: 1100 }; // reorged in-window at the window's last height
const n2: ScannedNote = { txid: "b2".repeat(32), pool: "ironwood", action_index: 1, address: "bal0", height: 1050, value_zats: 60_000 };
const id1 = `${n1Out.txid}:${n1Out.pool}:${n1Out.action_index}`, id2 = `${n2.txid}:${n2.pool}:${n2.action_index}`;
const lateParty = `balance-late:${id1}`, excessParty = "balance-excess:0";

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; }
};
let seq = 0;
const base = mkdtempSync(path.join(tmpdir(), "benzo-r46-f23-"));
const st = () => { const d = path.join(base, `s${++seq}`); mkdirSync(d, { recursive: true }); return d; };
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(base, "b.pczt");
writeFileSync(fakePczt, Buffer.from("r46-f23 fixture batch"));

// ---- f23a-matured-only: the shipped classification (plan, hosts and verify consume this one helper) --------
{
  const out = balanceSettlement(m, result, leaves, [n1In, n2], 1101); // n1 re-mined in-window with 2 confs
  const without = balanceSettlement(m, result, leaves, [n2], 1101);   // the same derivation with n1 absent
  const matured = balanceSettlement(m, result, leaves, [n1In, n2], 1109); // n1 at 10 confs
  const dOut = balanceDefaults(m, result, leaves, [n1In, n2], 1101), dWithout = balanceDefaults(m, result, leaves, [n2], 1101);
  const invisible = JSON.stringify(out) === JSON.stringify(without) && JSON.stringify(dOut) === JSON.stringify(dWithout);
  const flipped = matured.refunds.length === 1 && matured.refunds[0].party === excessParty &&
    matured.refunds[0].amount_zats === "10000" && matured.refunds[0].matured === true;
  line("f23a-matured-only", invisible && flipped,
    `immature n1 (${id1}, 2 confs): derivation ${JSON.stringify(out.refunds.map(r => [r.party, r.amount_zats]))} vs note-absent ${JSON.stringify(without.refunds.map(r => [r.party, r.amount_zats]))} (equal: ${invisible}); at 10 confs ${JSON.stringify(matured.refunds.map(r => [r.party, r.amount_zats]))} — a note is classified only once matured, so an in-model reorg can never move it across the window edge after it is counted`);
}

// ---- f23a (probe p2a): flip IN — the unpaid late row released, the excess row replaced at 10,000 ----------
{
  const l = new Ledger(st(), uid(1));
  const L: Obligation = { party: lateParty, kind: "refund", amount_zats: "50000", notes: [id1] };
  const E1: Obligation = { party: excessParty, kind: "refund", amount_zats: "60000", notes: [id2] };       // default case
  const E2: Obligation = { party: excessParty, kind: "refund", amount_zats: "10000", notes: [id1, id2] };  // paid case
  l.pin([L, E1], []); l.eligible();
  let err = "";
  try { l.pin([E2], []); l.eligible(); } catch (e) { err = (e as Error).message; }
  const rows = l.rows();
  const lateGone = !rows.some(r => r.party === lateParty);
  const alloc = err ? null : l.allocate(13);
  let receipt: { amount_zats: string } | undefined;
  if (alloc) {
    l.stage(alloc.id, fakePczt, uid(9));
    l.confirm(alloc.id, uid(9), 200, alloc.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
    receipt = l.receipts().find(r => r.party === excessParty);
  }
  const e = l.rows().find(r => r.party === excessParty);
  line("f23a-flip-in-replaced", !err && lateGone && e?.amount_zats === "10000" && e?.state === "refunded" && receipt?.amount_zats === "10000",
    err ? `pin refused: ${err.slice(0, 140)}` :
      `late row released ${lateGone}; excess row ${e ? `${e.state} at ${e.amount_zats}` : "missing"} (fresh derivation 10000) and settled at ${receipt?.amount_zats} (red before: stale 60000 SETTLES — +50000 over-refund of other users' vault funds)`);
  l.close();
}

// ---- f23b (probe p2b): flip in, no batch — the corrected row is eligible at the derived amount ------------
{
  const l = new Ledger(st(), uid(2));
  const L: Obligation = { party: lateParty, kind: "refund", amount_zats: "50000", notes: [id1] };
  const E1: Obligation = { party: excessParty, kind: "refund", amount_zats: "60000", notes: [id2] };
  const E2: Obligation = { party: excessParty, kind: "refund", amount_zats: "10000", notes: [id1, id2] };
  let err = "";
  try {
    l.pin([L, E1], []); l.eligible();
    l.pin([E2], []); l.eligible();
    l.pin([E2], []); l.eligible();
  } catch (e) { err = (e as Error).message; }
  const e3 = l.rows().find(r => r.party === excessParty);
  line("f23b-rederive-eligible", !err && e3?.amount_zats === "10000" && e3?.state === "eligible",
    err ? `pin refused: ${err.slice(0, 140)}` :
      `after three pins the excess row is ${e3 ? `${e3.state} at ${e3.amount_zats}` : "missing"} (red before: parked 'exception' at the stale 60000 forever — the correct 10000 refund can never complete)`);
  l.close();
}

// ---- f23c (probe p3): flip OUT — both rows exist, 110,000 total ------------------------------------------
{
  const l = new Ledger(st(), uid(3));
  const E1: Obligation = { party: excessParty, kind: "refund", amount_zats: "10000", notes: [id1, id2] };   // paid case
  const L2: Obligation = { party: lateParty, kind: "refund", amount_zats: "50000", notes: [id1] };          // default case
  const E2: Obligation = { party: excessParty, kind: "refund", amount_zats: "60000", notes: [id2] };
  let err = "";
  try {
    l.pin([E1], []); l.eligible();
    l.pin([E2, L2], []); l.eligible();
    l.pin([E2, L2], []); l.eligible();
  } catch (e) { err = (e as Error).message; }
  const rows = l.rows(), e = rows.find(r => r.party === excessParty), late = rows.find(r => r.party === lateParty);
  const total = rows.reduce((s, r) => s + BigInt(r.amount_zats), 0n);
  line("f23c-flip-out-both-rows", !err && e?.amount_zats === "60000" && late?.amount_zats === "50000" &&
    e?.state === "eligible" && late?.state === "eligible" && total === 110000n,
    err ? `pin refused: ${err.slice(0, 140)}` :
      `excess ${e ? `${e.state} at ${e.amount_zats}` : "missing"} + late ${late ? `${late.state} at ${late.amount_zats}` : "missing (red before: skipped EVERY run — permanent stranding)"} = ${total} (received 110000, settled 0 — the default case refunds in full)`);
  l.close();
}

// ---- the subtraction rule itself: an UNPAID taking row's amount is never subtracted ----------------------
{
  const l = new Ledger(st(), uid(4));
  const L: Obligation = { party: lateParty, kind: "refund", amount_zats: "50000", notes: [id1] };
  const E: Obligation = { party: excessParty, kind: "refund", amount_zats: "10000", notes: [id1, id2] };
  let err = "";
  try {
    l.pin([L], []);
    l.pin([L, E], []); // E's note id1 is backed by the UNPAID row L (still owed as its own row)
    l.eligible();
  } catch (e) { err = (e as Error).message; }
  const rows = l.rows(), e = rows.find(r => r.party === excessParty), late = rows.find(r => r.party === lateParty);
  line("f23-unpaid-taking-not-subtracted", !err && e?.amount_zats === "10000" && late?.amount_zats === "50000" && rows.length === 2,
    err ? `pin refused: ${err.slice(0, 140)}` :
      `rows ${JSON.stringify(rows.map(r => [r.party, r.amount_zats, r.state]))} (red before: L's unpaid 50000 subtracted -> the fresh row skipped, its value stranded)`);
  l.close();
}

rmSync(assertScratch(base), { recursive: true, force: true });
console.log(all ? "RESULT PASS r46-f23" : "RESULT FAIL r46-f23");
process.exitCode = all ? 0 : 1;
