// R23 item 3 repro (reviewer G4, head-triaged): the read API returns the verify ERROR, never a 500,
// for a document with deposit claims and no published beacon.
//
//   r23-3-api-claims-no-beacon: the fixture — a fresh signed manifest on a REFUNDING auction (the
//      cancel path where stray claims appear) with one stray deposit claim carrying a REAL tlock-
//      sealed memo, and NO published beacon — gets `valid:false` and the claims check's fail-closed
//      ERROR `refused: claim 0 memo opening` (the exact error `benzo verify` prints as
//      `ERROR claims refused: claim 0 memo opening`), HTTP 200. Before the fix `deriveClaimOpenings` threw before the checks could fail closed and the
//      caller got an exception error instead of the verify ERROR.
//   r23-3-api-claims-with-beacon: the same document with the real BLS-verifiable published beacon
//      verifies the claim end to end (the memo opens to the bid, the owner signature checks) and
//      reports `valid:true` — the ERROR above is the live check's fail-closed verdict, not a canned
//      string.
//   r23-3-api-never-500: both responses are JSON verdicts (200), never a 500.
//
// The fixture is BUILT by this run — fresh keys, a fresh 128-byte bid tlock-sealed with the shipped
// tlock-js to a past drand quicknet round (the beacon is fetched from drand and BLS-verified inside
// the product code at use), a fresh owner signature over the claim body — nothing pre-baked. The
// run builds the read API from this working tree (esbuild api/server.ts) and drives it over real HTTP.
//
// Output: `PASS r23-3-<id>` / `ERROR r23-3-<id> <reason>`; exit 0 only if all PASS.
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const WORK = path.join(ROOT, "tmp/r23-3-api");
const DIR = path.join(WORK, "public");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// the shipped modules under test, bundled from this working tree
writeFileSync(path.join(WORK, "entry.mjs"), [
  'export * as schema from "../../manifest/schema";',
  'export * as envelope from "../../envelope/index";',
  'export * as bid from "../../envelope/bid";',
  'export * as tlock from "tlock-js";',
  'export * as armor from "tlock-js/age/armor";',
  'export * as witness from "../../witness/index";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(WORK, "entry.mjs"), "--bundle", "--platform=node", "--format=esm",
  "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
  "--outfile=" + path.join(WORK, "lib.mjs"), "--log-level=warning",
], { cwd: ROOT });
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(ROOT, "api/server.ts"), "--bundle", "--platform=node", "--format=esm",
  "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
  "--outfile=" + path.join(WORK, "server.mjs"), "--log-level=warning",
], { cwd: ROOT });
const { schema, envelope, bid, tlock, armor, witness } = await import(pathToFileURL(path.join(WORK, "lib.mjs")).href);
const { startServer } = await import(pathToFileURL(path.join(WORK, "server.mjs")).href);

