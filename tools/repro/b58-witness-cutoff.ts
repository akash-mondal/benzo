// B58 (Zecathon judge finding, witness timing): an honest witness refuses a FIRST certificate once round R is out, so an
// operator that froze late cannot get a price-aware subset certified; an auction left uncertified is cancelled, and a
// cancelled auction's plan needs no certificate (it pays only full-C refunds through each deposit's own memo/claim).
// Offline, on the B55 world (h-fixtures: a REAL auction document, real tlock ciphertexts, stubbed externals):
//   (1) plan: CANCELLED + frozen set + NO witness certificate, pre-R. Base refuses it (the funds could never move);
//       B58 parks both deposits exactly as B55's cancel-after-freeze does.
//   (2) `benzo witness sign` on a published auction whose R is past: base goes on to sign (it is stopped only later,
//       here by the stub chain scan); B58 refuses with "witness signing closed" before any scan.
//   (3) B58, R in the future: not refused by the clock.  (4) B58, R past but this witness already pinned that root
//       (an idempotent re-run): not refused by the clock.
// Build+run (base = the main checkout's bundles at 52c7353, read only):
//   npx esbuild tools/repro/b58-witness-cutoff.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b58.mjs
//   B58_BASE=<path to the 52c7353 checkout> node tmp/b58.mjs before && node tmp/b58.mjs after
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUICKNET, hash, jsonBytes, signRecord } from "../../manifest/schema";
import { tree } from "../../clear/merkle";
import { freezeStatement, signStatement as signWitnessStatement, signOpensReport } from "../../witness";
import { ownerPublic, signStatement } from "../../envelope";
import { buildAuction, fetchBeacon, needRealPczt, ownerPrivate, witnessPrivate, UA_ORCHARD, writeHostState, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b58.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b58.mjs ${part} (tools/repro/b58-witness-cutoff.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
const WORK = path.join(ROOT, "tmp", "b58", "run");
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true }); mkdirSync(path.join(ROOT, "tmp", "b58"), { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
const BASE = process.env.B58_BASE ?? path.join(ROOT, "..", "benzo");
const BASE_PLAN = path.join(BASE, "settle", "dist", "plan.mjs"), BASE_BENZO = path.join(BASE, "cli", "dist", "benzo.mjs");
const GREEN_PLAN = path.join(ROOT, "settle", "dist", "plan.mjs"), GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
for (const f of [BASE_PLAN, BASE_BENZO]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
for (const f of [GREEN_PLAN, GREEN_BENZO]) if (part === "after" && !existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const save = (name: string, doc: unknown) => writeFileSync(path.join(ROOT, "tmp", "b58", name), JSON.stringify(doc, null, 1));
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(ROOT, "tmp", "b58", name), "utf8"));

// ---- the one real fetch (the fixtures' rule) and the local drand stub: a SEPARATE process (the fold blocks
// its own event loop inside spawnSync, so an in-process server could never answer the child's fetch) that
// serves ONLY the recorded round-32704232 beacon (the (d) world's "stub-verified" beacon — the shared fetch
// BLS-verifies it), 404s every other round, and appends one line per request to a log so the pre-R legs can
// prove ZERO beacon fetches.
const R = 32704232;
type FixtureBox = { fx: Fixture; futureR: number };
let box: FixtureBox;
if (part === "before" || !existsSync(path.join(ROOT, "tmp", "b58", "fixture.json"))) {
  const beacon = await fetchBeacon(R); // one real past-round beacon, once (tools/bench.ts's rule)
  const fx = await buildAuction({ beacon, count: 2, fee_zats: "0" });
  const futureR = 1 + Math.ceil((Math.floor(Date.now() / 1000) + 31_536_000 - QUICKNET.genesis) / QUICKNET.period);
  box = { fx, futureR };
  if (part === "before") save("fixture.json", box);
} else box = load<FixtureBox>("fixture.json");
const { fx, futureR } = box;
const stubLog = path.join(ROOT, "tmp", "b58", "drand-hits.log");
writeFileSync(stubLog, "");
const stubScript = path.join(ROOT, "tmp", "b58", "drand-stub.cjs");
writeFileSync(stubScript, `const http=require("http"),fs=require("fs");
const [portFile,logFile,round,sig,chain]=process.argv.slice(2);
const s=http.createServer((req,res)=>{fs.appendFileSync(logFile,"1\\n");
if(req.url.endsWith("/"+chain+"/public/"+round)){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({round:Number(round),signature:sig}));}
else{res.writeHead(404);res.end();}});
s.listen(0,"127.0.0.1",()=>{fs.writeFileSync(portFile,String(s.address().port));});
`);
const portFile = path.join(ROOT, "tmp", "b58", "drand-port.txt"); rmSync(portFile, { force: true });
const stubProc = spawn(process.execPath, [stubScript, portFile, stubLog, String(R), fx.beacon.signature, QUICKNET.chain_hash], { stdio: "ignore" });
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100));
if (!existsSync(portFile)) throw new Error("the drand stub did not start");
const hits = () => readFileSync(stubLog, "utf8").split("\n").filter(Boolean).length;
const DRAND_URL = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}/`;
const closedPort = await new Promise<number>(resolve => {
  const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => resolve(p)); });
});
const CLOSED_URL = `http://127.0.0.1:${closedPort}/`; // a genuinely closed local port (the design's setup)

