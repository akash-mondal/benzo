// B44 (docs/design/phase7-b44-opener-fix.md): the opener never throws on a leaf or a memo — Reviewer R's P1-1
// and P1-2 on B43. Real tlock ciphertexts sealed to the past quicknet round 32704232 (the h-fixtures
// machinery); red on the BASE commit's bundles under tmp/b44/base/ (built ONCE from the pristine base commit
// before any B44 edit), green after, for each of the design's cases:
//   (a) a 128-byte stanza body of junk (128 x 0x5a, the head's r100 probe): shape-valid under B43's
//       length-only rule and the base opener THROWS `invalid G2 point: expected 96/192 bytes` — one admitted
//       griefing bid stops `open`, `benzo verify` and every host's deriveRows for everyone. B44 refuses it at
//       ADMISSION (the new G2 check on the body's first 96 bytes — the bidder sees the reason); built
//       directly into a frozen fixture it opens {error:"undecryptable"} and verify plus host deriveRows agree.
//   (b) a valid compressed G2 point + 32 junk bytes: passes admission before AND after (only the first 96
//       bytes can be checked before R); the base opener THROWS `invalid proof: rP check failed`; after B44 it
//       opens `undecryptable` on every path and nothing throws.
//   (c) stray deposits whose memos are (1) a genuine sealed bid of round R+1 and (2) a junk-body sealed bid
//       of round R — a stray never passes admission — in a CLEARED fixture and in a CANCELLED fixture. The
//       base plan and deriveRows die on the first such note; after B44 the plan and deriveRows complete, and
//       each stray's owner key derives as null (the memo-openings cache records it) — claim-only, exactly
//       today's null path.
//   (d) `claim-refund` against such a memo: the base run surfaces the raw opener throw; after B44 the claim is
//       refused cleanly with the normal `ERROR benzo refused: claim owner signature` line.
//   (e) the honest leaves open byte-identically to the base commit's (the no-change invariant).
//
// Build+run:
//   npx esbuild tools/repro/b44-opener.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b44.mjs
//   (base bundles under tmp/b44/base/, built ONCE from the pristine base commit before any B44 edit:
//     npx esbuild envelope/opening.ts      --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=tmp/b44/base/opening.mjs
//     npx esbuild cli/published-beacon.ts  --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=tmp/b44/base/published-beacon.mjs
//     npx esbuild clear/auction-cli.ts     --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=tmp/b44/base/auction.mjs
//     npx esbuild settle/plan.ts           --bundle --packages=external --platform=node --format=esm --banner:js=... --outfile=tmp/b44/base/plan.mjs
//     cp -R cli/dist tmp/b44/base/cli-dist; mkdir -p tmp/b44/base/root/clear/dist; cp clear/dist/cli.mjs tmp/b44/base/root/clear/dist/cli.mjs
//   green bundles from this tree: npm run build:core && npm run build:settle && npm run build:cli)
//   node tmp/b44.mjs before && node tmp/b44.mjs after
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bls12_381 } from "@noble/curves/bls12-381";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import { hash, jsonBytes, QUICKNET, signRecord, type Manifest } from "../../manifest/schema";
import { generateOwnerKey, sealEnvelope, signStatement } from "../../envelope";
import { sealedBidShape, openSealedBid } from "../../envelope/opening";
import { publishedClient } from "../../cli/published-beacon";
import { depositParty } from "../../settle/deposits";
import { buildAuction, fetchBeacon, needRealPczt, pem, UA_ORCHARD, writeAuctionLedger, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/b44.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/b44.mjs ${part} (tools/repro/b44-opener.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const WORK = path.join(ROOT, "tmp", "b44", "run");
mkdirSync(WORK, { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;
const BASE = path.join(ROOT, "tmp", "b44", "base");
const BASE_OPENING = path.join(BASE, "opening.mjs"), BASE_PB = path.join(BASE, "published-beacon.mjs");
const BASE_AUCTION = path.join(BASE, "auction.mjs"), BASE_PLAN = path.join(BASE, "plan.mjs"), BASE_BENZO = path.join(BASE, "cli-dist", "benzo.mjs");
const BASE_ROOT = path.join(BASE, "root"); // carries the base clear/dist/cli.mjs the base plan spawns (BNZ_ROOT)
const GREEN_AUCTION = path.join(ROOT, "clear", "dist", "auction.mjs"), GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs"), GREEN_PLAN = path.join(ROOT, "settle", "dist", "plan.mjs");
for (const f of [BASE_OPENING, BASE_PB, BASE_AUCTION, BASE_PLAN, BASE_BENZO, path.join(BASE_ROOT, "clear", "dist", "cli.mjs")]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
for (const f of [GREEN_AUCTION, GREEN_BENZO, GREEN_PLAN]) if (part === "after" && !existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:settle && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const save = (name: string, value: unknown) => writeFileSync(path.join(WORK, name), jsonBytes(value));
const load = (name: string) => JSON.parse(readFileSync(path.join(WORK, name), "utf8"));
const R = 32704232;

// ---- the two B44 griefing bodies (the head's r100 probe mutations) ---------------------------------------
// Replace the stanza body's three base64 lines (64 + 64 + 43 chars = 128 bytes) with another 128-byte body.
const replaceBody = (ct: Buffer, body: Buffer): Buffer => {
  const encoded = body.toString("base64").replace(/=+$/, "");
  const lines = ct.toString("latin1").split("\n"), stanzaAt = lines.findIndex(l => l.startsWith("-> tlock "));
  return Buffer.from([...lines.slice(0, stanzaAt + 1), encoded.slice(0, 64), encoded.slice(64, 128), encoded.slice(128), ...lines.slice(stanzaAt + 4)].join("\n"), "binary");
};
const junkBodyCt = (ct: Buffer): Buffer => replaceBody(ct, Buffer.alloc(128, 0x5a));
const junkVwCt = (ct: Buffer): Buffer => replaceBody(ct, Buffer.concat([Buffer.from(bls12_381.G2.ProjectivePoint.BASE.toBytes(true)), Buffer.alloc(32, 0x5b)]));
const memoV1 = (ct: Buffer): string => {
  if (ct.length > 505) throw new Error("ciphertext memo cap");
  const memo = Buffer.alloc(512); Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
  return memo.toString("hex");
};

// ---- the future-round admission fixture (the admission time gates refuse a past round by design) ----------
const pinnedInfo = { public_key: QUICKNET.public_key, period: QUICKNET.period, genesis_time: QUICKNET.genesis, hash: QUICKNET.chain_hash, groupHash: "", schemeID: QUICKNET.scheme, metadata: { beaconID: "quicknet" } };
const pinnedClient = { chain: () => ({ info: async () => pinnedInfo }) } as unknown as Parameters<typeof timelockEncrypt>[2];
const admissionR = 1 + Math.ceil((Math.floor(Date.now() / 1000) + 30 * 86400 - QUICKNET.genesis) / QUICKNET.period);
const admissionFixture = async () => {
  const signer = createPublicKey(pem("manifest")).export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = createHash("sha256").update("benzo-b44-admission").digest("hex");
  const release = QUICKNET.genesis + (admissionR - 1) * QUICKNET.period;
  const address = "utest1" + createHash("sha256").update("benzo-b44-deposit").digest("hex");
  const manifest: Manifest = {
    version: 1, network: "test", auction_id, escrow_ua: address, frost_group_key: createHash("sha256").update("benzo-b44-group").digest("hex"), lot: "b44 admission",
    supply: 3, reserve_zats: "1000", tick_zats: "1000", B_max_zats: "100000", q_max: 10, C_zats: "1000100", fee_zats: "100",
    deposit_addresses: [address], drand: { ...QUICKNET, R: admissionR }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  } as Manifest;
  const manifestPacket = signRecord(manifest, pem("manifest"));
  const honest = Buffer.from(decodeArmor(await timelockEncrypt(admissionR, Buffer.alloc(128, 1), pinnedClient)), "binary");
  const cases = [
    { name: "honest", ct: honest },
    { name: "junk-body", ct: junkBodyCt(honest) },
    { name: "junk-vw", ct: junkVwCt(honest) },
  ];
  return { signer, auction_id, manifestPacket, address, cases: cases.map((c, i) => ({
    ...c,
    memo: memoV1(c.ct),
    txid: createHash("sha256").update("benzo-b44-admission-txid:" + i).digest("hex"),
    note: { txid: createHash("sha256").update("benzo-b44-admission-txid:" + i).digest("hex"), height: 99000, pool: "ironwood", address,
      diversifier_index: String(i), action_index: i, value_zats: Number(manifest.C_zats), memo_hex: memoV1(c.ct), spent_in_txid: null },
  })) };
};

// ---- the admit command harness (the real `bid deposit` admit path: clear/dist/auction.mjs admit) ----------
const writeAdmissionState = (state: string, fx: Awaited<ReturnType<typeof admissionFixture>>, notes: any[]) => {
  rmSync(state, { recursive: true, force: true });
  for (const d of [state, path.join(state, "bin"), path.join(state, "run"), path.join(state, "auction")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "auction", "manifest-signing.pem"), pem("manifest"));
  writeFileSync(path.join(state, "auction", `${fx.auction_id}.json`), jsonBytes(
    { manifest: fx.manifestPacket, signer: fx.signer, state: "OPEN", leaves: [], receipts: [], trace: [] }));
  writeFileSync(path.join(state, "fixture.json"), JSON.stringify({ notes }));
  const stub = (n: string, source: string) => {
    const run = path.join(state, "bin", n), impl = path.join(state, "bin", n + ".cjs");
    writeFileSync(impl, source); chmodSync(impl, 0o755);
    writeFileSync(run, `#!/bin/sh\nexec node "$(dirname "$0")/${n}.cjs" "$@"\n`); chmodSync(run, 0o755);
  };
  stub("zcash-devtool", `const a = process.argv.slice(2);
if (a.includes("balance")) { console.log(JSON.stringify({ chain_tip_height: 100000 })); process.exit(0); }
process.exit(0);
`);
  stub("benzo-scan", `const fs = require("fs"), path = require("path");
const state = path.dirname(path.dirname(process.argv[1]));
for (const n of JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8")).notes) console.log(JSON.stringify(n));
`);
};
const runAdmitCase = (bundle: string, fx: Awaited<ReturnType<typeof admissionFixture>>, c: { name: string; memo: string; txid: string; note: any }) => {
  const state = path.join(WORK, `admit-${path.basename(path.dirname(bundle))}-${c.name}`);
  writeAdmissionState(state, fx, [c.note]);
  const r = spawnSync(process.execPath, [bundle, "admit", fx.auction_id], {
    input: JSON.stringify({ envelope_hex: c.memo, txid: c.txid, address: fx.address }), encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9" },
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

// ---- the open / verify / deriveRows harnesses (h-fixtures stub state; every product decision is real code) --
const runOpen = (label: string, bundle: string, fixture: Fixture) => {
  const state = path.join(WORK, "state-open-" + label);
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, fixture, REAL_PCZT);
  writeAuctionLedger(state, fixture);
  const r = spawnSync(process.execPath, [bundle, "open", fixture.id], {
    input: "{}", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "https://api.drand.sh" },
  });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed };
};
const runVerify = (label: string, benzo: string, fixture: Fixture, opened: any[]) => {
  const dir = path.join(WORK, "verify-" + label), state = path.join(WORK, "verify-state-" + label);
  rmSync(dir, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); mkdirSync(state, { recursive: true, mode: 0o700 });
  writePublicDir(dir, { ...fixture, opened });
  const r = spawnSync(process.execPath, [benzo, "verify", "--dir", dir, "--signer", fixture.signer], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: state } });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
// The cancelled packet's public doc: a signed manifest + a CANCELLED state — never frozen (cancelled before
// freeze), never a result or openings, the same shape loadPublicAuction accepts for a cancelled auction.
const writeCancelledDir = (dir: string, fixture: Fixture) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "auction.json"), jsonBytes({ version: 1, auction_id: fixture.id, signer: fixture.signer,
    manifest: fixture.manifestPacket, state: "CANCELLED", receipts: [], beacon: fixture.beacon, envelopes: fixture.envelopes }));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(fixture.manifestPacket));
};
const runDerivable = (label: string, benzo: string, fixture: Fixture, opts: { notes?: any[]; cancelled?: boolean } = {}) => {
  const notes = opts.notes ?? fixture.notes;
  const state = path.join(WORK, "state-derive-" + label);
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, { ...fixture, notes }, REAL_PCZT);
  const packet = path.join(WORK, "packet-derive-" + label);
  rmSync(packet, { recursive: true, force: true }); mkdirSync(path.join(packet, "public"), { recursive: true, mode: 0o700 });
  if (opts.cancelled) writeCancelledDir(path.join(packet, "public"), fixture); else writePublicDir(path.join(packet, "public"), fixture);
  writeFileSync(path.join(packet, "packet.json"), jsonBytes({ auction_id: fixture.id, signer: fixture.signer, seller_ua: UA_ORCHARD }));
  const r = spawnSync(process.execPath, [benzo, "sign", "derivable", "--id", fixture.id, "--packet", packet, "--name", "alice"], {
    input: "", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/" },
  });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed, state };
};

