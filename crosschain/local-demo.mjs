#!/usr/bin/env node
// Cross-chain local demo (docs/design/crosschain.md §7 step 3): one cleared drop delivered end to
// end locally through the shipped `benzo xchain` CLI against both local chains — a Foundry/Anvil
// EVM chain and a solana-test-validator running the built BenzoEscrow program.
//
// The "cleared drop" input is a small allocation file (winners and lot counts, as the Zcash
// clearing pipeline produces; nothing from the Zcash funding path enters any leaf). The demo:
//   lock (both chains) -> attest (2-of-3, per chain) -> release (each chain pays its leaves)
//   -> status (escrow state matches the attested root) -> replay refused -> refund after deadline
//   on a cancelled second auction (both chains).
//
// Keys: local dev keys only, generated under $BNZ_STATE_DIR/xchain-local/ (never printed).
// Output: `PASS demo-<id>` / `ERROR demo-<id> <reason>` lines; exit 0 only if all PASS.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { JsonRpcProvider, Wallet, formatEther, parseEther, Interface } from "ethers";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3";

const REPO = process.env.BNZ_REPO_ROOT ?? process.cwd();
const STATE = process.env.BNZ_STATE_DIR ?? path.join(REPO, ".benzo");
const KEYDIR = path.join(STATE, "xchain-local");
const WORK = path.join(REPO, "tmp/xchain-demo");
const EVM_RPC = "http://127.0.0.1:8546";
const SOL_RPC = "http://127.0.0.1:8901";
const SOL_PROGRAM = process.env.BNZ_SOLANA_PROGRAM ?? "";
const ANVIL_SK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil dev account 0 (public)

mkdirSync(KEYDIR, { recursive: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));
const hex32 = (b) => "0x" + Buffer.from(b).toString("hex");

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

