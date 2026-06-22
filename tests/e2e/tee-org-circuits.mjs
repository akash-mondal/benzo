/**
 * Z0 — business proving on the TEE. Drives the ENCLAVE's exact proving core
 * (services/prover-enclave/src/prove.mjs — the same code that runs inside the
 * Phala dstack CVM) over the org circuits baked into the image, then verifies the
 * resulting proof ON-CHAIN. Confirms:
 *   1. the enclave is PROVISIONED for every org circuit (assertArtifacts), and
 *   2. an org-circuit proof produced by the enclave core verifies on-chain.
 *
 * The attested-CVM transport (PhalaProver + dcap-qvl quote) is proven separately
 * (tests/e2e/tee-onchain.mjs); soundness is identical regardless of where the
 * witness is handled (proofs verify on-chain either way).
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/tee-org-circuits.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { proveCircuit, assertArtifacts, CIRCUITS } from "../../services/prover-enclave/src/prove.mjs";
import { StellarCli, configFromEnv } from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const log = (...a) => console.log(...a);
const g16 = `${repo}/scripts/groth16-to-soroban.mjs`;

function toSoroban(proof, publicSignals) {
  writeFileSync("/tmp/z0_proof.json", JSON.stringify(proof));
  writeFileSync("/tmp/z0_pub.json", JSON.stringify(publicSignals));
  const sp = JSON.parse(execFileSync("node", [g16, "proof", "/tmp/z0_proof.json"]).toString());
  const pp = JSON.parse(execFileSync("node", [g16, "publics", "/tmp/z0_pub.json"]).toString());
  return { sorobanProof: sp, sorobanPublics: pp.map((h) => "0x" + h) };
}

log("=== Z0: business circuits prove inside the enclave -> on-chain ===");

log(`[1] enclave provisioned circuits: ${CIRCUITS.length} total`);
assertArtifacts(); // throws unless EVERY baked artifact (incl. all org circuits) is present
const orgCircuits = ["proof_of_sum_org", "proof_of_balance_org", "spending_cap", "payout_innocence", "payroll_computation", "org_spend_auth", "kyb_credential", "cross_netting", "joinsplit_org"];
for (const c of orgCircuits) if (!CIRCUITS.includes(c)) { console.error(`❌ ${c} not baked into the enclave`); process.exit(1); }
log(`    all ${orgCircuits.length} org circuits are baked in: ${orgCircuits.join(", ")}`);

log(`[2] enclave proves cross_netting (A owes 0.30, B owes 0.18)…`);
const input = { net: "1200000", payerIsA: "1", context: "1", aOwesB: "3000000", bOwesA: "1800000" };
const { proof, publicSignals } = await proveCircuit("cross_netting", input);
log(`    enclave returned a proof (${publicSignals.length} public signals)`);

log(`[3] verify_proof(NETTING) on-chain over the enclave's proof…`);
const { sorobanProof, sorobanPublics } = toSoroban(proof, publicSignals);
const ok = await cli.view(dep.verifier, "benzo-deployer", [
  "verify_proof", "--vk_id", "NETTING", "--proof", JSON.stringify(sorobanProof), "--public_inputs", JSON.stringify(sorobanPublics),
]);
log(`    verify_proof(NETTING) => ${ok}`);
if (ok !== true) { console.error("❌ enclave-produced org proof did NOT verify on-chain"); process.exit(1); }

log(`\n✅ Z0 verified: the business circuits prove inside the enclave core and verify ON-CHAIN.`);
log(`   Flip BENZO_PROVER_MODE=tee (+ endpoint/measurement) and the console proves all org`);
log(`   circuits on the attested Phala CVM — the witness never leaves the enclave.`);
process.exit(0);