// ---- the worlds. `futureWorld` re-stamps the fixture's real ciphertexts to the future round (same stanza,
// different round number — nothing opens them before R) and re-binds every signed field to a manifest whose
// drand.R is a year out with T_submit/T_freeze already past: the real cancel-before-R shape.
const NOW = Math.floor(Date.now() / 1000);
const frameMemo = (ctHex: string): string => {
  const ct = Buffer.from(ctHex, "hex"), memo = Buffer.alloc(512);
  Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
  return memo.toString("hex");
};
const retargetCt = (ctHex: string): string =>
  Buffer.from(Buffer.from(ctHex, "hex").toString("latin1").replace(`-> tlock ${R} `, `-> tlock ${futureR} `), "latin1").toString("hex");
type World = { manifest: any; manifestPacket: any; manifestHash: string; leaves: any[]; receipts: any[]; frozen: any; witnessCert: any[]; envelopes: any[]; notes: any[] };
const futureWorld = (): World => {
  const manifest = { ...fx.manifest, drand: { ...fx.manifest.drand, R: futureR }, T_submit: NOW - 7200, T_freeze: NOW - 3600 };
  const manifestPacket = signRecord(manifest, fx.manifestPem), manifestHash = manifestPacket.sha256;
  const leaves = fx.leaves.map(l => {
    const ciphertext_hex = retargetCt(l.ciphertext_hex);
    return { ...l, manifest_hash: manifestHash, ciphertext_hex, ciphertext_hash: hash(Buffer.from(ciphertext_hex, "hex")) };
  });
  const receipts = leaves.map(l => signRecord({ auction_id: fx.id, manifest_hash: manifestHash, ciphertext_hash: l.ciphertext_hash, deposit: l.deposit, leaf_index: l.leaf_index }, fx.manifestPem));
  const frozen = { ...fx.frozen, manifest_hash: manifestHash, leaves, ...tree(leaves) };
  const statement = freezeStatement(manifest, frozen);
  const witnessCert = [{ statement, signatures: [0, 1].map(i => signWitnessStatement(statement, witnessPrivate(String(i)))) }];
  // The envelope records' hashes follow the re-stamped ciphertexts; their owner signatures stay the fixture's
  // (inert before R — the plan/derive never open or verify an envelope pre-R; (d) uses the pristine world).
  const envelopes = fx.envelopes.map((e, i) => ({ ...e, ciphertext_hash: leaves[i].ciphertext_hash }));
  const notes = fx.notes.map((n, i) => ({ ...n, memo_hex: frameMemo(leaves[i].ciphertext_hex) }));
  return { manifest, manifestPacket, manifestHash, leaves, receipts, frozen, witnessCert, envelopes, notes };
};
const pristineWorld = (): World => {
  const statement = freezeStatement(fx.manifest, fx.frozen);
  return { manifest: fx.manifest, manifestPacket: fx.manifestPacket, manifestHash: fx.manifestHash, leaves: fx.leaves, receipts: fx.receipts, frozen: fx.frozen,
    witnessCert: [{ statement, signatures: [0, 1].map(i => signWitnessStatement(statement, witnessPrivate(String(i)))) }], envelopes: fx.envelopes, notes: fx.notes };
};
const future = futureWorld(), pristine = pristineWorld();

