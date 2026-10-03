#!/usr/bin/env node
// ERC-5564 stealth delivery demo (docs/design/crosschain.md §4, §7 step 4) on a local anvil chain:
// deliver.kind = "stealth" end to end through the shipped CLI, with the canonical ScopeLift
// Announcer + Registry (deployed here from the canonical bytecode bundled in the pinned
// @scopelift/stealth-address-sdk — on Ethereum Sepolia the canonical deployments are used as-is).
//
//   winner meta-address -> sealed in the winner's envelope payload v2 (deliver) -> attest derives
//   ONE signer-reproducible fresh stealth address per settlement -> the escrow releases the lot ->
//   the release flow adds the tiny native gas stipend and publishes the ERC-5564 announcement ->
//   the winner, holding only its viewing key, finds the payment, verifies it and recovers the
//   stealth key that spends it.
//
// The fixture is a real published auction directory: one bid, real tlock to a live drand quicknet
// round + its published beacon (BLS-verified at every use), a signed manifest, frozen leaf.
// Keys: local dev keys only, generated under $BNZ_STATE_DIR/xchain-local/ (never printed).
// Output: `PASS stealth-<id>` / `ERROR stealth-<id> <reason>` lines; exit 0 only if all PASS.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet, formatEther, parseEther } from "ethers";
import { createPublicClient, http } from "viem";
import { pathToFileURL } from "node:url";

const REPO = process.env.BNZ_REPO_ROOT ?? process.cwd();
const STATE = process.env.BNZ_STATE_DIR ?? path.join(REPO, ".benzo");
const KEYDIR = path.join(STATE, "xchain-local");
const WORK = path.join(REPO, "tmp/stealth-demo");
const PUBDIR = path.join(WORK, "public");
const EVM_RPC = process.env.BNZ_EVM_RPC ?? "http://127.0.0.1:8546";
const ANVIL_SK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil dev account 0 (public)
const UA = "utest1redacted";
const STIPEND = parseEther("0.001"); // design §4 lesson 6: a tiny native gas stipend per fresh destination
const LOT = parseEther("1");

