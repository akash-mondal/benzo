#!/usr/bin/env node
// Cross-chain local demo (docs/design/crosschain.md §7 step 3): one cleared drop delivered end to
// end locally through the shipped `benzo xchain` CLI against both local chains — a Foundry/Anvil
// EVM chain and a solana-test-validator running the built BenzoEscrow program.
//
// The fixture is a REAL published auction directory (R21): six bids, each tlock-sealed to a live
// drand quicknet round whose beacon the run waits for and publishes (BLS-verified at every use).
// The four honest winners are sealed through the shipped `benzo bid seal` (real owner keys, real
// browser tlock, deliver payload v2 in the envelope); the two hostile-sealer winners wrap a
// tampered envelope around a real tlock. R19/R21: `benzo xchain attest` derives every winner's
// opening itself from the frozen leaf's ciphertext + the published beacon, checks
// SHA-256(ciphertext) and the record's owner signature + settlement commitment, then derives each
// leaf's destination from the signers' own openings of the winner's v2 envelope (deliver.to) —
// never from an operator allocation file or operator-supplied openings. The demo:
//   lock (both chains) -> attest (2-of-3, per chain) -> release (each chain pays its leaves)
//   -> status -> replay refused -> refund after deadline on a cancelled second auction.
//
// Keys: local dev keys only, generated under $BNZ_STATE_DIR/xchain-local/ (never printed).
// Output: `PASS demo-<id>` / `ERROR demo-<id> <reason>` lines; exit 0 only if all PASS.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { Interface, JsonRpcProvider, SigningKey, Wallet, formatEther, parseEther } from "ethers";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3";
import sodium from "libsodium-wrappers";
import { pathToFileURL } from "node:url";
await sodium.ready;

const REPO = process.env.BNZ_REPO_ROOT ?? process.cwd();
const STATE = process.env.BNZ_STATE_DIR ?? path.join(REPO, ".benzo");
const KEYDIR = path.join(STATE, "xchain-local");
const WORK = path.join(REPO, "tmp/xchain-demo");
const PUBDIR = path.join(WORK, "public");
const EVM_RPC = "http://127.0.0.1:8546";
const SOL_RPC = "http://127.0.0.1:8901";
const SOL_PROGRAM = process.env.BNZ_SOLANA_PROGRAM ?? "";
const ANVIL_SK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil dev account 0 (public)
// a real shielded testnet UA (official zcash-test-vectors unified_address rows) — the mandatory
// refund inside every winner's envelope payload
const UA = "utest1redacted";

