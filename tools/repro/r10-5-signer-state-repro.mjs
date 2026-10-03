// R10 item 5 repro — `benzo sign envelope-key` needs no git checkout (signer hosts have none): it takes
// --state DIR or BNZ_STATE_DIR and defaults to ~/.benzo-signer.
//
//   S1 (the flip): `sign envelope-key --name alice --state DIR` run outside any checkout. Before, the
//      command has no --state option (usage error) and its state dir comes from `git rev-parse`, which
//      fails off-checkout — a signer host cannot generate its key at all. After, the key is created under
//      DIR/signers/alice/ and the command prints only the public half.
//   S2 (the default): with HOME redirected and no BNZ_STATE_DIR, the key lands in ~/.benzo-signer (under
//      the redirected HOME) with no git call.
//   S3 (control): with the dev BNZ_STATE_DIR and inside the checkout, the state resolves to the repo's
//      state dir — the existing key refuses replacement (nothing is overwritten).
//
// Usage: node tools/repro/r10-5-signer-state-repro.mjs
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const TMP = path.join(ROOT, "tmp/e2e/r10-5");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const run = (args, env, cwd) => {
  const p = spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), ...args], { encoding: "utf8", maxBuffer: 1 << 22, env: { ...process.env, ...env }, cwd });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}` };
};
let outcome = "INCONCLUSIVE";

// ---- S1: --state, outside any checkout --------------------------------------------------------------
{
  const r = run(["sign", "envelope-key", "--name", "alice", "--state", TMP], { BNZ_STATE_DIR: "" }, "/");
  console.log(`S1 --state outside a checkout: exit ${r.code} ${r.out.trim().slice(-120)}`);
  const key = path.join(TMP, "signers", "alice", "envelope-key.json");
  if (/usage/.test(r.out) || /not a git repository|fatal/.test(r.out)) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: a signer host (no git checkout) cannot generate its envelope key — there is no --state option and the state dir comes from git.");
  } else if (r.code === 0 && existsSync(key) && /public_hex/.test(r.out) && !/private_hex/.test(r.out)) {
    const saved = JSON.parse(readFileSync(key, "utf8"));
    if (/^[0-9a-f]{64}$/.test(saved.public_hex) && /^[0-9a-f]{64}$/.test(saved.private_hex)) {
      outcome = "FIXED";
      console.log("FIXED: the key is created under --state and the command printed only the public half.");
    }
  }
}

// ---- S2: the ~/.benzo-signer default ----------------------------------------------------------------
{
  const home = path.join(TMP, "home");
  mkdirSync(home, { recursive: true });
  const r = run(["sign", "envelope-key", "--name", "bob"], { HOME: home, BNZ_STATE_DIR: "" }, "/");
  const key = path.join(home, ".benzo-signer", "signers", "bob", "envelope-key.json");
  console.log(`S2 default ~/.benzo-signer (redirected HOME): exit ${r.code} ${existsSync(key) ? "key created" : r.out.trim().slice(-100)}`);
}

// ---- S3: the dev checkout flow still resolves the repo state dir ------------------------------------
{
  const r = run(["sign", "envelope-key", "--name", "alice"], {}, ROOT);
  console.log(`S3 dev BNZ_STATE_DIR inside the checkout: exit ${r.code} ${r.out.trim().slice(-100)}`);
}
console.log(`outcome ${outcome}`);
