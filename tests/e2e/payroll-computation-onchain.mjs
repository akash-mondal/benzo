/**
 * Verifiable payroll computation (Z6) -> verified ON-CHAIN (vk_id PAYCOMP).
 * Proves runTotal + per-line commitments were derived from a PRIVATE rate card
 * (gross = rate*period - deductions, runTotal = Σ gross). Rate card never revealed.
 *   - honest run            => verify_proof(PAYCOMP) on-chain true
 *   - tampered public total  => on-chain false (fail-closed)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/payroll-computation-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BenzoClient, StellarCli, NodeProver, configFromEnv } from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const rpc = process.env.SOROBAN_RPC_URL;
const log = (...a) => console.log(...a);
const art = (c) => ({ wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`, zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey` });
const circuits = { shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"), payrollComputation: art("payroll_computation") };
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("contractor-a");
const a = c.address().spendPub;
c.createAccount("contractor-b");
const b = c.address().spendPub;

log("=== Verifiable payroll computation (rate card private) -> on-chain (PAYCOMP) ===");
// Private rate card: A = 0.20/mo x 1mo - 0 = 0.20 ; B = 0.15/mo x 1mo - 0.05 = 0.10
const lines = [
  { rate: 2_000_000n, period: 1n, deductions: 0n, recipientPk: a, blinding: 11n },
  { rate: 1_500_000n, period: 1n, deductions: 500_000n, recipientPk: b, blinding: 22n },
];

log("[1] proving the run was correctly computed from the private rate card…");
const r = await c.proveOrgPayrollComputation({ lines, context: 1n });
log(`    computed runTotal = ${r.runTotal} (0.30 USDC), commitDigest bound`);
log(`    verify_proof(PAYCOMP) on-chain => ${r.onChain}`);
if (!(r.ok && r.onChain && r.runTotal === 3_000_000n)) { console.error("❌ honest computation should verify on-chain at total 0.30"); process.exit(1); }

log("[2] adversarial: tamper the public runTotal (index 0) -> must be rejected…");
const forged = [...r.sorobanPublics];
forged[0] = "0x" + (123n).toString(16); // a lie about the total
let bad;
try {
  bad = await cli.view(dep.verifier, "benzo-deployer", [
    "verify_proof", "--vk_id", "PAYCOMP", "--proof", JSON.stringify(r.sorobanProof), "--public_inputs", JSON.stringify(forged),
  ]);
} catch {
  bad = "rejected"; // the verifier ERRORS on an invalid proof — also a correct rejection
}
log(`    verify_proof(PAYCOMP) with a forged total => ${bad} (rejected: false | error)`);
if (bad === true) { console.error("❌ forged total must be rejected"); process.exit(1); }

log(`\n✅ Verifiable payroll computation verified ON-CHAIN (PAYCOMP):`);
log(`   • runTotal + per-line commitments proven derived from the rate card (rate×period−deductions)`);
log(`   • the rate card stays private; a forged total is rejected (fail-closed)`);
process.exit(0);
