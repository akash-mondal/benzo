// R8 G10 repro — gate X witness certificates wired into the product flow (design §5): publish() emits the
// witness fields, `benzo witness sign` runs on product dirs (and records the certificate in the public
// document), and the signer path REFUSES — never WARNs — any manifest carrying witness_set_hash without a
// valid q_w certificate. `benzo open` refuses the same way.
//
// Usage (after the auction is frozen): node tools/repro/r7-witness-repro.mjs <auction-id>
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r7-witness-repro.mjs <auction-id>"); process.exit(2); }
const cli = (args) => { const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { encoding: "utf8", maxBuffer: 64 << 20 }); return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") }; };
const plan = () => { const p = spawnSync(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id], { encoding: "utf8", maxBuffer: 64 << 20 }); return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") }; };
const show = (label, r) => console.log(`${label}: exit ${r.code} ${r.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 220) || "(no error lines)"}`);
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicDir = path.resolve(config.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const signer = JSON.parse(readFileSync(path.join(publicDir, "signer.json"), "utf8")).signer;
console.log(`published witness_set: ${doc.witness_set ? "present" : "MISSING"}; witness_cert entries: ${(doc.witness_cert ?? []).length}`);
show("W2 signer plan without certificates", plan());
show("W3 benzo open without certificates", cli(["open", "--id", id]));
for (const i of [0, 1]) {
  const r = cli(["witness", "sign", "--dir", publicDir, "--signer", signer, "--key", path.join(STATE, "witness", `w${i}.key`)]);
  console.log(`W1 witness ${i} sign on the product dir: exit ${r.code}`);
}
const after = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
console.log(`published witness_cert entries after sign: ${(after.witness_cert ?? []).length}`);
show("W2 signer plan with certificates", plan());
show("W3 benzo open with certificates", cli(["open", "--id", id]));
show("W4 benzo witness verify", cli(["witness", "verify", "--dir", publicDir, "--signer", signer]));
