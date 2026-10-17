#!/usr/bin/env node
// Cross-chain signer-host demo — part 2 §2 items (a)-(c) proven on local chains (docs/design/crosschain.md §1,
// Ruling R28). THREE LOCAL SIGNER STATE DIRS stand in for the signer hosts (BNZ_STATE_DIR per signer:
// $BNZ_STATE_DIR/xchain-hosts/{alice,bob,carol}, plus eve as a third party).
//
// Test-audit answers:
// 1. Behaviour protected (R28 + crosschain §1): each signer host generates its OWN cross-chain key (printed
//    public part only), each host's `xchain attest --host-record` derives every leaf's opening and destination
//    itself from the published dir + its own envelope key (R21/R22/R19), and the coordinator's
//    `xchain release --attestation` pays only from 2 host records over the IDENTICAL attestation bytes, from
//    distinct signers of the escrow's pinned set — no destination and no signature ever comes from the
//    coordinator.
// 2. Credible regression: the collection path trusting one record, any signature, or a coordinator-supplied
//    destination (e.g. the pinned-set membership check dropped, or release rebuilt from operator files).
// 3. No existing test catches it: crosschain/local-demo.mjs drives one operator process holding every key
//    (multi-key attest + --bundle release); the host-record flow and its coordinator-side collection are new.
// 4. Production seam: none — every step drives the shipped `benzo xchain`/`benzo sign` CLI with real
//    BNZ_STATE_DIR state dirs against real local chains (anvil + solana-test-validator running the built
//    program); the fixture is a real tlock-sealed, drand-BLS-verified published auction directory.
//
// Output: `PASS host-<id>` / `ERROR host-<id> <reason>` lines; exit 0 only if all PASS.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { JsonRpcProvider, Wallet, parseEther, verifyTypedData } from "ethers";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { pathToFileURL } from "node:url";

const REPO = process.env.BNZ_REPO_ROOT ?? process.cwd();
const STATE = process.env.BNZ_STATE_DIR ?? path.join(REPO, ".benzo");
const HOSTROOT = path.join(STATE, "xchain-hosts"); // each subdirectory is one signer's BNZ_STATE_DIR
const WORK = path.join(REPO, "tmp/host-attest-demo");
const PUBDIR = path.join(WORK, "public");
const EVM_RPC = process.env.BNZ_EVM_RPC ?? "http://127.0.0.1:8547";
const SOL_RPC = `http://127.0.0.1:${process.env.BNZ_SOLANA_TEST_RPC_PORT ?? 8902}`;
const SOL_PROGRAM = process.env.BNZ_SOLANA_PROGRAM ?? "";
const ANVIL_SK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil dev account 0 (public)
const ZERO = "0x0000000000000000000000000000000000000000"; // both demo auctions lock the native asset
const HOSTS = ["alice", "bob", "carol"];
// a real shielded testnet UA (official zcash-test-vectors unified_address rows) — the mandatory refund
// inside every winner's envelope payload
const UA = "utest1nqaarlf8ehmtateefnysz3a6mxvtl39cgvtmj68ngj9266vtk7efr936qp67cz4aywuy4cqss3pfu870hxmkruhmrzgetw2jq7dle6lvzrgsrckh2ugw4fehsyd7j66sy67x84hylx5rjg47qnkzztwf9zvce9v6je7ngd6j8mjh44knm2kj7u6c67nv20dk6hkhsfugd5t7jqlkjfm";

rmSync(WORK, { recursive: true, force: true }); // never read a stale artifact from an earlier run
mkdirSync(WORK, { recursive: true });
// fresh stand-in host state dirs per run (demo key material only, under $BNZ_STATE_DIR)
rmSync(HOSTROOT, { recursive: true, force: true });
for (const n of ["alice", "bob", "carol", "eve"]) mkdirSync(path.join(HOSTROOT, n), { recursive: true, mode: 0o700 });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR host-${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(`host-${id}`) : fail(id, reason));
const hex32 = (b) => "0x" + Buffer.from(b).toString("hex");
const rndHex = (n) => randomBytes(n).toString("hex");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const hexToBytes = (h) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g) ?? [], (b) => parseInt(b, 16));

