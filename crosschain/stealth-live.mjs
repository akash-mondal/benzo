#!/usr/bin/env node
// One LIVE ERC-5564 stealth delivery on Ethereum Sepolia (§7 step 4/5):
// deliver.kind = "stealth" end to end through the shipped CLI against the real chain —
//   the canonical ScopeLift Announcer + Registry (their canonical Sepolia deployments, from the
//   pinned SDK), one winner envelope carrying the stealth meta-address, a real published directory
//   (real tlock + the BLS-verified drand quicknet beacon), the BenzoEscrow locked with a native
//   ETH lot, attest/release through `benzo xchain`, the release paying the derived one-time address
//   WITH the tiny native gas stipend and publishing the ERC-5564 announcement, and the winner's
//   viewing key alone finding, verifying and spending the payment.
//
// Keys: the deployer key is read from $BNZ_STATE_DIR/evm/deployer.key and never printed (it is
// never passed on a command line either — the escrow deploy signs through ethers). Winner and
// signer keys are fresh local files under $BNZ_STATE_DIR/xchain-live/.
// Output: `PASS live-<id>` / `ERROR live-<id> <reason>` lines; exit 0 only if all PASS.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet, formatEther, parseEther } from "ethers";
import { createPublicClient, http } from "viem";
import { pathToFileURL } from "node:url";

const REPO = process.env.BNZ_REPO_ROOT ?? process.cwd();
const STATE = process.env.BNZ_STATE_DIR ?? path.join(REPO, ".benzo");
const KEYDIR = path.join(STATE, "xchain-live");
const WORK = path.join(REPO, "tmp/stealth-live");
const PUBDIR = path.join(WORK, "public");
const EVM_RPC = process.argv[2] || process.env.BNZ_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const UA = "utest1nqaarlf8ehmtateefnysz3a6mxvtl39cgvtmj68ngj9266vtk7efr936qp67cz4aywuy4cqss3pfu870hxmkruhmrzgetw2jq7dle6lvzrgsrckh2ugw4fehsyd7j66sy67x84hylx5rjg47qnkzztwf9zvce9v6je7ngd6j8mjh44knm2kj7u6c67nv20dk6hkhsfugd5t7jqlkjfm";
const STIPEND = parseEther("0.0001"); // A tiny native gas stipend with the fresh payout
const LOT = parseEther("0.01");

