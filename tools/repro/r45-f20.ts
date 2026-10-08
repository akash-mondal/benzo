// Ruling R45 item 4 (Reviewer R F20, P1 in the head's F16 fix; `benzo-sol/reports/pr-a22-r44.md`): the
// unbuildable-batch path must never condemn honest rows. A host `sign build` that TIMES OUT or exits 1 is
// "unreachable" — the batch is retried and nothing is condemned. Only when EVERY reached host gives a TYPED
// refusal (exit 3 listing the rows it cannot derive) is the batch unbuildable, and only the rows NO reached
// host derives (the intersection) are set aside: a refund row becomes a claimable exception (recorded in
// unbuildable.json), a payout row (seller, treasury) is DEFERRED for this run only — never condemned — and is
// re-derived on the next settle. The pre-R45 rule (any failure condemns the whole batch forever) is the
// mutation red.
// 1. Which behavior does it protect: settlement liveness and recoverability (DESIGN settlement flow; R44 F16
//    expiry semantics as corrected by R45) — a transient host failure must never strand honest rows, and a
//    condemned seller payout (which `claim-refund` cannot claim) must never exist.
// 2. Which credible regression makes it fail: the pre-R45 classification (settle/cli.ts before d2255fb) — any
//    nonzero `sign build` status INCLUDING a timeout counted as a refusal and every row of the batch was
//    condemned forever, payout rows included (Reviewer R's F20 X1b/X1c).
// 3. Why no existing test catches it: r44-f16 drives the expired-batch re-pin only; nothing drove a timeout
//    vs a typed refusal, the intersection rule, or the payout-row deferral/re-eligibility.
// 4. Production seam: none — this drives the shipped pure rule (settle/build-outcome.ts classifyBuildAttempts
//    and setAsideRows, extracted from settle/cli.ts hostBuild/worker, behaviour identical) and the shipped
//    Ledger (pin/expire/allocate/eligible/stage/confirm) with exactly the worker's catch sequence
//    (`expire; pinRows; eligible; continue`). Scratch state only (R43 guard).
// Assertions (the A23-F20 mutation — the pre-R45 rule — turns all three red):
//   f20-timeout-retried                a host timeout (status null) plus an exit-1 failure: the batch is NOT
//                                      unbuildable, nothing is set aside, and the retry sees the same batch
//                                      with every row still allocated (nothing condemned);
//   f20-set-aside-only-refused-rows    every reached host typed-refuses, disagreeing on supersets
//                                      {X,Y} and {X,Z}: only the intersection X is set aside (a refund row →
//                                      claimable exception), and seller + leaf:1 settle in the NEXT batch;
//   f20-seller-deferred-not-condemned  every reached host typed-refuses the seller row: it is deferred (never
//                                      in the condemned/unbuildable record) and the next settle re-derives it
//                                      eligible again, while the other rows settle first.
// Run: npx esbuild tools/repro/r45-f20.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r45-f20.mjs && node tmp/r45-f20.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyBuildAttempts, setAsideRows, type BuildOutcome } from "../../settle/build-outcome";
import { Ledger, type Obligation } from "../../settle/ledger";

console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r45-f20.mjs (tools/repro/r45-f20.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};

