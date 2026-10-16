// Before any spec: refuse an evidence run on a dirty tree, clear the staging dir, and build what the tests run.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E, ROOT } from "./env";

export default function globalSetup() {
  rmSync(path.join(E2E, "out"), { recursive: true, force: true });
  rmSync(path.join(E2E, "results"), { recursive: true, force: true });
  rmSync(path.join(E2E, "fail-reasons"), { recursive: true, force: true }); // R74
  if (process.env.BNZ_EVIDENCE_DIR) {
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString();
    if (dirty.trim()) {
      console.log("NOT RUN dirty tree");
      throw new Error("NOT RUN dirty tree");
    }
    // R58 (Reviewer R F1 on R57): skip-worktree / assume-unchanged files hide edits from `git status`, so the clean-tree
    // rule also requires every tracked file to be plain — for every evidence run, not only the specs that call pins.ts.
    const hidden = execFileSync("git", ["ls-files", "-v"], { cwd: ROOT }).toString().split("\n").filter((l) => l && !l.startsWith("H "));
    if (hidden.length) {
      console.log(`NOT RUN files hidden from git status: ${hidden.slice(0, 3).join(", ")}`);
      throw new Error("NOT RUN hidden files");
    }
  }
  mkdirSync(path.join(E2E, "out"), { recursive: true });
  writeFileSync(path.join(E2E, "start.txt"), new Date().toISOString());
  writeFileSync(path.join(E2E,"command.txt"),(process.env.BNZ_LIVE==="1"?"BNZ_LIVE=1 ":"")+"node node_modules/.bin/playwright "+process.argv.slice(2).join(" "));
  writeFileSync(path.join(E2E,"start-commit.txt"),execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT}).toString().trim());
  execFileSync("npm", ["run", "--silent", "build:seal"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  if (process.env.BNZ_LIVE === "1") {
    execFileSync("npm", ["run", "--silent", "build:cli"], {cwd:ROOT,stdio:["ignore","ignore","inherit"]});
    execFileSync("npm", ["run", "--silent", "build:core"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    execFileSync("npm", ["run", "--silent", "build:settle"], {cwd: ROOT, stdio:["ignore","ignore","inherit"]});
    execFileSync("cargo", ["build", "--release", "--locked", "--quiet", "--manifest-path", "scan/Cargo.toml"], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
}