// ---- fixture: a REFUNDING auction, one stray deposit claim with a REAL tlock memo, no beacon ----
const auctionId = randomBytes(32).toString("hex");
const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signerHex = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const drandBase = (process.env.BNZ_DRAND_URLS ?? "https://api.drand.sh").split(",")[0];
const chainHash = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chainHash}/public/latest`);
if (!latest.ok) throw new Error(`drand HTTP ${latest.status}`);
const R = (await latest.json()).round - 5;
const RT = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
const manifest = {
  version: 1, network: "test", auction_id: auctionId,
  escrow_ua: "utest1" + randomBytes(35).toString("hex"), frost_group_key: randomBytes(32).toString("hex"),
  lot: "r23-3 fixture", supply: 1,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: "500000", q_max: 1,
  C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + randomBytes(35).toString("hex")],
  drand: { ...schema.QUICKNET, R },
  T_submit: RT - 850, T_freeze: RT - 100, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
};
// R23 item 1 (merged after this fixture was first written): a stray claim is verified against a q_w-certified
// strays statement under the manifest-pinned witness set, so the fixture publishes the full witness flow.
const w1 = witness.generateWitnessKey(), w2 = witness.generateWitnessKey(), w3 = witness.generateWitnessKey();
const witnessSet = schema.signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: [w1.public_hex, w2.public_hex, w3.public_hex] }, signerPem);
manifest.witness_set_hash = witness.witnessSetHash(witnessSet);
const packet = schema.signRecord(manifest, signerPem);

// a fresh 128-byte sealed bid, tlock-sealed to the past round R and framed as the v1 stray memo
const owner = envelope.generateOwnerKey();
const plaintext = bid.buildBidPlaintext({
  auction_id: auctionId, price_zats: 250000n, quantity: 1,
  nonce_hex: randomBytes(16).toString("hex"), owner_public_hex: owner.public_hex,
  settlement_commitment_hex: randomBytes(32).toString("hex"),
});
const pinnedInfo = {
  public_key: schema.QUICKNET.public_key, period: schema.QUICKNET.period, genesis_time: schema.QUICKNET.genesis,
  hash: chainHash, groupHash: "", schemeID: schema.QUICKNET.scheme, metadata: { beaconID: "quicknet" },
};
const armored = await tlock.timelockEncrypt(R, plaintext, { chain: () => ({ info: async () => pinnedInfo }) });
const ct = Buffer.from(armor.decodeArmor(armored), "binary");
const memo = Buffer.alloc(512);
Buffer.from("ff424e5a01", "hex").copy(memo, 0);
memo.writeUInt16BE(ct.length, 5);
ct.copy(memo, 7);
const party = `deposit:${randomBytes(32).toString("hex")}:ironwood:0`;
const claimBody = { kind: "claim-refund", auction_id: auctionId, party, claim_envelope_sha256: randomBytes(32).toString("hex") };
const claim = { party, claim_envelope_sha256: claimBody.claim_envelope_sha256, owner_sig: envelope.signStatement(owner, claimBody), memo_hex: memo.toString("hex") };
const strays = { version: 1, auction_id: auctionId, strays: [{ party, memo_sha256: sha256(memo), value_zats: "500000" }] };
const straysCert = { statement: strays, signatures: [witness.signStrays(strays, w1.private_hex), witness.signStrays(strays, w2.private_hex)] };

const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
if (!beaconRes.ok) throw new Error(`drand HTTP ${beaconRes.status} for round ${R}`);
const beaconJson = await beaconRes.json();

const docFile = path.join(DIR, "auction.json");
const writeDoc = (beacon) => writeFileSync(docFile, JSON.stringify({
  version: 1, auction_id: auctionId, signer: signerHex, manifest: packet, state: "REFUNDING", receipts: [],
  claims: [claim], witness_set: witnessSet, strays_cert: [straysCert],
  ...(beacon ? { beacon: { round: R, signature: beaconJson.signature, chain_hash: chainHash } } : {}),
}, null, 2) + "\n");

// ---- drive the shipped read API over real HTTP ----
const server = startServer({ dir: DIR, host: "127.0.0.1", port: 0 });
await new Promise((resolve) => server.on("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async () => {
  const res = await fetch(`${base}/auction/${auctionId}`);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
};

writeDoc(false);
const noBeacon = await get();
writeDoc(true);
const withBeacon = await get();
server.close();

const claimsError = (r) => (r.body?.errors ?? []).find((e) => e.id === "claims") ?? null;
check("r23-3-api-claims-no-beacon",
  noBeacon.status === 200 && noBeacon.body?.valid === false &&
    claimsError(noBeacon)?.error === "refused: claim 0 memo opening",
  `status ${noBeacon.status} valid ${noBeacon.body?.valid} claims ${JSON.stringify(claimsError(noBeacon))}`);
check("r23-3-api-claims-with-beacon",
  withBeacon.status === 200 && withBeacon.body?.valid === true && (withBeacon.body?.errors ?? []).length === 0,
  `status ${withBeacon.status} valid ${withBeacon.body?.valid} errors ${JSON.stringify(withBeacon.body?.errors)}`);
check("r23-3-api-never-500",
  noBeacon.status !== 500 && withBeacon.status !== 500 && noBeacon.body !== null && withBeacon.body !== null,
  `statuses ${noBeacon.status}/${withBeacon.status}`);

console.log(failures === 0
  ? "RESULT PASS the read API fails closed with the verify ERROR on claims without a beacon, never a 500"
  : `RESULT FAIL ${failures} assertion(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
