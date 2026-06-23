/**
 * PERMISSIONLESS on-chain ZK re-verification — the zero-setup repro path for
 * reviewers. No proving artifacts, no admin key, no USDC: it takes a REAL,
 * committed Groth16 proof (tests/fixtures/replay-proof.json) and asks the LIVE
 * Benzo verifier on Stellar testnet to check it, then tampers one public input
 * and shows the chain reject it. This is the ZK doing its job, end to end, that
 * anyone can run from a fresh clone:
 *
 *   node tests/replay-verify.mjs
 *
 * It funds a throwaway account from friendbot (free) purely to source the
 * read-only simulation; nothing is ever submitted or spent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Keypair } from "@stellar/stellar-sdk";

const repo = fileURLToPath(new URL("..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const fx = JSON.parse(readFileSync(`${repo}/tests/fixtures/replay-proof.json`, "utf8"));
const RPC = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const PASSPHRASE = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
const VERIFIER = fx.verifier || dep.verifier;
const log = (...a) => console.log(...a);

log("=== Benzo · permissionless on-chain ZK re-verification ===");
log(`verifier: ${VERIFIER}`);
log(`https://stellar.expert/explorer/testnet/contract/${VERIFIER}`);
log(`proof:    vk_id=${fx.vkId}  (real org proof-of-sum; discloses only a total)\n`);

// 1. Free throwaway account to source the read-only simulation.
const kp = Keypair.random();
log("[1] funding a throwaway account from friendbot (free; never spends)…");
const fb = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(kp.publicKey())}`);
if (!fb.ok && fb.status !== 400) throw new Error(`friendbot funding failed: ${fb.status}`);

function verify(publics) {
  const out = execFileSync("stellar", [
    "contract", "invoke", "--id", VERIFIER, "--source", kp.secret(),
    "--rpc-url", RPC, "--network-passphrase", PASSPHRASE, "--send", "no", "--",
    "verify_proof", "--vk_id", fx.vkId,
    "--proof", JSON.stringify(fx.sorobanProof),
    "--public_inputs", JSON.stringify(publics),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.trim().includes("true");
}

// 2. Re-verify the genuine proof — the chain must accept it.
log("[2] re-verifying the REAL proof on-chain…");
let ok = false;
try { ok = verify(fx.sorobanPublics); } catch (e) { ok = String(e).includes("true"); }
log(`    verify_proof(${fx.vkId}) over the real total => ${ok}`);
if (!ok) { console.error("❌ the committed real proof did NOT verify on-chain"); process.exit(1); }

// 3. Tamper one public input — the chain must reject it (fail-closed).
log("[3] tampering the disclosed-total public input…");
const tampered = [...fx.sorobanPublics];
tampered[1] = (BigInt(tampered[1]) + 1n).toString();
let bad = true;
try { bad = verify(tampered); } catch { bad = false; }
log(`    verify_proof(${fx.vkId}) over a forged total => ${bad} (must be false)`);
if (bad) { console.error("❌ a tampered proof WRONGLY verified"); process.exit(1); }

log("\n✅ A real Groth16 proof verifies on Stellar (BN254 / CAP-0074); a forged one is rejected.");
log("   The ZK is load-bearing — and you just re-checked it with no keys, no funds, no artifacts.");
