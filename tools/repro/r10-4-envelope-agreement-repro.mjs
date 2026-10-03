// R10 item 4 + R12 item 3 repro — `envelope-opens-<name>.json` and the two-signer agreement gate.
//
//   G1 (the flip): a refund through an envelope is payable only when at least 2 signers' own opening
//      reports say ok with the same dest_sha256. Before the fix, one signer's opening decides: a leaf whose
//      envelope the owner deliberately broke for two of the three signers (their wrapped content keys
//      corrupted inside the owner-signed box — validEnvelope accepts it; it is the owner's own signature)
//      is still paid to whatever the acting signer opens. After, it waits in the exception queue with
//      "signers could not agree on the envelope destination".
//   G2 (control): a leaf whose envelope only carol cannot open still pays — alice and bob agree — and the
//      plan's agreed dest_sha256 is the hash of the exact UA sealed at bid time.
//   G3 (R12 item 3): carol's report for that leaf says ok:false and the report never throws; her other
//      entries are still written.
//
// The corpus is the r10-2 recipe (real tlock ciphertexts to a real quicknet round, real v2 envelopes sealed
// through the shipped envelope/ modules to the real signer keys, a fresh ed25519-signed manifest, the
// shipped clear, real confirmed deposits, a real PCZT candidate from the bidder wallet) extended with two
// owner-signed boxes whose wrapped content keys are corrupted for chosen signers. Everything runs in a
// scratch BNZ_STATE_DIR; the live auction state is never touched.
//
// Usage: node tools/repro/r10-4-envelope-agreement-repro.mjs
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const TLE = path.join(STATE, "bin", "tle");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rndHex = (n) => randomBytes(n).toString("hex");
execFileSync("npm", ["run", "--silent", "build:cli"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(path.join(ROOT, "tmp/repro-r10-4-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as merkle from "../clear/merkle";',
  'export * as env from "../envelope/index";',
  'export * as bid from "../envelope/bid";',
  'export * as senv from "../settle/envelopes";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-r10-4-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-r10-4-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { schema, merkle, env, bid, senv } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-r10-4-lib.mjs")).href);

const SCRATCH = path.join(ROOT, "tmp/e2e/r10-4-state");
const scratch = (p) => path.join(SCRATCH, p);
const sh = (cmd, args, input) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, BNZ_STATE_DIR: SCRATCH } });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "" };
};
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out.match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });

const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sourceAuction = process.argv[2] ?? "3bbfa50130665d5177c6fdcd19ebb610b47fcf2a8016c38a7a0b1a21b2a0801a";
const sourceLedger = path.join(STATE, "settle", sourceAuction, "ledger.sqlite");
const { DatabaseSync } = await import("node:sqlite");
const owned = new Set(new DatabaseSync(sourceLedger, { readOnly: true }).prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
const deposits = [...new Map(notes.filter((n) => n.value_zats === 500000 && n.height && n.memo_hex && n.memo_hex !== "00".repeat(512) && (!n.spent_in_txid || owned.has(n.spent_in_txid)))
  .map((n) => [n.address, n])).values()].slice(0, 3);
if (deposits.length < 3) { console.error("fewer than three usable deposits"); process.exit(2); }
const C = 500000n;

const signerKey = generateKeyPairSync("ed25519");
const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const signer = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
const auction_id = rndHex(32);
const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
const chain = schema.QUICKNET.chain_hash;
const latest = await fetch(`${drandBase}/${chain}/public/latest`);
if (!latest.ok) { console.error(`drand HTTP ${latest.status}`); process.exit(2); }
const R = (await latest.json()).round - 50;
const release = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
const T_freeze = release - 100, T_submit = T_freeze - 800, published_at = T_freeze - 200;
const beaconRes = await fetch(`${drandBase}/${chain}/public/${R}`);
if (!beaconRes.ok) { console.error(`drand HTTP ${beaconRes.status}`); process.exit(2); }
const beacon = await beaconRes.json();
const signerKeys = ["alice", "bob", "carol"].map((n) => JSON.parse(readFileSync(path.join(STATE, "signers", n, "envelope-key.json"), "utf8")).public_hex);
const manifest = {
  version: 1, network: "test", auction_id,
  escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "r10.4 repro lot", supply: 1,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: C.toString(), q_max: 1,
  C_zats: C.toString(), fee_zats: "0", deposit_addresses: deposits.map((n) => n.address),
  drand: { ...schema.QUICKNET, R }, T_submit, T_freeze, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  envelope_keys: signerKeys,
};
const packet = schema.signRecord(manifest, signerPem);
const freshUa = () => sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder")]).out.trim();
const dest1 = freshUa(), dest2 = freshUa(); // leaf1 (carol cannot open) and leaf2 (bob+carol cannot open)
// A real owner-signed v2 box whose content key is wrapped to the real signer keys except for chosen signers,
// who receive a valid wrap of the WRONG key (exactly the malicious owner of R12 item 3: the box is
// internally consistent — the owner commits to it and signs it — so validEnvelope accepts the record, while
// the sabotaged signers cannot open it and the honest ones all open the same destination). The format and
// primitives are the shipped ones (libsodium); nothing here is pre-baked — keys, nonce and content key are
// fresh per box.
const sodium = (await import("libsodium-wrappers")).default;
await sodium.ready;
const pad512 = (text) => { const pt = Buffer.alloc(512); const payload = Buffer.from(text, "utf8"); pt.writeUInt16BE(payload.length, 0); payload.copy(pt, 2); return pt; };
const sealSabotaged = (dest, broken) => {
  const owner = env.generateOwnerKey(), aeadNonce = sodium.randombytes_buf(12), bidNonce = randomBytes(16).toString("hex");
  const contentKey = sodium.randombytes_buf(32);
  const kcLabel = Buffer.from("benzo-envelope-v2-kc");
  const kcKey = Buffer.concat([kcLabel, Buffer.alloc(32 - kcLabel.length)]);
  const commit = Buffer.from(sodium.crypto_generichash(32, contentKey, kcKey));
  const stanzas = Buffer.concat(signerKeys.map((h, i) => {
    const pk = Buffer.from(h, "hex");
    return Buffer.concat([pk, sodium.crypto_box_seal(broken.includes(i) ? Buffer.alloc(32, 0x5a) : contentKey, pk)]);
  }));
  const header = Buffer.concat([Buffer.from("benzo-envelope-v2"), Buffer.from([3]), stanzas, commit]);
  const body = Buffer.from(sodium.crypto_aead_chacha20poly1305_ietf_encrypt(pad512(dest), header, null, aeadNonce, contentKey));
  const envelope_ct_hex = Buffer.concat([header, aeadNonce, body]).toString("hex");
  const commitment = env.settlementCommitment(bidNonce, envelope_ct_hex);
  const plaintext = bid.buildBidPlaintext({ auction_id, price_zats: 1000n, quantity: 1, nonce_hex: bidNonce, owner_public_hex: owner.public_hex, settlement_commitment_hex: commitment }).toString("hex");
  const sealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(plaintext, "hex"), maxBuffer: 1 << 20 });
  if (sealed.status !== 0) { console.error(`tle seal: ${sealed.stderr?.toString().trim()}`); process.exit(2); }
  const ciphertext_hash = sha256(sealed.stdout);
  return { bound: bid.bindSealedBid({ plaintext_hex: plaintext, nonce_hex: bidNonce, owner, settlement_commitment_hex: commitment, envelope_ct_hex }, auction_id, ciphertext_hash), ct: sealed.stdout.toString("hex"), ciphertext_hash };
};
const bidWinner = bid.prepareBid({ auction_id, price_zats: C, quantity: 1 });
const winnerSealed = spawnSync(TLE, ["-e", "-f", "-r", String(R), "-c", chain], { input: Buffer.from(bidWinner.plaintext_hex, "hex"), maxBuffer: 1 << 20 });
const winnerHash = sha256(winnerSealed.stdout);
const bid1 = sealSabotaged(dest1, [2]);     // only carol is sabotaged: alice and bob agree
const bid2 = sealSabotaged(dest2, [1, 2]);  // bob and carol are sabotaged: only alice can open
const specs = [
  { bound: bid.bindSealedBid(bidWinner, auction_id, winnerHash), ct: winnerSealed.stdout.toString("hex"), ciphertext_hash: winnerHash },
  bid1, bid2,
];
const leaves = specs.map((b, i) => ({ auction_id, manifest_hash: packet.sha256, ciphertext_hash: b.ciphertext_hash,
  deposit: { txid: deposits[i].txid, pool: "ironwood", address: deposits[i].address, diversifier_index: String(deposits[i].diversifier_index) },
  leaf_index: i, ciphertext_hex: b.ct }));