// Every step drives the shipped CLI from the working tree; per-signer runs get their own BNZ_STATE_DIR.
function benzo(args, stateDir) {
  try {
    const out = execFileSync("node", [path.join(REPO, "cli/dist/benzo.mjs"), ...args], {
      cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20,
      env: { ...process.env, ...(stateDir ? { BNZ_STATE_DIR: stateDir } : {}) },
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
const lastJson = (r) => JSON.parse(r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1));
const hostDir = (n) => path.join(HOSTROOT, n);

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
    'export * as wit from "../../witness";',
    'export * as att from "../../crosschain/attestation";',
    'export * as tlock from "tlock-js";',
    'export * as armor from "tlock-js/age/armor";',
    "",
  ].join("\n"));
  execFileSync(path.join(REPO, "node_modules/.bin/esbuild"), [
    path.join(WORK, "env-entry.mjs"), "--bundle", "--platform=node", "--format=esm",
    "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
    "--outfile=" + path.join(WORK, "env-lib.mjs"), "--log-level=warning",
  ], { cwd: REPO });
  const { bid, schema, merkle, reg, wit, att, tlock, armor } = await import(pathToFileURL(path.join(WORK, "env-lib.mjs")).href);

  // ---- (a) `benzo xchain keygen` ON each host: its own key, 0600, never replaced, public part only ----
  const xkey = (dir, chain, name) => path.join(dir, "xchain", `${chain}-${name}.key`);
  const keygenStdout = [];
  for (const chain of ["evm", "solana"]) {
    const pubs = {};
    for (const name of [...HOSTS, "eve"]) {
      const dir = hostDir(name);
      const r = benzo(["xchain", "keygen", "--chain", chain, "--name", name], dir);
      keygenStdout.push(r.stdout);
      const f = xkey(dir, chain, name);
      const out = (() => { try { return lastJson(r); } catch { return null; } })();
      const secret = existsSync(f) ? readFileSync(f, "utf8").trim() : "";
      const derived = chain === "evm"
        ? (secret ? new Wallet("0x" + secret).address : "")
        : (secret ? new PublicKey(ed25519.getPublicKey(hexToBytes(secret))).toBase58() : "");
      check(`keygen-${chain}-${name}`,
        r.code === 0 && out?.chain === chain && out?.name === name && typeof out?.public === "string"
          && out.public === derived && (statSync(f).mode & 0o777) === 0o600 && secret.length === 64,
        `rc=${r.code} out=${JSON.stringify(out)} derived=${derived} mode=${(statSync(f).mode & 0o777).toString(8)}`);
      pubs[name] = out?.public ?? "";
    }
    const before = readFileSync(xkey(hostDir("alice"), chain, "alice"), "utf8");
    const again = benzo(["xchain", "keygen", "--chain", chain, "--name", "alice"], hostDir("alice"));
    check(`keygen-${chain}-refuses-overwrite`,
      again.code !== 0 && /refusing to replace/.test(again.stderr) && readFileSync(xkey(hostDir("alice"), chain, "alice"), "utf8") === before,
      `rc=${again.code}: ${(again.stderr || "").slice(0, 120)}`);
    // one capture per chain for the lock's signer set
    writeFileSync(path.join(WORK, `keygen-${chain}-pubs.json`), JSON.stringify(pubs, null, 2) + "\n");
  }
  {
    const everySecret = [...HOSTS, "eve"].flatMap((name) => ["evm", "solana"].map((chain) => readFileSync(xkey(hostDir(name), chain, name), "utf8").trim()));
    check("keygen-no-secret-printed",
      everySecret.every((s) => s.length === 64 && !keygenStdout.some((o) => o.includes(s))) && keygenStdout.every((o) => o.includes("public")),
      "a keygen stdout carried key material or no public part");
  }

  // ---- each host's own envelope key (the shipped `sign envelope-key`, private half stays on the host) ----
  const envPub = {}, envFile = (n) => path.join(hostDir(n), "signers", n, "envelope-key.json");
  for (const n of HOSTS) {
    const r = benzo(["sign", "envelope-key", "--name", n], hostDir(n));
    const out = lastJson(r);
    envPub[n] = out.public_hex;
    check(`envelope-key-${n}`, r.code === 0 && /^[0-9a-f]{64}$/.test(out.public_hex) && (statSync(envFile(n)).mode & 0o777) === 0o600 && !r.stdout.includes(JSON.parse(readFileSync(envFile(n), "utf8")).private_hex),
      `rc=${r.code} out=${JSON.stringify(out)}`);
  }

  // ---- the published auction directory: two REAL tlock-sealed bids around a real drand quicknet beacon ----
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
  const witnessKeys = [wit.generateWitnessKey(), wit.generateWitnessKey(), wit.generateWitnessKey()];
  const witnessSet = { version: 1, auction_id: auction1, q_w: 2, keys: witnessKeys.map((k) => k.public_hex) };
  const witnessPacket = schema.signRecord(witnessSet, signerPem);
  const manifest = {
    version: 1, network: "test", auction_id: auction1,
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "host-attest demo lot", supply: 2,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "500000", q_max: 1,
    C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R },
    T_submit: RT - 850, T_freeze: RT - 100, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: HOSTS.map((n) => envPub[n]),
    witness_set_hash: wit.witnessSetHash(witnessPacket),
  };
  const packet = schema.signRecord(manifest, signerPem);
  const checked = reg.clientForMode(packet, signerHex);
  if (checked.manifest.auction_id !== auction1) throw new Error("signed manifest did not validate");

  // fresh winner addresses — sealed in the bids' envelopes, readable only with the hosts' envelope keys
  const r1 = Wallet.createRandom().address;
  const s1 = Keypair.generate().publicKey.toBase58();
  const delivers = [{ chain: "evm", kind: "address", to: r1 }, { chain: "solana", kind: "address", to: s1 }];
  const pinnedInfo = {
    public_key: schema.QUICKNET.public_key, period: schema.QUICKNET.period, genesis_time: schema.QUICKNET.genesis,
    hash: chainHash, groupHash: "", schemeID: schema.QUICKNET.scheme, metadata: { beaconID: "quicknet" },
  };
  const pinnedClient = { chain: () => ({ info: async () => pinnedInfo }) };
  const records = [], openPlaintexts = [];
  for (let i = 0; i < 2; i++) {
    const prep = bid.prepareBid({ auction_id: auction1, price_zats: 250000n, quantity: 1, destination_ua: UA, deliver: delivers[i], envelope_public_hexs: HOSTS.map((n) => envPub[n]) });
    const ctHex = Buffer.from(armor.decodeArmor(await tlock.timelockEncrypt(R, Buffer.from(prep.plaintext_hex, "hex"), pinnedClient)), "binary").toString("hex");
    const bound = bid.bindSealedBid(prep, auction1, sha256(Buffer.from(ctHex, "hex")));
    records.push({ ciphertext_hash: bound.ciphertext_hash_hex, envelope_ct: bound.envelope_ct_hex, owner_sig: bound.owner_sig_hex, ct_hex: ctHex });
    openPlaintexts.push(prep.plaintext_hex);
  }
  const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
  if (!beaconRes.ok) throw new Error(`drand HTTP ${beaconRes.status} for round ${R}`);
  const beacon = await beaconRes.json();
  const leaves = records.map((r, i) => ({
    auction_id: auction1, manifest_hash: checked.manifest_hash, ciphertext_hash: r.ciphertext_hash,
    deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[i], diversifier_index: String(i) },
    leaf_index: i, ciphertext_hex: r.ct_hex,
  }));
  const frozenTree = merkle.tree(leaves);
  const frozen = { auction_id: auction1, manifest_hash: checked.manifest_hash, root: frozenTree.root, leaf_count: 2, cutoff: R, published_at: RT - 500, leaves, paths: frozenTree.paths };
  const openedInput = openPlaintexts.map((p, i) => ({ leaf_index: i, plaintext_hex: p }));
  const clearResult = reg.clearForMode({ manifest: packet, signer: signerHex, frozen, opened: openedInput, reserve_opening: null });
  if (!Array.isArray(clearResult.allocations) || clearResult.allocations.length !== 2 || clearResult.allocations.some((x) => x.fill !== 1)) {
    throw new Error(`fixture clearing unexpected: ${JSON.stringify(clearResult.allocations?.map((x) => x.fill))}`);
  }
  // gate-X certificates over the frozen root, signed with the shipped witness primitive (see
  // crosschain/local-demo.mjs: `witness sign` requires the witness's own vault scan, which a synthetic
  // fixture has none of); every signature is still verified by the attest code under test
  const fixtureCert = (() => {
    const statement = wit.freezeStatement(checked.manifest, frozen);
    return { statement, signatures: witnessKeys.slice(0, 2).map((k) => wit.signStatement(statement, k.private_hex)) };
  })();
  const doc = {
    version: 1, auction_id: auction1, signer: signerHex, manifest: packet, state: "OPENED", receipts: [],
    frozen, opened: openedInput,
    beacon: { round: R, signature: beacon.signature, chain_hash: chainHash },
    envelopes: records.map((r) => ({ ciphertext_hash: r.ciphertext_hash, envelope_ct: r.envelope_ct, owner_sig: r.owner_sig })),
    witness_set: witnessPacket, witness_cert: [fixtureCert],
    result: clearResult,
  };
  mkdirSync(PUBDIR, { recursive: true });
  writeFileSync(path.join(PUBDIR, "auction.json"), JSON.stringify(doc, null, 2) + "\n");
  const resultBytes = schema.jsonBytes(clearResult);
  writeFileSync(path.join(PUBDIR, "result.json"), resultBytes);
  const resultHash = "0x" + sha256(resultBytes);

  // ---- lock both chains with the three hosts' own keys as the pinned signer set ----
  const evmSigners = JSON.parse(readFileSync(path.join(WORK, "keygen-evm-pubs.json"), "utf8"));
  const solSigners = JSON.parse(readFileSync(path.join(WORK, "keygen-solana-pubs.json"), "utf8"));
  const evmSignersFile = path.join(WORK, "evm-signers.json"), solSignersFile = path.join(WORK, "solana-signers.json");
  writeFileSync(evmSignersFile, JSON.stringify(HOSTS.map((n) => evmSigners[n]), null, 2));
  writeFileSync(solSignersFile, JSON.stringify(HOSTS.map((n) => solSigners[n]), null, 2));
  const now = Math.floor(Date.now() / 1000);
  const lockUntil = now + 600, deadline = now + 3600, expiry = now + 1800;
  const evmSellerKeyFile = path.join(WORK, "evm-seller.key");
  writeFileSync(evmSellerKeyFile, ANVIL_SK, { mode: 0o600 });
  const solPayerFile = path.join(WORK, "solana-payer.json");
  writeFileSync(solPayerFile, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  const solPayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(solPayerFile, "utf8"))));
  const airdrop = await sol.requestAirdrop(solPayer.publicKey, 10 * LAMPORTS_PER_SOL);
  await sol.confirmTransaction(airdrop);
  const escrowEvm = JSON.parse(execFileSync("forge", [
    "create", "src/BenzoEscrow.sol:BenzoEscrow", "--root", path.join(REPO, "contracts/evm"),
    "--rpc-url", EVM_RPC, "--private-key", ANVIL_SK, "--json", "--broadcast",
  ], { cwd: REPO, encoding: "utf8" })).deployedTo;
  const lotEvm = parseEther("1").toString(), lotSol = String(1 * LAMPORTS_PER_SOL);
  {
    const r = benzo(["xchain", "lock", "--chain", "evm", "--auction", "0x" + auction1,
      "--amount", lotEvm, "--lot", lotEvm, "--lock-until", String(lockUntil), "--deadline", String(deadline),
      "--signers", evmSignersFile, "--return", new Wallet(ANVIL_SK).address, "--key", evmSellerKeyFile,
      "--escrow", escrowEvm, "--rpc", EVM_RPC]);
    check("lock-evm", r.code === 0 && !!lastJson(r).tx, (r.stderr || r.stdout).slice(0, 200));
  }
  {
    const r = benzo(["xchain", "lock", "--chain", "solana", "--auction", "0x" + auction1,
      "--amount", lotSol, "--lot", lotSol, "--lock-until", String(lockUntil), "--deadline", String(deadline),
      "--signers", solSignersFile, "--return", solPayer.publicKey.toBase58(), "--key", solPayerFile,
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC]);
    check("lock-solana", r.code === 0 && !!lastJson(r).tx, (r.stderr || r.stdout).slice(0, 200));
  }

  // ---- (b) `xchain attest --host-record` ON each host: own envelope key + own xchain key over --dir ----
  const chainIdEvm = (await evm.getNetwork()).chainId;
  const recFile = (n, chain) => path.join(WORK, `record-${chain}-${n}.json`);
  const attest = (name, chain, opts = {}) => benzo(["xchain", "attest", "--host-record",
    "--chain", chain, "--auction", "0x" + auction1, "--result", path.join(PUBDIR, "result.json"), "--result-hash", resultHash,
    "--batch", "0", "--nonce", "0", "--expiry", String(expiry), "--asset", ZERO, "--dir", PUBDIR,
    "--envelope-key", opts.envelopeKey ?? envFile(name), "--signer-key", opts.signerKey ?? xkey(hostDir(name), chain, name),
    "--escrow", chain === "evm" ? escrowEvm : SOL_PROGRAM, "--rpc", chain === "evm" ? EVM_RPC : SOL_RPC,
    "--out", opts.out ?? recFile(name, chain)], opts.dir ?? hostDir(name));
  const recs = { evm: {}, solana: {} };
  for (const chain of ["evm", "solana"]) {
    for (const name of HOSTS) {
      const r = attest(name, chain);
      const rec = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
      recs[chain][name] = rec;
      const secret = readFileSync(xkey(hostDir(name), chain, name), "utf8").trim();
      const envPrivate = JSON.parse(readFileSync(envFile(name), "utf8")).private_hex;
      const ownPub = chain === "evm" ? new Wallet("0x" + secret).address.toLowerCase() : new PublicKey(ed25519.getPublicKey(hexToBytes(secret))).toBase58();
      // independent verification of the signature over the record's attestation bytes (harness-side crypto)
      const fields = rec && { auctionId: hexToBytes(rec.auction_id), resultHash: hexToBytes(rec.result_hash), allocationRoot: hexToBytes(rec.allocation_root), batchIndex: rec.batch_index, nonce: rec.nonce, expiry: rec.expiry };
      const sigOk = rec === null ? false : chain === "evm"
        ? (() => { const td = att.evmTypedData(fields, chainIdEvm, rec.escrow); return verifyTypedData(td.domain, td.types, td.message, rec.signatures[0]).toLowerCase() === rec.signers[0]; })()
        : ed25519.verify(hexToBytes(rec.signatures[0]), hexToBytes(rec.attestation_bytes), new PublicKey(rec.signers[0]).toBytes());
      check(`attest-record-${chain}-${name}`,
        r.code === 0 && rec !== null && sigOk && JSON.stringify(rec) === JSON.stringify(JSON.parse(readFileSync(recFile(name, chain), "utf8")))
          && rec.signers?.length === 1 && rec.signers[0] === ownPub
          && (rec.attestation_bytes ?? "").replace(/^0x/, "").length === (chain === "evm" ? 64 : 400)
          && /^[0-9a-f]+$/.test((rec.attestation_bytes ?? "").replace(/^0x/, ""))
          && !r.stdout.includes(secret) && !r.stdout.includes(envPrivate),
        `rc=${r.code} sigOk=${sigOk} signers=${JSON.stringify(rec?.signers)} own=${ownPub} stdout ${r.stdout === readFileSync(recFile(name, chain), "utf8") ? "== out file" : "!= out file"}`);
    }
    const rs = HOSTS.map((n) => recs[chain][n]).filter(Boolean);
    check(`attest-identical-bytes-${chain}`,
      rs.length === 3 && new Set(rs.map((r) => r.attestation_bytes.toLowerCase())).size === 1
        && new Set(rs.map((r) => JSON.stringify(r.payouts))).size === 1,
      rs.map((r) => r?.attestation_bytes).join(","));
    const chainRec = recs[chain][HOSTS[0]];
    const wantDest = chain === "evm" ? r1 : s1;
    const wantIdx = chain === "evm" ? 0 : 1;
    check(`attest-payouts-from-envelope-${chain}`,
      !!chainRec && chainRec.payouts?.length === 1 && chainRec.payouts[0].index === wantIdx
        && chainRec.payouts[0].destination === wantDest
        && (chainRec.exceptions ?? []).some((x) => x.index === (chain === "evm" ? 1 : 0)),
      `payouts ${JSON.stringify(chainRec?.payouts)} want destination ${wantDest}`);
  }

  // ---- (c) the coordinator: `xchain release` collects 2 host records over identical bytes, holds no key ----
  const release = (chain, atts, extra = []) => benzo(["xchain", "release", "--chain", chain,
    ...atts.flatMap((f) => ["--attestation", f]),
    "--key", chain === "evm" ? evmSellerKeyFile : solPayerFile, "--rpc", chain === "evm" ? EVM_RPC : SOL_RPC, ...extra]);
  // the refusal proofs run BEFORE the successful release (they never reach the chain)
  {
    // a third party (eve) attests with her own xchain key — even with a host's envelope key in hand
    const rEve = attest("alice", "evm", { signerKey: xkey(hostDir("eve"), "evm", "eve"), out: path.join(WORK, "record-evm-eve.json"), dir: hostDir("eve") });
    check("attest-third-party-record-signed", rEve.code === 0 && JSON.parse(rEve.stdout).signers[0] === new Wallet("0x" + readFileSync(xkey(hostDir("eve"), "evm", "eve"), "utf8").trim()).address.toLowerCase(),
      `rc=${rEve.code}`);
    const r = release("evm", [recFile("alice", "evm"), path.join(WORK, "record-evm-eve.json")]);
    check("release-third-party-refused",
      r.code !== 0 && /not in the escrow's pinned signer set/.test(r.stderr), `rc=${r.code}: ${(r.stderr || "").slice(0, 160)}`);
    // a tampered record: eve's signature relabelled as alice's
    const forged = JSON.parse(readFileSync(path.join(WORK, "record-evm-eve.json"), "utf8"));
    forged.signers = [new Wallet("0x" + readFileSync(xkey(hostDir("alice"), "evm", "alice"), "utf8").trim()).address.toLowerCase()];
    const forgedFile = path.join(WORK, "record-evm-forged.json");
    writeFileSync(forgedFile, JSON.stringify(forged, null, 2) + "\n");
    const rf = release("evm", [recFile("bob", "evm"), forgedFile]);
    check("release-forged-signer-refused",
      rf.code !== 0 && /signature does not verify/.test(rf.stderr), `rc=${rf.code}: ${(rf.stderr || "").slice(0, 160)}`);
    // a coordinator-supplied destination: one record's payout rewritten (attestation bytes untouched)
    const swapped = JSON.parse(readFileSync(recFile("bob", "solana"), "utf8"));
    swapped.payouts[0].destination = Keypair.generate().publicKey.toBase58();
    const swappedFile = path.join(WORK, "record-solana-swapped.json");
    writeFileSync(swappedFile, JSON.stringify(swapped, null, 2) + "\n");
    const rs2 = release("solana", [recFile("alice", "solana"), swappedFile]);
    check("release-swapped-destination-refused",
      rs2.code !== 0 && /records disagree on the derived payouts/.test(rs2.stderr), `rc=${rs2.code}: ${(rs2.stderr || "").slice(0, 160)}`);
    const r1rec = release("evm", [recFile("alice", "evm")]);
    check("release-single-record-refused",
      r1rec.code !== 0 && /at least 2 --attestation records/.test(r1rec.stderr), `rc=${r1rec.code}: ${(r1rec.stderr || "").slice(0, 160)}`);
    const rk = release("evm", [recFile("alice", "evm"), recFile("bob", "evm")], ["--signer-key", xkey(hostDir("eve"), "evm", "eve")]);
    check("release-refuses-signer-key",
      rk.code !== 0 && /never holds a signer key/.test(rk.stderr), `rc=${rk.code}: ${(rk.stderr || "").slice(0, 160)}`);
  }
  const evmBalance = (addr) => evm.send("eth_getBalance", [addr, "latest"]).then((h) => BigInt(h));
  {
    // any two distinct hosts: alice+bob on evm, bob+carol on solana
    const r = release("evm", [recFile("alice", "evm"), recFile("bob", "evm")]);
    const out = (() => { try { return lastJson(r); } catch { return null; } })();
    const paid = await evmBalance(r1);
    check("release-evm-paid",
      r.code === 0 && !!out?.tx && paid === BigInt(lotEvm), `rc=${r.code} balance=${paid} want=${lotEvm} ${(r.stderr || r.stdout).slice(0, 160)}`);
  }
  {
    const r = release("solana", [recFile("bob", "solana"), recFile("carol", "solana")]);
    const out = (() => { try { return lastJson(r); } catch { return null; } })();
    const paid = await sol.getBalance(new PublicKey(s1)); // web3.js v1 returns lamports directly
    check("release-solana-paid",
      r.code === 0 && !!out?.tx && BigInt(paid) === BigInt(lotSol), `rc=${r.code} balance=${paid} want=${lotSol} ${(r.stderr || r.stdout).slice(0, 160)}`);
  }

  console.log(failures ? `RESULT FAIL ${failures} failing` : `RESULT PASS all host assertions`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(`ERROR host-demo ${e.stack ?? e}`); process.exit(1); });
