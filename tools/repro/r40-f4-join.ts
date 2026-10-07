// Ruling R40 item 3 (F4, A18 item 3): launch delivery records stay private. Reviewer R's F4 probe
// (reports/pr-a16-a17-r38.md) joined every published allocation row back to its winning leaf through
// `launch_input.delivery` in the SAME published document — the A16 canonical sort undone exactly, with the
// owner signatures proving the join. R40: the records are sealed to `envelope_keys` ("as claims do"), never
// published; the doc carries only the canonical allocation.json and two host signatures
// (`benzo-delivery-list-v1` over allocation_file_hash).
//
// Assertions over a published launch directory (args[3], or the committed corpora):
//   f4-no-join-key     the published document set carries NO leaf<->destination join: no `launch_input.delivery`,
//                      and no object anywhere pairing a destination with a leaf index (the reviewer's probe
//                      must find nothing to join);
//   f4-allocation      allocation.json holds the public invariants (row count = Σ fill/lot, every amount =
//                      standard_lot_size, distinct destinations, canonical order) and its hash is the
//                      host-signed quantity in delivery_list;
//   f4-verify-passes   `benzo verify` accepts the directory (cold, from the committed bundle's tree).
// Red before (this file's output over the pre-F4 corpus) and red with mutation A18-F4 (`launch_input`
// published again); green over the A18 launch-meet live corpus.
// `--rebuild <auction-id>` first drives the shipped publish() over that run's own recorded private state into
// tmp/r40-f4-rebuild/<id> (the drop-reserve-opening pattern) and adds the rebuilt directory to the list — the
// lab leg of the green (no join key in the REBUILT document) and of the A18-F4 mutation replay.
// Run: npx esbuild tools/repro/r40-f4-join.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r40-f4-join.mjs && node tmp/r40-f4-join.mjs [--rebuild ID] <public-dir>...
import { execFileSync, spawnSync } from "node:child_process";
import { assertScratch } from "./scratch";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonBytes } from "../../manifest/schema";
import { publish } from "../../cli/product";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r40-f4-join.mjs (tools/repro/r40-f4-join.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

let dirs = process.argv.slice(2);
if (dirs[0] === "--rebuild") {
  // Drive the real publish() over the run's own recorded state into a scratch copy of its public dir.
  const id = dirs[1];
  dirs = dirs.slice(2);
  const STATE = path.resolve(ROOT, readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find(l => /^BNZ_STATE_DIR=/.test(l))!.split("=").slice(1).join("="));
  const cfgPath = path.join(STATE, "product", `${id}.json`);
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const scratch = path.join(ROOT, `tmp/r40-f4-rebuild/${id}`);
  rmSync(assertScratch(scratch), { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
  if (cfg.public_dir && existsSync(cfg.public_dir)) cpSync(cfg.public_dir, scratch, { recursive: true });
  writeFileSync(cfgPath, jsonBytes({ ...cfg, public_dir: scratch }));
  let err = "";
  try { publish(id); } catch (e) { err = (e as Error).message; }
  writeFileSync(cfgPath, jsonBytes(cfg));
  console.log(`rebuild ${id} -> ${path.relative(ROOT, scratch)}${err ? ` (publish refused: ${err})` : ""}`);
  dirs = [scratch, ...dirs];
}
if (!dirs.length) { console.log("usage: node tmp/r40-f4-join.mjs [--rebuild ID] <launch-public-dir>..."); process.exit(2); }
const sha256 = (b: Buffer) => execFileSync("openssl", ["dgst", "-sha256"], { input: b, encoding: "utf8" }).trim().split(" ").at(-1)!;

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) console.log(`ERROR ${id} ${d}`);
  all &&= ok;
};
// Every object in every published JSON file, depth-first — the reviewer's join walked launch_input.delivery;
// this walks everything a reader of the published directory can read.
function* objects(v: any, at: string): Generator<{ v: any; at: string }> {
  if (v === null || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const [i, x] of v.entries()) yield* objects(x, `${at}[${i}]`); return; }
  yield { v, at };
  for (const [k, x] of Object.entries(v)) yield* objects(x, `${at}.${k}`);
}