const { root, paths } = merkle.tree(leaves);
const frozen = { auction_id, manifest_hash: packet.sha256, root, leaf_count: leaves.length, cutoff: T_freeze, published_at, leaves, paths };
const opened = leaves.map((l) => {
  const r = spawnSync(TLE, ["-d", "-c", chain], { input: Buffer.from(l.ciphertext_hex, "hex"), maxBuffer: 1 << 20 });
  if (r.status !== 0) { console.error(`tle open: ${r.stderr?.toString().trim()}`); process.exit(2); }
  return { leaf_index: l.leaf_index, plaintext_hex: r.stdout.toString("hex") };
});
const envelopes = [bid1, bid2].map((b) => ({ ciphertext_hash: b.ciphertext_hash, envelope_ct: b.bound.envelope_ct_hex, owner_sig: b.bound.owner_sig_hex }));
const clearRun = sh(process.execPath, [path.join(ROOT, "clear/dist/cli.mjs")], JSON.stringify({ manifest: packet, signer, frozen, opened, reserve_opening: null, serial_beacon: null, launch: undefined }));
if (clearRun.code !== 0) { console.error(`clear failed: ${clearRun.out.trim().slice(-200)}`); process.exit(2); }
const result = JSON.parse(clearRun.out);
for (const leaf of [1, 2]) if (result.allocations.find((a) => a.leaf_index === leaf)?.refund_zats !== C.toString()) { console.error(`corpus: leaf ${leaf} refund must be C`); process.exit(2); }

const publicDir = scratch("public");
mkdirSync(publicDir, { recursive: true });
const doc = { version: 1, auction_id, signer, manifest: packet, state: "CLEARED", receipts: [], frozen, result, opened, envelopes, beacon: { round: beacon.round, signature: beacon.signature, chain_hash: chain } };
writeFileSync(scratch(`auction/${auction_id}.json`), JSON.stringify(doc), { mode: 0o600 });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(doc));
writeFileSync(scratch(`product/${auction_id}.json`), JSON.stringify({ public_dir: publicDir, settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 } }));
mkdirSync(scratch(`settle/${auction_id}`), { recursive: true });
{
  cpSync(sourceLedger, scratch(`settle/${auction_id}/ledger.sqlite`));
  const db = new DatabaseSync(scratch(`settle/${auction_id}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}
const sellerUa = freshUa();
const routing = { bidders: deposits.map((n) => ({ deposit_ua: n.address })), seller_ua: sellerUa, fee_reserve_ua: freshUa() };
for (const name of ["alice", "bob", "carol"]) writeFileSync(scratch(`settle/${auction_id}/routing-${name}.json`), JSON.stringify(routing), { mode: 0o600 });
writeFileSync(scratch(`settle/${auction_id}/routing-commitment.json`), JSON.stringify({ sha256: schema.hash(schema.jsonBytes(routing)), pinned_at: Date.now() }), { mode: 0o600 });

// ---- G3: each signer writes its own opening report (never the destination) -------------------------
for (const name of ["alice", "bob", "carol"]) {
  const r = sh(path.join(ROOT, "bin/benzo"), ["sign", "envelope-opens", "--id", auction_id, "--name", name]);
  if (r.code === 0) {
    const report = JSON.parse(readFileSync(scratch(`settle/${auction_id}/envelope-opens-${name}.json`), "utf8"));
    console.log(`G3 ${name} report: ${JSON.stringify(report.opens.map((o) => ({ leaf: o.leaf, ok: o.ok })))}`);
    if (/utest1/.test(JSON.stringify(report))) console.log(`G3 FAILED ${name}: the report leaked a destination`);
  } else console.log(`G3 ${name} report unavailable (pre-fix build): ${r.out.trim().slice(-80)}`);
}

// ---- G1/G2: the shipped signer plan ----------------------------------------------------------------
const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), auction_id]);
console.log(`G1 plan exit ${planRun.code}`);
let outcome = "INCONCLUSIVE", plan = null;
if (planRun.code === 0) {
  plan = JSON.parse(planRun.stdout);
  console.log(`G1 obligations: ${JSON.stringify(plan.obligations.map((o) => o.party))}`);
  console.log(`G1 exceptions: ${JSON.stringify(plan.exceptions.map((o) => ({ party: o.party, reason: o.reason ?? null })))}`);
  console.log(`G1 envelope_agreed: ${JSON.stringify(plan.envelope_agreed)}`);
  const g1 = plan.obligations.find((o) => o.party === "leaf:2");
  const g1x = plan.exceptions.find((o) => o.party === "leaf:2");
  const g2 = plan.obligations.find((o) => o.party === "leaf:1");
  const g2ok = g2 && (plan.envelope_agreed === undefined || plan.envelope_agreed?.["leaf:1"] === sha256(Buffer.from(dest1, "utf8")));
  if (g1 && g2ok) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: the payability decision never consults the signers' openings — leaf:2 (whose envelope the owner sabotaged for two of three signers) is still owed, and the acting signer's check would approve paying it.");
  } else if (g1x && /signers could not agree on the envelope destination/.test(g1x.reason ?? "") && g2ok) {
    outcome = "FIXED";
    console.log("FIXED: leaf:2 waits in the exception queue (fewer than 2 signers open its envelope) while leaf:1 pays to the hash alice and bob agree on.");
  } else if (g1x) console.log(`G1 leaf:2 exception reason: ${g1x.reason}`);
} else console.log(`G1 plan stderr: ${planRun.out.trim().slice(-200)}`);

// ---- the shipped signer check over a real batch ------------------------------------------------------
if (plan) {
  execFileSync(process.execPath, ["node_modules/.bin/esbuild", "settle/ledger.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${scratch("ledger.mjs")}`, "--log-level=error"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  const { Ledger } = await import(scratch("ledger.mjs"));
  const ledger = new Ledger(SCRATCH, auction_id);
  ledger.pin(plan.obligations, plan.exceptions);
  ledger.eligible();
  const batch = ledger.allocate(13);
  console.log(`G1 scratch batch ${batch ? `${batch.id} with rows ${JSON.stringify(batch.outputs.map((o) => o.party))}` : "none"}`);
  if (batch) {
    const recipient = (party) => party === "seller" ? sellerUa : party === "leaf:1" ? dest1 : party === "leaf:2" ? dest2 : null;
    const payment = batch.outputs.map((o) => ({ recipient: recipient(o.party), amount_zats: o.amount_zats }));
    const candidate = scratch("candidate.pczt");
    const created = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "bidder"), candidate, "364"], JSON.stringify(payment));
    if (created.code === 0) {
      const check = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", auction_id, String(batch.id), candidate, "alice"]);
      console.log(`G1 signer check (alice) exit ${check.code}`);
      if (check.code !== 0) console.log(`G1 check stderr: ${check.out.trim().slice(-220)}`);
      const carol = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", auction_id, String(batch.id), candidate, "carol"]);
      console.log(`G2 signer check (carol, sabotaged for leaf:1) exit ${carol.code} ${carol.out.trim().split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(-160)}`);
    } else console.log(`G1 candidate create failed: ${created.out.trim().slice(-120)}`);
  }
}

