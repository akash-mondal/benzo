// Paths and settings for the E2E glue. Variables come from .env (a copy of .env.example); the command line wins.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();

for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} in .env`);
  return v;
}

export const STATE = path.join(ROOT, env("BNZ_STATE_DIR").replace(/^\.\//, ""));
export const bin = (tool: string) => path.join(STATE, "bin", tool);
// Every run stages its output here; an evidence run copies it to BNZ_EVIDENCE_DIR at the end (global-teardown.ts).
export const E2E = path.join(ROOT, "tmp", "e2e");
export const OUT = path.join(E2E, "out");
export const DRAND = env("BNZ_DRAND_URLS").split(",")[0] + "/" + env("BNZ_DRAND_CHAIN_HASH");
