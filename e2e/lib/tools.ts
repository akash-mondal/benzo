// Spawns the pinned CLIs by absolute path ($BNZ_STATE_DIR/bin) and returns their bytes unchanged.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bin, E2E, env } from "./env";
import { tleBound } from "../../settle/bounded"; // R52: drand spawns are bounded like the product's

export function tleDecrypt(ciphertext: Uint8Array): { code: number; stdout: Buffer; stderr: string } {
  mkdirSync(E2E, { recursive: true });
  const dir = mkdtempSync(path.join(E2E, "tle-"));
  const [input, output] = [path.join(dir, "in.age"), path.join(dir, "out.bin")];
  writeFileSync(input, ciphertext);
  const r = spawnSync(bin("tle"), ["-d", "-c", env("BNZ_DRAND_CHAIN_HASH"), "-o", output, input], { encoding: "buffer", ...tleBound });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: existsSync(output) ? readFileSync(output) : Buffer.alloc(0), stderr: r.stderr.toString() };
}
