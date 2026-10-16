#!/usr/bin/env node
// Structure checks: the mistake classes agents repeated in this repo (docs/design/agent-friendly.md), each made a
// failing check whose message names the fix. Run on the working tree, or on any commit with --ref <commit> (that is
// how every rule is proven against a real past mistake).
//   node tools/check-structure.mjs [--ref <commit>]
import { execFileSync } from "node:child_process";

const ref = process.argv.includes("--ref") ? process.argv[process.argv.indexOf("--ref") + 1] : null;
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 });
const files = (ref ? git("ls-tree", "-r", "--name-only", ref) : git("ls-files")).split("\n").filter((f) => /\.(ts|mjs)$/.test(f) && !f.startsWith("node_modules/") && !/\/dist\//.test(f));
const read = (f) => (ref ? git("show", `${ref}:${f}`) : execFileSync("cat", [f], { encoding: "utf8", maxBuffer: 64 << 20 }));

const PRODUCT = /^(settle|cli|clear|api|witness|manifest|envelope|crosschain)\//;
const HARNESS = /^(e2e\/|tools\/repro\/markets\.ts$)/;
const CHAIN_TOOL = /grpcurl|zcash-devtool|["'/]tle["']|bin\/tle|bin\("tle"\)|bin\('tle'\)/;
const SPAWN = /\b(spawnSync|execFileSync|execSync)\s*\(/;
const errors = [];
const err = (f, line, rule, msg) => errors.push(`${f}:${line} [${rule}] ${msg}`);

for (const f of files) {
  if (f === "tools/check-structure.mjs") continue;
  const src = read(f), lines = src.split("\n");
  const inScope = PRODUCT.test(f) || HARNESS.test(f);
  // 1. no-ts-nocheck (R66–R70: four fold bugs a typecheck would have caught hid behind it).
  if (/^\/\/\s*@ts-nocheck/m.test(src) && f.endsWith(".ts"))
    err(f, lines.findIndex((l) => /@ts-nocheck/.test(l)) + 1, "no-ts-nocheck", "type this file; @ts-nocheck hid R69/R70's undefined names and wrong arities");
  // 2. esm-no-require (R66): a bare require() in an ES module throws at runtime.
  if (inScope && f.endsWith(".ts")) lines.forEach((l, i) => {
    if (/(^|[^.\w"'`])require\(\s*["']/.test(l) && !/["'`].*require\(.*["'`]/.test(l)) err(f, i + 1, "esm-no-require", "import it at the top (ES module); require is undefined at runtime");
  });
  // 3. bounded-chain-io (R48/R49/R52 + Reviewer R P1s): a lightwalletd or drand process must be bounded.
  if (inScope) lines.forEach((l, i) => {
    if (!SPAWN.test(l)) return;
    const stmt = l; // the call's own line: a spawn naming a chain tool there is the pattern every past miss had
    if (!CHAIN_TOOL.test(stmt)) return;
    if (/lwdBound|tleBound|timeout\s*:/.test(stmt)) return;
    if (/["']pczt["']|["']inspect["']|["']prove["']|["']sign["']|init-fvk|list-tx|["']balance["']|redact|address|["']scan["']|version/.test(stmt) && !/["']-s["']|GetBlock|GetTransaction|SendTransaction|GetLatestBlock|["']sync["']|["']enhance["']|["']-d["']/.test(stmt)) return;
    err(f, i + 1, "bounded-chain-io", "chain/beacon I/O must go through settle/bounded (lwdBound / tleBound) or settle/io run(); an unbounded stream stalled RG for 51 min (R48)");
  });
  // 4. evidence-through-write (R71): harness evidence files are written only through e2e/lib/run.ts write(), which redacts.
  if (HARNESS.test(f) && f !== "e2e/lib/run.ts") lines.forEach((l, i) => {
    if (/writeFileSync\([^)]*\b(OUT|EVIDENCE|evidence)\b/.test(l)) err(f, i + 1, "evidence-through-write", "write evidence with write() from e2e/lib/run.ts so destinations are redacted (B37 findings 1–3)");
  });
}
if (errors.length) { console.log(errors.join("\n")); console.log(`FAIL check:structure ${errors.length} error(s)${ref ? ` at ${ref}` : ""}`); process.exitCode = 1; }
else console.log(`OK check:structure${ref ? ` at ${ref}` : ""} (${files.length} files)`);
