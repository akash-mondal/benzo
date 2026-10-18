// Shared offline fixture for the H10/H11 repros (docs/design/phase7-h10-h11.md). One small but REAL auction
// document — real tlock ciphertexts sealed to a past quicknet round (the tools/bench.ts machinery), a signed
// manifest, the merkle frozen set, witness certificates, envelope records and a cleared result that
// `benzo verify` re-derives — plus the stub toolchain the signer-host commands need instead of live chain
// access (their external tools are stubbed; every product decision runs the real shipped code). Everything is
// written under tmp/ in the caller's worktree (the R43 rule).
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bls12_381 } from "@noble/curves/bls12-381";
import { timelockEncrypt } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor.js";
import { QUICKNET, hash, jsonBytes, signRecord, type Manifest, type Signed } from "../../manifest/schema";
import { tree, type Deposit, type Frozen, type Leaf } from "../../clear/merkle";
import { clearForMode, modeEntry } from "../../clear/registry";
import { generateEnvelopeKey, ownerPublic, sealEnvelope, signEnvelope, settlementCommitment } from "../../envelope";
import { freezeStatement, signStatement, witnessSetHash, checkCertificates } from "../../witness";
import { publishedClient } from "../../cli/published-beacon";

// The two real testnet UAs r81-destination-rule.ts pins (zcash-address-cases.json): the committed seller
// payout address (a UA with a Sapling AND an Orchard receiver) and the substitute a hostile coordinator would
// put in its packet (a UA without an Orchard receiver — accepted by the pre-H10 amount-only rule).
export const UA_ORCHARD = "utest1redacted";
export const UA_SAPLING_ONLY = "utest1redacted";

const seed = "benzo-phase7-h10-h11";
const bytes = (tag: string) => Buffer.from(hash(seed + ":" + tag), "hex");
const ed = (tag: string) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), bytes(tag)]), type: "pkcs8", format: "der" });
export const pem = (tag: string) => ed(tag).export({ type: "pkcs8", format: "pem" }).toString();
// B46 (H15): the fixture's witness private halves (the same `bytes("witness:i")` keys the witness set pins),
// so a repro can sign envelope-opens reports and approval maps the fixture's checks accept.
export const witnessPrivate = (tag: string) => bytes("witness:" + tag).toString("hex");
const rawPublic = (tag: string) => createPublicKey(ed(tag)).export({ type: "spki", format: "der" }).toString("hex").slice(24);

