// H10 (docs/design/phase7-h10-h11.md): the seller payout address is committed in the signed manifest and the
// signer hosts refuse a packet whose seller_ua does not hash to that commitment. This repro drives the REAL
// shipped paths offline:
//   - the commitment function and the manifest schema shape (unit: good, bad length, uppercase hex, extra field);
//   - `auction create`: the commitment from the operator routing, H4's Orchard-receiver rule, the mainnet rule;
//   - the three signer-host commands (`sign build`, `sign approve`, `sign derivable`) against a fixture
//     auction whose packet carries a different seller_ua than the committed one — red-before (base commit):
//     the host accepts the substituted address; green-after: all three refuse it typedly;
//   - `benzo seller check`, the seller's own one-line pre-open check.
// The base commit's manifest schema predates seller_ua_commitment and refuses the field outright, so the
// red-before's acceptance is shown on the only manifest the base can read — the pre-H10 legacy manifest (which
// is what every pre-H10 auction is); the green-after adds the bound-manifest refusals and keeps the legacy
// manifest settling with one WARN line. The header of each .out records which tree ran.
// Build+run: npx esbuild tools/repro/h10-seller-binding.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/h10.mjs && node tmp/h10.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { hash, jsonBytes, sellerUaCommitment, reserveReturnUaCommitment, validateManifest } from "../../manifest/schema";
import { sealBlob } from "../../envelope";
import { buildAuction, fetchBeacon, needRealPczt, UA_ORCHARD, UA_SAPLING_ONLY, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/h10.mjs (tools/repro/h10-seller-binding.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT; // this process classifies through the real audited binary
const BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
const WORK = path.join(ROOT, "tmp", "h10");
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const sh = (args: string[], env: Record<string, string>) => {
  const r = spawnSync(process.execPath, [BENZO, ...args], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

// ---- A. the commitment function and the manifest schema shape (unit) -----------------------------------------
{
  // Independent recomputation: the prefix carries a literal NUL, exactly the spec's bytes.
  const independent = createHash("sha256").update("benzo-seller-ua-v1\0" + UA_ORCHARD, "binary").digest("hex");
  const mine = sellerUaCommitment(UA_ORCHARD);
  check("unit-commitment-known-answer", mine === independent && /^[0-9a-f]{64}$/.test(mine),
    `sellerUaCommitment = ${mine} (independent sha256 over "benzo-seller-ua-v1\\0" || utf8(ua) = ${independent})`);
  check("unit-commitment-not-the-address", mine !== hash(UA_ORCHARD) && !mine.includes(UA_ORCHARD.slice(0, 12)),
    "the commitment is domain-separated, not a bare address hash");
}

const beacon = await fetchBeacon(32704232);
// B46 (H15): the bound fixture carries BOTH address commitments (a B46-era manifest does), so the mainnet
// cases below still show each rule passing one at a time and refusing at the network lock.
const fixture: Fixture = await buildAuction({ beacon, commitment: sellerUaCommitment(UA_ORCHARD), reserve_commitment: reserveReturnUaCommitment(UA_ORCHARD) });
const legacy: Fixture = await buildAuction({ beacon });

{
  // The schema shape verify checks when the field is present (H10 item 5): good, bad length, uppercase hex,
  // and an extra field (a manifest that leaks a real seller_ua must never validate).
  const shapeCase = (id: string, patch: (m: any) => any, mustPass: boolean) => {
    const m = patch(JSON.parse(JSON.stringify(fixture.manifest)));
    let verdict: string | null = null;
    try { validateManifest(m); } catch (e) { verdict = (e as Error).message; }
    check(id, mustPass ? verdict === null : verdict !== null && /seller_ua_commitment|unknown or missing manifest field/.test(verdict),
      mustPass ? (verdict === null ? "accepted" : `unexpectedly refused: ${verdict}`) : `refused: ${verdict}`);
  };
  shapeCase("unit-shape-good", m => m, true);
  shapeCase("unit-shape-bad-length", m => ({ ...m, seller_ua_commitment: "ab".repeat(31) }), false);
  shapeCase("unit-shape-uppercase-hex", m => ({ ...m, seller_ua_commitment: "AB".repeat(32) }), false);
  shapeCase("unit-shape-extra-field", m => ({ ...m, seller_ua: UA_ORCHARD }), false);
}
check("fixture-seller-payout", /^[1-9][0-9]*$/.test(fixture.payout),
  `/^[1-9]/ tests the fixture result's seller obligation: ${fixture.payout} zats`);

// ---- B. `auction create`: the commitment, H4's receiver rule, the mainnet rule --------------------------------
const createRun = (name: string, manifest: any, config: any) => {
  const state = path.join(WORK, "create-" + name);
  for (const d of [state, path.join(state, "product")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "witness-set.json"), jsonBytes(fixture.witnessSet));
  if (config) writeFileSync(path.join(state, "operator.json"), JSON.stringify(config));
  writeFileSync(path.join(state, "unsigned.json"), JSON.stringify(manifest));
  const r = sh(["auction", "create", "--file", path.join(state, "unsigned.json"), "--witness-set", path.join(state, "witness-set.json"),
    ...(config ? ["--config", path.join(state, "operator.json")] : [])], { BNZ_STATE_DIR: state, BNZ_PCZT_BIN: REAL_PCZT });
  return { state, r };
};
const draftOf = (state: string) => JSON.parse(readFileSync(path.join(state, "product", `${fixture.id}.draft.json`), "utf8")).manifest;
const unbound = (m: any) => ({ ...m, seller_ua_commitment: undefined });
const mainnet = (withCommitment: boolean) => ({ ...(withCommitment ? fixture.manifest : unbound(fixture.manifest)), network: "main",
  escrow_ua: "u1fixtureescrow000000000000000000000000000000000000000000000000000000",
  deposit_addresses: ["u1fixturedeposit00000000000000000000000000000000000000000000000000000"] });

{
  const { state, r } = createRun("routing", unbound(fixture.manifest), { settlement: {}, routing: { seller_ua: UA_ORCHARD } });
  const committed = r.code === 0 ? draftOf(state).seller_ua_commitment : null;
  check("create-sets-commitment-from-routing", r.code === 0 && committed === sellerUaCommitment(UA_ORCHARD),
    `${r.code === 0 ? "set" : "did not set"} seller_ua_commitment ${committed ?? "(none)"} (${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 120)})`);
}
{
  const { r } = createRun("sapling", unbound(fixture.manifest), { settlement: {}, routing: { seller_ua: UA_SAPLING_ONLY } });
  check("create-refuses-sapling-only-seller-ua", r.code !== 0 && /Orchard\/Ironwood receiver \(H4\)/.test(r.err),
    `refused a Sapling-only seller_ua (H4): ${(r.err || r.out).trim().split("\n").at(-1)}`);
}
{
  const { r } = createRun("main-unbound", mainnet(false), null);
  check("create-mainnet-requires-commitment", r.code !== 0 && /mainnet manifest must carry seller_ua_commitment \(H10\)/.test(r.err),
    `mainnet create without seller_ua_commitment refused: ${(r.err || r.out).trim().split("\n").at(-1)}`);
}
{
  // With the commitment the H10 rule passes; the pre-existing `network: "test"` lock (lifted by the head at
  // mainnet) refuses next — the H10 refusal must not fire.
  const { r } = createRun("main-bound", mainnet(true), null);
  check("create-mainnet-with-commitment-passes-h10-rule", r.code !== 0 && !/seller_ua_commitment \(H10\)/.test(r.err) && /manifest version\/network/.test(r.err),
    `passes the H10 rule, refused later by the network lock: ${(r.err || r.out).trim().split("\n").at(-1)}`);
}

// ---- C. the three signer-host paths --------------------------------------------------------------------------
const hostEnv = (state: string) => ({ BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"),
  BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/" });
const packetDir = (name: string, fx: Fixture, sellerUa: string, rows: any[], candidate?: { pays: string; amount: string }) => {
  const dir = path.join(WORK, "packet-" + name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePublicDir(path.join(dir, "public"), fx);
  const meta: any = { auction_id: fx.id, signer: fx.signer, seller_ua: sellerUa };
  if (rows.length) { meta.batch = 1; meta.expiry_blocks = 100; } // what settle/cli.ts writes for a build packet
  if (rows.length) writeFileSync(path.join(dir, "rows.json"), jsonBytes(rows));
  if (candidate) {
    // The candidate the coordinator would deliver: the stub PCZT shape (rows) plus the copy sealed to alice,
    // exactly the packet `sign approve` consumes (the stub redact copies bytes, so plan_version is the file hash).
    const content = JSON.stringify({ rows: [{ recipient: candidate.pays, amount_zats: candidate.amount }] });
    writeFileSync(path.join(dir, "candidate.pczt"), content);
    writeFileSync(path.join(dir, "sealed-alice.bin"), sealBlob(Buffer.from(content), fx.envelopeKeys[0].public_hex), { mode: 0o600 });
    meta.batch = 1;
    meta.plan_version = createHash("sha256").update(readFileSync(path.join(dir, "candidate.pczt"))).digest("hex");
  }
  writeFileSync(path.join(dir, "packet.json"), jsonBytes(meta));
  return dir;
};
const rowsSeller = (fx: Fixture) => [{ party: "seller", kind: "payout", amount_zats: fx.payout }];
const warnCount = (err: string) => (err.match(/^WARN legacy manifest: seller payout address not bound \(H10\)$/gm) ?? []).length;
const createdRows = (state: string) => existsSync(path.join(state, "create-log.jsonl"))
  ? readFileSync(path.join(state, "create-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];

// C1. The substituted packet against the committed manifest: every host path refuses the seller row typedly.
for (const [name, args] of [["build", ["sign", "build", "--id", fixture.id, "--batch", "1"]],
  ["approve", ["sign", "approve", "--id", fixture.id, "--batch", "1"]],
  ["derivable", ["sign", "derivable", "--id", fixture.id]]] as [string, string[]][]) {
  const dir = packetDir(`substituted-${name}`, fixture, UA_SAPLING_ONLY, name === "build" ? rowsSeller(fixture) : [],
    name === "approve" ? { pays: UA_SAPLING_ONLY, amount: fixture.payout } : undefined);
  const state = path.join(WORK, `state-substituted-${name}`);
  writeHostState(state, fixture, REAL_PCZT);
  const r = sh([...args, "--packet", dir, "--name", "alice"], hostEnv(state));
  const typed = /refused-rows \["seller"\]/.test(r.err);
  check(`sign-${name}-substituted-refused`, r.code === 3 && typed,
    `${r.code === 3 && typed ? "typed refusal" : `exit ${r.code}, no typed refusal`}: ${(r.err || r.out).trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`);
  const built = createdRows(state);
  if (built.length) { console.log(`OBSERVE substituted-seller-accepted ${built.map(b => b.recipient).join(",")} (the base commit pays this address)`); fail(`sign-${name}-substituted-not-built`, "the host commanded a payment to the substituted address"); }
  if (existsSync(path.join(dir, "build.json"))) fail(`sign-${name}-substituted-no-build`, "build.json was written for a refused packet");
}

// C2. The honest packet: every host path passes.
{
  const dir = packetDir("honest-build", fixture, UA_ORCHARD, rowsSeller(fixture));
  const state = path.join(WORK, "state-honest-build"); writeHostState(state, fixture, REAL_PCZT);
  const r = sh(["sign", "build", "--id", fixture.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
  const built = existsSync(path.join(dir, "build.json")) ? JSON.parse(readFileSync(path.join(dir, "build.json"), "utf8")) : null;
  const seller = (built?.outputs ?? []).find((o: any) => o.party === "seller");
  const paid = createdRows(state).map(b => b.recipient);
  check("sign-build-honest-passes", r.code === 0 && seller && paid.includes(UA_ORCHARD) && warnCount(r.err) === 0,
    `${r.code === 0 ? `built the seller row to the committed address (${paid.join(",").slice(0, 24)}…)` : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)}`}`);
}
{
  const dir = packetDir("honest-derivable", fixture, UA_ORCHARD, []);
  const state = path.join(WORK, "state-honest-derivable"); writeHostState(state, fixture, REAL_PCZT);
  const r = sh(["sign", "derivable", "--id", fixture.id, "--packet", dir, "--name", "alice"], hostEnv(state));
  let listed = false; try { listed = (JSON.parse(r.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!).rows ?? []).some((x: any) => x.party === "seller" && x.amount_zats === fixture.payout); } catch {}
  check("sign-derivable-honest-passes", r.code === 0 && listed && warnCount(r.err) === 0,
    `${r.code === 0 && listed ? "lists the seller row" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)}`}`);
}
{
  const dir = packetDir("honest-approve", fixture, UA_ORCHARD, [], { pays: UA_ORCHARD, amount: fixture.payout });
  const state = path.join(WORK, "state-honest-approve"); writeHostState(state, fixture, REAL_PCZT);
  const r = sh(["sign", "approve", "--id", fixture.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
  const recorded = existsSync(path.join(state, "approvals", fixture.id, "batch-1.json"));
  check("sign-approve-honest-passes", r.code === 0 && recorded && warnCount(r.err) === 0,
    `${r.code === 0 && recorded ? "recorded the approval" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)}`}`);
}

// C3. A legacy manifest (created before H10, no commitment): today's amount-only behaviour stays, with exactly
// one WARN line — the host accepts the packet's seller_ua (the documented residual; the red-before's defect).
{
  const dir = packetDir("legacy-build", legacy, UA_SAPLING_ONLY, rowsSeller(legacy));
  const state = path.join(WORK, "state-legacy-build"); writeHostState(state, legacy, REAL_PCZT);
  const r = sh(["sign", "build", "--id", legacy.id, "--batch", "1", "--packet", dir, "--name", "alice"], hostEnv(state));
  const paid = createdRows(state).map(b => b.recipient);
  console.log(`OBSERVE legacy-packet-seller-accepted ${paid.join(",") || "(none)"} (amount-only behaviour for pre-H10 manifests)`);
  check("legacy-manifest-settles-with-warn", r.code === 0 && paid.includes(UA_SAPLING_ONLY) && warnCount(r.err) === 1,
    `${r.code === 0 ? "settled the legacy manifest's seller row from the packet" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)}`} with ${warnCount(r.err)} WARN line(s)`);
  const ddir = packetDir("legacy-derivable", legacy, UA_SAPLING_ONLY, []);
  const dstate = path.join(WORK, "state-legacy-derivable"); writeHostState(dstate, legacy, REAL_PCZT);
  const d = sh(["sign", "derivable", "--id", legacy.id, "--packet", ddir, "--name", "alice"], hostEnv(dstate));
  let listed = false; try { listed = (JSON.parse(d.out.trim().split("\n").filter((l: string) => l.startsWith("{")).at(-1)!).rows ?? []).some((x: any) => x.party === "seller"); } catch {}
  check("legacy-manifest-derivable-with-warn", d.code === 0 && listed && warnCount(d.err) === 1,
    `${d.code === 0 && listed ? "lists the seller row" : `exit ${d.code}`} with ${warnCount(d.err)} WARN line(s)`);
}

// ---- D. `benzo seller check` (the README's one-liner) ---------------------------------------------------------
for (const [id, ua, bound, expect] of [["honest", UA_ORCHARD, true, 0], ["substituted", UA_SAPLING_ONLY, true, 1], ["legacy", UA_ORCHARD, false, 1]] as const) {
  const fx = bound ? fixture : legacy;
  const dir = path.join(WORK, "seller-check-" + id); writePublicDir(dir, fx);
  const r = sh(["seller", "check", "--manifest", path.join(dir, "manifest.json"), "--ua", ua], { BNZ_STATE_DIR: path.join(WORK, "seller-check-state") });
  const ok = r.code === expect && (bound ? /"matches":(true|false)/.test(r.out + r.err) : /not bound/.test(r.err));
  check(`seller-check-${id}`, ok, `exit ${r.code} (expected ${expect}): ${((r.out || r.err).trim().split("\n").at(-1) ?? "").slice(0, 140)}`);
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
