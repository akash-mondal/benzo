#!/usr/bin/env node
/**
 * Stage the browser proving artifacts needed by capable desktop wallets.
 *
 * Proving keys remain gitignored; this script copies already-present verified
 * artifacts or downloads the exact published artifacts and checks them against
 * the committed manifest before Vite builds the static wallet.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "circuits/build/artifacts-manifest.json");
const publicDir = resolve(repoRoot, "apps/wallet/public/circuits");
const base = process.env.BENZO_ARTIFACTS_BASE_URL ?? "https://github.com/akash-mondal/benzo/releases/download/artifacts";
const browserCircuits = ["joinsplit", "proof_of_balance"];

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

async function sha256(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function valid(path, expected) {
  if (!existsSync(path)) return false;
  return (await sha256(path)) === expected;
}

async function copyIfValid(src, dest, expected) {
  if (!(await valid(src, expected))) return false;
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return true;
}

async function downloadVerified(url, dest, expected) {
  const tmp = `${dest}.tmp-${Date.now()}`;
  await mkdir(dirname(dest), { recursive: true });
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fetch(url);
      if (res.ok) {
        await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
        const got = await sha256(tmp);
        if (got !== expected) throw new Error(`hash mismatch for ${url}: got ${got}, want ${expected}`);
        await rename(tmp, dest);
        return;
      }
      if (attempt === 3) throw new Error(`download failed for ${url}: HTTP ${res.status}`);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 500));
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function stage(circuit, ext, expected) {
  const dest = resolve(publicDir, `${circuit}.${ext}`);
  if (await valid(dest, expected)) {
    console.log(`wallet artifact ok: ${circuit}.${ext}`);
    return;
  }

  const local =
    ext === "zkey"
      ? resolve(repoRoot, `circuits/build/${circuit}/${circuit}.zkey`)
      : resolve(repoRoot, `circuits/build/${circuit}/${circuit}_js/${circuit}.wasm`);
  if (await copyIfValid(local, dest, expected)) {
    console.log(`wallet artifact staged from local build: ${circuit}.${ext}`);
    return;
  }

  await downloadVerified(`${base}/${circuit}/${circuit}.${ext}`, dest, expected);
  console.log(`wallet artifact downloaded + verified: ${circuit}.${ext}`);
}

for (const circuit of browserCircuits) {
  const spec = manifest.circuits?.[circuit];
  if (!spec?.zkeyHash || !spec?.wasmHash) throw new Error(`missing artifact hashes for ${circuit}`);
  await stage(circuit, "zkey", spec.zkeyHash);
  await stage(circuit, "wasm", spec.wasmHash);
}