mkdirSync(KEYDIR, { recursive: true, mode: 0o700 });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id, note = "") => console.log(`PASS ${id}${note ? " " + note : ""}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id, reason) : fail(id, reason));
const rndHex = (n) => randomBytes(n).toString("hex");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function benzoXchain(args) {
  try {
    const out = execFileSync("node", [path.join(REPO, "cli/dist/benzo.mjs"), "xchain", ...args], { cwd: REPO, encoding: "utf8", timeout: 300000 });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
const jsonOut = (r) => {
  const at = r.stdout.indexOf("{");
  if (at < 0) throw new Error(`no JSON in CLI output: ${(r.stderr || r.stdout).slice(0, 300)}`);
  return JSON.parse(r.stdout.slice(at));
};
const evmBalance = (provider, addr) => provider.send("eth_getBalance", [addr, "latest"]).then((h) => BigInt(h));

async function main() {
  const deployerKey = readFileSync(path.join(STATE, "evm", "deployer.key"), "utf8").trim();
  const evm = new JsonRpcProvider(EVM_RPC, undefined, { staticNetwork: true });
  const publicClient = createPublicClient({ transport: http(EVM_RPC) });
  const deployer = new NonceManager(new Wallet(deployerKey, evm));
  const deployerAddr = await deployer.getAddress();
  console.log(`live rpc ${EVM_RPC}`);
  console.log(`live deployer ${deployerAddr}`);

  // the shipped modules under test, bundled from this working tree
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

  // the canonical Announcer + Registry: their canonical Sepolia deployments
  const announcer = stealth.CANONICAL_ERC5564_ANNOUNCER;
  const registryCode = await publicClient.getBytecode({ address: stealth.CANONICAL_ERC6538_REGISTRY });
  check("live-canonical-announcer",
    /^0x[0-9a-fA-F]{40}$/.test(announcer) && typeof registryCode === "string" && registryCode.length > 2,
    `announcer ${announcer} registry ${stealth.CANONICAL_ERC6538_REGISTRY} (canonical deployments on Sepolia)`);

  // ---- winner: one fresh stealth meta-address (its deliver is sealed in its envelope) ----
  const winnerKeys = stealth.generateStealthMetaAddress();
  const deliver = { chain: "evm", kind: "stealth", to: winnerKeys.stealthMetaAddress }; // no salt: the sealer generates it

  // ---- the published directory fixture: one bid, real tlock + BLS-verified drand beacon ----
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
    escrow_ua: "utest1" + rndHex(35), frost_group_key: rndHex(32), lot: "live stealth delivery lot", supply: 1,
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
  // The deliver's secret salt is generated inside the sealed envelope — open it to get it
  const sealedDeliver = del.requireDeliver(envmod.openEnvelopePayload(prep.envelope_ct_hex, envelopeKeys[0].private_hex).deliver);
  const armored = await tlock.timelockEncrypt(R, Buffer.from(prep.plaintext_hex, "hex"), { chain: () => ({ info: async () => pinnedInfo }) });
  const ctHex = Buffer.from(armor.decodeArmor(armored), "binary").toString("hex");
  const bound = bid.bindSealedBid(prep, auction1, sha256(Buffer.from(ctHex, "hex")));
  const beaconRes = await fetch(`${drandBase}/${chainHash}/public/${R}`);
  if (!beaconRes.ok) throw new Error(`drand HTTP ${beaconRes.status} for round ${R}`);
  const beacon = await beaconRes.json();
  const leaf = { auction_id: auction1, manifest_hash: checked.manifest_hash, ciphertext_hash: bound.ciphertext_hash_hex, deposit: { txid: rndHex(32), pool: "ironwood", address: manifest.deposit_addresses[0], diversifier_index: "0" }, leaf_index: 0, ciphertext_hex: ctHex };
  const frozenTree = merkle.tree([leaf]);
  // published_at precedes T_freeze as a real freeze does (checkPublicAuction refuses a late freeze)
  const frozen = { auction_id: auction1, manifest_hash: checked.manifest_hash, root: frozenTree.root, leaf_count: 1, cutoff: R, published_at: RT - 500, leaves: [leaf], paths: frozenTree.paths };
  // the REAL product result: the shipped clearing over the opening
  const openedInput = [{ leaf_index: 0, plaintext_hex: prep.plaintext_hex }];
  const clearResult = reg.clearForMode({ manifest: packet, signer: signerHex, frozen, opened: openedInput, reserve_opening: null });
  mkdirSync(PUBDIR, { recursive: true });
  writeFileSync(path.join(PUBDIR, "auction.json"), JSON.stringify({
    version: 1, auction_id: auction1, signer: signerHex, manifest: packet, state: "OPENED", receipts: [],
    frozen, opened: openedInput,
    beacon: { round: R, signature: beacon.signature, chain_hash: chainHash },
    envelopes: [{ ciphertext_hash: bound.ciphertext_hash_hex, envelope_ct: bound.envelope_ct_hex, owner_sig: bound.owner_sig_hex }],
    result: clearResult,
  }, null, 2) + "\n");
  // the literal --dir/result.json (byte-equality): the same canonical bytes the document embeds
  const resultBytes = schema.jsonBytes(clearResult);
  const resultFile = path.join(PUBDIR, "result.json");
  writeFileSync(resultFile, resultBytes);
  const resultHash = "0x" + sha256(resultBytes);
  pass("live-fixture-built", `auction 0x${auction1} drand round ${R}`);

  // ---- escrow: deploy fresh (never in-place upgrade), lock the native lot ----
  const artifact = JSON.parse(readFileSync(path.join(REPO, "contracts/evm/out/BenzoEscrow.sol/BenzoEscrow.json"), "utf8"));
  const escrow = await new ContractFactory(artifact.abi, artifact.bytecode.object, deployer).deploy();
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  const deployTx = escrow.deploymentTransaction();
  const deployBlock = BigInt((await evm.getTransaction(deployTx.hash)).blockNumber);
  check("live-escrow-deployed", /^0x[0-9a-fA-F]{40}$/.test(escrowAddr), `escrow ${escrowAddr} deploy tx ${deployTx?.hash} block ${deployBlock}`);

  const signerFiles = [];
  for (let i = 0; i < 3; i++) {
    const p = path.join(KEYDIR, `evm-signer-${i}.key`);
    writeFileSync(p, "0x" + rndHex(32), { mode: 0o600 });
    signerFiles.push(p);
  }
  writeFileSync(path.join(WORK, "evm-signers.json"), JSON.stringify(signerFiles.map((f) => new Wallet(readFileSync(f, "utf8").trim()).address), null, 2));
  const now = Math.floor(Date.now() / 1000);
  {
    const r = benzoXchain(["lock", "--chain", "evm", "--auction", "0x" + auction1, "--amount", LOT.toString(), "--lot", LOT.toString(),
      "--lock-until", String(now + 3600), "--deadline", String(now + 86400), "--signers", path.join(WORK, "evm-signers.json"),
      "--return", deployerAddr, "--key", path.join(STATE, "evm", "deployer.key"), "--escrow", escrowAddr, "--rpc", EVM_RPC]);
    check("live-escrow-lock", r.code === 0 && jsonOut(r).tx, `lock tx ${r.code === 0 ? jsonOut(r).tx : (r.stderr || r.stdout).slice(0, 200)}`);
  }

  // ---- attest + release: the lot, the gas stipend, and the ERC-5564 announcement ----
  const bundleFile = path.join(WORK, "bundle-evm.json");
  {
    const r = benzoXchain(["attest", "--chain", "evm", "--auction", "0x" + auction1, "--result", resultFile, "--result-hash", resultHash,
      "--dir", PUBDIR, ...envelopeKeyFiles.flatMap((f) => ["--envelope-key", f]),
      "--batch", "0", "--nonce", "0", "--expiry", String(now + 86400), "--asset", "0x0000000000000000000000000000000000000000",
      "--signer-key", signerFiles[0], "--signer-key", signerFiles[2], "--escrow", escrowAddr, "--rpc", EVM_RPC, "--out", bundleFile]);
    const b = r.code === 0 ? JSON.parse(readFileSync(bundleFile, "utf8")) : null;
    check("live-attest-from-envelope", r.code === 0 && b?.leaves?.length === 1 && b.leaves[0].deliver_kind === "stealth",
      `leaf destination ${b?.leaves?.[0]?.destination} ${(r.stderr || "").slice(0, 160)}`);
  }
  const bundle = JSON.parse(readFileSync(bundleFile, "utf8"));
  const dest = bundle.leaves[0].destination;
  const independent = stealth.deriveSettlementStealthAddress(sealedDeliver, {
    deliverSha256Hex: del.deliverSha256(sealedDeliver), auctionId: Buffer.from(auction1, "hex"), batchIndex: 0, leafIndex: 0, amountWei: LOT,
  });
  check("live-derive-reproducible", independent.stealthAddress.toLowerCase() === String(dest).toLowerCase(),
    `attested ${dest}, independently derived ${independent.stealthAddress}`);
  {
    const before = await evmBalance(evm, dest);
    const r = benzoXchain(["release", "--chain", "evm", "--bundle", bundleFile, "--key", path.join(STATE, "evm", "deployer.key"), "--rpc", EVM_RPC,
      "--stipend", STIPEND.toString(), "--announcer", announcer]);
    const after = await evmBalance(evm, dest);
    const out = r.code === 0 ? jsonOut(r) : null;
    check("live-release-pays-with-stipend",
      r.code === 0 && out?.stipend_txs?.length === 1 && out?.announce_txs?.length === 1 && after - before === LOT + STIPEND,
      `release tx ${out?.tx} stipend tx ${out?.stipend_txs?.[0]} announce tx ${out?.announce_txs?.[0]} fresh address delta ${formatEther(after - before)} ETH (want ${formatEther(LOT + STIPEND)})`);
  }

  // ---- winner side against Sepolia: the viewing key alone finds, verifies and spends it ----
  {
    const events = await stealth.scanDeliveries({ publicClient }, announcer, winnerKeys, { fromBlock: deployBlock, toBlock: "latest" });
    check("live-scan-finds-delivery", events.length === 1 && events[0].stealthAddress.toLowerCase() === String(dest).toLowerCase(),
      `${events.length} announcement(s), first ${events[0]?.stealthAddress} in tx ${events[0]?.announcement?.transactionHash}`);
    const owner = new Wallet(stealth.recoverStealthKey(winnerKeys, events[0].announcement), evm);
    check("live-recover-spends", owner.address.toLowerCase() === String(dest).toLowerCase(), `recovered ${owner.address}`);
    const sellerBefore = await evmBalance(evm, deployerAddr);
    const spendTx = await owner.sendTransaction({ to: deployerAddr, value: LOT });
    await spendTx.wait();
    const sellerAfter = await evmBalance(evm, deployerAddr);
    check("live-recovered-key-controls-funds", sellerAfter - sellerBefore === LOT,
      `spend tx ${spendTx.hash} moved ${formatEther(sellerAfter - sellerBefore)} ETH back`);
  }

  console.log(failures === 0
    ? "RESULT PASS one live ERC-5564 stealth delivery (deliver.kind=stealth) on Ethereum Sepolia with a gas stipend"
    : `RESULT FAIL ${failures} live assertion(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exitCode = 1;
});
