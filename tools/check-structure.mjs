#!/usr/bin/env node
// Structure checks: the mistake classes agents repeated in this repo (docs/design/agent-friendly.md), each made a
// failing check whose message names the fix. Run on the working tree, or on any commit with --ref <commit> (that is
// how every rule is proven against a real past mistake).
//   node tools/check-structure.mjs [--ref <commit>]
import { execFileSync } from "node:child_process";

const ref = process.argv.includes("--ref") ? process.argv[process.argv.indexOf("--ref") + 1] : null;
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 });
const files = (ref ? git("ls-tree", "-r", "--name-only", ref) : git("ls-files")).split("\n").filter((f) => /\.(ts|mjs)$/.test(f) && !f.startsWith("node_modules/") && !/(^|\/)dist\//.test(f));
const read = (f) => (ref ? git("show", `${ref}:${f}`) : execFileSync("cat", [f], { encoding: "utf8", maxBuffer: 64 << 20 }));

const PRODUCT = /^(settle|cli|clear|api|witness|manifest|envelope|crosschain)\//;
const HARNESS = /^(e2e\/|tools\/repro\/markets\.ts$)/;
const CHAIN_TOOL = /grpcurl|zcash-devtool|["'/]tle["']|bin\/tle|bin\("tle"\)|bin\('tle'\)/;
const SPAWN = /\b(spawnSync|execFileSync|execSync|spawn|execFile)\s*\(/; // R-AF-2: async forms too
const REVEAL_SITES = new Set(["settle/cli.ts", "cli/host-derive.ts", "cli/product.ts"]);
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
  // 3b. bounded-chain-io, variable-held commands (R-AF-2): spawn(cmd, …) where `cmd` is assigned a chain-tool path in
  // this file is held to the same rule; a variable hides the tool from the line rule above.
  if (inScope) {
    const chainVars = new Set([...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*(grpcurl|zcash-devtool|["'/]tle["'])/g)].map((m) => m[1]));
    lines.forEach((l, i) => {
      const m = l.match(/\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*([A-Za-z_$][\w$]*)\s*,/);
      if (m && chainVars.has(m[1]) && !/lwdBound|tleBound|timeout\s*:/.test(l))
        err(f, i + 1, "bounded-chain-io", `${m[1]} holds a chain tool; bound this call with lwdBound/tleBound (settle/bounded) or use settle/io run()`);
    });
  }
  // 3c. opaque-destination (class F: four P0s and B37 were a destination reaching a public document or log). A
  // bidder's destination is opened only through settle/envelopes (it returns an opaque Destination), and it is
  // revealed only at the reviewed payment-construction points below. A new reveal site is a review decision.
  // envelope/ is the primitive itself; crosschain/*.mjs are devnet demos that check the sealed deliver round trip.
  if (PRODUCT.test(f) && f.endsWith(".ts") && !f.startsWith("envelope/") && !/^settle\/(envelopes|destination)\.ts$/.test(f)) lines.forEach((l, i) => {
    if (/\bopenEnvelope\b/.test(l)) err(f, i + 1, "opaque-destination", "open destinations with openDestination (settle/envelopes), which returns an opaque Destination");
    if (/\bopenEnvelopePayload\b/.test(l) && f !== "cli/commands/xchain.ts") err(f, i + 1, "opaque-destination", "openEnvelopePayload exposes the refund destination; only xchain's deliver attestation may use it");
    if (/\.reveal\(\)/.test(l) && !REVEAL_SITES.has(f)) err(f, i + 1, "opaque-destination", "Destination.reveal() belongs only at payment construction (settle/cli.ts, cli/host-derive.ts, cli/product.ts); add a site only with a review");
  });
  // 3d. comment-swallowed-statement (R57 and R71: an edit glued a marker comment in front of the rest of the line, so a
  // statement became a comment — the markets Run construction, then auction-core's signatures.json write). A `//`
  // comment whose text ends in a call statement `name(…);` (optionally then closing braces, as in 4feaa86) is flagged.
  if (/\.(ts|mjs)$/.test(f)) lines.forEach((l, i) => {
    const c = l.match(/(?:^|[^:"'`\\])\/\/(.*)$/);
    if (c && /[A-Za-z_$][\w$.]*\([^()]*["'`][^()]*(\([^()]*\)[^()]*)*\)\s*;[\s}]*$/.test(c[1]) && !/["'`]/.test(l.slice(0, l.indexOf("//" + c[1])).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")))
      err(f, i + 1, "comment-swallowed-statement", "this comment ends in a statement; a marker comment swallowed code (R57, R71) — move the comment after the code or onto its own line");
  });
  // 4. evidence-through-write (R71): harness evidence files are written only through e2e/lib/run.ts write(), which redacts.
  if (HARNESS.test(f) && f !== "e2e/lib/run.ts") lines.forEach((l, i) => {
    if (/writeFileSync\([^)]*\b(OUT|EVIDENCE|evidence)\b/.test(l)) err(f, i + 1, "evidence-through-write", "write evidence with write() from e2e/lib/run.ts so destinations are redacted (B37 findings 1–3)");
  });
}
if (errors.length) { console.log(errors.join("\n")); console.log(`FAIL check:structure ${errors.length} error(s)${ref ? ` at ${ref}` : ""}`); process.exitCode = 1; }
else console.log(`OK check:structure${ref ? ` at ${ref}` : ""} (${files.length} files)`);