async function main() {
  if (!SOL_PROGRAM) throw new Error("BNZ_SOLANA_PROGRAM must name the loaded Solana program id");
  const programId = new PublicKey(SOL_PROGRAM);
  const evm = new JsonRpcProvider(EVM_RPC, undefined, { staticNetwork: true });
  const sol = new Connection(SOL_RPC, "confirmed");

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

  const r1 = Wallet.createRandom().address;                    // fresh EVM winner address
  const s1 = Keypair.generate().publicKey.toBase58();          // fresh Solana winner addresses
  const s2 = Keypair.generate().publicKey.toBase58();

  // ---- the cleared drop: allocation from the clearing result (winners + lot counts) ----
  const auction1 = hex32(randomBytes(32));
  const result = { auction_id: auction1, winners: [{ leaf: 0, lot_count: 1 }, { leaf: 1, lot_count: 1 }, { leaf: 2, lot_count: 1 }] };
  const resultFile = path.join(WORK, "result.json");
  writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
  // R14 item 4: the attested result_hash is the product's published result hash (manifest/schema
  // `hash`: sha256 over the raw result.json bytes — the value `benzo verify`/the API report as
  // result_hash), so `xchain status --result` can tie the escrow's approval to the published file
  const resultHash = "0x" + createHash("sha256").update(readFileSync(resultFile)).digest("hex");
  const allocationFile = path.join(WORK, "allocation.json");
  writeFileSync(allocationFile, JSON.stringify({
    standard_lot: "1",
    leaves: [
      { index: 0, lot_count: 1, destination_kind: 1, destination: r1 },
      { index: 1, lot_count: 1, destination_kind: 2, destination: s1 },
      { index: 2, lot_count: 1, destination_kind: 2, destination: s2 },
    ],
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

  // ---- 1. lock on both chains ----
  {
    const r = benzoXchain(["lock", "--chain", "evm", "--auction", auction1,
      "--amount", parseEther("1").toString(), "--lot", parseEther("1").toString(),
      "--lock-until", String(lockUntil), "--deadline", String(deadline),
      "--signers", evmSignersFile, "--return", evmSeller.address, "--key", evmSellerKeyFile,
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC]);
    if (r.code !== 0 || !jsonOut(r).tx) fail("demo-lock-evm", r.stderr || r.stdout.slice(0, 200));
    else pass("demo-lock-evm");
  }
  {
    const r = benzoXchain(["lock", "--chain", "solana", "--auction", auction1,
      "--amount", String(2 * LAMPORTS_PER_SOL), "--lot", String(1 * LAMPORTS_PER_SOL),
      "--lock-until", String(lockUntil), "--deadline", String(deadline),
      "--signers", solSignersFile, "--return", solPayer.publicKey.toBase58(), "--key", solPayerFile,
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC]);
    if (r.code !== 0 || !jsonOut(r).tx) fail("demo-lock-solana", r.stderr || r.stdout.slice(0, 200));
    else pass("demo-lock-solana");
  }

  // ---- 2. attest (2-of-3 per chain, same result hash + allocation root) ----
  const bundleEvm = path.join(WORK, "bundle-evm.json"), bundleSol = path.join(WORK, "bundle-solana.json");
  const ZERO_ASSET = "0x0000000000000000000000000000000000000000"; // both demo auctions lock the native asset
  {
    const r = benzoXchain(["attest", "--chain", "evm", "--auction", auction1, "--allocation", allocationFile,
      "--result-hash", resultHash, "--batch", "0", "--nonce", "0", "--expiry", String(now + 3600),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", bundleEvm, "--asset", ZERO_ASSET]);
    const rs = benzoXchain(["attest", "--chain", "solana", "--auction", auction1, "--allocation", allocationFile,
      "--result-hash", resultHash, "--batch", "0", "--nonce", "0", "--expiry", String(now + 3600),
      "--signer-key", solSignerFiles[0], "--signer-key", solSignerFiles[2],
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--out", bundleSol, "--asset", ZERO_ASSET]);
    const bE = JSON.parse(readFileSync(bundleEvm, "utf8")), bS = JSON.parse(readFileSync(bundleSol, "utf8"));
    check("demo-attest-both-chains",
      r.code === 0 && rs.code === 0 && bE.allocation_root === bS.allocation_root && bE.signatures.length === 2 && bS.signatures.length === 2,
      `evm rc=${r.code} sol rc=${rs.code} roots ${bE.allocation_root} / ${bS.allocation_root}`);
  }

  // §10 F-2 at the signer tool: signers must attest expiry <= deadline — refused before signing
  {
    const re = benzoXchain(["attest", "--chain", "evm", "--auction", auction1, "--allocation", allocationFile,
      "--result-hash", resultHash, "--batch", "7", "--nonce", "0", "--expiry", String(deadline + 10),
      "--signer-key", evmSignerFiles[0], "--signer-key", evmSignerFiles[2],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-refused-evm.json")]);
    const rs = benzoXchain(["attest", "--chain", "solana", "--auction", auction1, "--allocation", allocationFile,
      "--result-hash", resultHash, "--batch", "7", "--nonce", "0", "--expiry", String(deadline + 10),
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
    const base = ["--auction", auction1, "--allocation", allocationFile, "--result-hash", resultHash,
      "--batch", "8", "--nonce", "0", "--expiry", String(now + 3600)];
    const missE = benzoXchain(["attest", "--chain", "evm", ...base, "--signer-key", evmSignerFiles[0],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-asset-missing.json")]);
    const missS = benzoXchain(["attest", "--chain", "solana", ...base, "--signer-key", solSignerFiles[0],
      "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--out", path.join(WORK, "bundle-asset-missing-sol.json")]);
    const wrongE = benzoXchain(["attest", "--chain", "evm", ...base, "--asset", wrongAsset, "--signer-key", evmSignerFiles[0],
      "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--out", path.join(WORK, "bundle-asset-wrong.json")]);
    const wrongS = benzoXchain(["attest", "--chain", "solana", ...base, "--asset", wrongAsset, "--signer-key", solSignerFiles[0],
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
    const r1BalBefore = await evmBalance(evm, r1);
    const escrowBefore = await evmBalance(evm, evmEscrowAddr);
    const r = benzoXchain(["release", "--chain", "evm", "--bundle", bundleEvm, "--key", evmSellerKeyFile,
      "--rpc", EVM_RPC, "--only", "0"]);
    const r1BalAfter = await evmBalance(evm, r1);
    const escrowAfter = await evmBalance(evm, evmEscrowAddr);
    // the PayoutPaid event is the escrow's own record of delivery; assert it names r1 and 1 lot
    let paid = null;
    if (r.code === 0) {
      const receipt = await evm.getTransactionReceipt(jsonOut(r).tx);
      const iface = new Interface(artifact.abi);
      for (const log of receipt.logs) {
        try { const p = iface.parseLog(log); if (p?.name === "PayoutPaid") paid = p.args; } catch { /* other logs */ }
      }
    }
    check("demo-release-evm-delivers",
      r.code === 0 && paid && paid.recipient.toLowerCase() === r1.toLowerCase() && paid.amount === parseEther("1") &&
      r1BalAfter - r1BalBefore === parseEther("1") && escrowBefore - escrowAfter === parseEther("1"),
      `rc=${r.code}, event=${paid ? `${paid.recipient} ${paid.amount}` : "none"}, recipient ${r1} delta ${formatEther(r1BalAfter - r1BalBefore)} ETH, escrow delta ${formatEther(escrowAfter - escrowBefore)} ETH (want -1): ${r.stderr || r.stdout.slice(0, 120)}`);
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
    const re = benzoXchain(["status", "--chain", "evm", "--auction", auction1, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--bundle", bundleEvm]);
    const rs = benzoXchain(["status", "--chain", "solana", "--auction", auction1, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--bundle", bundleSol]);
    const stE = jsonOut(re).auction, stS = jsonOut(rs).auction;
    const evmPaidCount = Object.values(stE.paidLeaves).filter(Boolean).length;
    const solPaidCount = Object.values(stS.paidLeaves).filter(Boolean).length;
    check("demo-status-matches-attested-root",
      re.code === 0 && rs.code === 0 && evmPaidCount === 1 && solPaidCount === 2 &&
      stE.paid === parseEther("1").toString() && stS.paid === String(2 * LAMPORTS_PER_SOL),
      `evm paid ${stE.paid} (${evmPaidCount}/3 leaves), sol paid ${stS.paid} (${solPaidCount}/3 leaves)`);
  }

  // ---- 4b. R14 item 4: status ties the approved resultHash to the published result.json hash ----
  {
    const re = benzoXchain(["status", "--chain", "evm", "--auction", auction1, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--bundle", bundleEvm, "--result", resultFile]);
    const rs = benzoXchain(["status", "--chain", "solana", "--auction", auction1, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--bundle", bundleSol, "--result", resultFile]);
    const rhE = jsonOut(re).result_hash, rhS = jsonOut(rs).result_hash;
    check("demo-status-result-hash-matches-published",
      re.code === 0 && rs.code === 0 && rhE && rhE.match === true && rhS && rhS.match === true,
      `evm rc=${re.code} ${JSON.stringify(rhE)}, sol rc=${rs.code} ${JSON.stringify(rhS)}`);
    // a doctored published result must be refused loudly: exit 1 with the specific mismatch
    const doctoredFile = path.join(WORK, "result-doctored.json");
    writeFileSync(doctoredFile, JSON.stringify({ ...result, tampered: true }, null, 2) + "\n");
    const re2 = benzoXchain(["status", "--chain", "evm", "--auction", auction1, "--escrow", evmEscrowAddr, "--rpc", EVM_RPC, "--bundle", bundleEvm, "--result", doctoredFile]);
    const rs2 = benzoXchain(["status", "--chain", "solana", "--auction", auction1, "--escrow", SOL_PROGRAM, "--rpc", SOL_RPC, "--bundle", bundleSol, "--result", doctoredFile]);
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
