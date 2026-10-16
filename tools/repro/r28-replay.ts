// Ruling R28 item 3 (F2), standalone: on a SETTLED host-custody auction, build a new candidate that pays a row the
// mined batch already paid (to its real destination and amount), seal it to the hosts like a building host would,
// and ask alice and carol to approve it. Both must refuse with "already paid by mined batch" and record no approval.
// Build+run: npx esbuild tools/repro/r28-replay.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r28r.mjs && node tmp/r28r.mjs <auction-id> <recipient> <amount_zats>
import { createHash } from "node:crypto";
import { assertScratch } from "./scratch";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE, env } from "../../e2e/lib/env";
import { H, NAMES, hostTry, push, sh } from "../../e2e/lib/hosts";
import { sealBlob } from "../../envelope";
import { redactCandidate } from "../../cli/host-derive";
import * as z from "../../e2e/lib/zcash";

const [id, recipient, amount] = process.argv.slice(2);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const cfg = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8")), publicDir = path.resolve(cfg.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8")), m = JSON.parse(Buffer.from(doc.manifest.bytes, "base64").toString("utf8"));
const vault = path.join(STATE, "vaults", id, "wallet"), pczt = path.join(STATE, "../settle/target/release/benzo-pczt");
const w = assertScratch(path.join(ROOT, "tmp", `r28-replay-${id}`)); // R43: tmp/ only; the packet is pushed to the hosts from here
rmSync(w, { recursive: true, force: true }); mkdirSync(w, { recursive: true });
const created = path.join(w, "created.pczt"), proven = path.join(w, "proven.pczt"), redacted = path.join(w, "candidate.pczt");
for (let by = Date.now() + 15 * 60_000; ;) {
  try { sh(pczt, ["create", vault, created, "364", "--network", "test"], JSON.stringify([{ recipient, amount_zats: amount }])); break; }
  catch (e) { if (!/InsufficientFunds/.test(String((e as Error)?.message ?? e)) || Date.now() > by) throw e; await new Promise(r => setTimeout(r, 20_000)); for (const v of ["sync", "enhance"]) z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, v, "-s", env("BNZ_LWD_URL")]); }
}
sh(path.join(STATE, "bin/zcash-devtool"), ["pczt", "-w", vault, "prove", created, "--output", proven]);
redactCandidate(STATE, proven, redacted, JSON.parse(sh(pczt, ["inspect", proven, path.join(STATE, "vaults", id, "ufvk.txt"), "--network", "test"])));
(m.envelope_keys as string[]).forEach((pub, i) => writeFileSync(path.join(w, `sealed-${NAMES[i]}.bin`), sealBlob(readFileSync(proven), pub)));
rmSync(proven); rmSync(created); cpSync(publicDir, path.join(w, "public"), { recursive: true });
writeFileSync(path.join(w, "packet.json"), JSON.stringify({ auction_id: id, batch: 95, plan_version: sha(readFileSync(redacted)), signer: doc.signer }));
let ok = true;
for (const n of ["alice", "carol"]) {
  push(n, w, `r28r-${id.slice(0, 12)}`);
  const r = hostTry(n, [`${H}/bin/benzo`, "sign", "approve", "--id", id, "--batch", "95", "--packet", `/home/benzo/r28r-${id.slice(0, 12)}`, "--name", n]);
  const approved = hostTry(n, ["test", "-f", `${H}/approvals/${id}/batch-95.json`]).status === 0;
  const pass = r.status !== 0 && !approved && /already paid by mined batch/.test(r.stderr ?? "");
  console.log(`${pass ? "PASS" : "ERROR"} r28-replay ${n}: exit ${r.status}, approved ${approved}: ${(r.stderr ?? "").trim().split("\n").filter(l => /^ERROR/.test(l)).at(-1) ?? ""}`);
  ok &&= pass;
}
console.log(ok ? "RESULT PASS a row paid by a mined batch is never approved again" : "RESULT FAIL"); process.exitCode = ok ? 0 : 1;