// ---- the published CANCELLED document and the signer-host state (the h-fixtures stub toolchain).
const writeDoc = (dir: string, w: World, frozenSet: boolean) => {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "auction.json"), jsonBytes({ version: 1, auction_id: fx.id, signer: fx.signer, manifest: w.manifestPacket, state: "CANCELLED",
    receipts: [], envelopes: w.envelopes, witness_set: fx.witnessSet, witness_cert: w.witnessCert, ...(frozenSet ? { frozen: w.frozen } : {}) }));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(w.manifestPacket));
};
const writeState = (state: string, w: World, publicDir: string, opts: { claims?: any[]; opens?: boolean }) => {
  writeHostState(state, { ...fx, notes: w.notes }, REAL_PCZT);
  mkdirSync(path.join(state, "auction"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "auction", `${fx.id}.json`), jsonBytes({ manifest: w.manifestPacket, signer: fx.signer, state: "CANCELLED", envelopes: w.envelopes, receipts: [], trace: [] }));
  mkdirSync(path.join(state, "product"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "product", `${fx.id}.json`), jsonBytes({ settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 },
    routing: { bidders: [], seller_ua: UA_ORCHARD, fee_reserve_ua: UA_ORCHARD }, public_dir: publicDir }));
  mkdirSync(path.join(state, "settle", fx.id), { recursive: true, mode: 0o700 });
  if (opts.claims) writeFileSync(path.join(state, "settle", fx.id, "claims.json"), jsonBytes(opts.claims));
  if (opts.opens) for (const [n, wi] of [["alice", "0"], ["bob", "1"]] as const) {
    const body = { signer: n, opens: w.notes.map((note: any, i: number) => ({ leaf: null, party: `deposit:${note.txid}:${note.pool}:${note.action_index}`, ok: true, dest_sha256: hash(Buffer.from(UA_ORCHARD, "utf8")) })) };
    writeFileSync(path.join(state, "settle", fx.id, `envelope-opens-${n}.json`), jsonBytes({ ...body, ...signOpensReport(body, witnessPrivate(wi)) }));
  }
};
const baseEnv = (state: string, drand: string) => ({ ...process.env, BNZ_STATE_DIR: state,
  BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"),
  BNZ_LWD_URL: "127.0.0.1:9", BNZ_LWD_URL_ALT: "127.0.0.1:10", BNZ_DRAND_URLS: drand });
const runPlan = (label: string, planBundle: string, w: World, bnzRoot: string, drand: string, opts: { frozen?: boolean; claims?: any[]; opens?: boolean } = {}) => {
  const state = path.join(WORK, "state-plan-" + label), publicDir = path.join(WORK, "public-plan-" + label);
  rmSync(state, { recursive: true, force: true });
  writeDoc(publicDir, w, !!opts.frozen);
  writeState(state, w, publicDir, opts);
  const before = hits();
  const r = spawnSync(process.execPath, [planBundle, fx.id], { input: "{}", encoding: "utf8", maxBuffer: 64 << 20, env: { ...baseEnv(state, drand), BNZ_ROOT: bnzRoot } });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed, fetches: hits() - before };
};
const runDerivable = (label: string, benzo: string, w: World, publicDir: string, drand: string, opts: { claims?: any[] } = {}) => {
  const state = path.join(WORK, "state-derive-" + label);
  rmSync(state, { recursive: true, force: true });
  writeState(state, w, publicDir, opts);
  const packet = path.join(WORK, "packet-derive-" + label);
  rmSync(packet, { recursive: true, force: true }); mkdirSync(path.join(packet, "public"), { recursive: true, mode: 0o700 });
  writeDoc(path.join(packet, "public"), w, label.includes("frozen"));
  writeFileSync(path.join(packet, "packet.json"), jsonBytes({ auction_id: fx.id, signer: fx.signer, seller_ua: UA_ORCHARD }));
  if (opts.claims) writeFileSync(path.join(packet, "claims.json"), jsonBytes(opts.claims));
  const before = hits();
  const r = spawnSync(process.execPath, [benzo, "sign", "derivable", "--id", fx.id, "--packet", packet, "--name", "alice"],
    { input: "", encoding: "utf8", maxBuffer: 64 << 20, env: baseEnv(state, drand) });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout.trim().split("\n").filter(l => l.startsWith("{")).at(-1)!); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed, fetches: hits() - before };
};

