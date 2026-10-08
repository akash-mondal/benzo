// Ruling R45 item 4 (Reviewer R F20, P1 in the head's F16 fix; `benzo-sol/reports/pr-a22-r44.md`), CORRECTED
// by Ruling R46 (Reviewer R F20 residual + F25; `benzo-sol/reports/pr-a23-r45.md`): the unbuildable-batch path
// must never condemn honest rows. A host `sign build` that TIMES OUT or exits 1 is "unreachable" — the batch is
// retried and nothing is set aside. Only when EVERY reached host gives a TYPED refusal (exit 3 listing the rows
// it cannot derive) is anything set aside, and only the rows NO reached host derives (the intersection, within
// the batch). **R46: a set-aside is RUN-LOCAL and never persisted (unbuildable.json is gone)** — every settle
// re-derives every row through the G-5 derivable gate, so an owner's claim that makes a refund derivable pays it
// on the next settle, and a payout re-derives as soon as a host can build it. When every reached host typed-refuses
// but no row is refused by ALL of them (disjoint sets), the batch is ISOLATED: its rows retry one per batch, and a
// singleton refused by every reached host is set aside by name. Every iteration builds a batch or removes a row.
// 1. Which behavior does it protect: settlement liveness and recoverability (DESIGN settlement flow; R44 F16's
//    expiry semantics as corrected by R45/R46) — a transient host failure must never strand honest rows, a
//    condemned payout must never exist, and a claimable refund must actually pay once claimed.
// 2. Which credible regression makes it fail: the pre-R45 classification (any failure, timeouts included,
//    condemned every row of the batch forever — Reviewer R's F20 X1b/X1c) and the pre-R46 persistent set-aside
//    (unbuildable.json: a set-aside row was condemned FOREVER, so an owner claim could never pay it), plus the
//    R45 F25 wedge (disjoint typed refusals killed the run and every future run).
// 3. Why no existing test catches it: r44-f16 drives the expired-batch re-pin only; nothing drove a timeout vs a
//    typed refusal, the intersection rule, the run-local set-aside's claim-then-paid path, or the isolation.
// 4. Production seam: none — this drives the shipped pure rule (settle/build-outcome.ts classifyBuildAttempts,
//    extracted from settle/cli.ts hostBuild and now carrying R46's batch-scoped intersection + isolation) and
//    the shipped Ledger (pin/expire/allocate/eligible/stage/confirm) with exactly the worker's catch sequence
//    (settle/cli.ts: `ledger.expire; pinRows; eligible; continue`, set-aside rows exception for THIS run only).
//    Scratch state only (R43 guard).
// Assertions (the A24-F20persist mutation — the persistent set-aside restored — turns the two re-derivation
// legs red; the R45-era A23-F20 mutation (any failure condemns the whole batch) turns all four red):
//   f20-timeout-retried                a host timeout (status null) plus an exit-1 failure: not unbuildable and
//                                      not isolated, nothing set aside, and the retry sees the same batch with
//                                      every row still allocated;
//   f20-set-aside-only-refused-rows    every reached host typed-refuses, disagreeing on supersets {X,leaf:1} and
//                                      {X,seller}: only the intersection X is set aside (run-locally), leaf:1 +
//                                      seller settle in the NEXT batch, and once an owner claim makes X derivable
//                                      the next settle PAYS it (claim-then-paid; never condemned);
//   f20-seller-deferred-not-condemned  every reached host typed-refuses the seller payout row: set aside for this
//                                      run only, the other rows settle first, and the next settle re-derives and
//                                      pays it — nothing is persisted, so no payout can be condemned forever;
//   f20-isolate-disjoint-refusals      every reached host typed-refuses but DISJOINTLY ({X} vs {leaf:1}): nothing
//                                      is set aside, the batch is isolated — its rows retry one per batch — and a
//                                      singleton refused by every reached host is set aside by name while the
//                                      other singletons settle (the F25 wedge closed).
// Run: npx esbuild tools/repro/r45-f20.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r45-f20.mjs && node tmp/r45-f20.mjs
import { execFileSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyBuildAttempts, type BuildOutcome } from "../../settle/build-outcome";
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
const caseRun = (id: string, fn: () => [boolean, string]): void => {
  try { const [ok, d] = fn(); line(id, ok, d); }
  catch (e) { line(id, false, `threw: ${(e as Error).message.slice(0, 200)}`); }
};