// Freshly fetched authentic beacon for a fixed past quicknet round — never a recorded response (the tools/bench.ts rule).
export async function fetchBeacon(round: number): Promise<{ round: number; signature: string; chain_hash: string }> {
  const response = await fetch(`https://api.drand.sh/${QUICKNET.chain_hash}/public/${round}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`drand HTTP ${response.status} (this repro fetches the real past-round beacon once, as tools/bench.ts does)`);
  const beacon = await response.json() as { round: number; signature: string };
  if (beacon.round !== round) throw new Error("drand round");
  return { round: beacon.round, signature: beacon.signature, chain_hash: QUICKNET.chain_hash };
}

export type Tamper = { index: number; kind: "body" | "mac" | "stanza-body" | "payload-cut" | "junk-body" | "junk-vw" };
export type Fixture = {
  id: string; signer: string; manifestPem: string; manifest: Manifest; manifestPacket: Signed; manifestHash: string;
  envelopeKeys: { public_hex: string; private_hex: string }[];
  groupKey: string; payout: string; R: number;
  leaves: Leaf[]; receipts: Signed[]; frozen: Frozen; envelopes: { ciphertext_hash: string; envelope_ct: string; owner_sig: string }[];
  witnessSet: Signed; witnessCert: any[]; beacon: { round: number; signature: string; chain_hash: string };
  opened: { leaf_index: number; plaintext_hex: string | null; error?: string }[];
  notes: any[]; result: any; plaintexts: Record<string, string>; tampered: Tamper[];
};

// Build the fixture auction in memory. `commitment` is the manifest's seller_ua_commitment (undefined = the
// legacy pre-H10 variant); `tamper` corrupts one ciphertext AFTER sealing (body = payload-chunk MAC failure,
// mac = header MAC failure — the two authenticated-ciphertext classes tlock-js and Go tle both classify as
// undecryptable; stanza-body and payload-cut are the two H14 griefing probes — a malformed stanza body and a
// payload cut to 3 bytes, both of which pass the pre-H14 header rule; junk-body and junk-vw are the two B44
// griefing probes (Reviewer R P1-1) — a 128-byte stanza body of junk and a valid compressed G2 point followed
// by 32 junk bytes, both of which pass the B43 length-only shape rule and used to THROW in the opener);
// `hideDeposit` drops one deposit from the scan notes (the reorg case).
export async function buildAuction(opts: {
  beacon: { round: number; signature: string; chain_hash: string };
  commitment?: string; reserve_commitment?: string; tamper?: Tamper[]; hideDeposit?: number; count?: number; fee_zats?: string;
}): Promise<Fixture> {
  const count = opts.count ?? 3, R = opts.beacon.round, release = QUICKNET.genesis + (R - 1) * QUICKNET.period;
  const auction_id = bytes("auction").toString("hex"), signer = createPublicKey(ed("manifest")).export({ type: "spki", format: "der" }).toString("hex");
  const groupKey = bytes("group").toString("hex");
  const witnessSet = signRecord({ version: 1, auction_id, q_w: 2, keys: [0, 1, 2].map(i => rawPublic("witness:" + i)) }, pem("manifest"));
  const address = "utest1" + bytes("public-deposit-address").toString("hex");
  const envelopeKeys = [generateEnvelopeKey(), generateEnvelopeKey(), generateEnvelopeKey()];
  const manifest: Manifest = {
    version: 1, network: "test", auction_id, escrow_ua: address, frost_group_key: groupKey, lot: "phase7 repro",
    supply: count, reserve_zats: "1000", tick_zats: "1000", B_max_zats: "100000", q_max: 10, C_zats: "1000100", fee_zats: opts.fee_zats ?? "100",
    deposit_addresses: [address], drand: { ...QUICKNET, R }, T_submit: release - 1000, T_freeze: release - 200, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    // The product rule (R7 item 2): the signed manifest pins the three envelope keys the bids are sealed to.
    envelope_keys: envelopeKeys.map(k => k.public_hex), witness_set_hash: witnessSetHash(witnessSet),
    ...(opts.commitment !== undefined ? { seller_ua_commitment: opts.commitment } : {}),
    // B46 (H15): the reserve-return address commitment (reserve_return_ua_commitment), when the caller binds one.
    ...(opts.reserve_commitment !== undefined ? { reserve_return_ua_commitment: opts.reserve_commitment } : {}),
  } as Manifest;
  const manifestPacket = signRecord(manifest, pem("manifest")), manifestHash = manifestPacket.sha256;
  const client = publishedClient(opts.beacon);
  const plaintexts: Record<string, string> = {};
  const bids: any[] = [];
  for (let i = 0; i < count; i++) {
    const owner = { private_hex: bytes("owner:" + i).toString("hex"), public_hex: ownerPublic(bytes("owner:" + i).toString("hex")) };
    // The refund destination is a real unified address with an Orchard receiver (R81's rule at seal).
    const envelope_ct = sealEnvelope(UA_ORCHARD, envelopeKeys.map(k => k.public_hex), "test");
    const nonce = bytes("nonce:" + i).subarray(0, 16).toString("hex"), pt = Buffer.alloc(128);
    Buffer.from(auction_id, "hex").copy(pt, 1); pt.writeBigUInt64BE(BigInt(3 + i) * 1000n, 33);
    pt.writeUInt32BE(1 + i, 41); Buffer.from(nonce, "hex").copy(pt, 45);
    Buffer.from(owner.public_hex, "hex").copy(pt, 61); Buffer.from(settlementCommitment(nonce, envelope_ct), "hex").copy(pt, 93);
    const armored = await timelockEncrypt(R, pt, client);
    let ct = Buffer.from(decodeArmor(armored), "binary");
    const tamper = (opts.tamper ?? []).find(t => t.index === i);
    if (tamper) {
      // body: flip the ciphertext's last byte (payload-chunk MAC failure). mac: replace the first header-MAC
      // character after the "--- " marker with a DIFFERENT valid base64 character — both Go age and tlock-js
      // must parse the header and then fail its MAC check (a parse-breaking byte is a different error class).
      // stanza-body: replace the stanza body's first line with "!!!!" (the H14 probe) — the header rule still
      // passes, but the age parse breaks at the MAC line. payload-cut: cut the payload to 3 bytes (the H14
      // probe) — the header rule still passes and tlock-js returns an EMPTY plaintext for it. junk-body: the
      // whole 128-byte stanza body becomes 128 bytes of 0x5a (the B44 P1-1 probe). junk-vw: the body becomes
      // the compressed G2 generator (96 bytes, a valid point) followed by 32 bytes of junk (the B44 P1-1
      // probe's second variant) — only the first 96 bytes can be checked before R.
      if (tamper.kind === "body") { ct = Buffer.from(ct); ct[ct.length - 1] ^= 1; }
      else if (tamper.kind === "junk-body" || tamper.kind === "junk-vw") {
        const body = tamper.kind === "junk-body" ? Buffer.alloc(128, 0x5a)
          : Buffer.concat([Buffer.from(bls12_381.G2.ProjectivePoint.BASE.toBytes(true)), Buffer.alloc(32, 0x5b)]);
        const encoded = body.toString("base64").replace(/=+$/, "");
        const lines = ct.toString("latin1").split("\n"), stanzaAt = lines.findIndex(l => l.startsWith("-> tlock "));
        ct = Buffer.from([...lines.slice(0, stanzaAt + 1), encoded.slice(0, 64), encoded.slice(64, 128), encoded.slice(128), ...lines.slice(stanzaAt + 4)].join("\n"), "binary");
      } else if (tamper.kind === "stanza-body") {
        const text = ct.toString("latin1"), stanzaAt = text.indexOf("\n-> tlock "), lineStart = text.indexOf("\n", stanzaAt + 1) + 1, lineEnd = text.indexOf("\n", lineStart);
        ct = Buffer.from(text.slice(0, lineStart) + "!!!!" + text.slice(lineEnd), "binary");
      } else if (tamper.kind === "payload-cut") {
        const text = ct.toString("latin1"), macAt = text.indexOf("--- "), payloadStart = text.indexOf("\n", macAt) + 1;
        ct = Buffer.from(text.slice(0, payloadStart + 3), "binary");
      }
      else { const at = ct.toString("latin1").indexOf("--- ") + 4; ct = Buffer.from(ct); ct[at] = ct[at] === 0x41 ? 0x42 : 0x41; }
    }
    if (ct.length > 505) throw new Error("ciphertext memo cap");
    const memo = Buffer.alloc(512); Buffer.from("ff424e5a01", "hex").copy(memo); memo.writeUInt16BE(ct.length, 5); ct.copy(memo, 7);
    const ciphertext_hash = hash(ct);
    if (!tamper) plaintexts[ct.toString("hex")] = pt.toString("hex");
    bids.push({ memo_hex: memo.toString("hex"), ct: ct.toString("hex"), owner: owner.public_hex, envelope_ct,
      owner_sig: signEnvelope(owner, auction_id, ciphertext_hash, envelope_ct),
      deposit: { txid: bytes("txid:" + i).toString("hex"), pool: "ironwood", address, diversifier_index: String(i) } });
  }
  // Admission and freeze, exactly the intake rules (the tools/bench.ts stages): one leaf per bid.
  const leaves: Leaf[] = [], receipts: Signed[] = [], envelopes: any[] = [];
  for (const [i, bid] of bids.entries()) {
    const ciphertext_hash = hash(Buffer.from(bid.ct, "hex"));
    const receipt = { auction_id, manifest_hash: manifestHash, ciphertext_hash, deposit: bid.deposit as Deposit, leaf_index: i };
    leaves.push({ ...receipt, ciphertext_hex: bid.ct }); receipts.push(signRecord(receipt, pem("manifest")));
    envelopes.push({ ciphertext_hash, envelope_ct: bid.envelope_ct, owner_sig: bid.owner_sig });
  }
  const frozen: Frozen = { auction_id, manifest_hash: manifestHash, ...tree(leaves), leaf_count: count,
    cutoff: manifest.T_freeze, published_at: manifest.T_freeze - 100, leaves };
  const statement = freezeStatement(manifest, frozen);
  const witnessCert = [{ statement, signatures: [0, 1].map(i => signStatement(statement, bytes("witness:" + i).toString("hex"))) }];
  checkCertificates(witnessCert, { q_w: 2, keys: [0, 1, 2].map(i => rawPublic("witness:" + i)) }, statement);
  // The scan's notes: every deposit, mined, unspent, exactly C, with the leaf's ciphertext in its memo. One
  // deposit can be hidden (the reorg case) — the leaf stays in the frozen set but the deposit leaves the chain.
  const notes = bids.map((b, i) => ({ txid: b.deposit.txid, height: 90000 + i, pool: "ironwood", address,
    diversifier_index: b.deposit.diversifier_index, action_index: i, value_zats: Number(manifest.C_zats), memo_hex: b.memo_hex, spent_in_txid: null }));
  const visibleNotes = notes.filter((_, i) => i !== opts.hideDeposit);
  // The expected openings: every intact sealed bid opens from the real beacon; a tampered one is an
  // authenticated-ciphertext failure (undecryptable); a hidden deposit is a reorg (its ciphertext still opens —
  // the deposit left the chain). The repro compares the base and fixed `open` runs against each other and this.
  const opened = leaves.map((l, i) => {
    if (i === opts.hideDeposit) return { leaf_index: i, plaintext_hex: null, error: "reorg" };
    if ((opts.tamper ?? []).some(t => t.index === i)) return { leaf_index: i, plaintext_hex: null, error: "undecryptable" };
    return { leaf_index: i, plaintext_hex: plaintexts[l.ciphertext_hex] };
  });
  const result = clearForMode({ manifest: manifestPacket, signer, frozen, opened });
  // The seller obligation the result carries (obligationsModeA over conservation.payout_zats). A "0" payout
  // would make every seller-row scenario vacuous, so the callers check it is not.
  const payout = modeEntry(manifestPacket).obligations(result, null).get("seller") ?? "0";
  return { id: auction_id, signer, manifestPem: pem("manifest"), manifest, manifestPacket, manifestHash,
    envelopeKeys, groupKey, payout, R, leaves, receipts, frozen, envelopes, witnessSet, witnessCert,
    beacon: opts.beacon, opened, notes: visibleNotes, result, plaintexts, tampered: opts.tamper ?? [] };
}

// The canonical public document `benzo verify` reads (the tools/bench.ts verify stage's shape).
export function writePublicDir(dir: string, fixture: Fixture): void {
  mkdirSync(dir, { recursive: true });
  const doc = { version: 1, auction_id: fixture.id, signer: fixture.signer, manifest: fixture.manifestPacket, state: "CLEARED",
    receipts: fixture.receipts, frozen: fixture.frozen, result: fixture.result, opened: fixture.opened, beacon: fixture.beacon,
    witness_set: fixture.witnessSet, witness_cert: fixture.witnessCert, envelopes: fixture.envelopes };
  writeFileSync(path.join(dir, "auction.json"), jsonBytes(doc));
  writeFileSync(path.join(dir, "manifest.json"), jsonBytes(fixture.manifestPacket));
}

// The signer-host state dir with stub external tools. Every product decision (the seller binding, the row
// derivation, the refusal typing) runs the real shipped code; the stubs replace only the offline-impossible
// externals: the lightwalletd wallet/scanner (chain observations come from the fixture notes), benzo-pczt's
// vault subcommands (classify-address delegates to the REAL binary), zcash-sign (sighash), grpcurl (chain tip)
// and Go tle (ciphertext -> fixture plaintext map, with the two real MAC-failure stderr classes).
export function writeHostState(state: string, fixture: Fixture, realPczt: string): void {
  const bin = path.join(state, "bin");
  for (const d of [state, bin, path.join(state, "run"), path.join(state, "auction"), path.join(state, "auctions", fixture.id), path.join(state, "signers", "alice")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(state, "auctions", fixture.id, "group-key.txt"), fixture.groupKey + "\n");
  writeFileSync(path.join(state, "operator-signer.txt"), fixture.signer + "\n");
  writeFileSync(path.join(state, "ufvk.txt"), "uviewtest1fixture\n");
  writeFileSync(path.join(state, "signers", "alice", "envelope-key.json"), JSON.stringify(fixture.envelopeKeys[0]));
  writeFileSync(path.join(state, "fixture.json"), JSON.stringify({ groupKey: fixture.groupKey, notes: fixture.notes,
    plaintexts: fixture.plaintexts, tampered: fixture.tampered.map(t => ({ ct: fixture.leaves[t.index].ciphertext_hex, kind: t.kind })) }));
  writeFileSync(path.join(state, "auction", "manifest-signing.pem"), fixture.manifestPem);
  // Two files per stub: a shell wrapper with the exact name the product spawns (Node reads an extension-less
  // file under the repo's "type": "module" as ESM, where require is undefined) and a CommonJS implementation.
  const stub = (name: string, source: string) => {
    const run = path.join(bin, name), impl = path.join(bin, name + ".cjs");
    writeFileSync(impl, source); chmodSync(impl, 0o755);
    writeFileSync(run, `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`); chmodSync(run, 0o755);
  };
  stub("zcash-devtool", `const fs = require("fs");
const a = process.argv.slice(2);
if (a.includes("balance")) { console.log(JSON.stringify({ chain_tip_height: 100000 })); process.exit(0); }
if (a.includes("prove") || a.includes("redact")) {
  const out = a[a.indexOf("--output") + 1];
  const inputs = a.filter((x, i) => x !== "--output" && a[i - 1] !== "--output" && !x.startsWith("-") && !["pczt", "prove", "redact", "wallet"].includes(x));
  fs.copyFileSync(inputs[inputs.length - 1], out);
  process.exit(0);
}
process.exit(0);
`);
  stub("benzo-scan", `const fs = require("fs"), path = require("path");
const state = path.dirname(path.dirname(process.argv[1]));
for (const n of JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8")).notes) console.log(JSON.stringify(n));
`);
  stub("grpcurl", `const a = process.argv.slice(2), method = a[a.length - 1].split("/").pop();
if (method === "GetLatestBlock") { console.log(JSON.stringify({ height: 100000 })); process.exit(0); }
if (method === "GetTransaction") { process.stderr.write("NotFound\\n"); process.exit(1); }
if (method === "GetBlockRange") {
  const body = JSON.parse(a[a.indexOf("-d") + 1]);
  for (let h = body.start.height; h <= body.end.height; h++) console.log(JSON.stringify({ height: h, vtx: [] }));
  process.exit(0);
}
process.stderr.write("NotFound\\n"); process.exit(1);
`);
  stub("zcash-sign", `const fs = require("fs"), crypto = require("crypto");
const a = process.argv.slice(2);
fs.writeFileSync(a[a.indexOf("-o") + 1], "fixture signature probe\\n");
console.log("SIGHASH: " + crypto.createHash("sha256").update(fs.readFileSync(a[a.indexOf("-i") + 1])).digest("hex"));
`);
  stub("tle", `const fs = require("fs"), path = require("path");
const state = path.dirname(path.dirname(process.argv[1]));
const fix = JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8"));
const ct = fs.readFileSync(0).toString("hex");
const hit = fix.tampered.find(t => t.ct === ct);
if (hit) {
  // The real Go-age failure classes: a body or payload-cut tamper fails the payload chunk MAC, a header tamper
  // fails the fileKey/payload MAC (settle/bounded MAC_FAILURE and clear/auction-cli.ts match these), and the
  // H14 stanza-body grief fails the age PARSE (non-MAC stderr — the failure class that made the open throw).
  if (hit.kind === "stanza-body") { process.stderr.write("age: malformed stanza body\\n"); process.exit(1); }
  process.stderr.write(hit.kind === "body" || hit.kind === "payload-cut" ? "failed to decrypt and authenticate payload chunk\\n" : "bad header MAC\\n");
  process.exit(1);
}
const pt = fix.plaintexts[ct];
if (pt === undefined) { process.stderr.write("tle stub: unknown ciphertext\\n"); process.exit(1); }
const out = process.argv.includes("-o") ? process.argv[process.argv.indexOf("-o") + 1] : null;
if (out) fs.writeFileSync(out, Buffer.from(pt, "hex")); else process.stdout.write(Buffer.from(pt, "hex"));
`);
  stub("benzo-pczt", `const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const state = path.dirname(path.dirname(process.argv[1]));
const fix = JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8"));
const a = process.argv.slice(2), cmd = a[0];
if (process.env.BNZ_PCZT_TRACE) fs.appendFileSync(process.env.BNZ_PCZT_TRACE, a.join(" ") + "\\n");
if (cmd === "classify-address") {
  // B45: classify-address --stdin is the bulk form — stdin/stdout pass straight through to the real binary.
  if (a.includes("--stdin")) {
    const r = cp.spawnSync(${JSON.stringify(realPczt)}, ["classify-address", "--stdin"], { input: fs.readFileSync(0), maxBuffer: 1 << 28 });
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? ""); process.exit(r.status ?? 1);
  }
  process.stdout.write(cp.execFileSync(${JSON.stringify(realPczt)}, ["classify-address", a[1]])); process.exit(0);
}
if (cmd === "ufvk-ak") { console.log(fix.groupKey); process.exit(0); }
if (cmd === "owns") {
  // B46 (H15): the scope verdict the reserve-return source rule needs — a fixture may name its vault's
  // internal (change) addresses in fixture.json under internal_addresses; every other address is external.
  console.log(((fix.internal_addresses ?? []).includes(a[2])) ? "internal" : "external");
  process.exit(0);
}
if (cmd === "create") {
  const rows = JSON.parse(fs.readFileSync(0, "utf8"));
  fs.writeFileSync(a[2], JSON.stringify({ rows }));
  fs.appendFileSync(path.join(state, "create-log.jsonl"), rows.map(r => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10));
  process.exit(0);
}
if (cmd === "inspect") {
  const file = JSON.parse(fs.readFileSync(a[1], "utf8"));
  console.log(JSON.stringify({ outputs: file.rows.map((r, i) => ({ index: i, pool: "ironwood", is_change: false, recipient: r.recipient, amount_zats: String(r.amount_zats) })),
    expiry_height: 100500, txid: crypto.createHash("sha256").update(fs.readFileSync(a[1])).digest("hex"), randomizers: [] }));
  process.exit(0);
}
if (cmd === "address") { console.log("utest1fixturevaultaddress0000000000000000000000000000000000"); process.exit(0); }
process.stderr.write("benzo-pczt stub: unknown command " + cmd + "\\n"); process.exit(1);
`);
}

// The auction ledger `benzo open` reads (state/auction/<id>.json): a frozen, SEALED-WAIT auction. Written
// directly because admit/freeze refuse a past drand round by design.
export function writeAuctionLedger(state: string, fixture: Fixture): void {
  const dir = path.join(state, "auction");
  mkdirSync(dir, { recursive: true, mode: 0o700 }); mkdirSync(path.join(state, "run"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "manifest-signing.pem"), fixture.manifestPem);
  const ledger = { manifest: fixture.manifestPacket, signer: fixture.signer, state: "SEALED-WAIT",
    leaves: fixture.leaves, receipts: fixture.receipts, frozen: fixture.frozen, trace: [] as any[] };
  writeFileSync(path.join(dir, `${fixture.id}.json`), jsonBytes(ledger));
}

export const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
export const realPcztPath = (root: string) => path.join(root, "settle", "target", "release", "benzo-pczt");
export const needRealPczt = (root: string) => {
  const p = realPcztPath(root);
  if (!existsSync(p)) throw new Error(`build the audited classifier first: cargo build --release --locked --manifest-path settle/Cargo.toml (${p} missing)`);
  return p;
};