const REASON = "cancelled before release; refund is claimable after R";
const parked = (p: any) => (p?.parsed?.exceptions ?? []).length === 2 && (p.parsed.exceptions as any[]).every((e: any) => e.reason === REASON && e.kind === "refund")
  && (p.parsed.obligations ?? []).length === 0;
const noCerts = (w: World): World => ({ ...w, witnessCert: [] });
const line = (r: { err: string; out: string }) => (r.err + r.out).split("\n").filter(l => /^ERROR/.test(l)).at(-1)?.slice(0, 160) ?? "(no ERROR line)";

// The witness command on a published auction. The doc is published FROZEN (no result); the key is a witness-set key.
const runWitness = (label: string, benzo: string, w: World, opts: { pin?: boolean } = {}) => {
  const state = path.join(WORK, "state-witness-" + label), dir = path.join(WORK, "public-witness-" + label);
  rmSync(state, { recursive: true, force: true });
  writeDoc(dir, w, true);
  writeState(state, w, dir, {});
  mkdirSync(path.join(state, "witness"), { recursive: true, mode: 0o700 });
  const key = path.join(state, "witness", "w0.key"); writeFileSync(key, witnessPrivate("0") + "\n", { mode: 0o600 });
  if (opts.pin) { mkdirSync(path.join(state, "auctions", fx.id), { recursive: true, mode: 0o700 }); writeFileSync(path.join(state, "auctions", fx.id, "frozen-root.txt"), w.frozen.root + "\n"); }
  const r = spawnSync(process.execPath, [benzo, "witness", "sign", "--dir", dir, "--signer", fx.signer, "--key", key], { input: "", encoding: "utf8", maxBuffer: 64 << 20, env: baseEnv(state, DRAND_URL), timeout: 120_000 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const CLOSED = /witness signing closed: round \d+ was released/;

if (part === "before") {
  console.log("=== red (1) BASE plan: CANCELLED + frozen + no witness certificate, before R");
  const p = runPlan("red-1", BASE_PLAN, noCerts(future), BASE, DRAND_URL, { frozen: true });
  check("red-1-uncertified-cancel-refused", p.code !== 0 && !p.parsed, `exit ${p.code}: ${line(p)}`);
  console.log("=== red (2) BASE witness sign after R: no clock refusal");
  const s = runWitness("red-2", BASE_BENZO, pristine);
  check("red-2-late-first-certificate-not-refused-by-clock", !CLOSED.test(s.err + s.out), `exit ${s.code}: ${line(s)}`);
} else {
  console.log("=== green (1) B58 plan: CANCELLED + frozen + no witness certificate, before R -> parked");
  const p = runPlan("green-1", GREEN_PLAN, noCerts(future), ROOT, DRAND_URL, { frozen: true });
  check("green-1-uncertified-cancel-plans", p.code === 0 && parked(p), `exit ${p.code}, exceptions ${(p.parsed?.exceptions ?? []).length}: ${line(p)}`);
  console.log("=== green (2) B58 witness sign after R -> refused before any scan");
  const s = runWitness("green-2", GREEN_BENZO, pristine);
  check("green-2-late-first-certificate-refused", s.code !== 0 && CLOSED.test(s.err + s.out), `exit ${s.code}: ${line(s)}`);
  console.log("=== green (3) B58 witness sign, R in the future -> not refused by the clock");
  const f = runWitness("green-3", GREEN_BENZO, future);
  check("green-3-before-release-not-refused", !CLOSED.test(f.err + f.out), `exit ${f.code}: ${line(f)}`);
  console.log("=== green (4) B58 witness sign after R, root already pinned by this witness -> not refused by the clock");
  const g = runWitness("green-4", GREEN_BENZO, pristine, { pin: true });
  check("green-4-pinned-resign-not-refused", !CLOSED.test(g.err + g.out), `exit ${g.code}: ${line(g)}`);
}
stubProc.kill();
console.log(failed === 0 ? `RESULT PASS ${part}` : `RESULT FAIL ${part} (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
