// Ruling R40 item 2 (F2, A18 item 2): immutable per-note late-refund rows. Reviewer R's r39-ledger-growth
// repro showed the 025c736 "row grows" rule is a permanent settlement wedge: one out-of-window note arriving
// after the first plan grows a row that has left the exception state, `Ledger.pin` refuses it on every worker
// attempt, and no batch, refund or claim can ever run again — R38's own design rule violated by R38's own fix.
// R40 replaces the growing row with one IMMUTABLE row per note, keyed by the note
// (`balance-late:<txid>:<pool>:<action_index>`): a newly seen note ADDS a new row and never grows an existing
// one, and the ledger accepts new rows of this kind after the first plan.
//
// Green assertions (driving the shipped balanceSettlement/obligationsModeA/Ledger, red with mutation A18-F2
// "row growth restored"):
//   f2-late-rows-immutable              each late note is its own row, keyed by the note, for the note's own
//                                       value — the existing rows never change;
//   f2-late-note-after-settled-batch    plan 1 pins the rows and batch 1 SETTLES; one more late note after
//                                       that is accepted by pin as a NEW row and settlement proceeds (the
//                                       claim promotes it and batch 2 allocates it) — the wedge is gone;
//   f2-no-amount-change                 a row's amount never changes (pin refuses a changed amount);
//   f2-reorg-drop                       a late row whose note vanished (reorg) is dropped while unpaid and
//                                       never wedges a later plan.
// Run: npx esbuild tools/repro/r40-f2-ledger-growth.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r40-f2-ledger-growth.mjs && node tmp/r40-f2-ledger-growth.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ledger, type Obligation } from "../../settle/ledger";
import { balanceSettlement, isBalanceLateParty, type ScannedNote } from "../../clear/features";
import { obligationsModeA } from "../../clear/core";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r40-f2-ledger-growth.mjs (tools/repro/r40-f2-ledger-growth.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// The fixture: one bonded winner (leaf 0) at deposit slot 0, balance address bal0, owing 300,000, with its own
// 200,000 refund. Late notes at bal0 (out of the manifest-fixed window (1000, 1100]) are the reviewer's
// third-party dust / late payments.
const m = { deposit_addresses: ["dep0"], bond: { bond_bps: 500, balance_window_blocks: 100, balance_window_start_height: 1000, balance_addresses: ["bal0"] } } as any;
const result = { allocations: [{ leaf_index: 0, fill: 1, refund_zats: "200000", balance_due_zats: "300000" }], conservation: { payout_zats: "0", input_zats: "200000", refund_zats: "200000", fees_zats: "0", balances_zats: "300000" } } as any;
const leaves = [{ leaf_index: 0, deposit: { address: "dep0" } }] as any;
const noteA: ScannedNote = { txid: "aa".repeat(32), pool: "ironwood", action_index: 0, address: "bal0", height: 900, value_zats: 50_000 };
const noteB: ScannedNote = { txid: "bb".repeat(32), pool: "ironwood", action_index: 1, address: "bal0", height: 1200, value_zats: 30_000 };

// Exactly the plan's derivation (settle/plan.ts): the mode's obligations over the result and the shared
// per-note rows, split into the ready set and the parked (exception) set as the plan pins them.
const rowsFor = (notes: ScannedNote[]): { ready: Obligation[]; parked: Obligation[] } => {
  const settled = balanceSettlement(m, result, leaves, notes, 1300);
  const owed = obligationsModeA(result, { defaults: [], balance_refunds: settled.refunds });
  const mk = (party: string, amount_zats: string): Obligation => ({ party, kind: "refund", amount_zats });
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

const st = mkdtempSync(path.join(tmpdir(), "benzo-r40-f2-"));
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(st, "b1.pczt");
writeFileSync(fakePczt, Buffer.from("r40-f2 fixture batch"));

// f2-late-rows-immutable: one row per late note, keyed by the note, for the note's own value.
{
  const one = rowsFor([noteA]), two = rowsFor([noteA, noteB]);
  const partyA = `balance-late:${noteA.txid}:${noteA.pool}:${noteA.action_index}`, partyB = `balance-late:${noteB.txid}:${noteB.pool}:${noteB.action_index}`;
  line("f2-late-rows-immutable",
    one.parked.length === 1 && one.parked[0].party === partyA && one.parked[0].amount_zats === "50000" &&
      two.parked.map(r => r.party).join(",") === [partyA, partyB].sort().join(",") &&
      two.parked.find(r => r.party === partyA)!.amount_zats === "50000" &&
      JSON.stringify(two.ready) === JSON.stringify(one.ready),
    `rows note A ${JSON.stringify(one.parked)}; rows A+B ${JSON.stringify(two.parked)} (a new note adds a new row; the ready rows never change)`);
}

// f2-late-note-after-settled-batch (the required proof): plan 1 pins; batch 1 allocates AND SETTLES (money
// moved for its rows); ONE MORE late note after that must be accepted by pin as a new row — and settlement
// proceeds: the owner's claim promotes it and batch 2 allocates it. Red with A18-F2 (row growth restored):
// the derivation merges the notes into one growing row, pin refuses it after the settled batch, and every
// later attempt wedges exactly as r39-ledger-growth scenario 1.
{
  const l = new Ledger(st, uid(1));
  const p1 = rowsFor([noteA]);
  l.pin(p1.ready, p1.parked);
  l.eligible();
  const b1 = l.allocate(13)!;
  l.stage(b1.id, fakePczt, "11".repeat(32));
  l.confirm(b1.id, "11".repeat(32), 100, b1.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
  const settledRows = l.rows().map(r => `${r.party}=${r.state}`).join(",");
  const p2 = rowsFor([noteA, noteB]);
  let threw: string | null = null;
  try { l.pin(p2.ready, p2.parked); } catch (e) { threw = (e as Error).message; }
  const added = l.rows().find(r => r.party === `balance-late:${noteB.txid}:${noteB.pool}:${noteB.action_index}`);
  // Settlement proceeds: the owner's claim promotes the parked row (the claim path pins it ready), and a batch
  // allocates it.
  let b2: { id: number; outputs: { party: string }[] } | null = null;
  if (!threw) {
    l.pin([...p2.ready, ...p2.parked]); // the claim makes the rows payable
    l.eligible();
    b2 = l.allocate(13);
  }
  line("f2-late-note-after-settled-batch",
    threw === null && !!added && added.state === "exception" && added.amount_zats === "30000" &&
      !!b2 && b2.outputs.some(o => o.party === added.party),
    `batch 1 settled (${settledRows}); one more late note -> pin ${threw ? `threw ${JSON.stringify(threw)} (WEDGE)` : `accepted the new row ${JSON.stringify(added)}`}; claim batch ${b2 ? `allocates ${JSON.stringify(b2.outputs.map(o => o.party))}` : "NOT ALLOCATED"}`);
  l.close();
}

// f2-no-amount-change: refund rows never change — a re-derivation with a different amount never rewrites
// the pinned row and never wedges (Ruling R42 F12: pin logs the divergence and the pinned row stands).
{
  const l = new Ledger(st, uid(2));
  const p1 = rowsFor([noteA]);
  l.pin(p1.ready, p1.parked);
  const partyA = `balance-late:${noteA.txid}:${noteA.pool}:${noteA.action_index}`;
  let threw: string | null = null;
  try { l.pin(p1.ready, [{ party: partyA, kind: "refund", amount_zats: "60000" }]); } catch (e) { threw = (e as Error).message; }
  const row = l.rows().find(r => r.party === partyA);
  line("f2-no-amount-change", threw === null && row?.amount_zats === "50000",
    `changed re-derivation -> ${threw ? `threw ${JSON.stringify(threw)} (WEDGE)` : `no throw; the pinned row stands at ${row?.amount_zats} (rows are immutable)`}`);
  l.close();
}

// f2-reorg-drop: a late row whose note vanished (reorg/reclassify) is dropped while unpaid — never a wedge.
{
  const l = new Ledger(st, uid(3));
  const p1 = rowsFor([noteA]), p2 = rowsFor([noteA, noteB]);
  l.pin(p1.ready, p1.parked);
  l.pin(p2.ready, p2.parked);
  const partyB = `balance-late:${noteB.txid}:${noteB.pool}:${noteB.action_index}`;
  let threw: string | null = null;
  try { l.pin(p1.ready, p1.parked); } catch (e) { threw = (e as Error).message; }
  line("f2-reorg-drop", threw === null && !l.rows().some(r => r.party === partyB),
    `note B reorged away -> pin ${threw ? `threw ${JSON.stringify(threw)} (WEDGE)` : "dropped the unpaid row and proceeded"}`);
  l.close();
}

rmSync(st, { recursive: true, force: true });
console.log(all ? "RESULT PASS r40-f2-ledger-growth" : "RESULT FAIL r40-f2-ledger-growth");
process.exitCode = all ? 0 : 1;