for (const dir of dirs) {
  const doc = JSON.parse(readFileSync(path.join(dir, "auction.json"), "utf8"));
  console.log(`== ${path.basename(dir)} (${doc.auction_id.slice(0, 8)}, state ${doc.state})`);

  // f4-no-join-key: nothing published pairs a destination with a leaf index.
  const joins: string[] = [];
  if (doc.launch_input?.delivery !== undefined) joins.push("launch_input.delivery published");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    let parsed: any; try { parsed = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    for (const { v, at } of objects(parsed, f)) {
      const keys = Object.keys(v);
      const hasDest = keys.some(k => k === "destination" || k === "destinations" || k === "deliver");
      const hasLeaf = keys.some(k => k === "leaf_index" || k === "leaf");
      if (hasDest && hasLeaf) joins.push(`${at} pairs a destination with a leaf`);
    }
  }
  line("f4-no-join-key", joins.length === 0,
    joins.length ? joins.slice(0, 3).join(" | ") : "the published document set carries no leaf<->destination join");

  // f4-allocation: the public invariants over allocation.json + the committed/host-signed hash (era-aware:
  // a pre-F4 corpus commits to its file in the result, a new one carries the host-signed quantity).
  const file = path.join(dir, "allocation.json");
  const rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).rows ?? [] : null;
  const list = doc.delivery_list;
  const committed = list?.allocation_file_hash ?? doc.result?.allocation_file_hash;
  const m = JSON.parse(Buffer.from(doc.manifest.bytes, "base64").toString("utf8"));
  const lot = m.launch?.standard_lot_size;
  const want = (doc.result?.allocations ?? []).reduce((n: number, a: any) => n + a.fill, 0) / (lot ?? 1);
  const canonical = Array.isArray(rows) && rows.every((r: any, i: number) => i === 0 ||
    Buffer.compare(Buffer.from(rows[i - 1].destination, "utf8"), Buffer.from(r.destination, "utf8")) < 0 ||
    (Buffer.compare(Buffer.from(rows[i - 1].destination, "utf8"), Buffer.from(r.destination, "utf8")) === 0 && rows[i - 1].amount <= r.amount));
  const sigs = list === undefined || (Array.isArray(list.signatures) && new Set(list.signatures.map((s: any) => s.witness)).size >= 2);
  const okAlloc = Array.isArray(rows) && rows.length === want &&
    rows.every((r: any) => r.amount === lot && typeof r.destination === "string" && r.destination.length > 0 && r.destination.length <= 256) &&
    new Set(rows.map((r: any) => r.destination)).size === rows.length && canonical && sigs &&
    !!committed && sha256(readFileSync(file)) === committed;
  line("f4-allocation", okAlloc,
    `rows ${Array.isArray(rows) ? rows.length : "missing"} want ${want}; lot ${lot}; canonical ${canonical}; committed hash ${committed?.slice(0, 12) ?? "MISSING"} (${list?.signatures?.length ?? 0} host signatures)`);

  // f4-verify-passes: the shipped verifier accepts the directory.
  const v = spawnSync(process.execPath, [path.join(ROOT, "cli/dist/benzo.mjs"), "verify", "--dir", dir, "--signer", doc.signer], { encoding: "utf8", maxBuffer: 64 << 20 });
  const err = `${v.stdout ?? ""}${v.stderr ?? ""}`.split("\n").filter((l: string) => l.startsWith("ERROR")).slice(0, 2).join(" | ");
  line("f4-verify-passes", v.status === 0, `verify exit ${v.status}${v.error ? ` (${v.error.message})` : ""}${err ? ` (${err})` : ""}`);
}
console.log(all ? "RESULT PASS r40-f4-join" : "RESULT FAIL r40-f4-join");
process.exitCode = all ? 0 : 1;
