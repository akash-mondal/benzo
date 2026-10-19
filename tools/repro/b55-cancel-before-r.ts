// B55 item 1 (docs/design/phase7-b55-cancel-before-r-and-rg-harness.md §1): a cancelled-before-R settle never
// touches drand — the canary M1 product bug (`settle node exited 1: ERROR settle refused: drand opening beacon
// unavailable or unverified on every endpoint` on every cancelled-before-R run since B43). Red on the base
// commit b2b35b6 bundles (tmp/b55/base-src/), green after, all offline on the h-fixtures machinery (a small but
// REAL auction document — real tlock ciphertexts to quicknet round 32704232, a signed manifest, the frozen set,
// witness certificates, envelope records — with the offline externals stubbed and every product decision the
// real shipped code):
//   red (a) / green: the coordinator plan for a CANCELLED auction with 2 confirmed deposits parks both with the
//     exact reason `cancelled before release; refund is claimable after R`, exit 0 — and fetches the beacon ZERO
//     times (counted by the local drand stub's request log; a run against a genuinely closed local port agrees);
//   red (b) / green: the same with a frozen set (cancel after freeze — the witness gate runs on the fixture's
//     own re-signed freeze certificates): same rows, reason, exit 0, zero fetches;
//   red (c) / green: the host derive (`benzo sign derivable`) for both packets does not throw (exit 0), derives
//     no payable deposit row, and every deposit waits with the plan's own reason in the listing's refused_rows
//     (and as H21 per-row refused tags) — zero beacon fetches;
//   (d): the same 2-deposit world after R with a STUB-VERIFIED beacon (the local drand stub serves the recorded
//     round-32704232 quicknet beacon; the shared fetch's own BLS verify passes it) behaves exactly as before the
//     fix — the owner's claim and the memo-bound envelope resolve through gateEnvelope, base and green plans
//     agree row for row, and the beacon IS fetched then. The pre-R guards are pre-R only.
// The pre-R worlds' manifests pin a FUTURE drand round R (released = false, the settle/plan.ts predicate) with
// T_submit/T_freeze in the past — a real cancel-before-R shape; their memo/leaf ciphertexts are the fixture's
// real ciphertexts re-stamped to the future round in the age tlock stanza (nothing opens them before R; the
// derive's own-scan frozen recompute reads only the stanza shape). The (d) world keeps the real round and real
// ciphertexts byte for byte.
//
// Build+run:
//   npx esbuild tools/repro/b55-cancel-before-r.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b55.mjs
//   (base bundles under tmp/b55/base-src/, built ONCE from the pristine base commit before any B55 edit:
//     mkdir -p tmp/b55/base-src && git archive b2b35b6 | tar -x -C tmp/b55/base-src && ln -s $PWD/node_modules tmp/b55/base-src/node_modules
//     (cd tmp/b55/base-src && node cli/build.mjs && npx esbuild settle/plan.ts --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=settle/dist/plan.mjs))
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli
//   node tmp/b55.mjs before && node tmp/b55.mjs after
//   (the `after` part reuses tmp/b55/fixture.json + tmp/b55/d-base.json the `before` part wrote — run it first)
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
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b55.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b55.mjs ${part} (tools/repro/b55-cancel-before-r.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
const WORK = path.join(ROOT, "tmp", "b55", "run");
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true }); mkdirSync(path.join(ROOT, "tmp", "b55"), { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
const BASE = path.join(ROOT, "tmp", "b55", "base-src");
const BASE_PLAN = path.join(BASE, "settle", "dist", "plan.mjs"), BASE_BENZO = path.join(BASE, "cli", "dist", "benzo.mjs");
const GREEN_PLAN = path.join(ROOT, "settle", "dist", "plan.mjs"), GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
for (const f of [BASE_PLAN, BASE_BENZO]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
for (const f of [GREEN_PLAN, GREEN_BENZO]) if (part === "after" && !existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const save = (name: string, doc: unknown) => writeFileSync(path.join(ROOT, "tmp", "b55", name), JSON.stringify(doc, null, 1));
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(ROOT, "tmp", "b55", name), "utf8"));

// ---- the one real fetch (the fixtures' rule) and the local drand stub: a SEPARATE process (the fold blocks
// its own event loop inside spawnSync, so an in-process server could never answer the child's fetch) that
// serves ONLY the recorded round-32704232 beacon (the (d) world's "stub-verified" beacon — the shared fetch
// BLS-verifies it), 404s every other round, and appends one line per request to a log so the pre-R legs can
// prove ZERO beacon fetches.
const R = 32704232;
type FixtureBox = { fx: Fixture; futureR: number };
let box: FixtureBox;
if (part === "before" || !existsSync(path.join(ROOT, "tmp", "b55", "fixture.json"))) {
  const beacon = await fetchBeacon(R); // one real past-round beacon, once (tools/bench.ts's rule)
  const fx = await buildAuction({ beacon, count: 2, fee_zats: "0" });
  const futureR = 1 + Math.ceil((Math.floor(Date.now() / 1000) + 31_536_000 - QUICKNET.genesis) / QUICKNET.period);
  box = { fx, futureR };
  if (part === "before") save("fixture.json", box);
} else box = load<FixtureBox>("fixture.json");
const { fx, futureR } = box;
const stubLog = path.join(ROOT, "tmp", "b55", "drand-hits.log");
writeFileSync(stubLog, "");
const stubScript = path.join(ROOT, "tmp", "b55", "drand-stub.cjs");
writeFileSync(stubScript, `const http=require("http"),fs=require("fs");
const [portFile,logFile,round,sig,chain]=process.argv.slice(2);
const s=http.createServer((req,res)=>{fs.appendFileSync(logFile,"1\\n");
if(req.url.endsWith("/"+chain+"/public/"+round)){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({round:Number(round),signature:sig}));}
else{res.writeHead(404);res.end();}});
s.listen(0,"127.0.0.1",()=>{fs.writeFileSync(portFile,String(s.address().port));});
`);
const portFile = path.join(ROOT, "tmp", "b55", "drand-port.txt"); rmSync(portFile, { force: true });
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
  && (p.parsed.obligations ?? []).length === 0 && (p.parsed.refusals ?? []).length === 2
  && (p.parsed.checks ?? []).length === 0 && (p.err.match(new RegExp(REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length === 2;
const waitingRows = (d: any) => {
  const rows: any[] = d?.parsed?.rows ?? [], refused: string[] = d?.parsed?.refused_rows ?? [], why: Record<string, string> = d?.parsed?.refused_reasons ?? {};
  const depositRows = rows.filter(r => !r.refused && String(r.party).startsWith("deposit:"));
  return { ok: depositRows.length === 0 && refused.length === 2 && refused.every(p => why[p] === REASON)
    && rows.filter(r => r.refused && String(r.party).startsWith("deposit:")).every(r => r.reason === REASON), refused, why };
};
// (d) claims: deposit 0's own owner key claims its refund; deposit 1 refunds through its memo-bound envelope.
const claimsFor = (w: World) => {
  const note = w.notes[0], party = `deposit:${note.txid}:${note.pool}:${note.action_index}`;
  const envelopeCt = fx.envelopes[0].envelope_ct;
  const owner = { private_hex: ownerPrivate("0"), public_hex: ownerPublic(ownerPrivate("0")) };
  const body = { kind: "claim-refund", auction_id: fx.id, party, claim_envelope_sha256: hash(Buffer.from(envelopeCt, "hex")) };
  return [{ auction_id: fx.id, party, claim_envelope_sha256: body.claim_envelope_sha256, claim_envelope_ct: envelopeCt, owner_sig: signStatement(owner, body), memo_hex: note.memo_hex }];
};
const parties = (p: any) => (p?.parsed?.obligations ?? []).map((o: any) => `${o.party}:${o.amount_zats}`).sort();

if (part === "before") {
  console.log("=== red (a) on the BASE bundles: the cancelled-before-R plan dies on the drand fetch (M1)");
  const a = runPlan("red-a", BASE_PLAN, future, BASE, DRAND_URL);
  check("red-a-cancel-before-r-throws", a.code !== 0 && /drand opening beacon unavailable/.test(a.err) && a.fetches >= 1 && !a.parsed,
    `exit ${a.code}, ${a.fetches} beacon fetch(es): ${(a.err || a.out).trim().split("\n").filter(l => /^ERROR/.test(l)).at(-1)?.slice(0, 120) ?? "(no ERROR line)"}`);
  console.log("=== red (b): the same with a frozen set (cancel after freeze)");
  const b = runPlan("red-b", BASE_PLAN, future, BASE, DRAND_URL, { frozen: true });
  check("red-b-cancel-after-freeze-throws", b.code !== 0 && /drand opening beacon unavailable/.test(b.err) && b.fetches >= 1 && !b.parsed,
    `exit ${b.code}, ${b.fetches} beacon fetch(es): ${(b.err || b.out).trim().split("\n").filter(l => /^ERROR/.test(l)).at(-1)?.slice(0, 120) ?? "(no ERROR line)"}`);
  console.log("=== red (c): the host derive throws on both packets");
  const cu = runDerivable("red-c", BASE_BENZO, future, path.join(WORK, "public-red-c"), DRAND_URL);
  check("red-c-derive-throws", cu.code !== 0 && !cu.parsed,
    `exit ${cu.code}, ${cu.fetches} beacon fetch(es): ${(cu.err || cu.out).trim().split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 160) || "(no ERROR line)"}`);
  const cf = runDerivable("red-c-frozen", BASE_BENZO, future, path.join(WORK, "public-red-c-frozen"), DRAND_URL);
  check("red-c-derive-frozen-throws", cf.code !== 0 && !cf.parsed,
    `exit ${cf.code}, ${cf.fetches} beacon fetch(es): ${(cf.err || cf.out).trim().split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 160) || "(no ERROR line)"}`);
  console.log("=== red (a-claim): a claim submitted before R dies with the opaque drand error and stops the run");
  const ac = runPlan("red-a-claim", BASE_PLAN, future, BASE, DRAND_URL, { claims: claimsFor(future) });
  check("red-a-claim-fails-with-drand-error", ac.code !== 0 && /refused: refused: drand opening beacon unavailable/.test(ac.err) && !ac.parsed,
    `exit ${ac.code}, ${ac.fetches} beacon fetch(es): ${(ac.err || ac.out).trim().split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 200)}`);
  console.log("=== (d) baseline on the BASE bundles: the same world AFTER R resolves claim and envelope");
  const dp = runPlan("d-plan-base", BASE_PLAN, pristine, BASE, DRAND_URL, { claims: claimsFor(pristine), opens: true });
  const dd = runDerivable("d-derive-base", BASE_BENZO, pristine, path.join(WORK, "public-d-derive-base"), DRAND_URL, { claims: claimsFor(pristine) });
  check("base-d-post-r-claim-and-envelope-resolve", dp.code === 0 && dp.parsed?.obligations?.length === 2 && (dp.parsed.exceptions ?? []).length === 0
    && (dp.parsed.claim_envelopes ?? {}) && Object.keys(dp.parsed.envelope_agreed ?? {}).length === 2 && dd.code === 0 && (dd.parsed?.rows ?? []).length === 2,
    `plan exit ${dp.code} obligations ${JSON.stringify(parties(dp))}, derive exit ${dd.code} rows ${JSON.stringify((dd.parsed?.rows ?? []).map((r: any) => r.party))}, ${dp.fetches}+${dd.fetches} beacon fetch(es); plan: ${(dp.err || dp.out).trim().split("\n").filter((l: string) => /^ERROR|^WARN/.test(l)).slice(0, 3).join(" | ").slice(0, 240)}; derive: ${(dd.err || dd.out).trim().split("\n").filter((l: string) => /^ERROR|^WARN/.test(l)).slice(0, 3).join(" | ").slice(0, 240)}`);
  save("d-base.json", { plan: { code: dp.code, obligations: dp.parsed?.obligations ?? null, exceptions: dp.parsed?.exceptions ?? null, refusals: dp.parsed?.refusals ?? null,
    claim_envelopes: dp.parsed?.claim_envelopes ?? null, claims_used: dp.parsed?.claims_used ?? null, envelope_agreed: dp.parsed?.envelope_agreed ?? null },
    derive: { code: dd.code, rows: dd.parsed?.rows ?? null } });
} else {
  const dBase = existsSync(path.join(ROOT, "tmp", "b55", "d-base.json")) ? load<any>("d-base.json") : null;
  console.log("=== green (a): the plan parks both deposits with the exact reason, exit 0, no fetch");
  const a = runPlan("green-a", GREEN_PLAN, future, ROOT, DRAND_URL);
  check("green-a-parks-2-with-reason", a.code === 0 && parked(a),
    `exit ${a.code}, exceptions ${JSON.stringify((a.parsed?.exceptions ?? []).map((e: any) => [e.kind, e.amount_zats, e.reason]))}`);
  check("green-a-no-beacon-fetch", a.fetches === 0, `${a.fetches} beacon fetch(es) on the counting stub`);
  const ac2 = runPlan("green-a-claim", GREEN_PLAN, future, ROOT, DRAND_URL, { claims: claimsFor(future) });
  const claimRefusal = (ac2.parsed?.refusals ?? []).find((r: any) => r.reason === "claim refused: refused: claim before release; the owner key is derivable only after R");
  check("green-a-claim-refused-per-request", ac2.code === 0 && !!claimRefusal && (ac2.parsed.exceptions ?? []).length === 2
    && (ac2.parsed.exceptions as any[]).every((e: any) => e.reason === REASON) && (ac2.parsed.claim_envelopes ?? {}) && Object.keys(ac2.parsed.claim_envelopes ?? {}).length === 0,
    `exit ${ac2.code}; the claim fails per request (${JSON.stringify(claimRefusal?.party ?? null)}) inside the plan's try, both deposits still park with the exact reason`);
  check("green-a-claim-no-beacon-fetch", ac2.fetches === 0, `${ac2.fetches} beacon fetch(es) with a claim recorded`);
  const ac = runPlan("green-a-closed", GREEN_PLAN, future, ROOT, CLOSED_URL);
  check("green-a-closed-port-exits-0", ac.code === 0 && parked(ac) && !/drand opening beacon/.test(ac.err),
    `exit ${ac.code} with BNZ_DRAND_URLS on a closed local port (${CLOSED_URL})`);
  console.log("=== green (b): the same with a frozen set (the witness gate passes on the re-signed certificates)");
  const b = runPlan("green-b", GREEN_PLAN, future, ROOT, DRAND_URL, { frozen: true });
  check("green-b-parks-2-with-reason", b.code === 0 && parked(b),
    `exit ${b.code}, exceptions ${JSON.stringify((b.parsed?.exceptions ?? []).map((e: any) => [e.kind, e.amount_zats, e.reason]))}`);
  check("green-b-no-beacon-fetch", b.fetches === 0, `${b.fetches} beacon fetch(es)`);
  console.log("=== green (c): the host derive waits every deposit in refused_rows, exit 0, no fetch");
  const cu = runDerivable("green-c", GREEN_BENZO, future, path.join(WORK, "public-green-c"), DRAND_URL);
  const wu = waitingRows(cu);
  check("green-c-derive-waits-rows", cu.code === 0 && wu.ok,
    `exit ${cu.code}, rows ${JSON.stringify((cu.parsed?.rows ?? []).map((r: any) => r.party))}, refused_rows ${JSON.stringify(wu.refused)} reasons ${JSON.stringify(wu.why)}`);
  check("green-c-derive-no-beacon-fetch", cu.fetches === 0, `${cu.fetches} beacon fetch(es)`);
  const cf = runDerivable("green-c-frozen", GREEN_BENZO, future, path.join(WORK, "public-green-c-frozen"), DRAND_URL);
  const wf = waitingRows(cf);
  check("green-c-derive-frozen-waits-rows", cf.code === 0 && wf.ok,
    `exit ${cf.code}, rows ${JSON.stringify((cf.parsed?.rows ?? []).map((r: any) => r.party))}, refused_rows ${JSON.stringify(wf.refused)}`);
  check("green-c-derive-frozen-no-beacon-fetch", cf.fetches === 0, `${cf.fetches} beacon fetch(es)`);
  console.log("=== (d) green: the same world after R with the stub-verified beacon — exactly as before");
  const dp = runPlan("d-plan-green", GREEN_PLAN, pristine, ROOT, DRAND_URL, { claims: claimsFor(pristine), opens: true });
  const dd = runDerivable("d-derive-green", GREEN_BENZO, pristine, path.join(WORK, "public-d-derive-green"), DRAND_URL, { claims: claimsFor(pristine) });
  const claimParty = claimsFor(pristine)[0].party, otherParty = `deposit:${pristine.notes[1].txid}:${pristine.notes[1].pool}:${pristine.notes[1].action_index}`;
  check("green-d-claim-and-envelope-resolve", dp.code === 0 && JSON.stringify(parties(dp)) === JSON.stringify([`${claimParty}:${fx.manifest.C_zats}`, `${otherParty}:${fx.manifest.C_zats}`].sort())
    && (dp.parsed.exceptions ?? []).length === 0 && Object.keys(dp.parsed.claim_envelopes ?? {}).length === 1 && Object.keys(dp.parsed.envelope_agreed ?? {}).length === 2
    && dd.code === 0 && (dd.parsed?.rows ?? []).length === 2,
    `plan exit ${dp.code} obligations ${JSON.stringify(parties(dp))}, derive exit ${dd.code} rows ${JSON.stringify((dd.parsed?.rows ?? []).map((r: any) => r.party))}`);
  check("green-d-beacon-fetched-after-r", dp.fetches >= 1 && dd.fetches >= 1, `plan ${dp.fetches} + derive ${dd.fetches} beacon fetch(es) — after R the beacon is fetched exactly as before`);
  if (dBase) {
    const same = JSON.stringify({ obligations: dp.parsed.obligations, exceptions: dp.parsed.exceptions, refusals: dp.parsed.refusals,
      claim_envelopes: dp.parsed.claim_envelopes, claims_used: dp.parsed.claims_used, envelope_agreed: dp.parsed.envelope_agreed })
      === JSON.stringify({ obligations: dBase.plan.obligations, exceptions: dBase.plan.exceptions, refusals: dBase.plan.refusals,
        claim_envelopes: dBase.plan.claim_envelopes, claims_used: dBase.plan.claims_used, envelope_agreed: dBase.plan.envelope_agreed });
    check("green-d-parity-with-base", same && JSON.stringify(dd.parsed?.rows ?? null) === JSON.stringify(dBase.derive.rows),
      same ? "the base and green plans and derives agree row for row (claim, envelope, reasons, agreed hashes)" : "green output differs from the base baseline (tmp/b55/d-base.json)");
  } else check("green-d-parity-with-base", false, "tmp/b55/d-base.json missing — run `node tmp/b55.mjs before` first");
  console.log(`OBSERVE d-frozen-derive: the green derive also completes on the frozen cancelled packet (${JSON.stringify((cf.parsed?.rows ?? []).map((r: any) => r.party))} rows, refused_rows ${JSON.stringify(wf.refused)}); the base refused it at the internal verify gate ("missing result") before any derivation — see STATUS-B Q2`);
}

stubProc.kill();
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