mkdirSync(KEYDIR, { recursive: true, mode: 0o700 });
rmSync(WORK, { recursive: true, force: true }); // never read a stale artifact from an earlier run
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));
const rndHex = (n) => randomBytes(n).toString("hex");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function benzoXchain(args) {
  try {
    const out = execFileSync("node", [path.join(REPO, "cli/dist/benzo.mjs"), "xchain", ...args], { cwd: REPO, encoding: "utf8" });
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
const evmBalance = (provider, addr) => provider.send("eth_getBalance", [addr, "latest"]).then((h) => BigInt(h));
function secretFile(name, bytes32) {
  const p = path.join(KEYDIR, name);
  writeFileSync(p, "0x" + Buffer.from(bytes32).toString("hex"), { mode: 0o600 });
  return p;
}

async function main() {
  const evm = new JsonRpcProvider(EVM_RPC, undefined, { staticNetwork: true });
  const publicClient = createPublicClient({ transport: http(EVM_RPC) });
  // ethers v6 briefly caches the resolved block/nonce; on instant-mining anvil consecutive sends from
  // one wallet would reuse a nonce — NonceManager tracks it locally
  const seller = new NonceManager(new Wallet(ANVIL_SK, evm));

  // the shipped modules under test, bundled from this working tree (never a stale build)
  writeFileSync(path.join(WORK, "entry.mjs"), [
    'export * as stealth from "../../crosschain/stealth";',
    'export * as del from "../../envelope/deliver";',
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
    path.join(WORK, "entry.mjs"), "--bundle", "--platform=node", "--format=esm",
    "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
    "--outfile=" + path.join(WORK, "lib.mjs"), "--log-level=warning",
  ], { cwd: REPO });
  const { stealth, del, bid, envmod, schema, merkle, reg, tlock, armor } = await import(pathToFileURL(path.join(WORK, "lib.mjs")).href);

  // ---- canonical Announcer + Registry from the pinned SDK's canonical bytecode ----
  // R25 item 6: `--announcer` must be THE canonical ERC-5564 Announcer, so the local chain runs the
  // canonical contract AT its canonical address (anvil_setCode copies the deployed canonical runtime
  // code there — the Announcer is stateless; on Sepolia the canonical deployment is used as-is).
  let announcer = "", registry = "";
  try {
    const announcerC = await new ContractFactory(stealth.ANNOUNCER_ABI, stealth.CANONICAL_ERC5564_BYTECODE, seller).deploy();
    await announcerC.waitForDeployment();
    const registryC = await new ContractFactory(stealth.REGISTRY_ABI, stealth.CANONICAL_ERC6538_BYTECODE, seller).deploy();
    await registryC.waitForDeployment();
    await evm.send("anvil_setCode", [stealth.CANONICAL_ERC5564_ANNOUNCER, await evm.getCode(await announcerC.getAddress())]);
    announcer = stealth.CANONICAL_ERC5564_ANNOUNCER;
    registry = await registryC.getAddress();
    check("stealth-canonical-deploy",
      announcer.toLowerCase() === stealth.CANONICAL_ERC5564_ANNOUNCER.toLowerCase() &&
        /^0x[0-9a-fA-F]{40}$/.test(registry) && (await evm.getCode(announcer)).length > 2,
      `announcer ${announcer} (the canonical ERC-5564 address, canonical bytecode from the pinned SDK) registry ${registry}`);
  } catch (e) {
    check("stealth-canonical-deploy", false, String(e).slice(0, 200));
    throw e;
  }

  // ---- winner: one stealth meta-address, registered in the canonical Registry ----
  const winnerKeys = stealth.generateStealthMetaAddress();
  const deliver = { chain: "evm", kind: "stealth", to: winnerKeys.stealthMetaAddress }; // the bidder's input (no salt: the sealer generates it, R25 item 1)
  const winner = Wallet.createRandom().connect(evm); // the winner's everyday account (gas only)
  await (await seller.sendTransaction({ to: winner.address, value: parseEther("0.05") })).wait();
  await seller.reset();
  {
    const reg1 = await stealth.prepareRegistration({ publicClient }, winner.address, registry, winnerKeys);
    const tx = await winner.sendTransaction({ to: reg1.to, data: reg1.data });
    await tx.wait();
    const onchain = await publicClient.readContract({
      address: registry, abi: stealth.REGISTRY_ABI,
      functionName: "stealthMetaAddressOf", args: [winner.address, 1n],
    });
    check("stealth-meta-address-registered",
      onchain?.toLowerCase() === winnerKeys.stealthMetaAddress.toLowerCase() && tx.hash.length === 66,
      `registry has ${onchain}, winner published ${winnerKeys.stealthMetaAddress}, register tx ${tx.hash}`);
  }

  // ---- the published auction directory fixture (one winner, deliver sealed in its envelope) ----
  const envelopeKeys = [envmod.generateEnvelopeKey(), envmod.generateEnvelopeKey(), envmod.generateEnvelopeKey()];
  const recipients = envelopeKeys.map((k) => k.public_hex);
  const envelopeKeyFiles = envelopeKeys.map((k, i) => {
    const p = path.join(KEYDIR, `envelope-key-${i}.key`);
    writeFileSync(p, k.private_hex, { mode: 0o600 });
    return p;
  });
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
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "stealth delivery lot", supply: 1,
    reserve_zats: "0", tick_zats: "1000", B_max_zats: "500000", q_max: 1,
    C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35)],
    drand: { ...schema.QUICKNET, R }, T_submit: RT - 850, T_freeze: RT - 100, confirmations: 10,
    clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
    refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
    envelope_keys: recipients,
  };
  const packet = schema.signRecord(manifest, signerPem);
  writeFileSync(path.join(WORK, "manifest.json"), schema.jsonBytes(packet));
  const checked = reg.clientForMode(packet, signerHex);
  if (checked.manifest.auction_id !== auction1) throw new Error("signed manifest did not validate");

  const pinnedInfo = {
    public_key: schema.QUICKNET.public_key, period: schema.QUICKNET.period, genesis_time: schema.QUICKNET.genesis,
    hash: chainHash, groupHash: "", schemeID: schema.QUICKNET.scheme, metadata: { beaconID: "quicknet" },
  };
  const prep = bid.prepareBid({ auction_id: auction1, price_zats: 250000n, quantity: 1, destination_ua: UA, deliver, envelope_public_hexs: recipients });
  // R25 item 1: the deliver's secret salt is generated inside the sealed envelope — a signer (and the
  // derivation below) gets it only by opening the envelope, exactly as the attest layer does
  const sealedDeliver = del.requireDeliver(envmod.openEnvelopePayload(prep.envelope_ct_hex, envelopeKeys[0].private_hex).deliver);
  const armored = await tlock.timelockEncrypt(R, Buffer.from(prep.plaintext_hex, "hex"), { chain: () => ({ info: async () => pinnedInfo }) });
  const ctHex = Buffer.from(armor.decodeArmor(armored), "binary").toString("hex");
  const bound = bid.bindSealedBid(prep, auction1, sha256(Buffer.from(ctHex, "hex")));
  const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
  if (!beaconRes.ok) throw new Error(`drand HTTP ${beaconRes.status} for round ${R}`);
  const beacon = await beaconRes.json();
  const leaves = [{ auction_id: auction1, manifest_hash: checked.manifest_hash, ciphertext_hash: bound.ciphertext_hash_hex, deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[0], diversifier_index: "0" }, leaf_index: 0, ciphertext_hex: ctHex }];
  const frozenTree = merkle.tree(leaves);
  // published_at precedes T_freeze as a real freeze does (checkPublicAuction refuses a late freeze)
  const frozen = { auction_id: auction1, manifest_hash: checked.manifest_hash, root: frozenTree.root, leaf_count: 1, cutoff: R, published_at: RT - 500, leaves, paths: frozenTree.paths };
  // the REAL product result (R22 + R24 item 2): the shipped clearing over the opening
  const openedInput = [{ leaf_index: 0, plaintext_hex: prep.plaintext_hex }];
  const clearResult = reg.clearForMode({ manifest: packet, signer: signerHex, frozen, opened: openedInput, reserve_opening: null });
  const doc = {
    version: 1, auction_id: auction1, signer: signerHex, manifest: packet, state: "OPENED", receipts: [],
    frozen, opened: openedInput,
    beacon: { round: R, signature: beacon.signature, chain_hash: chainHash },
    envelopes: [{ ciphertext_hash: bound.ciphertext_hash_hex, envelope_ct: bound.envelope_ct_hex, owner_sig: bound.owner_sig_hex }],
    result: clearResult,
  };
  mkdirSync(PUBDIR, { recursive: true });
  writeFileSync(path.join(PUBDIR, "auction.json"), JSON.stringify(doc, null, 2) + "\n");
  // the literal --dir/result.json (R22 byte-equality): the same canonical bytes the document embeds
  const resultBytes = schema.jsonBytes(clearResult);
  const resultFile = path.join(PUBDIR, "result.json");
  writeFileSync(resultFile, resultBytes);
  const resultHash = "0x" + sha256(resultBytes);

  // ---- escrow (native ETH lot): lock -> attest -> release with stipend + announcement ----
  const artifact = JSON.parse(readFileSync(path.join(REPO, "contracts/evm/out/BenzoEscrow.sol/BenzoEscrow.json"), "utf8"));
  const escrowAddr = JSON.parse(execFileSync("forge", [
    "create", "src/BenzoEscrow.sol:BenzoEscrow", "--root", path.join(REPO, "contracts/evm"),
    "--rpc-url", EVM_RPC, "--private-key", ANVIL_SK, "--json", "--broadcast",
  ], { cwd: REPO, encoding: "utf8" })).deployedTo;
  await seller.reset();
  check("stealth-escrow-deployed", /^0x[0-9a-fA-F]{40}$/.test(escrowAddr), escrowAddr);

  const signerFiles = [];
  for (let i = 0; i < 3; i++) signerFiles.push(secretFile(`evm-signer-${i}.key`, randomBytes(32)));
  const signersFile = path.join(WORK, "evm-signers.json");
  writeFileSync(signersFile, JSON.stringify(signerFiles.map((f) => new Wallet(readFileSync(f, "utf8").trim()).address), null, 2));
  const sellerKeyFile = secretFile("evm-seller.key", Buffer.from(ANVIL_SK.slice(2), "hex"));
  const now = Math.floor(Date.now() / 1000);
  {
    const r = benzoXchain(["lock", "--chain", "evm", "--auction", "0x" + auction1, "--amount", LOT.toString(), "--lot", LOT.toString(),
      "--lock-until", String(now + 600), "--deadline", String(now + 3600), "--signers", signersFile,
      "--return", await seller.getAddress(), "--key", sellerKeyFile, "--escrow", escrowAddr, "--rpc", EVM_RPC]);
    check("stealth-escrow-lock", r.code === 0 && jsonOut(r).tx, `rc=${r.code} ${(r.stderr || r.stdout).slice(0, 160)}`);
    await seller.reset();
  }
  const bundleFile = path.join(WORK, "bundle-evm.json");
  {
    const attestArgv = ["attest", "--chain", "evm", "--auction", "0x" + auction1, "--result", resultFile, "--result-hash", resultHash,
      "--dir", PUBDIR, ...envelopeKeyFiles.flatMap((f) => ["--envelope-key", f]),
      "--batch", "0", "--nonce", "0", "--expiry", String(now + 3600), "--asset", "0x0000000000000000000000000000000000000000",
      "--signer-key", signerFiles[0], "--signer-key", signerFiles[2], "--escrow", escrowAddr, "--rpc", EVM_RPC, "--out", bundleFile];
    const r = benzoXchain(attestArgv);
    const b = r.code === 0 ? JSON.parse(readFileSync(bundleFile, "utf8")) : null;
    check("stealth-attest-from-envelope", r.code === 0 && b?.leaves?.length === 1 && b.leaves[0].deliver_kind === "stealth" && b.leaves[0].announce?.ephemeral_pubkey?.startsWith("0x"),
      `rc=${r.code} leaf ${JSON.stringify(b?.leaves?.[0] ?? {}).slice(0, 200)} ${(r.stderr || "").slice(0, 160)}`);
    // R25 item 6: numeric CLI arguments are validated — a fractional --nonce is refused, never coerced
    const bad = benzoXchain(attestArgv.map((x, i) => (attestArgv[i - 1] === "--nonce" ? "1.5" : x)));
    check("stealth-numeric-args-refused",
      bad.code !== 0 && /--nonce must be a non-negative integer/.test(bad.stderr),
      `rc=${bad.code}: ${(bad.stderr || bad.stdout).slice(0, 160)}`);
  }

  // the derived one-time address is signer-reproducible: the opened deliver + settlement coordinates
  // give every signer the same fresh address (the allocation root is 2-of-3 signed over it)
  const bundle = JSON.parse(readFileSync(bundleFile, "utf8"));
  const leaf0 = bundle.leaves[0];
  const independent = stealth.deriveSettlementStealthAddress(sealedDeliver, {
    deliverSha256Hex: del.deliverSha256(sealedDeliver), auctionId: Buffer.from(auction1, "hex"), batchIndex: 0, leafIndex: 0, amountWei: LOT,
  });
  check("stealth-derive-reproducible",
    independent.stealthAddress.toLowerCase() === String(leaf0.destination).toLowerCase() &&
      independent.ephemeralPublicKey === leaf0.announce.ephemeral_pubkey &&
      independent.stealthAddress.toLowerCase() !== winnerKeys.stealthMetaAddress.toLowerCase() &&
      independent.stealthAddress.toLowerCase() !== winner.address.toLowerCase(),
    `attested ${leaf0.destination}, independently derived ${independent.stealthAddress}`);

  // R25 item 1 (Reviewer R F1 linking probe): an attacker who can GUESS the winner's meta-address
  // reconstructs the deliver from public data only (no envelope opening, so no salt) and re-derives
  // the ephemeral key from the public settlement coordinates. Before the secret salt this reproduced
  // the paid one-time address — linking the payout to the meta-address; after, it cannot.
  const attackerDeliver = { chain: "evm", kind: "stealth", to: winnerKeys.stealthMetaAddress, salt: "00".repeat(32) };
  const probe = stealth.deriveSettlementStealthAddress(attackerDeliver, {
    deliverSha256Hex: del.deliverSha256(attackerDeliver), auctionId: Buffer.from(auction1, "hex"), batchIndex: 0, leafIndex: 0, amountWei: LOT,
  });
  check("stealth-link-probe-fails",
    probe.stealthAddress.toLowerCase() !== String(leaf0.destination).toLowerCase() &&
      probe.ephemeralPublicKey !== leaf0.announce.ephemeral_pubkey,
    `the guessed-meta-address probe reproduced the paid address ${probe.stealthAddress} (ephemeral ${probe.ephemeralPublicKey}) — the payout is linkable`);

  // ---- release: the lot + the gas stipend to the fresh address, and the ERC-5564 announcement ----
  {
    const before = await evmBalance(evm, leaf0.destination);
    // R25 item 6: --announcer must be THE canonical ERC-5564 Announcer — any other address is refused
    // before anything is signed or sent
    const badAnn = benzoXchain(["release", "--chain", "evm", "--bundle", bundleFile, "--key", sellerKeyFile, "--rpc", EVM_RPC,
      "--stipend", STIPEND.toString(), "--announcer", Wallet.createRandom().address]);
    check("stealth-announcer-canonical-refused",
      badAnn.code !== 0 && /canonical ERC-5564 Announcer/.test(badAnn.stderr) && /0x55649E01B5Df198D18D95b5cc5051630cfD45564/i.test(badAnn.stderr),
      `rc=${badAnn.code}: ${(badAnn.stderr || badAnn.stdout).slice(0, 200)}`);
    const r = benzoXchain(["release", "--chain", "evm", "--bundle", bundleFile, "--key", sellerKeyFile, "--rpc", EVM_RPC,
      "--stipend", STIPEND.toString(), "--announcer", announcer]);
    const after = await evmBalance(evm, leaf0.destination);
    const out = r.code === 0 ? jsonOut(r) : null;
    check("stealth-release-pays-with-stipend",
      r.code === 0 && out?.stipend_txs?.length === 1 && out?.announce_txs?.length === 1 && after - before === LOT + STIPEND,
      `rc=${r.code} stipend_txs ${JSON.stringify(out?.stipend_txs)} announce_txs ${JSON.stringify(out?.announce_txs)} fresh address delta ${formatEther(after - before)} ETH (want ${formatEther(LOT + STIPEND)}): ${(r.stderr || r.stdout).slice(0, 160)}`);
    await seller.reset();
  }

  // ---- winner side: the viewing key alone finds the payment, verifies it, and spends it ----
  let announcement = null;
  {
    const events = await stealth.scanDeliveries({ publicClient }, announcer, winnerKeys, { fromBlock: 0n, toBlock: "latest" });
    announcement = events[0]?.announcement ?? null;
    check("stealth-scan-finds-delivery",
      events.length === 1 && events[0].stealthAddress.toLowerCase() === String(leaf0.destination).toLowerCase(),
      `${events.length} announcement(s) for this winner, first ${events[0]?.stealthAddress}`);
    const stealthKey = stealth.recoverStealthKey(winnerKeys, announcement);
    const owner = new Wallet(stealthKey, evm);
    check("stealth-recover-spends",
      owner.address.toLowerCase() === String(leaf0.destination).toLowerCase(),
      `recovered ${owner.address} (paid ${leaf0.destination})`);
    const sellerBefore = await evmBalance(evm, await seller.getAddress());
    await (await owner.sendTransaction({ to: await seller.getAddress(), value: LOT })).wait();
    const sellerAfter = await evmBalance(evm, await seller.getAddress());
    check("stealth-recovered-key-controls-funds", sellerAfter - sellerBefore === LOT,
      `recovered key moved ${formatEther(sellerAfter - sellerBefore)} ETH to the seller (want ${formatEther(LOT)})`);
  }

  // what is public is exactly design §4's: the escrow, the amount, one one-time address — the
  // winner's everyday account and meta-address appear in no announcement field
  {
    const fields = JSON.stringify(announcement ?? {}, (k, v) => (typeof v === "bigint" ? String(v) : v)).toLowerCase();
    check("stealth-privacy",
      announcement !== null &&
        !fields.includes(winner.address.toLowerCase()) &&
        !fields.includes(String(winnerKeys.stealthMetaAddress).toLowerCase()) &&
        announcement.stealthAddress.toLowerCase() === String(leaf0.destination).toLowerCase(),
      "announcement names the winner or its meta-address");
  }

  console.log(failures === 0
    ? "RESULT PASS ERC-5564 stealth delivery (deliver.kind=stealth) end to end on the local chain"
    : `RESULT FAIL ${failures} stealth assertion(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exitCode = 1;
});
