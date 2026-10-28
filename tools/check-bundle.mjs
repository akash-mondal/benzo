// check:bundle guard. The shipped
// public verifier bundle must match this tree: rebuild cli/verify-standalone.ts into tmp through the
// same tools/build-verify.mjs config `npm run build:verify` uses, and compare the fresh bytes with
// the committed dist/benzo-verify.mjs AND the digest recorded in docs/verify-bundle.sha256.
// Exit 1 on any mismatch. Run before every commit that touches api/, envelope/, settle/envelopes.ts,
// cli/commands/verify.ts or cli/published-beacon.ts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tmp = path.join(ROOT, "tmp", "benzo-verify.check.mjs");
execFileSync(process.execPath, [path.join(ROOT, "tools", "build-verify.mjs"), tmp], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const digest = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fresh = digest(tmp);
const committed = digest(path.join(ROOT, "dist", "benzo-verify.mjs"));
const recorded = readFileSync(path.join(ROOT, "docs", "verify-bundle.sha256"), "utf8").trim().split(/\s+/)[0];
rmSync(tmp, { force: true });
const problems = [];
if (fresh !== committed) problems.push(`ERROR check:bundle dist/benzo-verify.mjs is stale: committed ${committed}, fresh rebuild ${fresh} — run npm run build:verify and commit the result`);
if (fresh !== recorded) problems.push(`ERROR check:bundle docs/verify-bundle.sha256 records ${recorded}, fresh rebuild ${fresh} — run npm run build:verify and commit the result`);
for (const p of problems) console.error(p);
if (problems.length) process.exit(1);
console.log(`OK check:bundle ${fresh} dist/benzo-verify.mjs and docs/verify-bundle.sha256 match a fresh rebuild of this tree`);
