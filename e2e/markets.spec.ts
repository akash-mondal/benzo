// 1. Protects Phase 5 part 2 §3 (docs/design/phase5-part2-live.md): one live run over the market modes on the signer
//    hosts (host custody, R28) — per scenario the CLI result equals the registry's pure clear, the settlement receipts
//    equal the mode's obligations, every payment lands at the bidder's own destination, and `benzo verify` passes on a
//    cold copy. Scenarios: OTC match and no-match, launch meeting and missing its minimum raise, RFQ with a
//    non-allowlisted dealer and an RFQ that cancels, and a bid revision. (The collection drop joins with A14.)
// 2. Mutations 5M8 (superseded order counted), 5M9 (RFQ ignores the allowlist) and 5M10 (RFQ pays the lowest ask)
//    turn this spec's clear/outcome checks red (replayed: docs/evidence/phase-5/mutations/5M8–5M10.out); 5M6/5M7
//    need the drop.
// 3. The buyback spec covers Mode B; no other spec runs OTC, launch, RFQ or revision.
// 4. No seam: the scenarios run tools/repro/markets.ts, which drives shipped commands only, in parallel processes
//    coordinated by its DKG and funding locks and settlement's FROST signing lock.
import { expect, test } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/env";
import { Run } from "./lib/run";

const GROUPS = [["otc-match", "launch-meet", "rfq"], ["otc-nomatch", "launch-miss", "rfq-cancel", "revision"]];
const IDS = GROUPS.flat().map(s => `M-${s}`);

test("market modes settle under host custody", async () => {
  test.setTimeout(240 * 60_000); const run = new Run("markets");
  const bundle = path.join(ROOT, "tmp/markets-spec.mjs");
  const b = spawnSync("npx", ["esbuild", "tools/repro/markets.ts", "--bundle", "--packages=external", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=warning"], { cwd: ROOT, encoding: "utf8" });
  if (b.status !== 0) run.notRun(IDS, `harness bundle: ${b.stderr}`);
  const logs: string[] = [];
  await Promise.all(GROUPS.map((g, i) => new Promise<void>(async resolve => {
    // Stagger so the groups' DKGs and fundings start apart (the locks would serialize them anyway).
    await new Promise(r => setTimeout(r, i * 120_000));
    const p = spawn(process.execPath, [bundle, ...g], { cwd: ROOT, env: process.env });
    let out = ""; p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (out += d));
    p.on("close", () => { logs[i] = out; writeFileSync(path.join(ROOT, `tmp/markets-spec-${i}.log`), out); resolve(); });
  })));
  const all = logs.join("\n");
  for (const s of GROUPS.flat()) {
    await run.check(`M-${s}`, `${s}: pure clear, receipts = obligations, landed, cold verify`, () => {
      const lines = all.split("\n").filter(l => l.startsWith(`[${s}] `));
      expect(lines.some(l => l.includes("FATAL")), lines.filter(l => l.includes("FATAL")).join(" | ")).toBe(false);
      const errors = lines.filter(l => / ERROR /.test(l));
      expect(errors, errors.join(" | ")).toEqual([]);
      expect(lines.some(l => l.includes(`RESULT PASS ${s}`)), `no RESULT PASS for ${s}`).toBe(true);
    });
  }
});
