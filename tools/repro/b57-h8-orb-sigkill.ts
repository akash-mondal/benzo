// B57 (H8, docs/design/phase7-hardening.md): an `orb` client that ignores SIGTERM no longer blocks `sh()`.
// A PATH stub named `orb` traps TERM and sleeps for an hour, the way the stuck live clients behaved (RG attempt
// 13, the final RG's rfq-cancel). `sh("orb", …)` must give up after its three 2-minute attempts (SIGKILL each
// time) and throw, and no stub process may survive. Before B57 the first attempt never returned.
// Build+run: npx esbuild tools/repro/b57-h8-orb-sigkill.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b57-h8.mjs && node tmp/b57-h8.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sh } from "../../cli/hosts";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/b57-h8.mjs (tools/repro/b57-h8-orb-sigkill.ts)");
let failed = 0;
const check = (id: string, ok: boolean, detail: string) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`); if (!ok) failed++; };

const bin = path.join(ROOT, "tmp", "b57-h8-bin");
rmSync(bin, { recursive: true, force: true }); mkdirSync(bin, { recursive: true });
const marker = `b57-h8-stub-${process.pid}`;
writeFileSync(path.join(bin, "orb"), `#!/bin/bash\n# ${marker}\ntrap '' TERM\nsleep 3600 & wait $!\n`);
chmodSync(path.join(bin, "orb"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const t0 = Date.now();
let threw = "";
try { sh("orb", ["run", "-m", "benzo-alice", "-u", "benzo", "true"]); } catch (e) { threw = String((e as Error).message ?? e); }
const secs = Math.round((Date.now() - t0) / 1000);
check("h8-sh-gives-up", threw !== "" && secs < 3 * 120 + 60, `sh("orb", …) threw after ${secs} s: ${threw.slice(0, 120)}`);
const left = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" }).stdout.trim();
check("h8-no-stub-survives", left === "", left ? `stub processes still running: ${left.replace(/\n/g, ",")}` : "every stub client was killed");
spawnSync("pkill", ["-f", marker]);
rmSync(bin, { recursive: true, force: true });
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