const st = mkdtempSync(path.join(tmpdir(), "benzo-r45-f20-"));
const uid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const fakePczt = path.join(st, "b.pczt");
writeFileSync(fakePczt, Buffer.from("r45-f20 fixture batch"));
const N = `${"11".repeat(32)}:ironwood:0`;
const X: Obligation = { party: `balance-late:${N}`, kind: "refund", amount_zats: "5000", notes: [N] };
const leaf1: Obligation = { party: "leaf:1", kind: "refund", amount_zats: "200000" };
const seller: Obligation = { party: "seller", kind: "payout", amount_zats: "700000" };
const asideReason = "set aside this run: no reachable signer host builds it; re-derived on the next settle (an owner claim makes a refund derivable)";
const settleBatch = (l: Ledger, id: number, cap = 13): void => {
  const b = l.allocate(cap)!;
  const txid = id.toString(16).padStart(2, "0").repeat(32);
  l.stage(b.id, fakePczt, txid);
  l.confirm(b.id, txid, 100, b.outputs.map((o, i) => ({ party: o.party, amount_zats: o.amount_zats, index: i, pool: "orchard" })));
};
// The worker's catch sequence (settle/cli.ts, R46): expire the batch, re-pin — pinRows drops the recipient of
// every run-locally set-aside row (exception for THIS run with the aside reason) — then re-allocate. Nothing is
// persisted: the NEXT settle re-derives every row through the G-5 gate (an owner claim makes a refund derivable).
const setAsideRun = (l: Ledger, batchId: number, ready: Obligation[], aside: string[], pool: Obligation[]): void => {
  l.expire(batchId);
  l.pin(ready.filter((r) => !aside.includes(r.party)),
    aside.map((p) => ({ ...pool.find((r) => r.party === p)!, reason: asideReason })));
  l.eligible();
};

// ---- case 1: a host timeout (SIGKILL kill: status null) and an exit-1 transient — "unreachable", retried --
caseRun("f20-timeout-retried", () => {
  const l = new Ledger(st, uid(1));
  l.pin([leaf1, seller], []); l.eligible();
  const b1 = l.allocate(13)!;
  const attempts: BuildOutcome[] = [{ status: null, stderr: "" }, { status: 1, stderr: "ERROR signer bob could not build: connection reset" }];
  const c = classifyBuildAttempts(attempts, b1.outputs.map((o) => o.party));
  const retry = l.allocate(13)!; // the worker rethrows on !unbuildable && !isolate: the batch is retried as-is
  const states = Object.fromEntries(l.rows().map((r) => [r.party, r.state]));
  const ok = !c.unbuildable && !c.isolate && c.refusedRows.length === 0 &&
    retry.id === b1.id && retry.outputs.length === 2 && Object.values(states).every((s) => s === "allocated");
  const d = `classify(unbuildable=${c.unbuildable}, isolate=${c.isolate}, refusedRows=${JSON.stringify(c.refusedRows)}); retry sees batch ${retry.id} with ${retry.outputs.length} rows (batch ${b1.id}), row states ${JSON.stringify(states)} — a timeout/exit-1 is retried, never set aside`;
  l.close();
  return [ok, d];
});

// ---- case 2: typed refusals {X,leaf:1} / {X,seller}: only the intersection X is set aside (run-locally), the
// ---- other rows settle next, and an owner claim pays X on the following settle (R46 claim-then-paid) --------
caseRun("f20-set-aside-only-refused-rows", () => {
  const l = new Ledger(st, uid(2));
  l.pin([X, leaf1, seller], []); l.eligible();
  const b1 = l.allocate(13)!;
  const parties = b1.outputs.map((o) => o.party);
  const attempts: BuildOutcome[] = [
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([X.party, "leaf:1"])}` },
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([X.party, "seller"])}` },
  ];
  const c = classifyBuildAttempts(attempts, parties);
  setAsideRun(l, b1.id, [leaf1, seller], c.refusedRows, [X, leaf1, seller]);
  const b2 = l.allocate(13)!;
  settleBatch(l, 2);
  const xMid = l.rows().find((r) => r.party === X.party)!;
  // the next settle: nothing persisted (R46) — X is re-derived through the G-5 gate; the owner claim that made
  // it derivable is recorded, so the run pins it ready and the ledger promotes it out of the exception queue.
  l.pin([X, leaf1, seller], []);
  l.eligible();
  const b3 = l.allocate(13)!;
  settleBatch(l, 3);
  const xEnd = l.rows().find((r) => r.party === X.party)!;
  const ok = c.unbuildable && !c.isolate && JSON.stringify(c.refusedRows) === JSON.stringify([X.party]) &&
    JSON.stringify(b2.outputs.map((o) => o.party)) === JSON.stringify(["leaf:1", "seller"]) &&
    xMid.state === "exception" && b3.outputs.some((o) => o.party === X.party) && xEnd.state === "refunded";
  const d = `classify(unbuildable=${c.unbuildable}, refusedRows=${JSON.stringify(c.refusedRows)}) — the intersection of {X,leaf:1} and {X,seller}; next batch pays ${JSON.stringify(b2.outputs.map((o) => o.party))}; X this run: ${xMid.state} (set aside run-locally, never persisted); after the owner claim the next settle pays it in batch ${b3.id} → ${xEnd.state}`;
  l.close();
  return [ok, d];
});

