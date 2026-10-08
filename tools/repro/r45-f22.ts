// Ruling R45 item 3 (Reviewer R F22, `benzo-sol/reports/pr-a22-r44.md`): the F18 amount rule's single-note
// assumption becomes an ASSERTION — a multi-note taking row is an ERROR, never silently mis-sized. The rule
// subtracts a taking row's WHOLE amount for each of its notes the new row carries; exact only when the taking
// row backs exactly one note at its own value.
// 1. Which behavior does it protect: refund-row conservation (DESIGN refund rules; R42 F15's one-note-one-
//    refund key) — the per-note skip must never subtract more than the taken note's own value, which silently
//    strands the free notes' value (under-refund) or spuriously skips the row.
// 2. Which credible regression makes it fail: the F18 amount rule as written (settle/ledger.ts) — with a
//    multi-note taking row it subtracts that row's whole amount for ONE taken note, so a partially-colliding
//    new row is created at the wrong amount (or not created at all) and zat-exact conservation breaks.
// 3. Why no existing test catches it: r44-f18's f18a/f18b drive only SINGLE-note taking rows (the multi-note
//    row there is the NEW row — the F18 direction); nothing drove the reversed roles F22 names.
// 4. Production seam: none — this drives the shipped Ledger (pin) at the exact boundary the worker's
//    `keyed` pinRows call drives it (settle/cli.ts), with the note-shaped backing `plan.balance_refunds`
//    carries in. The multi-note taking-row shape is UNCONFIRMED-reachable through the shipped derivation
//    (one bid per slot ⇒ one excess row per address, all other rows one-note); pin is its real boundary.
// Assertions (the pre-F22 tree turns the first red):
//   f22-multinote-taking-row-error  [F22] a new row whose backing includes a note of a MULTI-NOTE taking row
//                                    — red: pin accepts silently and subtracts the taking row's whole amount
//                                    for that one note (row mis-sized, the free note's value stranded);
//                                    green: pin refuses with the specific ERROR before any subtraction;
//   f22-single-note-skip-unchanged  control (green before and after): f18b's shape — a single-note taking
//                                    row still subtracts exactly its own note's value (zat-exact skip).
// Run: npx esbuild tools/repro/r45-f22.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r45-f22.mjs && node tmp/r45-f22.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ledger, type Obligation } from "../../settle/ledger";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r45-f22.mjs (tools/repro/r45-f22.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};

const st = mkdtempSync(path.join(tmpdir(), "benzo-r45-f22-"));
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(st, "b.pczt");
writeFileSync(fakePczt, Buffer.from("r45-f22 fixture batch"));
// Ruling R46 (F23): the F18 skip runs against a row money has moved for — the taking row is SETTLED first
// (an unpaid taking row is dropped or replaced before any subtraction, never subtracted).
const settle = (l: Ledger): void => {
  l.eligible();
  const b = l.allocate(13)!;
  l.stage(b.id, fakePczt, "11".repeat(32));
  l.confirm(b.id, "11".repeat(32), 100, b.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
};
const N1 = `${"a1".repeat(32)}:ironwood:0` // 60,000 — in-window note 1
const N3 = `${"c3".repeat(32)}:ironwood:2` // 40,000 — in-window note 2
const N2 = `${"b2".repeat(32)}:ironwood:1` // 100,000 — the free note of the new row
const lateParty = `balance-late:${N2}`;

// f22: the F22 shape at pin()'s real boundary. P is a MULTI-NOTE taking row (`balance-excess:0` over N1+N3,
// 100,000) money has moved for (settled below). The new row's backing is [N3, N2] — N3 is already P's
// (taken), N2 is free — and its amount (140,000) is the two notes' values. The F18 amount rule subtracts P's WHOLE 100,000 for the one taken note
// N3 (its own value is 40,000): the row is created at 40,000 instead of 100,000 and 60,000 of N2's value is
// silently stranded. Ruling R45: that is an ERROR, never a wrong subtraction.
{
  const l = new Ledger(st, uid(1));
  const P: Obligation = { party: "balance-excess:0", kind: "refund", amount_zats: "100000", notes: [N1, N3] };
  const Q: Obligation = { party: lateParty, kind: "refund", amount_zats: "140000", notes: [N3, N2] };
  l.pin([P], []); settle(l);
  let refused = "";
  try { l.pin([Q], []); } catch (e) { refused = (e as Error).message; }
  const row = l.rows().find(r => r.party === lateParty);
  const ok = /multi-note taking row/.test(refused) && /balance-excess:0/.test(refused) && /an ERROR/.test(refused) && !row;
  line("f22-multinote-taking-row-error", ok,
    ok ? `refused: ${refused.slice(0, 140)}`
      : `pin ${refused ? `threw "${refused.slice(0, 80)}"` : "ACCEPTED silently"}: new row ${row ? `created at ${row.amount_zats} (correct: 100000 — the taking row's whole amount was subtracted for one 40000 note)` : "not created (spurious skip)"}; ${row ? String(100000 - Number(row.amount_zats)) : "100000"} of the free note's value can never refund`);
  l.close();
}

// control: f18b's shape unchanged — a SINGLE-NOTE taking row (`balance-late:` N1, 100,000 = N1's own value)
// money has moved for subtracts exactly its note's value from the multi-note excess row (110,000 - 100,000 =
// 10,000 over N3).
{
  const l = new Ledger(st, uid(2));
  const P: Obligation = { party: `balance-late:${N1}`, kind: "refund", amount_zats: "100000", notes: [N1] };
  const Q: Obligation = { party: "balance-excess:0", kind: "refund", amount_zats: "110000", notes: [N1, N3] };
  l.pin([P], []); settle(l);
  let refused = "";
  try { l.pin([Q], []); } catch (e) { refused = (e as Error).message; }
  const row = l.rows().find(r => r.party === "balance-excess:0");
  line("f22-single-note-skip-unchanged", !refused && row?.amount_zats === "10000",
    refused ? `refused: ${refused.slice(0, 120)}` : `per-note skip intact: excess row over the free note at ${row?.amount_zats} (expected 10000)`);
  l.close();
}

rmSync(assertScratch(st), { recursive: true, force: true });
console.log(all ? "RESULT PASS r45-f22" : "RESULT FAIL r45-f22");
process.exitCode = all ? 0 : 1;
