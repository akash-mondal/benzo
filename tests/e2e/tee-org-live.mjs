/**
 * Z0 LIVE — a BUSINESS (org) circuit proved INSIDE the attested Phala TDX CVM,
 * verified ON-CHAIN. Against the live enclave this:
 *   [1] verifies a fresh TDX attestation quote (dcap-qvl) + pins the compose-hash;
 *   [2] proves cross_netting (Z8) INSIDE the enclave via PhalaProver — the witness
 *       (both gross invoice totals) is ECIES-sealed to the enclave's *attested*
 *       X25519 key, so the gateway only ever sees ciphertext — then verifies that
 *       enclave-produced proof ON-CHAIN (verifier NETTING => true);
 *   [3] NEGATIVE: a wrong measurement pin makes PhalaProver refuse (witness withheld).
 *
 * Run: set -a; . ./.env; set +a; \
 *   BENZO_PROVER_ENDPOINT=https://<app-id>-8080.<node>.phala.network node tests/e2e/tee-org-live.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StellarCli, configFromEnv, PhalaProver, makeNodeAttestationVerifier } from "@benzo/core";

const ENDPOINT = process.env.BENZO_PROVER_ENDPOINT;
if (!ENDPOINT) throw new Error("set BENZO_PROVER_ENDPOINT to the live CVM URL");
const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const SOURCE = "benzo-deployer";
const log = (...a) => console.log(...a);

log("=== Z0 LIVE — org circuit proved INSIDE the attested Phala TDX CVM -> on-chain ===");
log(`endpoint: ${ENDPOINT}`);

log("\n[1] verifying live TDX attestation quote (dcap-qvl) + pinning measurement …");
const verifier = makeNodeAttestationVerifier();
const att = await verifier.verify(ENDPOINT);
log(`    TCB status   : ${att.status}`);
log(`    compose-hash : ${att.composeHash}`);
log(`    attested encPub: ${att.enclavePublicKey?.slice(0, 24)}…`);
if (!att.ok) { console.error("❌ attestation FAILED"); process.exit(1); }
const teeProver = new PhalaProver(ENDPOINT, verifier, att.measurement);

log("\n[2] proving cross_netting INSIDE the enclave (sealed witness: A owes 0.30, B owes 0.18) …");
// witness: net = |aOwesB - bOwesA| = 0.12, payerIsA = 1 (A owes more)
const input = { net: "1200000", payerIsA: "1", context: "1", aOwesB: "3000000", bOwesA: "1800000" };
const proof = await teeProver.prove({ wasmPath: "", zkeyPath: "", circuit: "cross_netting" }, input);
log(`    enclave returned proof (${proof.publicSignals.length} public signals: net=${proof.publicSignals[0]}, payerIsA=${proof.publicSignals[1]})`);
const ok = await cli.view(dep.verifier, SOURCE, [
  "verify_proof", "--vk_id", "NETTING",
  "--proof", JSON.stringify(proof.sorobanProof),
  "--public_inputs", JSON.stringify(proof.sorobanPublics),
]);
log(`    on-chain verify_proof NETTING => ${ok}`);
if (ok !== true) { console.error("❌ enclave org proof did NOT verify on-chain"); process.exit(1); }
log("    ✅ ENCLAVE-PRODUCED org (cross_netting) proof verified ON-CHAIN — grosses never left the TEE");

log("\n[3] NEGATIVE — wrong measurement pin must withhold the witness …");
const badProver = new PhalaProver(ENDPOINT, verifier, "deadbeef".repeat(8));
let blocked = false;
try { await badProver.prove({ wasmPath: "", zkeyPath: "", circuit: "cross_netting" }, input); }
catch (e) { blocked = /measurement mismatch/.test(String(e?.message)); log(`    refused: ${e?.message}`); }
if (!blocked) { console.error("❌ witness sent to a non-matching enclave!"); process.exit(1); }
log("    ✅ witness withheld from a non-matching enclave");

log("\n=== Z0 LIVE PASSED — business proving runs on the attested TEE and verifies ON-CHAIN ===");
log(JSON.stringify({ endpoint: ENDPOINT, composeHash: att.composeHash, tcbStatus: att.status, orgProof: "verify_proof NETTING => true", witness: "ECIES-sealed to attested X25519 key" }, null, 2));
process.exit(0);
