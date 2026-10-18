// Batch B40 proof (offline): the operator guide's step 1, followed with the shipped CLI alone on a clean
// scratch state — witness set -> auction addresses -> drand round -> fill the template -> auction create ->
// auction sign -> auction publish — then the manifest checks `benzo verify` applies pass on the published
// directory. It also shows the `witness set` record and `witness_set_hash` are byte-equal to what the
// harness's own code produces for the same inputs (tools/repro/markets.ts signs the same object with the
// same signRecord and the operator's manifest-signing key).
//
// Fixture material (documented in tools/repro/fixtures/b40-vault/README.md): the view-only vault wallet
// `auction keys` would create (generated offline), plus tools/bench.ts's deterministic fixture key recipe
// (seed "benzo-phase6-offline-v1") for the manifest key and the witness keys. This driver never reads the
// real $BNZ_STATE_DIR, .env, any wallet, or the network.
// Build+run: npx esbuild tools/repro/b40-operator-cli.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b40-operator-cli.mjs && node tmp/b40-operator-cli.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertScratch } from "./scratch";
import { QUICKNET, hash, signRecord, verifyRecord } from "../../manifest/schema";
import { validateWitnessSet, witnessSetHash, type WitnessSet } from "../../witness";
import { generateEnvelopeKey } from "../../envelope";
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
import { markPublic } from "../../e2e/lib/redact";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tmp/b40-operator-cli.mjs (tools/repro/b40-operator-cli.ts)");
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