// ---- the plan and claim-refund harnesses -----------------------------------------------------------------
// One plan state per run: the signer's own state dir (stub externals), the private ledger, and — for the
// cleared fixture — the product config pointing at the published document (the plan then cross-checks its
// fresh openings and clearing against it, exactly like a live settle).
const writePlanState = (state: string, fixture: Fixture, notes: any[], kind: "cleared" | "cancelled") => {
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, { ...fixture, notes }, REAL_PCZT);
  const ledger: any = {
    manifest: fixture.manifestPacket, signer: fixture.signer, state: kind === "cleared" ? "CLEARED" : "CANCELLED",
    leaves: kind === "cleared" ? fixture.leaves : [], receipts: kind === "cleared" ? fixture.receipts : [],
    ...(kind === "cleared" ? { frozen: fixture.frozen, opened: fixture.opened, result: fixture.result } : {}),
    trace: [], beacon: fixture.beacon, envelopes: fixture.envelopes,
  };
  mkdirSync(path.join(state, "auction"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "auction", `${fixture.id}.json`), jsonBytes(ledger));
  if (kind === "cleared") {
    const dir = path.join(state, "public");
    writePublicDir(dir, fixture);
    mkdirSync(path.join(state, "product"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(state, "product", `${fixture.id}.json`), jsonBytes({ public_dir: dir }));
  }
};
const runPlan = (label: string, planBundle: string, fixture: Fixture, kind: "cleared" | "cancelled", notes: any[], bnzRoot: string) => {
  const state = path.join(WORK, "state-plan-" + label);
  writePlanState(state, fixture, notes, kind);
  const r = spawnSync(process.execPath, [planBundle, fixture.id], {
    input: "{}", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/", BNZ_ROOT: bnzRoot },
  });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed };
};
const runClaim = (label: string, benzo: string, fixture: Fixture, notes: any[], note: any) => {
  const state = path.join(WORK, "state-claim-" + label);
  writePlanState(state, fixture, notes, "cleared");
  const owner = generateOwnerKey();
  const claim_envelope_ct = sealEnvelope(UA_ORCHARD, fixture.manifest.envelope_keys!, "test");
  const body = { kind: "claim-refund", auction_id: fixture.id, party: depositParty(note), claim_envelope_sha256: hash(Buffer.from(claim_envelope_ct, "hex")) };
  const request = path.join(state, "claim-request.json");
  writeFileSync(request, jsonBytes({ ...body, claim_envelope_ct, owner_sig: signStatement(owner, body) }));
  const r = spawnSync(process.execPath, [benzo, "claim-refund", "--id", fixture.id, "--file", request], {
    input: "", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/" },
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

if (part === "before") {
  console.log("=== fixtures: real tlock to quicknet round 32704232 (2 intact leaves + the two B44 bodies; 2 strays)");
  const beacon = await fetchBeacon(R);
  const main = await buildAuction({ beacon, count: 4, tamper: [{ index: 2, kind: "junk-body" }, { index: 3, kind: "junk-vw" }] });
  // The strays fixture: two honest leaves plus two third-party deposits whose memos carry (1) a genuine
  // sealed bid of round R+1 and (2) a junk-body sealed bid of round R. fee_zats "0": the settlement plan
  // requires it (the network fee comes from the reserve).
  const strays = await buildAuction({ beacon, count: 2, fee_zats: "0" });
  const wrongRoundCt = Buffer.from(decodeArmor(await timelockEncrypt(R + 1, Buffer.alloc(128, 3), pinnedClient)), "binary");
  const junkBodyStrayCt = junkBodyCt(Buffer.from(main.leaves[0].ciphertext_hex, "hex"));
  const depositAddress = strays.manifest.deposit_addresses[0];
  const strayNote = (tag: string, ct: Buffer, i: number) => ({
    txid: createHash("sha256").update("benzo-b44-stray-" + tag).digest("hex"), height: 91000 + i, pool: "ironwood", address: depositAddress,
    diversifier_index: String(90 + i), action_index: 0, value_zats: 250000, memo_hex: memoV1(ct), spent_in_txid: null });
  const strayWrongRound = strayNote("wrong-round", wrongRoundCt, 0), strayJunkBody = strayNote("junk-body", junkBodyStrayCt, 1);
  const straysFixture = { ...strays, notes: [...strays.notes, strayWrongRound, strayJunkBody] };
  save("fixtures.json", { main, strays: straysFixture, strayNotes: { wrongRound: strayWrongRound, junkBody: strayJunkBody },
    strayCts: { wrongRound: wrongRoundCt.toString("hex"), junkBody: junkBodyStrayCt.toString("hex") } });

  console.log("=== the B44 probe on the BASE commit's opener (the head's r100 probe, both P1s)");
  const baseOpening = await import(pathToFileURL(BASE_OPENING).href);
  const basePb = await import(pathToFileURL(BASE_PB).href);
  const baseLocal = basePb.publishedClient({ round: beacon.round, signature: beacon.signature });
  const probeBase = async (name: string, hex: string) => {
    let open: string; try { const r = await baseOpening.openSealedBid(hex, baseLocal); open = r === null ? "null (undecryptable)" : "plaintext"; }
    catch (e) { open = "THROW " + (e as Error).message; }
    console.log(`OBSERVE probe-${name} shape ${JSON.stringify(baseOpening.sealedBidShape(hex, R))} open ${open}`);
    return open;
  };
  check("red-probe-intact-opens", await probeBase("intact", main.leaves[0].ciphertext_hex) === "plaintext", "the base opener opens an honest bid");
  check("red-probe-junk-body-shape-passes", baseOpening.sealedBidShape(main.leaves[2].ciphertext_hex, R).ok === true, "the base (B43) shape rule accepts the junk body — length-only");
  check("red-probe-junk-body-throws", await probeBase("junk-body", main.leaves[2].ciphertext_hex) === "THROW invalid G2 point: expected 96/192 bytes",
    "the base opener THROWS on the junk body and would stop the open for every bidder");
  check("red-probe-junk-vw-shape-passes", baseOpening.sealedBidShape(main.leaves[3].ciphertext_hex, R).ok === true, "the base shape rule accepts valid G2 + junk V/W");
  check("red-probe-junk-vw-throws", await probeBase("junk-vw", main.leaves[3].ciphertext_hex) === "THROW invalid proof: rP check failed",
    "the base opener THROWS on the junk V/W body");
  const wrongRoundHex = wrongRoundCt.toString("hex");
  const redWrongShape = baseOpening.sealedBidShape(wrongRoundHex, R);
  check("red-probe-wrong-round-shape-would-refuse", redWrongShape.ok === false && /^stanza round is/.test(redWrongShape.reason),
    `the shape rule already calls it the bid's fault: ${JSON.stringify(redWrongShape)}`);
  check("red-probe-wrong-round-throws", await probeBase("wrong-round", wrongRoundHex) === "THROW refused: ciphertext beacon round",
    "the base opener throws OUT of client.get before the shape rule — a stray memo stops everyone");

  console.log("=== red admission: the base admit command accepts both griefing bodies (the body rule is length-only)");
  const fx = await admissionFixture();
  save("admission.json", { R: admissionR, signer: fx.signer, auction_id: fx.auction_id, manifestPacket: fx.manifestPacket, address: fx.address,
    cases: fx.cases.map(c => ({ name: c.name, ct: c.ct.toString("hex"), memo: c.memo, txid: c.txid, note: c.note })) });
  for (const c of fx.cases) {
    const r = runAdmitCase(BASE_AUCTION, fx, c);
    check(`red-admit-accepts-${c.name}`, r.code === 0,
      r.code === 0 ? `the base admit command admitted the ${c.name} bid` : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
  }

  console.log("=== red open/verify/deriveRows on the frozen fixture: the junk-body leaf stops everything");
  const red = runOpen("red", BASE_AUCTION, main);
  check("red-open-throws", red.code !== 0 && /invalid G2 point: expected 96\/192 bytes/.test(red.err) && !red.parsed,
    `the base open died on the junk-body leaf (exit ${red.code}): ${(red.err || red.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
  const redVerify = runVerify("red", BASE_BENZO, main, main.opened);
  check("red-verify-throws", redVerify.code !== 0 && /invalid G2 point/.test(redVerify.out + redVerify.err),
    `the base benzo verify died re-deriving the junk-body leaf (exit ${redVerify.code})`);
  const redDerive = runDerivable("red-main", BASE_BENZO, main);
  check("red-derive-rows-throws", redDerive.code !== 0 && /invalid G2 point/.test(redDerive.out + redDerive.err),
    `the base sign derivable died (exit ${redDerive.code}): ${(redDerive.err || redDerive.out).trim().split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 180) || "(no ERROR line)"}`);

  console.log("=== red plan/deriveRows/claim on the strays: one stray memo kills settlement and refunds");
  const baseNotes = straysFixture.notes.slice(0, 2);
  for (const kind of ["cleared", "cancelled"] as const) {
    for (const [tag, note] of [["wrong-round", strayWrongRound], ["junk-body", strayJunkBody]] as [string, any][]) {
      const p = runPlan(`red-${kind}-${tag}`, BASE_PLAN, straysFixture, kind, [...baseNotes, note], BASE_ROOT);
      check(`red-plan-${kind}-${tag}-dies`, p.code !== 0 && /^ERROR settle /m.test(p.err),
        `the base plan died on the ${tag} stray (exit ${p.code}): ${p.err.trim().split("\n").filter(l => /^ERROR settle /.test(l))[0]?.slice(0, 140)}`);
      const d = runDerivable(`red-${kind}-${tag}`, BASE_BENZO, straysFixture, { notes: [...baseNotes, note], cancelled: kind === "cancelled" });
      check(`red-derive-${kind}-${tag}-dies`, d.code !== 0 && /ciphertext beacon round|invalid G2 point/.test(d.err),
        `the base deriveRows died on the ${tag} stray (exit ${d.code}): ${d.err.trim().split("\n").filter(l => /^ERROR/.test(l))[0]?.slice(0, 140)}`);
    }
    const both = runPlan(`red-${kind}-both`, BASE_PLAN, straysFixture, kind, straysFixture.notes, BASE_ROOT);
    check(`red-plan-${kind}-both-dies`, both.code !== 0 && /^ERROR settle /m.test(both.err),
      `the base plan died with both strays present (exit ${both.code})`);
  }
  for (const [tag, note] of [["wrong-round", strayWrongRound], ["junk-body", strayJunkBody]] as [string, any][]) {
    const c = runClaim(`red-${tag}`, BASE_BENZO, straysFixture, straysFixture.notes, note);
    check(`red-claim-${tag}-throws`, c.code !== 0 && !/claim owner signature/.test(c.err) && /^ERROR benzo /m.test(c.err),
      `the base claim-refund surfaced the raw opener throw (exit ${c.code}): ${c.err.trim().split("\n").at(-1)?.slice(0, 140)}`);
  }

  console.log("=== baseline: the base commit's openings for the honest leaves (case (e) byte-identity reference)");
  const baseline: string[] = [];
  for (const i of [0, 1]) baseline.push(await baseOpening.openSealedBid(main.leaves[i].ciphertext_hex, baseLocal));
  save("opened-honest-baseline.json", baseline);
  console.log(`OBSERVE baseline-honest ${baseline.map(b => b.length / 2 + "B").join(",")} (saved to tmp/b44/run/opened-honest-baseline.json)`);
} else {
  const { main, strays: straysFixture, strayNotes, strayCts } = load("fixtures.json");
  const baseline: string[] = load("opened-honest-baseline.json");
  const { R: aR, signer, auction_id, manifestPacket, address, cases } = load("admission.json");
  const fx = { signer, auction_id, manifestPacket, address, cases: cases.map((c: any) => ({ ...c, ct: Buffer.from(c.ct, "hex") })) };
  const wrongRoundHex: string = strayCts.wrongRound, junkBodyHex: string = strayCts.junkBody;

  console.log("=== the B44 probe on the fixed opener: nothing throws, the junk body is refused at admission");
  const local = publishedClient({ round: R, signature: main.beacon.signature });
  const probe = async (name: string, hex: string) => {
    let open: string; try { const r = await openSealedBid(hex, local); open = r === null ? "null (undecryptable)" : "plaintext"; }
    catch (e) { open = "THROW " + (e as Error).message; }
    console.log(`OBSERVE probe-${name} shape ${JSON.stringify(sealedBidShape(hex, R))} open ${open}`);
    return open;
  };
  check("green-probe-intact-opens", await probe("intact", main.leaves[0].ciphertext_hex) === "plaintext", "the fixed opener still opens an honest bid");
  const greenJunkShape = sealedBidShape(main.leaves[2].ciphertext_hex, R);
  check("green-probe-junk-body-refused-by-shape", greenJunkShape.ok === false && /not a valid G2 point/.test(greenJunkShape.reason),
    `the admission G2 check refuses the junk body: ${JSON.stringify(greenJunkShape)}`);
  check("green-probe-junk-body-null", await probe("junk-body", main.leaves[2].ciphertext_hex) === "null (undecryptable)", "built into a frozen leaf it opens as undecryptable — never a throw");
  check("green-probe-junk-vw-admitted", sealedBidShape(main.leaves[3].ciphertext_hex, R).ok === true, "valid G2 + junk V/W still passes admission (only the first 96 bytes are checkable before R)");
  check("green-probe-junk-vw-null", await probe("junk-vw", main.leaves[3].ciphertext_hex) === "null (undecryptable)", "and opens as undecryptable — never `invalid proof: rP check failed`");
  const greenWrongShape = sealedBidShape(wrongRoundHex, R);
  check("green-probe-wrong-round-null", greenWrongShape.ok === false && await probe("wrong-round", wrongRoundHex) === "null (undecryptable)",
    `a wrong-round sealed bid is the ciphertext's fault: ${JSON.stringify(greenWrongShape)}`);

  console.log("=== green admission: `bid deposit` admit refuses the junk body where the bidder sees it");
  for (const c of fx.cases) {
    const r = runAdmitCase(GREEN_AUCTION, fx, c);
    if (c.name === "honest") check("green-admit-accepts-honest", r.code === 0,
      r.code === 0 ? "the admit command still admits an honest bid" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
    else if (c.name === "junk-body") check("green-admit-refuses-junk-body", r.code !== 0 && /sealed bid structure: stanza body is not a valid G2 point/.test(r.err),
      `refused at admission: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
    else check("green-admit-accepts-junk-vw", r.code === 0,
      r.code === 0 ? "the junk-V/W body is still admitted (documented: V/W cannot be checked before R)" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
  }

  console.log("=== green open/verify/deriveRows on the frozen fixture: both bodies open as undecryptable");
  const green = runOpen("green", GREEN_AUCTION, main);
  const produced = green.parsed?.opened ?? [];
  check("green-open-succeeds", green.code === 0 && produced.length === main.leaves.length,
    `the open completed with ${produced.length} openings (exit ${green.code})`);
  check("green-open-classification-exact", JSON.stringify(produced) === JSON.stringify(main.opened),
    "2 intact leaves open by plaintext; the junk-body and junk-V/W leaves are {error:\"undecryptable\"}, nothing else");
  check("case-e-honest-byte-identical", produced.slice(0, 2).map((o: any) => o.plaintext_hex).join(",") === baseline.join(","),
    `the honest openings are byte-identical to the base commit's (sha ${createHash("sha256").update(baseline.join(",")).digest("hex").slice(0, 16)}…)`);
  const greenVerify = runVerify("green", GREEN_BENZO, main, produced);
  check("green-verify-agrees", greenVerify.code === 0,
    greenVerify.code === 0 ? (greenVerify.out.trim().split("\n").at(-1) ?? "exit 0") : `exit ${greenVerify.code}: ${(greenVerify.out + greenVerify.err).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ")}`);
  const greenDerive = runDerivable("green-main", GREEN_BENZO, main);
  const rows: { party: string }[] = greenDerive.parsed?.rows ?? [];
  check("green-derive-rows-completes", greenDerive.code === 0 && rows.length > 0,
    `exit ${greenDerive.code}, ${rows.length} derivable rows (its internal benzo verify gate passed, so the host's re-derivation agrees)`);
  check("green-derive-rows-skip-griefs", !rows.some(r => ["leaf:2", "leaf:3"].includes(r.party)),
    `rows ${JSON.stringify(rows.map(r => r.party))} carry nothing for the two undecryptable leaves`);
  console.log(`OBSERVE green-derive-rows ${JSON.stringify(rows)}`);

  console.log("=== green plan/deriveRows on the strays: both fixtures complete, strays are claim-only");
  const baseNotes = straysFixture.notes.slice(0, 2);
  const strayParties = [depositParty(strayNotes.wrongRound), depositParty(strayNotes.junkBody)];
  for (const kind of ["cleared", "cancelled"] as const) {
    const p = runPlan(`green-${kind}-both`, GREEN_PLAN, straysFixture, kind, straysFixture.notes, ROOT);
    const exceptions: { party: string; reason?: string }[] = p.parsed?.exceptions ?? [];
    check(`green-plan-${kind}-completes`, p.code === 0 && !!p.parsed, `the plan completed (exit ${p.code})`);
    for (const party of strayParties) {
      const row = exceptions.find(e => e.party === party);
      check(`green-plan-${kind}-stray-claim-only-${party.slice(8, 20)}`, !!row && row.reason === "deposit memo is not an openable sealed bid; no owner key claims it",
        `the stray derives no owner key and is claim-only: ${JSON.stringify(row ?? null)}`);
    }
    console.log(`OBSERVE plan-${kind}-exceptions ${JSON.stringify(exceptions.map(e => ({ party: e.party.slice(0, 34), reason: e.reason ?? null })))}`);
    const d = runDerivable(`green-${kind}-both`, GREEN_BENZO, straysFixture, { notes: straysFixture.notes, cancelled: kind === "cancelled" });
    const drows: { party: string }[] = d.parsed?.rows ?? [];
    check(`green-derive-${kind}-completes`, d.code === 0, `deriveRows completed (exit ${d.code})`);
    check(`green-derive-${kind}-no-stray-rows`, !drows.some(r => strayParties.includes(r.party)),
      `rows ${JSON.stringify(drows.map(r => r.party.slice(0, 28)))} carry nothing for the two griefing strays`);
    const cache = JSON.parse(readFileSync(path.join(d.state, "auctions", straysFixture.id, "memo-openings.json"), "utf8"));
    check(`green-derive-${kind}-owner-key-null-cached`, strayParties.every(party => {
      const n = party === strayParties[0] ? strayNotes.wrongRound : strayNotes.junkBody;
      const ctHex = party === strayParties[0] ? wrongRoundHex : junkBodyHex;
      return cache.openings[createHash("sha256").update(Buffer.from(ctHex, "hex")).digest("hex")] === null && !!n;
    }), `the memo-openings cache records both stray memo openings as null (owner key = claim-only)`);
  }

  console.log("=== green claim-refund: the claims are refused cleanly (a normal ERROR line, never a throw)");
  for (const [tag, note] of [["wrong-round", strayNotes.wrongRound], ["junk-body", strayNotes.junkBody]] as [string, any][]) {
    const c = runClaim(`green-${tag}`, GREEN_BENZO, straysFixture, straysFixture.notes, note);
    check(`green-claim-${tag}-refused-cleanly`, c.code !== 0 && /^ERROR benzo refused: claim owner signature$/m.test(c.err) && !/G2 point|beacon round/.test(c.err),
      `refused as the claim's own fault (exit ${c.code}): ${c.err.trim().split("\n").at(-1)?.slice(0, 140)}`);
  }
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
