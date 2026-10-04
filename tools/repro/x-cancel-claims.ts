// Cancelled auction under host custody (design §11.1 parked funds): every exception-queue deposit of a CANCELLED /
// REFUNDING auction is claimed by its bidder (owner key from `bid seal`, destination a fresh bidder address), the
// claims are attested ON the hosts (`sign envelope-opens --public --claims`), and `benzo cancel` settles them through
// host-built, host-approved batches. Checks: every exception paid exactly its deposit, at the claimed destination.
// Build+run: npx esbuild tools/repro/x-cancel-claims.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/xc.mjs && BNZ_LWD_SINGLE=1 node tmp/xc.mjs <auction-id>
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE, env } from "../../e2e/lib/env";
import { H, NAMES, benzoBin, hostBenzo, push, sh } from "../../e2e/lib/hosts";
import { memoSealedBid } from "../../settle/envelopes";
import { depositParty } from "../../settle/deposits";
import * as z from "../../e2e/lib/zcash";

const id = process.argv[2]; if (!/^[0-9a-f]{64}$/.test(id ?? "")) throw new Error("usage: x-cancel-claims <auction-id>");
const OUT = path.join(ROOT, "tmp/xc", id); mkdirSync(OUT, { recursive: true });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const say = (s: string) => { console.log(s); writeFileSync(path.join(OUT, "xc.out"), (existsSync(path.join(OUT, "xc.out")) ? readFileSync(path.join(OUT, "xc.out"), "utf8") : "") + s + "\n"); };
const benzo = (args: string[], input?: any) => { const out = sh(benzoBin, args, input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input)); return out.startsWith("{") || out.startsWith("[") ? JSON.parse(out.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!) : out; };
let ok = true; const check = (n: string, pass: boolean, d = "") => { say(`${pass ? "PASS" : "ERROR"} ${n}${d ? " " + d : ""}`); ok &&= pass; };

const cfg = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8")), publicDir = path.resolve(cfg.public_dir);
const doc = () => JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8")), signer = doc().signer;
const status = JSON.parse(sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "status", id]));
const exceptions = status.rows.filter((r: any) => r.state === "exception" && r.party.startsWith("deposit:"));
say(`auction ${id} state ${doc().state}: ${exceptions.length} exception rows`);
// The bidder's side: map each exception deposit to its bid (memo ciphertext hash -> the owner key `bid seal` kept).
const vault = path.join(STATE, "vaults", id, "wallet");
for (const v of ["sync", "enhance"]) z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, v, "-s", env("BNZ_LWD_URL")]);
const notes = z.run(z.scanner, ["scan", "test", vault]).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
const claimed: Record<string, { destination: string; amount: string }> = {};
for (const row of exceptions) {
  const n = notes.find((x: any) => depositParty(x) === row.party);
  const ct = n?.memo_hex ? memoSealedBid(n.memo_hex)?.ciphertext_hex : null;
  const keyFile = ct ? path.join(STATE, "bids", id, sha(Buffer.from(ct, "hex")) + ".json") : "";
  if (!ct || !existsSync(keyFile)) { say(`SKIP ${row.party}: no owner key kept for its bid`); continue; }
  const destination = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder")]).split("\n").at(-1)!;
  const request = benzo(["claim-refund", "--id", id, "--party", row.party, "--destination", destination, "--owner-key-stdin"], JSON.parse(readFileSync(keyFile, "utf8")).owner_private_hex);
  const file = path.join(OUT, `claim-${row.party.replace(/:/g, "_")}.json`); writeFileSync(file, JSON.stringify(request));
  benzo(["claim-refund", "--id", id, "--file", file, "--defer"]);
  claimed[row.party] = { destination, amount: row.amount_zats };
}
writeFileSync(path.join(OUT, "claimed.json"), JSON.stringify(claimed, null, 1)); // test-harness bidder state
// The hosts attest the claims from their own keys (two-signer agreement on each claimed destination's hash).
const claimsFile = path.join(STATE, "settle", id, "claims.json");
for (const n of NAMES) {
  for (const v of ["sync", "enhance"]) sh("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", `${H}/bin/zcash-devtool`, "wallet", "-w", `${H}/vaults/${id}/wallet`, v, "-s", env("BNZ_LWD_URL")]);
  const dir = `xc-${id.slice(0, 12)}`, stage = path.join(OUT, "stage"); cpSync(publicDir, path.join(stage, "public"), { recursive: true }); cpSync(claimsFile, path.join(stage, "claims.json"));
  push(n, stage, dir);
  const report = hostBenzo(n, ["sign", "envelope-opens", "--id", id, "--name", n, "--public", `/home/benzo/${dir}/public`, "--claims", `/home/benzo/${dir}/claims.json`, "--witness-key", `${H}/witness/${n}.key`]);
  writeFileSync(path.join(STATE, "settle", id, `envelope-opens-${n}.json`), JSON.stringify(report));
}
// Settle the promoted rows through host custody.
const frostd = spawn(path.join(STATE, "bin/frostd"), ["-i", "127.0.0.1", "-p", env("BNZ_FROSTD_ADDR").split(":").at(-1)!, "-c", path.join(STATE, "tls/frostd.pem"), "-k", path.join(STATE, "tls/frostd.key")], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 2000));
const run = spawnSync(benzoBin, ["cancel", "--id", id], { encoding: "utf8", maxBuffer: 64 << 20 });
frostd.kill();
writeFileSync(path.join(OUT, "cancel.log"), (run.stdout || "") + "\n----\n" + (run.stderr || "").replace(/\x1b\[[0-9;]*m/g, ""));
const receipts = Object.fromEntries((doc().settlement?.receipts ?? []).map((r: any) => [r.party, r.amount_zats]));
check("xc-cancel-settled", run.status === 0, `exit ${run.status}`);
for (const [party, c] of Object.entries(claimed)) check(`xc-paid ${party}`, receipts[party] === c.amount, `receipt ${receipts[party] ?? "none"} of ${c.amount}`);
z.sync("bidder"); z.enhance("bidder");
const got = z.run(z.scanner, ["scan", "test", path.join(STATE, "bidder")]).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
for (const [party, c] of Object.entries(claimed)) check(`xc-landed ${party}`, got.filter((n: any) => n.address === c.destination).reduce((s: number, n: any) => s + n.value_zats, 0) === Number(c.amount));
const v = spawnSync(benzoBin, ["verify", "--dir", publicDir, "--signer", signer], { encoding: "utf8" });
check("xc-verify", v.status === 0, (v.stdout + v.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | "));
say(ok ? "RESULT PASS all cancelled-auction claim assertions" : "RESULT FAIL"); process.exitCode = ok ? 0 : 1;