mkdirSync(KEYDIR, { recursive: true });
rmSync(WORK, { recursive: true, force: true }); // never read a stale artifact from an earlier run
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));
const hex32 = (b) => "0x" + Buffer.from(b).toString("hex");
const rndHex = (n) => randomBytes(n).toString("hex");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function benzoXchain(args) {
  try {
    const out = execFileSync("node", [path.join(REPO, "cli/dist/benzo.mjs"), "xchain", ...args], {
      cwd: REPO, encoding: "utf8",
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
const jsonOut = (r) => {
  const at = r.stdout.indexOf("{");
  if (at < 0) throw new Error(`no JSON in CLI output: ${(r.stderr || r.stdout).slice(0, 200)}`);
  return JSON.parse(r.stdout.slice(at));
};
// raw eth_getBalance: ethers v6 caches the resolved "latest" block number briefly, which would
// make post-transaction balance reads see the pre-transaction block
const evmBalance = (provider, addr) => provider.send("eth_getBalance", [addr, "latest"]).then((h) => BigInt(h));

function secretFile(name, bytes32) {
  // local dev keys are fresh per run (overwritten); identities below are derived from the same bytes
  const p = path.join(KEYDIR, name);
  writeFileSync(p, hex32(bytes32), { mode: 0o600 });
  return p;
}

// ---- hostile-sealer envelope fixture (same construction as tools/repro/kc-key-commitment-repro.mjs) ----
// A real envelope around a payload the shipped sealer refuses to build (a malformed deliver, or a
// split-key wrap): this is exactly the tampered-sealer path the attest layer must refuse or queue.
const KC_LABEL = Buffer.from("benzo-envelope-v2-kc");
const KC_KEY = Buffer.concat([KC_LABEL, Buffer.alloc(sodium.crypto_generichash_KEYBYTES - KC_LABEL.length)]);
const MAGIC = Buffer.from("benzo-envelope-v2");
function hostileEnvelope(payloadText, recipients, wrapKeys) {
  const pks = recipients.map((h) => Buffer.from(h, "hex"));
  const stanzas = Buffer.concat(pks.map((pk, i) => Buffer.concat([pk, sodium.crypto_box_seal(wrapKeys[i], pk)])));
  const header = Buffer.concat([MAGIC, Buffer.from([pks.length]), stanzas, Buffer.from(sodium.crypto_generichash(32, wrapKeys[0], KC_KEY))]);
  const nonce = sodium.randombytes_buf(12);
  const payload = Buffer.from(payloadText, "utf8");
  const pt = Buffer.alloc(512);
  pt.writeUInt16BE(payload.length, 0);
  payload.copy(pt, 2);
  const body = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(pt, header, null, nonce, wrapKeys[0]);
  return Buffer.concat([header, nonce, body]).toString("hex");
}

async function main() {
  if (!SOL_PROGRAM) throw new Error("BNZ_SOLANA_PROGRAM must name the loaded Solana program id");
  const programId = new PublicKey(SOL_PROGRAM);
  const evm = new JsonRpcProvider(EVM_RPC, undefined, { staticNetwork: true });
  const sol = new Connection(SOL_RPC, "confirmed");

  // the shipped modules under test, bundled from this working tree (never a stale build)
  writeFileSync(path.join(WORK, "env-entry.mjs"), [
    'export * as bid from "../../envelope/bid";',
    'export * as envmod from "../../envelope/index";',
    'export * as schema from "../../manifest/schema";',
    'export * as merkle from "../../clear/merkle";',
    'export * as reg from "../../clear/registry";',
    'export * as tlock from "tlock-js";',
    'export * as armor from "tlock-js/age/armor";',
    "",
  ].join("\n"));
  execFileSync(path.join(REPO, "node_modules/.bin/esbuild"), [
    path.join(WORK, "env-entry.mjs"), "--bundle", "--platform=node", "--format=esm",
    "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
    "--outfile=" + path.join(WORK, "env-lib.mjs"), "--log-level=warning",
  ], { cwd: REPO });
  const { bid, envmod, schema, merkle, reg, tlock, armor } = await import(pathToFileURL(path.join(WORK, "env-lib.mjs")).href);

  // ---- local dev keys ----
  const evmSeller = new Wallet(ANVIL_SK, evm);
  const solPayerFile = path.join(KEYDIR, "solana-payer.json");
  if (!existsSync(solPayerFile)) writeFileSync(solPayerFile, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  const solPayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(solPayerFile, "utf8"))));
  const airdrop = await sol.requestAirdrop(solPayer.publicKey, 10 * LAMPORTS_PER_SOL);
  await sol.confirmTransaction(airdrop);

  const evmSignerFiles = [], solSignerFiles = [], evmSignerAddrs = [], solSignerPubs = [];
  for (let i = 0; i < 3; i++) {
    const es = randomBytes(32), ss = randomBytes(32);
    evmSignerFiles.push(secretFile(`evm-signer-${i}.key`, es));
    solSignerFiles.push(secretFile(`solana-signer-${i}.key`, ss));
    evmSignerAddrs.push(new Wallet(hex32(es)).address);
    solSignerPubs.push(new PublicKey(ed25519.getPublicKey(ss)).toBase58());
  }
  const evmSignersFile = path.join(WORK, "evm-signers.json"), solSignersFile = path.join(WORK, "solana-signers.json");
  writeFileSync(evmSignersFile, JSON.stringify(evmSignerAddrs, null, 2));
  writeFileSync(solSignersFile, JSON.stringify(solSignerPubs, null, 2));

  // ---- the winners' settlement envelopes (R19): the ONLY source of destinations ----
  const envelopeKeys = [envmod.generateEnvelopeKey(), envmod.generateEnvelopeKey(), envmod.generateEnvelopeKey()];
  const recipients = envelopeKeys.map((k) => k.public_hex);
  const envelopeKeyFiles = envelopeKeys.map((k, i) => {
    const p = path.join(KEYDIR, `envelope-key-${i}.key`);
    writeFileSync(p, k.private_hex, { mode: 0o600 });
    return p;
  });
  const spend = Wallet.createRandom().signingKey, view = Wallet.createRandom().signingKey;
  const metaAddress = "0x" + SigningKey.computePublicKey(spend.privateKey, true).slice(2) + SigningKey.computePublicKey(view.privateKey, true).slice(2);
  const r1 = Wallet.createRandom().address;                    // fresh EVM winner address
  const s1 = Keypair.generate().publicKey.toBase58();          // fresh Solana winner addresses
  const s2 = Keypair.generate().publicKey.toBase58();
  const attacker = Wallet.createRandom().address;              // the operator/attacker's own EVM address

  // winner deliver plan (what each bidder sealed; only the signers' keys can read it):
  //   0 evm/address, 1 solana/address, 2 solana/ct (+elgamal), 3 evm/stealth (meta-address),
  //   4 malformed deliver (hostile sealer -> exception queue), 5 split-key envelope (hostile
  //   sealer, only one signer can open it -> signers cannot agree -> exception queue)
  const delivers = [
    { chain: "evm", kind: "address", to: r1 },
    { chain: "solana", kind: "address", to: s1 },
    { chain: "solana", kind: "ct", to: s2, elgamal: rndHex(32) },
    { chain: "evm", kind: "stealth", to: metaAddress },
  ];

  // ---- the signed manifest + one already-open drand quicknet round for all six bids ----
  // (the fixture is the real post-R situation attest runs in: bids sealed before R, R passed; a past
  // round's beacon is already published and BLS-verified at every use. `bid seal`'s own future-round
  // path is proven separately below and by the default e2e.)
  const drandBase = process.env.BNZ_DRAND_URLS.split(",")[0];
  const chainHash = schema.QUICKNET.chain_hash;
  const latest = await fetch(`${drandBase}/${chainHash}/public/latest`);
  if (!latest.ok) throw new Error(`drand HTTP ${latest.status}`);
  const R = (await latest.json()).round - 5;
  const RT = schema.QUICKNET.genesis + (R - 1) * schema.QUICKNET.period;
  const auction1 = rndHex(32);
  const signerKey = generateKeyPairSync("ed25519");
  const signerPem = signerKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signerHex = signerKey.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const manifest = {
    version: 1, network: "test", auction_id: auction1,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "demo cross-chain lot", supply: 6,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "500000", q_max: 1,
    C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R },
    T_submit: RT - 850, T_freeze: RT - 100, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: recipients,
  };
  const packet = schema.signRecord(manifest, signerPem);
  const manifestFile = path.join(WORK, "manifest.json");
  writeFileSync(manifestFile, schema.jsonBytes(packet));
  const checked = reg.clientForMode(packet, signerHex);
  if (checked.manifest.auction_id !== auction1) throw new Error("signed manifest did not validate");

  // ---- six real bids around real tlock ciphertexts to round R ----
  const pinnedInfo = {
    public_key: schema.QUICKNET.public_key, period: schema.QUICKNET.period, genesis_time: schema.QUICKNET.genesis,
    hash: chainHash, groupHash: "", schemeID: schema.QUICKNET.scheme, metadata: { beaconID: "quicknet" },
  };
  const pinnedClient = { chain: () => ({ info: async () => pinnedInfo }) }; // encryption needs only the chain info
  const records = [];        // published envelope records ({ciphertext_hash, envelope_ct, owner_sig}) + each bid's tlock ct
  const openPlaintexts = []; // the demo's own plaintext copies (fixture `opened[]`; attest derives its own)
  const ptHexOf = (nonceHex, ownerHex, commitmentHex) =>
    bid.buildBidPlaintext({ auction_id: auction1, price_zats: 1000000n, quantity: 1, nonce_hex: nonceHex, owner_public_hex: ownerHex, settlement_commitment_hex: commitmentHex }).toString("hex");
  const tlockHex = async (ptHex) => Buffer.from(armor.decodeArmor(await tlock.timelockEncrypt(R, Buffer.from(ptHex, "hex"), pinnedClient)), "binary").toString("hex");

  for (let i = 0; i < delivers.length; i++) {
    // the shipped bidder-side library (exactly what `bid seal` drives): owner key, deliver payload v2
    // sealed to the manifest's pinned envelope keys, salted commitment, real tlock, owner signature
    const prep = bid.prepareBid({ auction_id: auction1, price_zats: 1000000n, quantity: 1, destination_ua: UA, deliver: delivers[i], envelope_public_hexs: recipients });
    const ctHex = await tlockHex(prep.plaintext_hex);
    const bound = bid.bindSealedBid(prep, auction1, sha256(Buffer.from(ctHex, "hex")));
    records.push({ index: i, ciphertext_hash: bound.ciphertext_hash_hex, envelope_ct: bound.envelope_ct_hex, owner_sig: bound.owner_sig_hex, ct_hex: ctHex });
    openPlaintexts.push(prep.plaintext_hex);
    if (i === 0) {
      const g = envmod.openEnvelopePayload(bound.envelope_ct_hex, envelopeKeys[0].private_hex);
      check("demo-envelope-opens-to-deliver", g.refund === UA && g.deliver?.to === delivers[0].to && sha256(Buffer.from(ctHex, "hex")) === bound.ciphertext_hash_hex,
        `opened ${JSON.stringify(g)} ct_hash ${bound.ciphertext_hash_hex}`);
    }
  }

  // ---- the two hostile-sealer bids: real tlock around a tampered envelope ----
  for (const [idx, payloadText, wrap] of [
    [4, JSON.stringify({ v: 2, refund: UA, deliver: { chain: "evm", kind: "address", to: "0x1234" } }), "shared"],
    [5, JSON.stringify({ v: 2, refund: UA, deliver: { chain: "evm", kind: "address", to: r1 } }), "split"],
  ]) {
    const owner = envmod.generateOwnerKey(), nonce = rndHex(16);
    const sharedKey = sodium.randombytes_buf(32);
    const envCt = hostileEnvelope(payloadText, recipients, wrap === "shared" ? [sharedKey, sharedKey, sharedKey] : [sharedKey, sodium.randombytes_buf(32), sodium.randombytes_buf(32)]);
    const commitment = envmod.settlementCommitment(nonce, envCt);
    const ptHex = ptHexOf(nonce, owner.public_hex, commitment);
    const ctHex = await tlockHex(ptHex);
    const ctHash = sha256(Buffer.from(ctHex, "hex"));
    records.push({ index: idx, ciphertext_hash: ctHash, envelope_ct: envCt, owner_sig: envmod.signEnvelope(owner, auction1, ctHash, envCt), ct_hex: ctHex });
    openPlaintexts.push(ptHex);
  }

  // ---- the published, BLS-verified drand beacon that opens round R (R21: attest decrypts with it) ----
  const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
  if (!beaconRes.ok) throw new Error(`drand HTTP ${beaconRes.status} for round ${R}`);
  const beacon = await beaconRes.json();
  if (beacon.round !== R || !/^[0-9a-f]{96}$/.test(beacon.signature)) throw new Error(`drand round ${R} beacon malformed`);
  check("demo-drand-beacon", true, `round ${R} signature ${beacon.signature.slice(0, 16)}…`);

  // ---- the shipped `benzo bid seal` still seals deliver payload v2 through the real browser sealer ----
  // (its own manifest: `bid seal` refuses to seal after T_submit, and the fixture auction is post-R)
  {
    const RF = R + 100005, RFT = schema.QUICKNET.genesis + (RF - 1) * schema.QUICKNET.period;
    const sealManifest = { ...manifest, auction_id: rndHex(32), drand: { ...schema.QUICKNET, R: RF }, T_submit: RFT - 850, T_freeze: RFT - 100 };
    const sealPacket = schema.signRecord(sealManifest, signerPem);
    const sealManifestFile = path.join(WORK, "manifest-seal.json");
    writeFileSync(sealManifestFile, schema.jsonBytes(sealPacket));
    const input = { price_zats: "1000000", quantity: 1, address: manifest.deposit_addresses[0], refund_ua: UA, deliver: delivers[0] };
    const p = execFileSync("node", [path.join(REPO, "cli/dist/benzo.mjs"), "bid", "seal", "--manifest", sealManifestFile, "--signer", signerHex],
      { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 64 << 20 });
    const sealed = JSON.parse(p.slice(p.indexOf("{")));
    const memo = Buffer.from(sealed.envelope_hex, "hex");
    const g = envmod.openEnvelopePayload(sealed.envelope_ct_hex, envelopeKeys[1].private_hex);
    check("demo-bid-seal-deliver",
      memo.length === 512 && memo.subarray(0, 5).toString("hex") === "ff424e5a02" &&
        g.refund === UA && g.deliver?.to === delivers[0].to &&
        sha256(Buffer.from(memo.subarray(7, 7 + memo.readUInt16BE(5)), "hex")) === sealed.ciphertext_hash,
      `memo ${memo.length}B tag ${memo.subarray(7 + memo.readUInt16BE(5), 7 + memo.readUInt16BE(5) + 18).toString("hex")} opened ${JSON.stringify(g)}`);
  }

  // ---- the published auction directory (R21: attest derives its own openings from this) ----
  const publishedRecords = records.map((r) => ({ ciphertext_hash: r.ciphertext_hash, envelope_ct: r.envelope_ct, owner_sig: r.owner_sig }));
  const leaves = records.map((r, i) => ({
    auction_id: auction1, manifest_hash: checked.manifest_hash, ciphertext_hash: r.ciphertext_hash,
    deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i % 2], diversifier_index: String(i) },
    leaf_index: i, ciphertext_hex: r.ct_hex,
  }));
  const frozenTree = merkle.tree(leaves);
  const frozen = { auction_id: auction1, manifest_hash: checked.manifest_hash, root: frozenTree.root, leaf_count: 6, cutoff: R, published_at: Math.floor(Date.now() / 1000), leaves, paths: frozenTree.paths };
  const doc = {
    version: 1, auction_id: auction1, signer: signerHex, manifest: packet, state: "OPENED", receipts: [],
    frozen, opened: openPlaintexts.map((p, i) => ({ leaf_index: i, plaintext_hex: p })),
    beacon: { round: R, signature: beacon.signature, chain_hash: chainHash },
    envelopes: publishedRecords,
  };
  mkdirSync(PUBDIR, { recursive: true });
  writeFileSync(path.join(PUBDIR, "auction.json"), JSON.stringify(doc, null, 2) + "\n");

  const result = { auction_id: auction1, winners: records.map((_, i) => ({ leaf: i, lot_count: 1 })) };
  const resultFile = path.join(WORK, "result.json");
  writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
  // R14 item 4: the attested result_hash is the product's published result hash (manifest/schema
  // `hash`: sha256 over the raw result.json bytes), so `xchain status --result` ties the escrow's
  // approval to the published file
  const resultHash = "0x" + sha256(readFileSync(resultFile));

  // R21 repro material: an operator-fabricated "opened bid" whose commitment matches its OWN attacker
  // envelope (a valid deliver pointing at the attacker) — self-consistent, but it is not the bid the
  // frozen leaf's ciphertext opens to. The attacked directory is what post-R21 attest sees; the
  // records-*.json files are the pre-R21 `--envelopes` input shape (the harness runs both interfaces,
  // so the same demo run is the before/after proof of the R21 fix).
  const attackerOwner = envmod.generateOwnerKey();
  const attackerNonce = rndHex(16);
  const attackerEnvCt = hostileEnvelope(JSON.stringify({ v: 2, refund: UA, deliver: { chain: "evm", kind: "address", to: attacker } }), recipients,
    [sodium.randombytes_buf(32), sodium.randombytes_buf(32), sodium.randombytes_buf(32)]);
  const attackerCommitment = envmod.settlementCommitment(attackerNonce, attackerEnvCt);
  const fabricatedPt = ptHexOf(attackerNonce, attackerOwner.public_hex, attackerCommitment);
  const attackerRecord = { index: 0, ciphertext_hash: records[0].ciphertext_hash, envelope_ct: attackerEnvCt,
    owner_sig: envmod.signEnvelope(attackerOwner, auction1, records[0].ciphertext_hash, attackerEnvCt), ct_hex: records[0].ct_hex };
  writeFileSync(path.join(WORK, "attack.json"), JSON.stringify({
    attacker, fabricated_plaintext_hex: fabricatedPt, attacker_record: attackerRecord,
    envelope_keys: recipients,
    records: records.map((r) => ({ index: r.index, opened_bid_hex: openPlaintexts[r.index], ciphertext_hash: r.ciphertext_hash, envelope_ct: r.envelope_ct, owner_sig: r.owner_sig })),
  }, null, 2) + "\n");
  const recordFile = (name, mutate) => {
    const leaves = records.map((r, i) => ({ index: i, opened_bid_hex: openPlaintexts[i], owner_sig: r.owner_sig, envelope_ct: r.envelope_ct }));
    writeFileSync(path.join(WORK, `records-${name}.json`), JSON.stringify({ envelope_keys: recipients, leaves: mutate ? mutate(leaves) : leaves }, null, 2) + "\n");
  };
  recordFile("pub");
  recordFile("attacked", (leaves) => leaves.map((l) => (l.index === 0
    ? { index: 0, opened_bid_hex: fabricatedPt, owner_sig: attackerRecord.owner_sig, envelope_ct: attackerRecord.envelope_ct } : l)));
  recordFile("substituted", (leaves) => leaves.map((l) => (l.index === 0
    ? { index: 0, opened_bid_hex: l.opened_bid_hex, owner_sig: records[4].owner_sig, envelope_ct: records[4].envelope_ct } : l)));

  // the operator's OLD allocation file, naming the attacker address (R19 item 3 fixture): attest must
  // ignore it entirely — and the flag it was passed with is removed and refused
  const allocationFile = path.join(WORK, "allocation-attacker.json");
  writeFileSync(allocationFile, JSON.stringify({
    standard_lot: "1",
    leaves: [0, 1, 2].map((index) => ({ index, lot_count: 1, destination_kind: 1, destination: attacker })),
  }, null, 2) + "\n");

  const now = Math.floor(Date.now() / 1000);
  const lockUntil = now + 600, deadline = now + 3600;
  const evmSellerKeyFile = path.join(KEYDIR, "evm-seller.key");
  writeFileSync(evmSellerKeyFile, ANVIL_SK, { mode: 0o600 });
  const solReturn = Keypair.generate().publicKey; // refund address distinct from the fee payer

  // deploy the EVM escrow from the Foundry artifact (forge create is a shipped tool)
  const artifact = JSON.parse(readFileSync(path.join(REPO, "contracts/evm/out/BenzoEscrow.sol/BenzoEscrow.json"), "utf8"));
  const escrowEvm = execFileSync("forge", [
    "create", "src/BenzoEscrow.sol:BenzoEscrow", "--root", path.join(REPO, "contracts/evm"),
    "--rpc-url", EVM_RPC, "--private-key", ANVIL_SK, "--json", "--broadcast",
  ], { cwd: REPO, encoding: "utf8" });
  const evmEscrowAddr = JSON.parse(escrowEvm).deployedTo;
  check("demo-evm-escrow-deployed", /^0x[0-9a-fA-F]{40}$/.test(evmEscrowAddr), `forge create gave ${escrowEvm.slice(0, 120)}`);
  check("demo-evm-artifact-present", Array.isArray(artifact.abi), "artifact ABI missing");

  // ---- 1. lock on both chains (the demo sells the native asset on both: 2 lots each) ----
  {
    const r = benzoXchain(["lock", "--chain", "evm", "--auction", "0x" + auction1,
      "--amount", (2n * parseEther("1")).toString(), "--lot", parseEther("1").toString(),
      "--lock-until", String(lockUntil), "--deadline", String(deadline),
      "--signers", evmSignersFile, "--return", evmSeller.address, "--key", evmSellerKeyFile,
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC]);
    if (r.code !== 0 || !jsonOut(r).tx) fail("demo-lock-evm", r.stderr || r.stdout.slice(0, 200));
    else pass("demo-lock-evm");
  }
  {
    const r = benzoXchain(["lock", "--chain", "solana", "--auction", "0x" + auction1,
      "--amount", String(2 * LAMPORTS_PER_SOL), "--lot", String(1 * LAMPORTS_PER_SOL),
      "--lock-until", String(lockUntil), "--deadline", String(deadline),
      "--signers", solSignersFile, "--return", solPayer.publicKey.toBase58(), "--key", solPayerFile,
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC]);
    if (r.code !== 0 || !jsonOut(r).tx) fail("demo-lock-solana", r.stderr || r.stdout.slice(0, 200));
    else pass("demo-lock-solana");
  }

  // ---- 2. attest (2-of-3 per chain): openings derived from --dir, destinations from the envelopes ----
  const bundleEvm = path.join(WORK, "bundle-evm.json"), bundleSol = path.join(WORK, "bundle-solana.json");
  const ZERO_ASSET = "0x0000000000000000000000000000000000000000"; // both demo auctions lock the native asset
  // one arg builder: the CLI parser collects repeated flags into arrays, so overrides REPLACE values.
  // The harness runs the shipped CLI whichever interface it speaks (R21 changed it from `--envelopes`
  // with operator-supplied openings to `--dir` with self-derived openings): the same demo is therefore
  // the before/after proof of the R21 fix.
  const xchainHelp = (() => { const r = benzoXchain([]); return r.stderr + r.stdout; })();
  const oldInterface = xchainHelp.includes("--envelopes FILE");
  const attestArgs = (over = {}) => [
    "--auction", "0x" + auction1, "--result", resultFile, "--result-hash", over.resultHash ?? resultHash,
    "--batch", "0", "--nonce", "0", "--expiry", String(over.expiry ?? now + 3600),
    ...(over.asset === "omit" ? [] : ["--asset", over.asset ?? ZERO_ASSET]),
    ...(oldInterface
      ? ["--envelopes", path.join(WORK, `records-${over.records ?? "pub"}.json`)]
      : ["--dir", over.dir ?? PUBDIR]),
    ...(over.envelopeKeys ?? envelopeKeyFiles).flatMap((f) => ["--envelope-key", f]),
  ];
  {
    const r = benzoXchain(["attest", "--chain", "evm", ...attestArgs(),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", bundleEvm]);
    const rs = benzoXchain(["attest", "--chain", "solana", ...attestArgs(),
      "--signer-key", solSignerFiles[0], "--signer-key", solSignerFiles[2],
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--out", bundleSol]);
    const bE = JSON.parse(readFileSync(bundleEvm, "utf8")), bS = JSON.parse(readFileSync(bundleSol, "utf8"));
    check("demo-attest-both-chains",
      r.code === 0 && rs.code === 0 && bE.allocation_root === bS.allocation_root && bE.signatures.length === 2 && bS.signatures.length === 2 &&
        bE.leaves.length === 4 && bS.leaves.length === 4 &&
        bE.result_hash.replace(/^0x/, "") === resultHash.replace(/^0x/, "") && bS.result_hash.replace(/^0x/, "") === resultHash.replace(/^0x/, ""),
      `evm rc=${r.code} sol rc=${rs.code} roots ${bE.allocation_root} / ${bS.allocation_root} leaves ${bE.leaves.length}/${bS.leaves.length}`);
  }

  // R19 item 3: the operator's old allocation file names an attacker address — the attest output
  // ignores it. The flags it was passed with are removed and refused loudly (R19 and R21).
  {
    const r = benzoXchain(["attest", "--chain", "evm", "--allocation", allocationFile, ...attestArgs(),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-alloc-refused.json")]);
    check("demo-attest-allocation-refused",
      r.code !== 0 && /--allocation is removed/.test(r.stderr), `rc=${r.code}: ${(r.stderr || "").slice(0, 160)}`);
    const re = benzoXchain(["attest", "--chain", "evm", "--envelopes", path.join(WORK, "attack.json"), ...attestArgs(),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-envelopes-refused.json")]);
    check("demo-attest-envelopes-refused",
      re.code !== 0 && /--envelopes is removed/.test(re.stderr), `rc=${re.code}: ${(re.stderr || "").slice(0, 160)}`);
    const bE = JSON.parse(readFileSync(bundleEvm, "utf8"));
    const dests = Object.fromEntries(bE.leaves.map((l) => [l.index, l.destination]));
    const all = JSON.stringify(bE).toLowerCase();
    check("demo-attest-destinations-from-envelope",
      dests[0] === r1 && dests[1] === s1 && dests[2] === s2 &&
        /^0x[0-9a-fA-F]{40}$/.test(dests[3]) && dests[3].toLowerCase() !== metaAddress.toLowerCase() &&
        !all.includes(attacker.toLowerCase()),
      `destinations ${JSON.stringify(dests)}, attacker ${attacker} in bundle: ${all.includes(attacker.toLowerCase())}`);
  }

  // R19 item 3: a winner whose envelope's deliver.to is malformed lands in the exception queue
  {
    const bE = JSON.parse(readFileSync(bundleEvm, "utf8"));
    const ex = bE.exceptions.find((x) => x.index === 4);
    check("demo-attest-malformed-deliver-exception",
      ex !== undefined && /malformed deliver/.test(ex.reason) && bE.leaves.every((l) => l.index !== 4),
      `exceptions ${JSON.stringify(bE.exceptions)}, leaves ${bE.leaves.map((l) => l.index)}`);
    const bS = JSON.parse(readFileSync(bundleSol, "utf8"));
    check("demo-attest-malformed-deliver-exception-both-chains",
      bS.exceptions.some((x) => x.index === 4 && /malformed deliver/.test(x.reason)) && bS.leaves.every((l) => l.index !== 4),
      `solana exceptions ${JSON.stringify(bS.exceptions)}`);
  }

  // R10 attack at the attest layer: a split-key hostile envelope only one signer can open is never
  // attested — at least 2 signers must agree on SHA-256(deliver) (R19 item 2)
  {
    const bE = JSON.parse(readFileSync(bundleEvm, "utf8"));
    const ex = bE.exceptions.find((x) => x.index === 5);
    check("demo-attest-no-agreement-exception",
      ex !== undefined && /signers could not agree/.test(ex.reason) && bE.leaves.every((l) => l.index !== 5),
      `exceptions ${JSON.stringify(bE.exceptions)}, leaves ${bE.leaves.map((l) => l.index)}`);
  }

  // R21: an operator-fabricated "opened bid" + attacker envelope (self-consistent: the fabricated
  // plaintext's commitment matches the attacker envelope and its owner_sig verifies against the
  // fabricated owner key) can never ride leaf 0 — attest opens the FROZEN LEAF'S OWN ciphertext and
  // finds no owner-signed record for it.
  {
    const attacked = JSON.parse(readFileSync(path.join(PUBDIR, "auction.json"), "utf8"));
    attacked.envelopes = attacked.envelopes.map((e) => (e.ciphertext_hash === records[0].ciphertext_hash
      ? { ciphertext_hash: attackerRecord.ciphertext_hash, envelope_ct: attackerRecord.envelope_ct, owner_sig: attackerRecord.owner_sig }
      : e));
    const attackedDir = path.join(WORK, "public-attacked");
    mkdirSync(attackedDir, { recursive: true });
    writeFileSync(path.join(attackedDir, "auction.json"), JSON.stringify(attacked, null, 2) + "\n");
    const r = benzoXchain(["attest", "--chain", "evm", ...attestArgs({ dir: attackedDir, records: "attacked" }),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-fabricated.json")]);
    const b = JSON.parse(readFileSync(path.join(WORK, "bundle-fabricated.json"), "utf8"));
    const ex = b.exceptions.find((x) => x.index === 0);
    check("demo-attest-fabricated-opening-exception",
      r.code === 0 && ex !== undefined && /no valid owner-signed settlement envelope/.test(ex.reason) &&
        b.leaves.every((l) => l.index !== 0) && !JSON.stringify(b).toLowerCase().includes(attacker.toLowerCase()),
      `rc=${r.code} exceptions ${JSON.stringify(b.exceptions)}`);
  }

  // an operator-substituted record (winner 0's leaf slot carrying winner 4's REAL owner-signed envelope)
  // cannot ride the leaf either: the record must verify against this bid's own opening
  {
    const sub = JSON.parse(readFileSync(path.join(PUBDIR, "auction.json"), "utf8"));
    sub.envelopes = sub.envelopes.map((e) => (e.ciphertext_hash === records[0].ciphertext_hash
      ? { ciphertext_hash: records[0].ciphertext_hash, envelope_ct: records[4].envelope_ct, owner_sig: records[4].owner_sig }
      : e));
    const subDir = path.join(WORK, "public-substituted");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, "auction.json"), JSON.stringify(sub, null, 2) + "\n");
    const r = benzoXchain(["attest", "--chain", "evm", ...attestArgs({ dir: subDir, records: "substituted" }),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-substituted.json")]);
    const b = JSON.parse(readFileSync(path.join(WORK, "bundle-substituted.json"), "utf8"));
    const ex = b.exceptions.find((x) => x.index === 0);
    check("demo-attest-substituted-envelope-exception",
      r.code === 0 && ex !== undefined && /no valid owner-signed settlement envelope|envelope not bound to the opened bid/.test(ex.reason) && b.leaves.every((l) => l.index !== 0),
      `rc=${r.code} exceptions ${JSON.stringify(b.exceptions)}`);
  }

  // R17 item 4: the result hash is recomputed from the --result bytes and the leaves derive from that
  // result; a mismatching --result-hash is refused before any key is read or chain touched
  {
    const r = benzoXchain(["attest", "--chain", "evm", ...attestArgs({ resultHash: "0x" + "00".repeat(32) }),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-rh-mismatch.json")]);
    check("demo-attest-result-hash-mismatch-refused",
      r.code !== 0 && /mismatching --result-hash/.test(r.stderr), `rc=${r.code}: ${(r.stderr || "").slice(0, 160)}`);
  }

  // §10 F-2 at the signer tool: signers must attest expiry <= deadline — refused before signing
  {
    const re = benzoXchain(["attest", "--chain", "evm", ...attestArgs({ expiry: deadline + 10 }),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-refused-evm.json")]);
    const rs = benzoXchain(["attest", "--chain", "solana", ...attestArgs({ expiry: deadline + 10 }),
      "--signer-key", solSignerFiles[0], "--signer-key", solSignerFiles[2],
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--out", path.join(WORK, "bundle-refused-sol.json")]);
    check("demo-attest-expiry-past-deadline-refused",
      re.code !== 0 && rs.code !== 0 &&
        /must be <= the auction deadline/.test(re.stderr) && /must be <= the auction deadline/.test(rs.stderr),
      `evm rc=${re.code} sol rc=${rs.code}: ${(re.stderr || rs.stderr || "").slice(0, 160)}`);
  }

  // R9 item 2: the asset is read from the escrow state on chain — a missing or mismatching
  // --asset is refused before any signing; there is never a silent default
  {
    const wrongAsset = "0x1111111111111111111111111111111111111111";
    const noAsset = attestArgs({ asset: "omit" });
    const missE = benzoXchain(["attest", "--chain", "evm", ...noAsset, "--signer-key", evmSignerFiles[0],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-asset-missing.json")]);
    const missS = benzoXchain(["attest", "--chain", "solana", ...noAsset, "--signer-key", solSignerFiles[0],
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--out", path.join(WORK, "bundle-asset-missing-sol.json")]);
    const wrongE = benzoXchain(["attest", "--chain", "evm", ...attestArgs({ asset: wrongAsset }), "--signer-key", evmSignerFiles[0],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-asset-wrong.json")]);
    const wrongS = benzoXchain(["attest", "--chain", "solana", ...attestArgs({ asset: wrongAsset }), "--signer-key", solSignerFiles[0],
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--out", path.join(WORK, "bundle-asset-wrong-sol.json")]);
    check("demo-attest-asset-missing-refused",
      missE.code !== 0 && missS.code !== 0 && /--asset is required/.test(missE.stderr) && /--asset is required/.test(missS.stderr),
      `evm rc=${missE.code} sol rc=${missS.code}: ${(missE.stderr || missS.stderr || "").slice(0, 160)}`);
    check("demo-attest-asset-mismatch-refused",
      wrongE.code !== 0 && wrongS.code !== 0 && /does not match the escrow's asset/.test(wrongE.stderr) && /does not match the escrow's asset/.test(wrongS.stderr),
      `evm rc=${wrongE.code} sol rc=${wrongS.code}: ${(wrongE.stderr || wrongS.stderr || "").slice(0, 160)}`);
  }

  // ---- 3. release: each chain pays its leaves (one delivery of the cleared drop) ----
  {
    const bE = JSON.parse(readFileSync(bundleEvm, "utf8"));
    const stealthDest = bE.leaves.find((l) => l.index === 3).destination;
    const r1BalBefore = await evmBalance(evm, r1), stBalBefore = await evmBalance(evm, stealthDest);
    const escrowBefore = await evmBalance(evm, evmEscrowAddr);
    const r = benzoXchain(["release", "--chain", "evm", "--bundle", bundleEvm, "--key", evmSellerKeyFile,
      "--rpc", EVM_RPC, "--only", "0,3"]);
    const r1BalAfter = await evmBalance(evm, r1), stBalAfter = await evmBalance(evm, stealthDest);
    const escrowAfter = await evmBalance(evm, evmEscrowAddr);
    // the PayoutPaid events are the escrow's own record of delivery; assert they name the destinations
    let paid = [];
    if (r.code === 0) {
      const receipt = await evm.getTransactionReceipt(jsonOut(r).tx);
      const iface = new Interface(artifact.abi);
      for (const log of receipt.logs) {
        try { const p = iface.parseLog(log); if (p?.name === "PayoutPaid") paid.push(p.args); } catch { /* other logs */ }
      }
    }
    const evNames = paid.map((p) => p.recipient.toLowerCase()).sort();
    check("demo-release-evm-delivers",
      r.code === 0 && r1BalAfter - r1BalBefore === parseEther("1") && stBalAfter - stBalBefore === parseEther("1") &&
      escrowBefore - escrowAfter === 2n * parseEther("1") &&
      JSON.stringify(evNames) === JSON.stringify([r1.toLowerCase(), stealthDest.toLowerCase()].sort()),
      `rc=${r.code}, events=${JSON.stringify(evNames)}, r1 delta ${formatEther(r1BalAfter - r1BalBefore)} ETH, stealth ${stealthDest} delta ${formatEther(stBalAfter - stBalBefore)} ETH, escrow delta ${formatEther(escrowAfter - escrowBefore)} ETH (want -2): ${r.stderr || r.stdout.slice(0, 120)}`);
  }
  {
    const s1Before = await sol.getBalance(new PublicKey(s1)), s2Before = await sol.getBalance(new PublicKey(s2));
    const r = benzoXchain(["release", "--chain", "solana", "--bundle", bundleSol, "--key", solPayerFile,
      "--rpc", SOL_RPC, "--only", "1,2"]);
    const s1After = await sol.getBalance(new PublicKey(s1)), s2After = await sol.getBalance(new PublicKey(s2));
    check("demo-release-solana-delivers",
      r.code === 0 && s1After - s1Before === LAMPORTS_PER_SOL && s2After - s2Before === LAMPORTS_PER_SOL,
      `rc=${r.code}, s1 +${s1After - s1Before} s2 +${s2After - s2Before} lamports (want ${LAMPORTS_PER_SOL}): ${r.stderr || r.stdout.slice(0, 160)}`);
  }

  // ---- 4. status: escrow state matches the attested root (each chain paid exactly its leaves) ----
  {
    const re = benzoXchain(["status", "--chain", "evm", "--auction", "0x" + auction1, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--bundle", bundleEvm]);
    const rs = benzoXchain(["status", "--chain", "solana", "--auction", "0x" + auction1, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--bundle", bundleSol]);
    const stE = jsonOut(re).auction, stS = jsonOut(rs).auction;
    const evmPaidCount = Object.values(stE.paidLeaves).filter(Boolean).length;
    const solPaidCount = Object.values(stS.paidLeaves).filter(Boolean).length;
    check("demo-status-matches-attested-root",
      re.code === 0 && rs.code === 0 && evmPaidCount === 2 && solPaidCount === 2 &&
      stE.paid === (2n * parseEther("1")).toString() && stS.paid === String(2 * LAMPORTS_PER_SOL),
      `evm paid ${stE.paid} (${evmPaidCount}/4 leaves), sol paid ${stS.paid} (${solPaidCount}/4 leaves)`);
  }

  // ---- 4b. R14 item 4: status ties the approved resultHash to the published result.json hash ----
  {
    const re = benzoXchain(["status", "--chain", "evm", "--auction", "0x" + auction1, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--bundle", bundleEvm, "--result", resultFile]);
    const rs = benzoXchain(["status", "--chain", "solana", "--auction", "0x" + auction1, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--bundle", bundleSol, "--result", resultFile]);
    const rhE = jsonOut(re).result_hash, rhS = jsonOut(rs).result_hash;
    check("demo-status-result-hash-matches-published",
      re.code === 0 && rs.code === 0 && rhE && rhE.match === true && rhS && rhS.match === true,
      `evm rc=${re.code} ${JSON.stringify(rhE)}, sol rc=${rs.code} ${JSON.stringify(rhS)}`);
    // a doctored published result must be refused loudly: exit 1 with the specific mismatch
    const doctoredFile = path.join(WORK, "result-doctored.json");
    writeFileSync(doctoredFile, JSON.stringify({ ...result, tampered: true }, null, 2) + "\n");
    const re2 = benzoXchain(["status", "--chain", "evm", "--auction", "0x" + auction1, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--bundle", bundleEvm, "--result", doctoredFile]);
    const rs2 = benzoXchain(["status", "--chain", "solana", "--auction", "0x" + auction1, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--bundle", bundleSol, "--result", doctoredFile]);
    check("demo-status-result-hash-mismatch-refused",
      re2.code !== 0 && rs2.code !== 0 && /result hash mismatch/.test(re2.stderr) && /result hash mismatch/.test(rs2.stderr),
      `evm rc=${re2.code} sol rc=${rs2.code}: ${(re2.stderr || rs2.stderr || "").slice(0, 160)}`);
  }

  // ---- replay of a used batch is refused on both chains (specific errors) ----
  {
    // replay = resubmitting the attestation for a used (auction_id, batch_index) — refused on
    // chain both chains (R9 item 3 / §9): the approval is stored exactly once per batch
    const batchReplayedSel = "0x" + Buffer.from(keccak_256(Buffer.from("BatchReplayed()"))).toString("hex").slice(0, 8);
    const r = benzoXchain(["release", "--chain", "evm", "--bundle", bundleEvm, "--key", evmSellerKeyFile, "--rpc", EVM_RPC, "--submit-only"]);
    const rs = benzoXchain(["release", "--chain", "solana", "--bundle", bundleSol, "--key", solPayerFile, "--rpc", SOL_RPC, "--submit-only"]);
    const evmSays = (r.stderr + r.stdout).includes(batchReplayedSel);
    const solSays = (rs.stderr + rs.stdout).includes("custom program error: 0x9"); // BatchReplayed
    check("demo-replay-refused", evmSays && solSays,
      `evm rc=${r.code} batchReplayed=${evmSays}, sol rc=${rs.code} batchReplayed=${solSays}`);
  }

  // ---- 5. cancelled auction: lock, wait past deadline, refund to the seller on both chains ----
  const auction2 = hex32(randomBytes(32));
  {
    const t = Math.floor(Date.now() / 1000);
    const rl = benzoXchain(["lock", "--chain", "evm", "--auction", auction2,
      "--amount", parseEther("1").toString(), "--lot", parseEther("1").toString(),
      "--lock-until", String(t + 10), "--deadline", String(t + 10),
      "--signers", evmSignersFile, "--return", evmSeller.address, "--key", evmSellerKeyFile,
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC]);
    const rls = benzoXchain(["lock", "--chain", "solana", "--auction", auction2,
      "--amount", String(1 * LAMPORTS_PER_SOL), "--lot", String(1 * LAMPORTS_PER_SOL),
      "--lock-until", String(t + 10), "--deadline", String(t + 10),
      "--signers", solSignersFile, "--return", solReturn.toBase58(), "--key", solPayerFile,
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC]);
    check("demo-cancel-lock-both", rl.code === 0 && rls.code === 0, `evm rc=${rl.code} sol rc=${rls.code}`);

    // before the deadline the refund is refused with each chain's BeforeDeadline error
    const rb = benzoXchain(["refund", "--chain", "evm", "--auction", auction2, "--key", evmSellerKeyFile, "--rpc", EVM_RPC, "--escrow", evmEscrowAddr]);
    const rbs = benzoXchain(["refund", "--chain", "solana", "--auction", auction2, "--key", solPayerFile, "--rpc", SOL_RPC, "--escrow", SOL_PROGRAM]);
    const beforeSel = "0x" + Buffer.from(keccak_256(Buffer.from("BeforeDeadline()"))).toString("hex").slice(0, 8);
    const evmSays = (rb.stderr + rb.stdout).includes(beforeSel);
    const solSays = (rbs.stderr + rbs.stdout).includes("custom program error: 0x10"); // BeforeDeadline
    check("demo-refund-before-deadline-refused", evmSays && solSays,
      `evm rc=${rb.code} beforeDeadline=${evmSays}, sol rc=${rbs.code} beforeDeadline=${solSays}`);

    // pass the deadline: anvil by time warp, the Solana validator by its own clock
    execFileSync("cast", ["rpc", "--rpc-url", EVM_RPC, "evm_increaseTime", "30"], { stdio: "pipe" });
    execFileSync("cast", ["rpc", "--rpc-url", EVM_RPC, "evm_mine"], { stdio: "pipe" });
    const deadlineS = t + 10;
    for (let i = 0; i < 120; i++) {
      const t = await sol.getBlockTime(await sol.getSlot());
      if (t > deadlineS) break;
      if (i === 119) throw new Error("timed out waiting for the Solana clock");
      await new Promise((r) => setTimeout(r, 400));
    }

    const sBefore = await sol.getBalance(solReturn);
    const rr = benzoXchain(["refund", "--chain", "evm", "--auction", auction2, "--key", evmSellerKeyFile, "--rpc", EVM_RPC, "--escrow", evmEscrowAddr]);
    const rrs = benzoXchain(["refund", "--chain", "solana", "--auction", auction2, "--key", solPayerFile, "--rpc", SOL_RPC, "--escrow", SOL_PROGRAM]);
    const sAfter = await sol.getBalance(solReturn);
    const stE = jsonOut(benzoXchain(["status", "--chain", "evm", "--auction", auction2, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC])).auction;
    const stS = jsonOut(benzoXchain(["status", "--chain", "solana", "--auction", auction2, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC])).auction;
    check("demo-refund-after-deadline-returns", rr.code === 0 && rrs.code === 0 &&
      sAfter - sBefore === LAMPORTS_PER_SOL && stE.refunded === true && stS.refunded === true,
      `evm rc=${rr.code} refunded=${stE.refunded}, sol rc=${rrs.code} refunded=${stS.refunded} delta +${sAfter - sBefore} (want ${LAMPORTS_PER_SOL})`);
  }

  console.log(failures === 0
    ? "RESULT PASS one cleared drop delivered end to end locally on both chains"
    : `RESULT FAIL ${failures} demo assertion(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`ERROR demo ${e.message}`);
  process.exitCode = 1;
});
