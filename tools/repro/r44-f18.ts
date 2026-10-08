// Ruling R44 item 3 (Reviewer R F18, `benzo-sol/reports/pr-a20-r42.md`): when one note of a multi-note excess
// row is already taken, skip ONLY that note — the row is created over its free notes with the taken notes'
// refunded value removed from its amount (clamped at 0), and `backingOf` may never silently disable the note
// key: an unkeyable note is an ERROR. Conservation must stay zat-exact.
// 1. Which behavior does it protect: refund-row conservation (DESIGN refund rules; R42 F15's one-note-one-
//    refund key) — a reorg that re-classifies one of several in-window notes must not strand the OTHER notes'
//    value, and one note must never refund twice.
// 2. Which credible regression makes it fail: the pre-F18 whole-row skip (settle/ledger.ts) — one taken note
//    made the ledger drop the entire excess row, so the free notes' excess value could never be refunded; and
//    the pre-F18 `backingOf` `[]` — an out-of-u16-range note party was created as a silently UNKEYED row that
//    the note key could not see (one note could refund twice).
// 3. Why no existing test catches it: r42-f15 drives only SINGLE-note rows (its "not created" assertions are
//    preserved — a fully taken row is still never created); nothing drove a multi-note excess row across the
//    F15 trigger, and nothing drove an unkeyable note party.
// 4. Production seam: none — this drives the shipped balanceSettlement derivation and the shipped Ledger
//    (pin/eligible/allocate/stage/confirm), the same primitives the worker drives (settle/cli.ts `keyed`).
// Assertions (the F18 mutation/old tree turns the first of each pair red):
//   f18a-multinote-per-note-skip    a taken note leaves the row's backing and its value leaves the amount;
//                                   the free note's value is still refunded (row over the free note only);
//   f18a-conservation               zat-exact: settled + every refund row = every zat received, once;
//   f18b-zat-exact-conservation     the same identity with a settled winner (due partially settled): the row
//                                   refunds amount - taken value exactly (10,000 of the 110,000 excess);
//   f18c-unkeyable-note-error       a note-shaped party outside the scanner's u16 range (and the legacy
//                                   no-pool identity) is refused with the specific ERROR — never a silently
//                                   unkeyed row two parties could refund the same note through.
// Run: npx esbuild tools/repro/r44-f18.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r44-f18.mjs && node tmp/r44-f18.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ledger, type Obligation } from "../../settle/ledger";
import { balanceSettlement, isBalanceLateParty, isRefundRowParty, type ScannedNote } from "../../clear/features";
import { obligationsModeA } from "../../clear/core";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r44-f18.mjs (tools/repro/r44-f18.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

// One slot (dep0 -> bal0), window (1000, 1100], leaf 0. Two IN-WINDOW notes at bal0 — N1 (100,000) and N3
// (40,000) — and N1 re-classified out of the window (>=11 blocks below) by the F15 deep-reorg trigger.
const m = { deposit_addresses: ["dep0"], confirmations: 10, bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0"] } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }] as any;
const N1: ScannedNote = { txid: "a1".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 1050, value_zats: 100_000 };
const N1reorged: ScannedNote = { ...N1, height: 1200 };
const N3: ScannedNote = { txid: "c3".repeat(32), pool: "ironwood", action_index: 2, address: "bal0", height: 1055, value_zats: 40_000 };
const idOf = (n: ScannedNote) => `${n.txid}:${n.pool}:${n.action_index}`;
const lateParty = (n: ScannedNote) => `balance-late:${idOf(n)}`;
const excessParty = "balance-excess:0";

// Exactly the plan's derivation (settle/plan.ts + settle/cli.ts `keyed`): the shared rule's rows split into
// ready and parked sets, carrying their backing notes into the ledger as the worker does.
const rowsFor = (notes: ScannedNote[], due: string): { ready: Obligation[]; parked: Obligation[]; settledZats: bigint } => {
  const result = { allocations: [{ leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: due }], conservation: { payout_zats: "0", input_zats: "200000", refund_zats: "200000", fees_zats: "0", balances_zats: String(notes.reduce((s, n) => s + BigInt(n.value_zats), 0n)) } } as any;
  const settled = balanceSettlement(m, result, leaves, notes, 1300);
  const owed = obligationsModeA(result, { defaults: [0], balance_refunds: settled.refunds });
  const backing = new Map(settled.refunds.map(r => [r.party, r.notes ?? []]));
  const mk = (party: string, amount: string): Obligation => ({ party, kind: "refund", amount_zats: amount, ...(backing.has(party) ? { notes: backing.get(party) } : {}) });
  const totalIn = notes.reduce((s, n) => s + BigInt(n.value_zats), 0n);
  const dueZats = BigInt(due);
  return {
    ready: [...owed].filter(([p]) => !isBalanceLateParty(p)).map(([p, v]) => mk(p, v)),
    parked: [...owed].filter(([p]) => isBalanceLateParty(p)).map(([p, v]) => mk(p, v)),
    settledZats: dueZats > 0n && totalIn >= dueZats ? dueZats : 0n,
  };
};

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};
const st = mkdtempSync(path.join(tmpdir(), "benzo-r44-f18-"));
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(st, "b.pczt");
writeFileSync(fakePczt, Buffer.from("r44-f18 fixture batch"));
const settleAll = (l: Ledger, d: { ready: Obligation[]; parked: Obligation[] }): void => {
  l.pin([...d.ready, ...d.parked], []); l.eligible();
  for (let b; (b = l.allocate(13)); ) {
    const txid = b.id.toString(16).padStart(2, "0").repeat(32);
    l.stage(b.id, fakePczt, txid);
    l.confirm(b.id, txid, 100, b.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
  }
};
// The conservation identity is over the balance ADDRESS's money only: every zat received at bal0 is either
// settled (the winner's due) or refunded once by a note-keyed balance row (balance-late:/balance-excess:) —
// the leaf:0 deposit refund is different money and is not part of it.
const refundedSum = (l: Ledger): bigint => l.rows().filter(r => ["refunded", "paid"].includes(r.state) && isRefundRowParty(r.party)).reduce((s, r) => s + BigInt(r.amount_zats), 0n);

// f18a: the F15 trigger on a MULTI-NOTE excess row. N1's `balance-late:` row is refunded first (100,000);
// the reorg re-classifies N1 in-window, and the derivation now carves the excess row from N1 + N3 (140,000
// received at bal0, default: settled 0). Pre-F18 the whole row is skipped and N3's 40,000 can never refund.
// F18: N1 is skipped as a BACKING NOTE only — the row refunds 40,000 over N3, and conservation is exact.
{
  const l = new Ledger(st, uid(1));
  settleAll(l, rowsFor([N1reorged], "300000"));
  settleAll(l, rowsFor([N1, N3], "300000"));
  const excess = l.rows().find(r => r.party === excessParty);
  const received = BigInt(N1.value_zats) + BigInt(N3.value_zats);
  const sum = refundedSum(l) + rowsFor([N1, N3], "300000").settledZats;
  line("f18a-multinote-per-note-skip",
    excess?.state === "refunded" && excess.amount_zats === "40000",
    `late row refunded 100000 for the taken note ${idOf(N1)}; excess row over the free note ${idOf(N3)}: ${excess ? `${excess.state} at ${excess.amount_zats}` : "NOT CREATED (free note value stranded)"}`);
  line("f18a-conservation",
    sum === received,
    `settled 0 + balance refund rows = ${sum} vs received ${received} at the balance address (zat-exact)`);
  l.close();
}

// f18b: the same trigger with a SETTLED winner — due 30,000, 140,000 received, excess 110,000 carved from
// N1 + N3. F18's amount rule is zat-exact here too: 110,000 - 100,000 (N1's refunded value) = 10,000, so
// settled 30,000 + late 100,000 + excess 10,000 = 140,000 received, once.
{
  const l = new Ledger(st, uid(2));
  settleAll(l, rowsFor([N1reorged], "30000"));
  const d = rowsFor([N1, N3], "30000");
  settleAll(l, d);
  const excess = l.rows().find(r => r.party === excessParty);
  const received = BigInt(N1.value_zats) + BigInt(N3.value_zats);
  const sum = refundedSum(l) + d.settledZats;
  line("f18b-zat-exact-conservation",
    excess?.state === "refunded" && excess.amount_zats === "10000" && sum === received,
    `excess row ${excess ? `${excess.state} at ${excess.amount_zats}` : "NOT CREATED"}; settled ${d.settledZats} + balance refund rows = ${sum} vs received ${received} at the balance address (zat-exact)`);
  l.close();
}

// f18c: an unkeyable note is an ERROR. `backingOf` used to return [] for action_index > 65535 (and the legacy
// no-pool deposit identity was never keyable), so such a party was created as a silently UNKEYED row — two
// parties naming the SAME note could then both refund it.
{
  const l = new Ledger(st, uid(3));
  const unkeyable = [
    { party: `balance-late:${"d4".repeat(32)}:orchard:70000`, kind: "refund", amount_zats: "5000" } as Obligation,
    { party: `deposit:${"d4".repeat(32)}:orchard:70000`, kind: "refund", amount_zats: "5000" } as Obligation,
  ];
  let refused = "";
  try { l.pin([unkeyable[0]], []); } catch (e) { refused = (e as Error).message; }
  const rowsAfter = l.rows().length;
  const legacyRefused = (() => { try { l.pin([{ party: `deposit:${"e5".repeat(32)}:7`, kind: "refund", amount_zats: "5000" } as Obligation], []); return ""; } catch (e) { return (e as Error).message; } })();
  line("f18c-unkeyable-note-error",
    /unkeyable/.test(refused) && /an unkeyable note is an ERROR/.test(refused) && rowsAfter === 0 && /unkeyable/.test(legacyRefused),
    refused ? `refused: ${refused.slice(0, 120)}; rows created: ${rowsAfter}; legacy identity refused: ${!!legacyRefused}` : `party ${unkeyable[0].party} ACCEPTED into ${rowsAfter} row(s) — the note key was silently disabled (legacy also ${legacyRefused ? "refused" : "accepted"})`);
  l.close();
}

rmSync(assertScratch(st), { recursive: true, force: true });
console.log(all ? "RESULT PASS r44-f18" : "RESULT FAIL r44-f18");
process.exitCode = all ? 0 : 1;
