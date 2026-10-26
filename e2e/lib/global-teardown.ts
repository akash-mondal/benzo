// After all specs: write run.json. On an evidence run with no NOT RUN, replace the run's evidence dirs with this run's output.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bin, E2E, OUT, realBin, ROOT, STATE } from "./env";

const RUN_DIRS = ["frost", "memo", "tlock", "scan", "auction", "settle", "cli"];
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
  const cliBuilt=[...files(path.join(ROOT,"cli/dist")),...files(path.join(ROOT,"api/dist"))].map(p=>path.relative(ROOT,p));
  const built = [...cliBuilt,"seal/dist/index.html", "seal/dist/main.js", "scan/target/release/benzo-scan", "manifest/dist/cli.mjs", "clear/dist/cli.mjs", "clear/dist/auction.mjs", "settle/dist/cli.mjs", "settle/dist/plan.mjs", "settle/target/release/benzo-pczt"].filter((p) => existsSync(path.join(ROOT, p)));
  const tools = execFileSync("cargo", ["install", "--list", "--root", STATE]).toString().split("\n").filter((l) => /^\S/.test(l));
  for (const t of ["tle", "grpcurl"])
    if (existsSync(bin(t))) tools.push(`${t} ` + execFileSync("go", ["version", "-m", realBin(t)]).toString().split("\n").find((l) => l.startsWith("\tmod\t"))!.trim());
  const packages = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")).packages;
  for (const name of ["tlock-js", "@playwright/test", "playwright-core", "esbuild", "typescript", "@types/node"])
    tools.push(`${name} ${packages[`node_modules/${name}`].version}`);
  const run = {
    command: existsSync(path.join(E2E,"command.txt"))?readFileSync(path.join(E2E,"command.txt"),"utf8"):process.env.BNZ_LIVE === "1" ? "npm run e2e:live" : "npm run e2e",
    commit: existsSync(path.join(E2E,"start-commit.txt"))?readFileSync(path.join(E2E,"start-commit.txt"),"utf8"):execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
    start_utc: readFileSync(path.join(E2E, "start.txt"), "utf8"),
    end_utc: new Date().toISOString(),
    results,
    // R74: the first assertion message of each FAIL (empty when everything passed).
    fail_reasons: Object.assign({}, ...files(path.join(E2E, "fail-reasons")).map((f) => JSON.parse(readFileSync(f, "utf8")))),
    sha256: Object.fromEntries([...hashed.map((f) => [path.relative(dest, f), sha256(f)]), ...built.map((p) => [p, sha256(path.join(ROOT, p))])]),
    tools,
    // R52 (Reviewer R S8 on R49): chain of custody for the NU7 path builds. The provenance record is attested by
    // the machine under test, so the evidence pins its digest and the binary's; a later swap shows against it.
    nu7_provenance: Object.fromEntries(["zcash-devtool", "zcash-sign"].map((b) => [b, existsSync(path.join(STATE, "nu7-provenance", `${b}.json`))
      ? { record_sha256: sha256(path.join(STATE, "nu7-provenance", `${b}.json`)), bin_sha256: sha256(bin(b)) } : "MISSING"])), // R53: never silently omitted
  };
  // R67: a spec that writes no evidence subdirectory (buyback-mode) still gets its run.json — the dir may not exist yet.
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, "run.json"), JSON.stringify(run, null, 1) + "\n");
  console.log(`run.json -> ${path.relative(ROOT, dest)}${evidence && !write ? " (NOT RUN or no results: no evidence written)" : ""}`);
}