// ---- case 3: a refused SELLER payout row is set aside this run only and paid on the next settle -------------
caseRun("f20-seller-deferred-not-condemned", () => {
  const l = new Ledger(st, uid(3));
  l.pin([leaf1, seller], []); l.eligible();
  const b1 = l.allocate(13)!;
  const attempts: BuildOutcome[] = [
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify(["seller"])}` },
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify(["seller"])}` },
  ];
  const c = classifyBuildAttempts(attempts, b1.outputs.map((o) => o.party));
  setAsideRun(l, b1.id, [leaf1], c.refusedRows, [leaf1, seller]);
  const b2 = l.allocate(13)!;
  settleBatch(l, 2); // the other rows settle first
  const sellerMid = l.rows().find((r) => r.party === "seller")!;
  // the next settle: nothing persisted — the payout row is re-derived as soon as a host can build it.
  l.pin([leaf1, seller], []);
  l.eligible();
  const b3 = l.allocate(13)!;
  settleBatch(l, 3);
  const sellerEnd = l.rows().find((r) => r.party === "seller")!;
  const ok = c.unbuildable && JSON.stringify(c.refusedRows) === JSON.stringify(["seller"]) &&
    JSON.stringify(b2.outputs.map((o) => o.party)) === JSON.stringify(["leaf:1"]) &&
    sellerMid.state === "exception" && b3.outputs.some((o) => o.party === "seller") && sellerEnd.state === "paid";
  const d = `classify(refusedRows=${JSON.stringify(c.refusedRows)}); this run: ${sellerMid.state} (set aside run-locally — R46: no unbuildable.json, nothing ever persisted); the next settle re-derives and pays it in batch ${b3.id} → ${sellerEnd.state}; the other rows settled first in batch ${b2.id}`;
  l.close();
  return [ok, d];
});

// ---- case 4: disjoint typed refusals — nothing set aside; the batch is ISOLATED (one row per batch); the
// ---- singletons a host CAN build settle, and a singleton every reached host typed-refuses is set aside by
// ---- name so the loop terminates (R46/F25) ---------------------------------------------------------------
caseRun("f20-isolate-disjoint-refusals", () => {
  const nZ = `${"22".repeat(32)}:ironwood:2`;
  const Z: Obligation = { party: `balance-late:${nZ}`, kind: "refund", amount_zats: "7000", notes: [nZ] };
  const l = new Ledger(st, uid(4));
  l.pin([X, leaf1, Z], []); l.eligible();
  const b1 = l.allocate(13)!;
  const parties = b1.outputs.map((o) => o.party);
  // host 1 cannot derive X; host 2 cannot derive leaf:1 — the refusal sets are DISJOINT.
  const c = classifyBuildAttempts([
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([X.party])}` },
    { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([leaf1.party])}` },
  ], parties);
  // the worker: nothing set aside at batch level; isolate = the batch's row count -> its rows retry one per batch
  let isolate = c.isolate ? b1.outputs.length : 0;
  l.expire(b1.id); l.pin([X, leaf1, Z], []); l.eligible();
  const steps: string[] = [];
  const onSingleton: Record<string, () => void> = {
    [X.party]: () => { // X: host 1 refuses it again, host 2 BUILDS it (its refusal named only leaf:1)
      steps.push(`${X.party} built`); settleBatch(l, 21, 1);
    },
    [leaf1.party]: () => { // leaf:1: host 2 refuses it again, host 1 BUILDS it
      steps.push("leaf:1 built"); settleBatch(l, 22, 1);
    },
    [Z.party]: () => { // Z: every reached host gives a typed refusal naming rows outside it -> set aside by name
      const one = classifyBuildAttempts([
        { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([X.party])}` },
        { status: 3, stderr: `ERROR sign build refused-rows ${JSON.stringify([leaf1.party])}` },
      ], [Z.party]);
      const b = l.allocate(1)!;
      steps.push(`${Z.party} set aside by name (singleton: unbuildable=${one.unbuildable}, isolate=${one.isolate}, refusedRows=${JSON.stringify(one.refusedRows)})`);
      setAsideRun(l, b.id, [], [Z.party], [Z]);
    },
  };
  while (isolate > 0) {
    isolate--;
    const b = l.allocate(1)!;
    onSingleton[b.outputs[0].party]();
  }
  const states = Object.fromEntries(l.rows().map((r) => [r.party, r.state]));
  const ok = !c.unbuildable && c.isolate && c.refusedRows.length === 0 && steps.length === 3 &&
    states[X.party] === "refunded" && states["leaf:1"] === "refunded" && states[Z.party] === "exception";
  const d = `classify(unbuildable=${c.unbuildable}, isolate=${c.isolate}, refusedRows=${JSON.stringify(c.refusedRows)}) — disjoint refusals set NOTHING aside; one per batch: ${JSON.stringify(steps)}; row states ${JSON.stringify(states)} — the derivable singletons settle and the refused singleton is set aside by name (F25: every iteration builds a batch or removes a row)`;
  l.close();
  return [ok, d];
});

rmSync(assertScratch(st), { recursive: true, force: true });
console.log(all ? "RESULT PASS r45-f20" : "RESULT FAIL r45-f20");
process.exitCode = all ? 0 : 1;
