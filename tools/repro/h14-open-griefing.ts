// H14 (docs/design/phase7-h13-h14.md): one griefing bidder can no longer stop the open. The probe the head
// measured (tmp/h14-probe.ts, gone with the b39 worktree) is re-created here on REAL tlock ciphertexts of
// 128-byte bids sealed to the past quicknet round 32704232 (the tools/bench.ts machinery):
//   (a) the stanza body's first line replaced with "!!!!"  — passes the pre-H14 admission header rule, and the
//       base commit's open THROWS ("Expected mac, but there were no more lines left!") for EVERY bidder;
//   (b) the payload cut to 3 bytes                        — passes the pre-H14 admission header rule, and the
//       base commit's open returns an EMPTY plaintext where Go tle said MAC failure.
//
//   before (base commit bundles under tmp/b43/base/): both ciphertexts are ADMITTED (the memoTlockCiphertext
//       header rule AND the real `bid deposit` admit command, on a future-round fixture so the admission time
//       gates pass), the base `open` throws on the first and stops every other opening, the base `open` on a
//       lone payload-cut leaf returns the empty plaintext, and host deriveRows stops on the malformed leaf.
//   after (this tree): `bid seal`'s self-check and `bid deposit` admit both refuse both griefs with
//       `sealed bid structure: <reason>`; a frozen fixture built directly with those leaves (bypassing
//       admission, as h-fixtures.ts does) opens with them {error:"undecryptable"}, `benzo verify` agrees,
//       host deriveRows agrees, and the honest leaves open byte-identically to the base commit's.
//
// Build+run:
//   npx esbuild tools/repro/h14-open-griefing.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/h14.mjs
//   (base bundles, built ONCE from the pristine base commit before any B43 edit:
//     npx esbuild clear/auction-cli.ts --bundle --packages=external --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/b43/base/auction.mjs
//     npx esbuild cli/host-derive.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b43/base/host-derive.mjs
//     npx esbuild cli/commands/verify.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b43/base/verify.mjs
//     npx esbuild settle/envelopes.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b43/base/envelopes.mjs
//     npx esbuild cli/published-beacon.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b43/base/published-beacon.mjs
//     cp -R cli/dist tmp/b43/base/cli-dist   — the base `benzo` CLI, so deriveRows' verify subprocess runs base code)
//   (green bundles from this tree: npm run build:core && npm run build:cli)
//   node tmp/h14.mjs before && node tmp/h14.mjs after
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import { jsonBytes, QUICKNET, signRecord, type Manifest } from "../../manifest/schema";
import { sealedBidShape } from "../../envelope/opening";
import { buildAuction, fetchBeacon, needRealPczt, pem, UA_ORCHARD, writeAuctionLedger, writeHostState, writePublicDir, type Fixture } from "./h-fixtures";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const part = process.argv[2];
if (part !== "before" && part !== "after") { console.error("usage: node tmp/h14.mjs before|after"); process.exit(2); }
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${commit}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tmp/h14.mjs ${part} (tools/repro/h14-open-griefing.ts)`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);
for (const line of (existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const WORK = path.join(ROOT, "tmp", "h14");
mkdirSync(WORK, { recursive: true });
const REAL_PCZT = needRealPczt(ROOT);
process.env.BNZ_PCZT_BIN = REAL_PCZT;
const BASE = path.join(ROOT, "tmp", "b43", "base");
const BASE_AUCTION = path.join(BASE, "auction.mjs"), BASE_ENVELOPES = path.join(BASE, "envelopes.mjs"), BASE_PB = path.join(BASE, "published-beacon.mjs");
const BASE_BENZO = path.join(BASE, "cli-dist", "benzo.mjs");
const GREEN_AUCTION = path.join(ROOT, "clear", "dist", "auction.mjs"), GREEN_BENZO = path.join(ROOT, "cli", "dist", "benzo.mjs");
for (const f of [BASE_AUCTION, BASE_ENVELOPES, BASE_PB, BASE_BENZO]) if (part === "before" && !existsSync(f)) throw new Error(`${f} missing — build the base bundles first (see the header)`);
for (const f of [GREEN_AUCTION, GREEN_BENZO]) if (part === "after" && !existsSync(f)) throw new Error(`${f} missing — run npm run build:core && npm run build:cli first`);

let failed = 0;
const pass = (id: string, detail = "") => console.log(`PASS ${id}${detail ? " " + detail : ""}`);
const fail = (id: string, detail: string) => { failed++; console.log(`FAIL ${id} ${detail}`); };
const check = (id: string, ok: boolean, detail: string) => ok ? pass(id, detail) : fail(id, detail);
const save = (name: string, value: unknown) => writeFileSync(path.join(WORK, name), jsonBytes(value));
const load = (name: string) => JSON.parse(readFileSync(path.join(WORK, name), "utf8"));

// ---- the two H14 griefing mutations (the head's probe, exactly) -------------------------------------------
const griefStanzaBody = (ct: Buffer): Buffer => {
  const text = ct.toString("latin1"), stanzaAt = text.indexOf("\n-> tlock "), lineStart = text.indexOf("\n", stanzaAt + 1) + 1, lineEnd = text.indexOf("\n", lineStart);
  return Buffer.from(text.slice(0, lineStart) + "!!!!" + text.slice(lineEnd), "binary");
};
const griefPayloadCut = (ct: Buffer): Buffer => {
  const text = ct.toString("latin1"), macAt = text.indexOf("--- "), payloadStart = text.indexOf("\n", macAt) + 1;
  return Buffer.from(text.slice(0, payloadStart + 3), "binary");
};

// The honest layout of a real 128-byte bid, measured here and stated in the output (the design's "check the
// exact body length on a real ciphertext and state it"): version line, one tlock stanza line, 3 base64 body
// lines (64 + 64 + 43 characters = the 128-byte stanza body), "--- <mac>" with a 32-byte MAC, 160-byte payload.
const layoutFacts = (ct: Buffer) => {
  const text = ct.toString("latin1"), lines = text.split("\n");
  const stanzaAt = lines.findIndex(l => l.startsWith("-> tlock "));
  const bodyLines = [lines[stanzaAt + 1], lines[stanzaAt + 2], lines[stanzaAt + 3]];
  const macLine = lines[stanzaAt + 4];
  const payload = text.slice(text.indexOf("\n", text.indexOf("--- ")) + 1);
  return {
    version: lines[0],
    stanza: lines[stanzaAt],
    body_line_lengths: bodyLines.map(l => l.length),
    body_bytes: Buffer.from(bodyLines.join(""), "base64").length,
    mac_bytes: Buffer.from(macLine.slice(4), "base64").length,
    payload_bytes: payload.length,
    total_bytes: ct.length,
  };
};

// ---- the future-round admission fixture (the admission time gates refuse a past round by design) ----------
const pinnedInfo = { public_key: QUICKNET.public_key, period: QUICKNET.period, genesis_time: QUICKNET.genesis, hash: QUICKNET.chain_hash, groupHash: "", schemeID: QUICKNET.scheme, metadata: { beaconID: "quicknet" } };
const pinnedClient = { chain: () => ({ info: async () => pinnedInfo }) } as unknown as Parameters<typeof timelockEncrypt>[2];
const memoV1 = (ct: Buffer): string => {
  if (ct.length > 505) throw new Error("ciphertext memo cap");
  const memo = Buffer.alloc(512); Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
  return memo.toString("hex");
};
const admissionR = 1 + Math.ceil((Math.floor(Date.now() / 1000) + 30 * 86400 - QUICKNET.genesis) / QUICKNET.period);
const admissionFixture = async () => {
  const signer = createPublicKey(pem("manifest")).export({ type: "spki", format: "der" }).toString("hex");
  const auction_id = createHash("sha256").update("benzo-h14-admission").digest("hex");
  const release = QUICKNET.genesis + (admissionR - 1) * QUICKNET.period;
  const address = "utest1" + createHash("sha256").update("benzo-h14-deposit").digest("hex");
  const manifest: Manifest = {
    version: 1, network: "test", auction_id, escrow_ua: address, frost_group_key: createHash("sha256").update("benzo-h14-group").digest("hex"), lot: "h14 admission",
    supply: 3, reserve_zats: "1000", tick_zats: "1000", B_max_zats: "100000", q_max: 10, C_zats: "1000100", fee_zats: "100",
    deposit_addresses: [address], drand: { ...QUICKNET, R: admissionR }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  } as Manifest;
  const manifestPacket = signRecord(manifest, pem("manifest"));
  const honest = Buffer.from(decodeArmor(await timelockEncrypt(admissionR, Buffer.alloc(128, 1), pinnedClient)), "binary");
  const cases: { name: string; ct: Buffer }[] = [
    { name: "honest", ct: honest },
    { name: "stanza-body", ct: griefStanzaBody(honest) },
    { name: "payload-cut", ct: griefPayloadCut(honest) },
  ];
  return { signer, auction_id, manifestPacket, address, cases: cases.map((c, i) => ({
    ...c,
    memo: memoV1(c.ct),
    txid: createHash("sha256").update("benzo-h14-admission-txid:" + i).digest("hex"),
    note: { txid: createHash("sha256").update("benzo-h14-admission-txid:" + i).digest("hex"), height: 99000, pool: "ironwood", address,
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
const runAdmit = (bundle: string, state: string, id: string, memo: string, txid: string, address: string) => {
  const r = spawnSync(process.execPath, [bundle, "admit", id], {
    input: JSON.stringify({ envelope_hex: memo, txid, address }), encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"), BNZ_LWD_URL: "127.0.0.1:9" },
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const runAdmitCase = (bundle: string, fx: Awaited<ReturnType<typeof admissionFixture>>, c: { name: string; memo: string; txid: string; note: any }) => {
  const state = path.join(WORK, `admit-${path.basename(path.dirname(bundle))}-${c.name}`);
  writeAdmissionState(state, fx, [c.note]);
  return runAdmit(bundle, state, fx.auction_id, c.memo, c.txid, fx.address);
};

// ---- the open and deriveRows harnesses (h-fixtures stub state; every product decision is real code) -------
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
const runDerivable = (label: string, benzo: string, fixture: Fixture) => {
  const state = path.join(WORK, "state-derive-" + label);
  rmSync(state, { recursive: true, force: true });
  writeHostState(state, fixture, REAL_PCZT);
  const packet = path.join(WORK, "packet-derive-" + label);
  rmSync(packet, { recursive: true, force: true }); mkdirSync(path.join(packet, "public"), { recursive: true, mode: 0o700 });
  writePublicDir(path.join(packet, "public"), fixture);
  writeFileSync(path.join(packet, "packet.json"), jsonBytes({ auction_id: fixture.id, signer: fixture.signer, seller_ua: UA_ORCHARD }));
  const r = spawnSync(process.execPath, [benzo, "sign", "derivable", "--id", fixture.id, "--packet", packet, "--name", "alice"], {
    input: "", encoding: "utf8", maxBuffer: 64 << 20,
    env: { ...process.env, BNZ_STATE_DIR: state, BNZ_PCZT_BIN: path.join(state, "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(state, "bin", "benzo-scan"),
      BNZ_LWD_URL: "127.0.0.1:9", BNZ_DRAND_URLS: "http://127.0.0.1:9/" },
  });
  let parsed: any = null; try { parsed = JSON.parse(r.stdout); } catch {}
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "", parsed };
};

if (part === "before") {
  console.log("=== fixtures: real tlock to quicknet round 32704232 (2 intact leaves + the two H14 griefs)");
  const beacon = await fetchBeacon(32704232);
  const main = await buildAuction({ beacon, count: 4, tamper: [{ index: 2, kind: "stanza-body" }, { index: 3, kind: "payload-cut" }] });
  const quirk = await buildAuction({ beacon, count: 1, tamper: [{ index: 0, kind: "payload-cut" }] });
  save("fixtures.json", { main, quirk });
  const facts = layoutFacts(Buffer.from(main.leaves[0].ciphertext_hex, "hex"));
  console.log(`OBSERVE honest-layout ${JSON.stringify(facts)}`);
  check("honest-layout-exact", facts.version === "age-encryption.org/v1" && facts.body_bytes === 128 && facts.body_line_lengths.join(",") === "64,64,43"
    && facts.mac_bytes === 32 && facts.payload_bytes === 160 && facts.total_bytes === 487,
    `one 128-byte stanza body (3 base64 lines of ${facts.body_line_lengths.join("/")} chars), 32-byte mac, ${facts.payload_bytes}-byte payload (16 + 128 + 16), ${facts.total_bytes}-byte ciphertext`);

  console.log("=== the H14 probe on the base commit's decryptPublished (re-created)");
  const basePb = await import(pathToFileURL(BASE_PB).href);
  const local = basePb.publishedClient({ round: beacon.round, signature: beacon.signature });
  const probe = async (name: string, hex: string) => {
    try { const pt = await basePb.decryptPublished(hex, local); return { name, threw: null, plaintext: pt }; }
    catch (e) { return { name, threw: (e as Error).message, plaintext: null }; }
  };
  const probeA = await probe("stanza-body", main.leaves[2].ciphertext_hex);
  check("red-probe-stanza-body-throws", probeA.threw === "Expected mac, but there were no more lines left!",
    `base decryptPublished threw ${JSON.stringify(probeA.threw)} (it stops the open for every bidder)`);
  const probeB = await probe("payload-cut", main.leaves[3].ciphertext_hex);
  check("red-probe-payload-cut-empty", probeB.threw === null && probeB.plaintext === "",
    `base decryptPublished returned ${JSON.stringify(probeB.plaintext)} (the empty-plaintext quirk; Go tle said MAC failure)`);

  console.log("=== red admission: the base header rule and the real admit command accept both griefs");
  const fx = await admissionFixture();
  save("admission.json", { R: admissionR, signer: fx.signer, auction_id: fx.auction_id, manifestPacket: fx.manifestPacket, address: fx.address,
    cases: fx.cases.map(c => ({ name: c.name, ct: c.ct.toString("hex"), memo: c.memo, txid: c.txid, note: c.note })) });
  const baseEnvelopes = await import(pathToFileURL(BASE_ENVELOPES).href);
  for (const c of fx.cases) {
    const rule = baseEnvelopes.memoTlockCiphertext(c.memo, admissionR);
    check(`red-rule-admits-${c.name}`, !!rule && rule.ct === c.ct.toString("hex"),
      `base memoTlockCiphertext accepted the ${c.name} memo (the admission header rule)`);
  }
  for (const c of fx.cases) {
    const r = runAdmitCase(BASE_AUCTION, fx, c);
    check(`red-admit-accepts-${c.name}`, r.code === 0,
      r.code === 0 ? `the base admit command admitted the ${c.name} bid` : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
  }

  console.log("=== red open: the base open throws on the first grief and stops every other opening");
  const red = runOpen("red", BASE_AUCTION, main);
  check("red-open-throws", red.code !== 0 && /Expected mac, but there were no more lines left!/.test(red.err) && !red.parsed,
    `the base open died on the malformed stanza body (exit ${red.code}): ${(red.err || red.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
  const redQuirk = runOpen("red-quirk", BASE_AUCTION, quirk);
  check("red-open-empty-plaintext", redQuirk.code === 0 && redQuirk.parsed?.opened?.[0]?.plaintext_hex === "",
    `the base open accepted the payload-cut leaf with plaintext_hex ${JSON.stringify(redQuirk.parsed?.opened?.[0]?.plaintext_hex)} (an invalid bid labelled as opened)`);

  console.log("=== red deriveRows: host derivation stops on the malformed leaf");
  const redDerive = runDerivable("red", BASE_BENZO, main);
  check("red-derive-rows-stops", redDerive.code !== 0,
    `the base sign derivable died (exit ${redDerive.code}): ${(redDerive.err || redDerive.out).trim().split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ").slice(0, 180) || "(no ERROR line)"}`);

  console.log("=== baseline: the base commit's openings for the honest leaves (byte-identity reference)");
  const baseline: string[] = [];
  for (const i of [0, 1]) baseline.push(await basePb.decryptPublished(main.leaves[i].ciphertext_hex, local));
  save("opened-honest-baseline.json", baseline);
  console.log(`OBSERVE baseline-honest ${baseline.map(b => b.length / 2 + "B").join(",")} (saved to tmp/h14/opened-honest-baseline.json)`);
} else {
  const { main, quirk } = load("fixtures.json") as { main: Fixture; quirk: Fixture };
  const baseline: string[] = load("opened-honest-baseline.json");
  const { R, signer, auction_id, manifestPacket, address, cases } = load("admission.json");
  const fx = { signer, auction_id, manifestPacket, address, cases: cases.map((c: any) => ({ ...c, ct: Buffer.from(c.ct, "hex") })) };

  console.log("=== green admission: `bid seal`'s self-check and the real admit command refuse both griefs");
  for (const c of fx.cases) {
    const shape = sealedBidShape(c.ct.toString("hex"), R);
    const message = shape.ok ? "" : `sealed bid structure: ${(shape as any).reason}`;
    if (c.name === "honest") check("green-bid-seal-self-check-accepts-honest", shape.ok, "the self-check expression passes the honest sealer output");
    else check(`green-bid-seal-self-check-refuses-${c.name}`, !shape.ok && /^sealed bid structure: /.test(message),
      `the self-check refuses it: ${message.slice(0, 120)}`);
  }
  for (const c of fx.cases) {
    const r = runAdmitCase(GREEN_AUCTION, fx, c);
    if (c.name === "honest") check("green-admit-accepts-honest", r.code === 0,
      r.code === 0 ? "the admit command still admits an honest bid" : `exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
    else check(`green-admit-refuses-${c.name}`, r.code !== 0 && /sealed bid structure: /.test(r.err),
      `refused at admission: ${(r.err || r.out).trim().split("\n").at(-1)?.slice(0, 140)}`);
  }

  console.log("=== green open: both griefs open as undecryptable; the honest leaves are byte-identical");
  const green = runOpen("green", GREEN_AUCTION, main);
  const produced = green.parsed?.opened ?? [];
  check("green-open-succeeds", green.code === 0 && produced.length === main.leaves.length,
    `the open completed with ${produced.length} openings (exit ${green.code})`);
  check("green-open-classification-exact", JSON.stringify(produced) === JSON.stringify(main.opened),
    "2 intact leaves open by plaintext; the stanza-body and payload-cut leaves are {error:\"undecryptable\"}, nothing else");
  check("honest-leaves-byte-identical", produced.slice(0, 2).map((o: any) => o.plaintext_hex).join(",") === baseline.join(","),
    `the honest openings are byte-identical to the base commit's (sha ${createHash("sha256").update(baseline.join(",")).digest("hex").slice(0, 16)}…)`);
  const trace: any[] = green.parsed?.trace ?? [];
  check("green-open-no-tle", trace.filter((t: any) => t.operation === "tle -d").length === 0,
    `trace: ${[...new Set(trace.map((t: any) => t.operation))].join(", ")} (no tle subprocess)`);

  console.log("=== green open on the lone payload-cut leaf: the empty-plaintext quirk is closed");
  const greenQuirk = runOpen("green-quirk", GREEN_AUCTION, quirk);
  check("green-open-quirk-undecryptable", greenQuirk.code === 0 && greenQuirk.parsed?.opened?.[0]?.plaintext_hex === null && greenQuirk.parsed?.opened?.[0]?.error === "undecryptable",
    `the payload-cut leaf is now ${JSON.stringify(greenQuirk.parsed?.opened?.[0] ?? null)}`);

  console.log("=== green verify: benzo verify agrees with the openings (griefs re-derive as undecryptable)");
  const dir = path.join(WORK, "verify-doc");
  rmSync(dir, { recursive: true, force: true });
  writePublicDir(dir, { ...main, opened: produced });
  const v = spawnSync(process.execPath, [GREEN_BENZO, "verify", "--dir", dir, "--signer", main.signer], { encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: path.join(WORK, "state-verify") } });
  check("green-verify-agrees", v.status === 0,
    v.status === 0 ? (v.stdout.trim().split("\n").at(-1) ?? "exit 0") : `exit ${v.status}: ${(v.stdout + v.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | ")}`);

  console.log("=== green deriveRows: host derivation completes and agrees (its verify subprocess re-derives every opening)");
  const derive = runDerivable("green", GREEN_BENZO, main);
  const rows: { party: string; amount_zats: string }[] = derive.parsed?.rows ?? [];
  const griefedParties = new Set(["leaf:2", "leaf:3"]);
  check("green-derive-rows-completes", derive.code === 0 && rows.length > 0,
    `exit ${derive.code}, ${rows.length} derivable rows (the internal benzo verify gate passed, so the host's re-derivation agrees with the published openings)`);
  check("green-derive-rows-skip-griefs", !rows.some(r => griefedParties.has(r.party)),
    `rows ${JSON.stringify(rows.map(r => r.party))} carry nothing for the two undecryptable leaves`);
  console.log(`OBSERVE green-derive-rows ${JSON.stringify(rows)}`);
}

console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
