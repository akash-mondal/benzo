// The repository root for locating pinned tools and bundles. A checkout answers through git; a packaged install or
// a signer host (no checkout, no git) uses BNZ_ROOT, else the working directory. Never throws at import time.
import { execFileSync } from "node:child_process";
export function repoRoot(): string {
  if (process.env.BNZ_ROOT) return process.env.BNZ_ROOT;
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return process.cwd(); }
}