const st = mkdtempSync(path.join(tmpdir(), "benzo-r45-f20-"));
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(st, "b.pczt");
writeFileSync(fakePczt, Buffer.from("r45-f20 fixture batch"));
const N = `${"11".repeat(32)}:ironwood:0`;
const X: Obligation = { party: `balance-late:${N}`, kind: "refund", amount_zats: "5000", notes: [N] };
const leaf1: Obligation = { party: "leaf:1", kind: "refund", amount_zats: "200000" };
const seller: Obligation = { party: "seller", kind: "payout", amount_zats: "700000" };
const settleBatch = (l: Ledger, id: number): void => {
  const b = l.allocate(13)!;
  const txid = id.toString(16).padStart(2, "0").repeat(32);
  l.stage(b.id, fakePczt, txid);
  l.confirm(b.id, txid, 100, b.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
};
// The worker's catch sequence after a set-aside (settle/cli.ts): expire the batch, re-pin — pinRows drops the
// recipient of every set-aside row (condemned to unbuildable.json or deferred for this run), so only the other
// rows stay ready — then re-allocate. The NEXT settle run re-derives every row except the recorded condemned.
const setAsideRun = (l: Ledger, batchId: number, ready: Obligation[], condemned: string[], deferred: string[]): void => {
  l.expire(batchId);
  const aside = new Set([...condemned, ...deferred]);
  const exceptions = [...condemned, ...deferred].map((p) => {
    const o = [X, leaf1, seller].find((r) => r.party === p)!;
    return { ...o, reason: condemned.includes(p) ? "no signer host derives this row from its own data; claimable through benzo claim-refund" : "payout deferred: no signer host could build it this run; re-derived on the next settle" };
  });
  l.pin(ready.filter((r) => !aside.has(r.party)), exceptions);
  l.eligible();
};
// A case that throws is a failed case (one grep-able ERROR line), never a crashed run.
const caseRun = (id: string, fn: () => [boolean, string]): void => {
  try { const [ok, d] = fn(); line(id, ok, d); }
  catch (e) { line(id, false, `threw: ${(e as Error).message.slice(0, 200)}`); }
};

// ---- case 1: a host timeout (SIGKILL kill: status null) and an exit-1 transient — "unreachable", retried --
caseRun("f20-timeout-retried", () => {
  const l = new Ledger(st, uid(1));
  l.pin([leaf1, seller], []); l.eligible();
  const b1 = l.allocate(13)!;
  const attempts: BuildOutcome[] = [{ status: null, stderr: "" }, { status: 1, stderr: "ERROR signer bob could not build: connection reset" }];
  const c = classifyBuildAttempts(attempts);
  const aside = setAsideRows(b1.outputs.map(({ party, kind }) => ({ party, kind })), c.refusedRows);
  const retry = l.allocate(13)!; // the worker rethrows on !unbuildable: the batch is retried as-is
  const states = Object.fromEntries(l.rows().map((r) => [r.party, r.state]));
  const ok = !c.unbuildable && c.refusedRows.length === 0 && aside.condemned.length === 0 && aside.deferred.length === 0 &&
    retry.id === b1.id && retry.outputs.length === 2 && Object.values(states).every((s) => s === "allocated");
  l.close();
  return [ok,
    `classify(unbuildable=${c.unbuildable}, refusedRows=${JSON.stringify(c.refusedRows)}); set-aside condemned ${JSON.stringify(aside.condemned)} deferred ${JSON.stringify(aside.deferred)}; retry sees batch ${retry.id} with ${retry.outputs.length} rows (batch ${b1.id}), row states ${JSON.stringify(states)} — a timeout/exit-1 is retried, never condemned`];
});

// ---- case 2: every reached host typed-refuses, disagreeing on supersets — only the intersection is set aside
caseRun("f20-set-aside-only-refused-rows", () => {
  const l = new Ledger(st, uid(2));
  l.pin([X, leaf1, seller], []); l.eligible();
  const b1 = l.allocate(13)!;
  const attempts: BuildOutcome[] = [
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([X.party, "leaf:1"])}` },
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([X.party, "seller"])}` },
  ];
  const c = classifyBuildAttempts(attempts);
  const aside = setAsideRows(b1.outputs.map(({ party, kind }) => ({ party, kind })), c.refusedRows);
  setAsideRun(l, b1.id, [leaf1, seller], aside.condemned, aside.deferred);
  const b2 = l.allocate(13)!;
  settleBatch(l, 2);
  // the next settle run: the condemned row stays recorded (its unbuildable.json entry), never re-promoted
  l.pin([leaf1, seller].map((o) => ({ ...o })), [{ ...X, reason: "no signer host derives this row from its own data; claimable through benzo claim-refund" }]);
  l.eligible();
  const x = l.rows().find((r) => r.party === X.party)!;
  const ok = c.unbuildable && JSON.stringify(c.refusedRows) === JSON.stringify([X.party]) &&
    JSON.stringify(aside.condemned) === JSON.stringify([X.party]) && aside.deferred.length === 0 &&
    JSON.stringify(b2.outputs.map((o) => o.party)) === JSON.stringify(["leaf:1", "seller"]) &&
    x.state === "exception" && !l.receipts().some((r) => r.party === X.party);
  const d = `classify(unbuildable=${c.unbuildable}, refusedRows=${JSON.stringify(c.refusedRows)}) — the intersection of {${X.party},leaf:1} and {${X.party},seller}; set-aside condemned ${JSON.stringify(aside.condemned)} deferred ${JSON.stringify(aside.deferred)}; next batch pays ${JSON.stringify(b2.outputs.map((o) => o.party))}; the refused row stays ${x.state} (claimable exception, never paid)`;
  l.close();
  return [ok, d];
});

// ---- case 3: a refused SELLER row is deferred, never condemned, and eligible again on the next settle ----
caseRun("f20-seller-deferred-not-condemned", () => {
  const l = new Ledger(st, uid(3));
  l.pin([leaf1, seller], []); l.eligible();
  const b1 = l.allocate(13)!;
  const attempts: BuildOutcome[] = [
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify(["seller"])}` },
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify(["seller"])}` },
  ];
  const c = classifyBuildAttempts(attempts);
  const aside = setAsideRows(b1.outputs.map(({ party, kind }) => ({ party, kind })), c.refusedRows);
  setAsideRun(l, b1.id, [leaf1], aside.condemned, aside.deferred);
  const b2 = l.allocate(13)!;
  settleBatch(l, 2); // the other rows settle first
  const sellerMid = l.rows().find((r) => r.party === "seller")!;
  // the next settle run: the deferred payout row is re-derived (it is NOT in the unbuildable record) and
  // promoted from its this-run exception back to eligible — the shipped pin's exception-promotion path.
  l.pin([leaf1, seller], []);
  l.eligible();
  const b3 = l.allocate(13)!;
  settleBatch(l, 3);
  const sellerEnd = l.rows().find((r) => r.party === "seller")!;
  const ok = c.unbuildable && JSON.stringify(c.refusedRows) === JSON.stringify(["seller"]) &&
    aside.condemned.length === 0 && JSON.stringify(aside.deferred) === JSON.stringify(["seller"]) &&
    JSON.stringify(b2.outputs.map((o) => o.party)) === JSON.stringify(["leaf:1"]) &&
    sellerMid.state === "exception" && b3.outputs.some((o) => o.party === "seller") && sellerEnd.state === "paid";
  const d = `set-aside condemned ${JSON.stringify(aside.condemned)} (never the payout row) deferred ${JSON.stringify(aside.deferred)}; this run: ${sellerMid.state} (deferred exception, not unbuildable.json); the next settle pays it in batch ${b3.id} → ${sellerEnd.state}; the other rows settled first in batch ${b2.id}`;
  l.close();
  return [ok, d];
});

rmSync(assertScratch(st), { recursive: true, force: true });
console.log(all ? "RESULT PASS r45-f20" : "RESULT FAIL r45-f20");
process.exitCode = all ? 0 : 1;