const OUT = assertScratch(path.join(ROOT, "tmp/b40"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const STATE = path.join(OUT, "state");
const PUBLIC = path.join(OUT, "public");
mkdirSync(path.join(STATE, "run"), { recursive: true, mode: 0o700 });

let ok = true;
const check = (id: string, pass: boolean, d = "") => {
  console.log(`${pass ? "PASS" : "ERROR"} ${id}${d ? " " + d : ""}`);
  ok &&= pass;
};

// Builds the proof runs the CLI from. build:cli + build:core are cheap and re-run here; build:settle
// includes a cargo build and is only checked (the working tree is expected to carry it, like every live run).
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
execFileSync("npm", ["run", "--silent", "build:core"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
const BENZO = path.join(ROOT, "cli/dist/benzo.mjs");
for (const file of [path.join(ROOT, "settle/dist/cli.mjs"), path.join(ROOT, "settle/target/release/benzo-pczt")]) {
  if (!existsSync(file)) {
    console.log(`ERROR missing ${path.relative(ROOT, file)}; run \`npm run build:settle\` first`);
    process.exit(1);
  }
}

// ---- fixture material -------------------------------------------------------
// tools/bench.ts's deterministic fixture recipe: keys derived from SHA-256 of a seed and a tag.
const bytes = (tag: string) => Buffer.from(hash("benzo-phase6-offline-v1" + ":" + tag), "hex");
const edKey = (seed: Buffer) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), type: "pkcs8", format: "der" });
const manifestPem = edKey(bytes("manifest")).export({ type: "pkcs8", format: "pem" }).toString();
const rawPublic = (tag: string) => createPublicKey(edKey(bytes(tag))).export({ type: "spki", format: "der" }).toString("hex").slice(24);
const fixture = JSON.parse(readFileSync(path.join(ROOT, "tools/repro/fixtures/b40-vault/fixture.json"), "utf8"));
const auctionId = bytes("b40-auction-id").toString("hex");

// The fixture vault is exactly what `benzo auction keys` writes (the e2e vault shape), under the scratch state.
const vaultDir = path.join(STATE, "vaults", auctionId);
mkdirSync(path.join(vaultDir, "wallet"), { recursive: true, mode: 0o700 });
cpSync(path.join(ROOT, "tools/repro/fixtures/b40-vault/data.sqlite"), path.join(vaultDir, "wallet", "data.sqlite"));
// The fixture group key is bench's `bytes("group")` (the offline-auction fixture key). The fixture vault
// is scaffold only and its ak is not this key (Questions in STATUS-B): no rule in this CLI path checks it.
const groupKey = bytes("group").toString("hex");
writeFileSync(path.join(vaultDir, "keys.json"), JSON.stringify({ auction_id: auctionId, group_key: groupKey, escrow_ua: fixture.escrow_ua, birthday: 300000, created_at: 0 }) + "\n", { mode: 0o600 });
// The operator's manifest-signing key (the same key `auction sign` signs with) is the fixture key.
mkdirSync(path.join(STATE, "auction"), { recursive: true, mode: 0o700 });
writeFileSync(path.join(STATE, "auction", "manifest-signing.pem"), manifestPem, { mode: 0o600 });
// R78b: public deposit/escrow addresses (class C) are registered with the harness-side evidence redactor
// exactly as e2e/lib/zcash.ts generateAddress("vault") registers them, before anything prints them.
markPublic(fixture.escrow_ua);
console.log(`fixture vault ${path.relative(ROOT, vaultDir)} (from tools/repro/fixtures/b40-vault)`);
console.log(`fixture escrow ${fixture.escrow_ua}`);

// ---- the CLI, driven exactly as a stranger drives bin/benzo ------------------
const env = { ...process.env, BNZ_ROOT: ROOT, BNZ_STATE_DIR: STATE, BNZ_NETWORK: "test" };
const raw = (args: string[], input?: string) => spawnSync(process.execPath, [BENZO, ...args], { input, encoding: "utf8", maxBuffer: 64 << 20, env });
const lastJson = (out: string) => JSON.parse(out.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!);
function benzo(args: string[], input?: string): any {
  const r = raw(args, input);
  if (r.status !== 0) throw new Error(`benzo ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  console.log(`$ benzo ${args.join(" ")}`);
  return lastJson(r.stdout);
}
const benzoExpectRefusal = (args: string[], pattern: RegExp, id: string) => {
  const r = raw(args);
  const line = (r.stderr || r.stdout).trim().split("\n").filter(l => l.startsWith("ERROR")).join(" | ");
  check(id, r.status !== 0 && pattern.test(line), line.slice(0, 160));
};

// ---- 1. witness set (plus the guards the design requires) -------------------
const witnessKeys = [0, 1, 2].map(i => rawPublic(`witness:${i}`));
benzoExpectRefusal(["witness", "set", "--id", auctionId, "--q", "4", "--keys", witnessKeys.join(",")], /witness quorum/, "witness-set-q-refused");
benzoExpectRefusal(["witness", "set", "--id", auctionId, "--q", "2", "--keys", [witnessKeys[0], witnessKeys[0], witnessKeys[2]].join(",")], /duplicate witness key/, "witness-set-duplicate-refused");
benzoExpectRefusal(["witness", "set", "--id", auctionId, "--q", "2", "--keys", [witnessKeys[0], "zz", witnessKeys[2]].join(",")], /witness key(?! count|s)/, "witness-set-malformed-refused");
const ws = benzo(["witness", "set", "--id", auctionId, "--q", "2", "--keys", witnessKeys.join(",")]);
const record = JSON.parse(readFileSync(ws.file, "utf8"));
// The harness's own code path for the same inputs (tools/repro/markets.ts run()): signRecord over
// {version: 1, auction_id, q_w, keys} with the operator's manifest-signing key.
const harness = signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: witnessKeys }, manifestPem);
check("witness-set-record-equal", record.bytes === harness.bytes && record.sha256 === harness.sha256 && record.signer === harness.signer && record.signature === harness.signature,
  record.sha256 === harness.sha256 ? `record sha256 ${record.sha256}` : `CLI ${record.sha256} vs harness ${harness.sha256}`);
check("witness-set-hash-equal", ws.witness_set_hash === witnessSetHash(harness), `witness_set_hash ${ws.witness_set_hash}`);
let roundTrip = "";
try {
  validateWitnessSet(verifyRecord<WitnessSet>(record, record.signer), auctionId);
} catch (e) {
  roundTrip = String((e as Error).message);
}
check("witness-set-validated", roundTrip === "", roundTrip || "record round-trips through verifyRecord + validateWitnessSet");
console.log(`witness set file ${path.relative(ROOT, ws.file)}`);

// ---- 2. auction addresses (the manifest's deposit and fee-reserve addresses) -----
const out = benzo(["auction", "addresses", "--id", auctionId, "--count", "4"]);
const addresses: string[] = out.addresses;
for (const a of addresses) markPublic(a);
check("auction-addresses-shape", out.auction_id === auctionId && addresses.length === 4 && addresses.every(a => /^utest1[a-z0-9]+$/.test(a)), `${addresses.length} addresses`);
check("auction-addresses-fresh", new Set(addresses).size === 4 && !addresses.includes(fixture.escrow_ua), "4 distinct, none is the escrow UA");
console.log(`auction addresses ${addresses.join(" ")}`);

// ---- 3. drand round --------------------------------------------------------
const now = Math.ceil(Date.now() / 1000);
const releaseAt = now + 33 * 60;
const releaseIso = new Date(releaseAt * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const dr = benzo(["drand", "round", "--at", releaseIso]);
check("drand-round-formula", dr.round === 1 + Math.ceil((releaseAt - QUICKNET.genesis) / QUICKNET.period), `round ${dr.round} for ${releaseIso}`);
check("drand-round-release", dr.release_utc === new Date((QUICKNET.genesis + (dr.round - 1) * QUICKNET.period) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") && dr.release_utc >= releaseIso, `release_utc ${dr.release_utc}`);
benzoExpectRefusal(["drand", "round", "--at", "2026-13-99T25:61:00Z"], /ISO-8601/, "drand-round-bad-time-refused");

// ---- 4. fill the template, using only CLI output ---------------------------
const envelopeKeys = [generateEnvelopeKey(), generateEnvelopeKey(), generateEnvelopeKey()].map(k => k.public_hex);
const manifest = JSON.parse(readFileSync(path.join(ROOT, "docs/examples/unsigned-manifest.json"), "utf8"));
manifest.auction_id = auctionId;
manifest.escrow_ua = fixture.escrow_ua;
manifest.frost_group_key = groupKey;
manifest.lot = "b40 fixture round";
manifest.supply = 1;
manifest.reserve_zats = "10";
manifest.tick_zats = "10";
manifest.B_max_zats = "3000";
manifest.q_max = 1;
manifest.C_zats = "200000";
manifest.fee_zats = "0";
manifest.deposit_addresses = [fixture.escrow_ua, addresses[0], addresses[1]];
manifest.envelope_keys = envelopeKeys;
manifest.witness_set_hash = ws.witness_set_hash;
manifest.drand.R = dr.round;
manifest.T_submit = now + 4 * 60;
manifest.T_freeze = now + 30 * 60;
const filled = path.join(OUT, "unsigned-manifest.json");
writeFileSync(filled, JSON.stringify(manifest, null, 2) + "\n");
check("template-filled", !JSON.stringify(manifest).includes("<"), "no placeholder left in the filled manifest");

// ---- 5. auction create -> sign -> publish ----------------------------------
const created = benzo(["auction", "create", "--file", filled, "--witness-set", ws.file]);
check("auction-create", created.auction_id === auctionId && created.state === "DRAFT", `state ${created.state}`);
const signed = benzo(["auction", "sign", "--id", auctionId]);
const manifestSigner = createPublicKey(manifestPem).export({ type: "spki", format: "der" }).toString("hex");
const roundTripPacket: any = verifyRecord(signed, signed.signer);
check("auction-sign", signed.signer === manifestSigner && roundTripPacket.auction_id === auctionId, `signer ${signed.signer.slice(0, 16)}…`);
const config = JSON.parse(readFileSync(path.join(ROOT, "docs/examples/private-operator.json"), "utf8"));
config.routing.bidders = manifest.deposit_addresses.map((deposit_ua: string) => ({ deposit_ua }));
// Offline stand-in only: a live seller_ua is the seller's own wallet address, never a vault address
// (docs/guide-operator.md step 1.2). Publish accepts any unified address on the network.
config.routing.seller_ua = addresses[3];
config.routing.fee_reserve_ua = addresses[2];
// `auction publish` refuses a config outside BNZ_STATE_DIR (private routing), so the filled config
// lives under the scratch state exactly as the harness keeps its operator.json in state/run/.
const configFilled = path.join(STATE, "run", "private-operator.json");
writeFileSync(configFilled, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
const doc = benzo(["auction", "publish", "--id", auctionId, "--dir", PUBLIC, "--config", configFilled]);
check("auction-publish", doc.auction_id === auctionId && doc.state === "OPEN" && witnessSetHash(doc.witness_set) === manifest.witness_set_hash, `state ${doc.state}`);

// ---- 6. the manifest checks `benzo verify` applies --------------------------
// loadPublicAuction runs the verifyRecord + validateManifest client over the published manifest and the
// canonical-document shape; checkPublicAuction is verify's own checker. On a freshly published (OPEN)
// directory the full `benzo verify` then stops at its documented pre-freeze lifecycle gate — "missing
// frozen" (R21 item 5: verify keeps requiring frozen and result) — and at nothing else.
const pub = loadPublicAuction(PUBLIC, { signer: signed.signer });
const checks = checkPublicAuction(pub);
const errors = checks.filter(c => c.error);
check("verify-level-manifest-checks", errors.length === 0 && pub.manifest_hash === signed.sha256 && pub.manifest.witness_set_hash === manifest.witness_set_hash,
  `${checks.length} checks, ${errors.length} errors; manifest_hash ${pub.manifest_hash}`);
for (const c of errors) console.log(`ERROR check ${c.id} ${c.error}`);
const verifyRun = raw(["verify", "--dir", PUBLIC, "--signer", signed.signer]);
const verifyErrors = (verifyRun.stderr || "").split("\n").filter(l => l.startsWith("ERROR"));
check("verify-lifecycle-gate-only", verifyRun.status === 1 && verifyErrors.length === 1 && verifyErrors[0] === "ERROR verify refused: missing frozen",
  verifyErrors.join(" | ") || `exit ${verifyRun.status} with no ERROR line`);

console.log(ok ? "RESULT PASS b40-operator-cli: the guide's step 1 holds with the CLI alone" : "RESULT FAIL b40-operator-cli");
process.exitCode = ok ? 0 : 1;
