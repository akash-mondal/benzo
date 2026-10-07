// Ruling R41 item 2 (F8, A19 item 2): the hash-checked `/allocation` delivery channel serves when
// `allocation_file_hash` matches the HOST-SIGNED `benzo-delivery-list-v1` statement (R40.3's `delivery_list`),
// not the `result.allocation_file_hash` field F4 removed.
// 1. Which behavior does it protect: the launch delivery channel (PHASE-5 part 2 §1 / R40.3, R41.2) — the only
//    public path that hands a consumer the allocation file already checked against the hosts' signed hash.
// 2. Which credible regression makes it fail: the route keying back onto a removed/renamed field (Reviewer R's
//    F8 exactly) — `/allocation` then dead for every new launch even at SETTLED, forcing hand-received
//    allocations outside any check.
// 3. Why no existing test catches it: the launch assertions (A16-a, A18 F4) check the file's contents and
//    `benzo verify`; nothing drove the HTTP route, which is how F8 survived A18.
// 4. Production seam: none — this drives the shipped server bundle (api/dist/server.mjs, built by
//    `npm run build:cli`) and the shipped verify bundle at their real boundary.
// Assertions (args: <corpus-dir> [--server <bundle>]):
//   f8-allocation-serves  GET /allocation serves the corpus's allocation.json against the host-signed
//                         delivery-list statement at SETTLED (red before: 409 {ready:false,state:"SETTLED"});
//   f8-auction-valid      GET /auction reports the served doc valid with no errors (its drift/projection checks);
//   f8-verify-green       the shipped `benzo verify` exits 0 on the served copy.
// Run: npx esbuild tools/repro/r41-f8-allocation.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r41-f8-allocation.mjs && npm run build:cli && node tmp/r41-f8-allocation.mjs docs/evidence/phase-5/markets/launch-a18/launch-cold
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { hash } from "../../manifest/schema";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/r41-f8-allocation.mjs (tools/repro/r41-f8-allocation.ts)");
for (const l of execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

const args = process.argv.slice(2);
const corpus = args[0];
if (!corpus) { console.error("usage: node tmp/r41-f8-allocation.mjs <corpus-dir> [--server <bundle>]"); process.exit(2); }
const serverBin = args.includes("--server") ? path.resolve(args[args.indexOf("--server") + 1]!) : path.join(ROOT, "api/dist/server.mjs");
console.log(`server ${serverBin}`);

let all = true;
const line = (id: string, f: () => [boolean, string]) => {
  try {
    const [ok, d] = f();
    console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
    if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; }
  } catch (e) {
    console.log(`FAIL ${id} threw ${(e as Error).message}`);
    console.log(`ERROR ${id} threw ${(e as Error).message}`);
    all = false;
  }
};

// Serve a READ-ONLY copy of the corpus (the server never writes; the copy keeps the evidence pristine).
const served = path.join(ROOT, "tmp/r41-f8-served");
rmSync(served, { recursive: true, force: true });
mkdirSync(served, { recursive: true });
cpSync(corpus, served, { recursive: true });
const doc = JSON.parse(readFileSync(path.join(served, "auction.json"), "utf8"));
const signer = doc.signer as string;
const rows = JSON.parse(readFileSync(path.join(served, "allocation.json"), "utf8")).rows;

const port = 18873;
const server = spawn(process.execPath, [serverBin, "--dir", served, "--port", String(port), "--signer", signer], { stdio: ["ignore", "pipe", "pipe"] });
let serverErr = "";
server.stderr.on("data", d => serverErr += d);
server.on("exit", code => { if (code !== null) serverErr += ` (server exit ${code})`; });
const base = `http://127.0.0.1:${port}`;
const get = async (p: string) => {
  for (let i = 0; ; i++) {
    try { return await (await fetch(base + p)).json(); } catch (e) {
      if (i >= 40) throw new Error(`GET ${p} failed: ${String((e as Error).message)} ${serverErr.trim().slice(-160)}`);
      await new Promise(r => setTimeout(r, 250));
    }
  }
};

const main = async () => {
  const alloc = await get("/allocation");
  line("f8-allocation-serves", () => {
    const commit = doc.delivery_list?.allocation_file_hash;
    return [Array.isArray(alloc.rows) && JSON.stringify(alloc.rows) === JSON.stringify(rows) &&
      typeof commit === "string" && hash(readFileSync(path.join(served, "allocation.json"))) === commit &&
      doc.result?.allocation_file_hash === undefined,
      `HTTP rows ${JSON.stringify(alloc.rows ?? alloc)}; delivery_list.allocation_file_hash ${String(commit).slice(0, 16)}…; result.allocation_file_hash ${doc.result?.allocation_file_hash === undefined ? "absent (F4)" : "present"}`];
  });
  const auction = await get(`/auction/${doc.auction_id}`);
  line("f8-auction-valid", () => [auction.valid === true && Array.isArray(auction.errors) && auction.errors.length === 0,
    `valid ${auction.valid}; errors ${JSON.stringify(auction.errors)}`]);
  const v = spawnSync(process.execPath, [path.join(ROOT, "dist/benzo-verify.mjs"), "--dir", served, "--signer", signer], { encoding: "utf8", maxBuffer: 64 << 20 });
  line("f8-verify-green", () => [v.status === 0, `verify exit ${v.status}${(v.stdout + v.stderr).split("\n").filter(l => l.startsWith("ERROR")).slice(0, 2).join(" | ")}`]);
  server.kill();
  console.log(all ? "RESULT PASS r41-f8-allocation" : "RESULT FAIL r41-f8-allocation");
  process.exitCode = all ? 0 : 1;
};
main();
