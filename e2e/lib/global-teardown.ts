// After all specs: write run.json. On an evidence run with no NOT RUN, replace the run's evidence dirs with this run's output.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bin, E2E, OUT, ROOT, STATE } from "./env";

const RUN_DIRS = ["frost", "memo", "tlock", "scan"];
const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const files = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : [path.join(dir, f)]))
    : [];

export default function globalTeardown() {
  const results: Record<string, string> = {};
  for (const f of files(path.join(E2E, "results"))) Object.assign(results, JSON.parse(readFileSync(f, "utf8")));
  const evidence = process.env.BNZ_EVIDENCE_DIR ? path.resolve(ROOT, process.env.BNZ_EVIDENCE_DIR) : undefined;
  const write = evidence && Object.keys(results).length > 0 && !Object.values(results).includes("NOT RUN");
  const dest = write ? evidence! : OUT;
  if (write) {
    for (const d of RUN_DIRS) rmSync(path.join(dest, d), { recursive: true, force: true });
    rmSync(path.join(dest, "run.json"), { force: true });
    for (const d of RUN_DIRS) if (existsSync(path.join(OUT, d))) cpSync(path.join(OUT, d), path.join(dest, d), { recursive: true });
  }
  const hashed = [...files(path.join(dest, "setup")), ...RUN_DIRS.flatMap((d) => files(path.join(dest, d)))];
  const built = ["seal/dist/index.html", "seal/dist/main.js", "scan/target/release/benzo-scan"].filter((p) => existsSync(path.join(ROOT, p)));
  const tools = execFileSync("cargo", ["install", "--list", "--root", STATE]).toString().split("\n").filter((l) => /^\S/.test(l));
  for (const t of ["tle", "grpcurl"])
    if (existsSync(bin(t))) tools.push(`${t} ` + execFileSync("go", ["version", "-m", bin(t)]).toString().split("\n").find((l) => l.startsWith("\tmod\t"))!.trim());
  const run = {
    command: process.env.BNZ_LIVE === "1" ? "npm run e2e:live" : "npm run e2e",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
    start_utc: readFileSync(path.join(E2E, "start.txt"), "utf8"),
    end_utc: new Date().toISOString(),
    results,
    sha256: Object.fromEntries([...hashed.map((f) => [path.relative(dest, f), sha256(f)]), ...built.map((p) => [p, sha256(path.join(ROOT, p))])]),
    tools,
  };
  writeFileSync(path.join(dest, "run.json"), JSON.stringify(run, null, 1) + "\n");
  console.log(`run.json -> ${path.relative(ROOT, dest)}${evidence && !write ? " (NOT RUN or no results: no evidence written)" : ""}`);
}
