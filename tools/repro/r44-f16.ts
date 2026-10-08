// R44 item 1 (Reviewer R F16, `benzo-sol/reports/pr-a20-r42.md`): the expired-batch re-pin must never promote a row
// the derivable gate (G-5) parked, and an unbuildable batch must not pin the queue. Drives the shipped Ledger with
// the two pin-argument shapes settle/cli.ts has used:
//   old-expire-path   `ledger.pin(plan.obligations, plan.exceptions)` (pre-R44 :333) promotes the parked row (red);
//   r44-pinRows       the shared `pinRows()` arguments (rows WITH a recipient as ready, every other row an exception)
//                     keep it parked across an expire + re-pin (green);
//   r44-unbuildable   a batch every reachable host refused: its rows recorded unbuildable, the batch expired, and
//                     the re-pin keeps them exceptions — the next allocation does not contain them, so the queue moves.
// Run: npx esbuild tools/repro/r44-f16.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r44-f16.mjs && node tmp/r44-f16.mjs
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { hash } from "../../manifest/schema";
import { Ledger, type Obligation } from "../../settle/ledger";
import { assertScratch } from "./scratch";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
const base = assertScratch(path.join(ROOT, "tmp/r44-f16-state")); // R43: scratch only
rmSync(base, { recursive: true, force: true }); mkdirSync(base, { recursive: true });

let all = true;
const line = (id: string, ok: boolean, d: string) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`); if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; } };
const fresh = (n: string) => { const d = path.join(base, n); mkdirSync(d, { recursive: true }); return new Ledger(d, hash(randomBytes(32))); };
const derivable: Obligation = { party: "seller", kind: "payout", amount_zats: "500000" };
const parkedRow: Obligation = { party: "leaf:7", kind: "refund", amount_zats: "12345" };
const parkedReason = { ...parkedRow, reason: "no signer host derives this row" } as any;
const state = (l: Ledger, p: string) => l.rows().find(r => r.party === p)?.state;

// The shared pinRows() shape: ready = rows with a recipient, exceptions = everything else (settle/cli.ts R44).
const pinRows = (l: Ledger, ready: Obligation[], exceptions: any[]) => l.pin(ready, exceptions);

{ // old expire path: the parked row is promoted and allocated (the finding)
  const l = fresh("old"); pinRows(l, [derivable], [parkedReason]);
  l.pin([derivable, parkedRow], []); l.eligible();
  const b = l.allocate(28);
  const promoted = state(l, "leaf:7") !== "exception" && !!b?.outputs.some(o => o.party === "leaf:7");
  line("old-expire-path", promoted, `pre-R44 :333 shape promotes the parked row into batch ${b?.id ?? "none"} (expected: promoted, the finding)`);
}
{ // R44: the same arguments at the first pin and at the expire re-pin keep it parked
  const l = fresh("new"); pinRows(l, [derivable], [parkedReason]);
  l.eligible(); const b1 = l.allocate(28)!; l.expire(b1.id);
  pinRows(l, [derivable], [parkedReason]); l.eligible();
  const b2 = l.allocate(28);
  line("r44-pinRows", state(l, "leaf:7") === "exception" && !b2?.outputs.some(o => o.party === "leaf:7"),
    `after expire + re-pin: leaf:7 ${state(l, "leaf:7")}; next batch ${b2?.id ?? "none"} rows [${b2?.outputs.map(o => o.party).join(",") ?? ""}]`);
}
{ // R44: an unbuildable batch's rows move to exceptions and stay there; other rows still settle
  const l = fresh("unbuildable");
  const a: Obligation = { party: "leaf:1", kind: "refund", amount_zats: "200000" }, c: Obligation = { party: "leaf:2", kind: "refund", amount_zats: "200000" };
  pinRows(l, [a], []); l.eligible(); const b1 = l.allocate(28)!;            // batch 1 = {leaf:1}: every host refuses
  const unbuildable = new Set(b1.outputs.map(o => o.party)); l.expire(b1.id);
  const ready = [a, c].filter(o => !unbuildable.has(o.party)), exc = [a, c].filter(o => unbuildable.has(o.party)).map(o => ({ ...o, reason: "every signer host refused to build its batch" }));
  pinRows(l, ready, exc); l.eligible(); const b2 = l.allocate(28);
  line("r44-unbuildable", state(l, "leaf:1") === "exception" && !!b2 && b2.outputs.some(o => o.party === "leaf:2") && !b2.outputs.some(o => o.party === "leaf:1"),
    `leaf:1 ${state(l, "leaf:1")} (claimable); next batch ${b2?.id ?? "none"} = [${b2?.outputs.map(o => o.party).join(",") ?? ""}] — the queue moves`);
}
console.log(`RESULT r44-f16 ${all ? "PASS" : "FAIL"}`);
process.exitCode = all ? 0 : 1;
