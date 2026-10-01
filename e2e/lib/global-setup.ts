// Before any spec: refuse an evidence run on a dirty tree, clear the staging dir, and build what the tests run.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E, ROOT } from "./env";

export default function globalSetup() {
  if (process.env.BNZ_EVIDENCE_DIR) {
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString();
    if (dirty.trim()) {
      console.log("NOT RUN dirty tree");
      throw new Error("NOT RUN dirty tree");
    }
  }
  rmSync(path.join(E2E, "out"), { recursive: true, force: true });
  rmSync(path.join(E2E, "results"), { recursive: true, force: true });
  mkdirSync(path.join(E2E, "out"), { recursive: true });
  writeFileSync(path.join(E2E, "start.txt"), new Date().toISOString());
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