// ---- R20: an operator-inserted record is never paid blind ------------------------------------------------
{
  const strayNote = notes.find((n) => n.value_zats === 500000 && n.height && n.memo_hex && n.memo_hex !== "00".repeat(512)
    && (!n.spent_in_txid || owned.has(n.spent_in_txid)) && !deposits.some((d) => d.txid === n.txid && d.diversifier_index === n.diversifier_index));
  const memolessNote = notes.find((n) => (!n.memo_hex || n.memo_hex === "00".repeat(512)) && owned.has(n.spent_in_txid));
  const probe = (note, label) => {
    if (!note) { console.log(`R20 ${label}: no such note in the scan; skipped`); return; }
    const party = `deposit:${note.txid}:${note.diversifier_index}`;
    const operatorOwner = env.generateOwnerKey();
    const operatorCt = env.sealEnvelope(sellerUa, signerKeys);
    const ctHash = sha256(Buffer.from(senv.memoSealedBid(note.memo_hex) ?? "", "hex"));
    const rec = { ciphertext_hash: ctHash, envelope_ct: operatorCt, owner_sig: env.signEnvelope(operatorOwner, auction_id, ctHash, operatorCt) };
    const aliceKey = JSON.parse(readFileSync(path.join(STATE, "signers", "alice", "envelope-key.json"), "utf8")).private_hex;
    const resolved = senv.authenticatedMemoEnvelope
      ? senv.memoEnvelopeRecipient(notes, party, packet, [rec], TLE, aliceKey)
      : senv.memoEnvelopeRecipient(notes, party, [rec], aliceKey);
    console.log(`R20 ${label}: operator-inserted record resolves to ${resolved === sellerUa ? "the operator's destination" : resolved === null ? "null" : "some destination"}`);
    return resolved;
  };
  const v1 = probe(strayNote, "v1 stray");
  probe(memolessNote, "memo-less stray");
  if (v1 === sellerUa && outcome === "CONFIRMED") console.log("CONFIRMED (R20): the signer's destination resolution pays an operator-inserted record blind — the operator's own destination resolves for a stray whose memo it does not control.");
  else if (v1 === null && outcome === "FIXED") console.log("FIXED (R20): the operator-inserted record is not authenticated by the stray's memo and resolves to null — the row is an exception row.");
}
console.log(`outcome ${outcome}`);
