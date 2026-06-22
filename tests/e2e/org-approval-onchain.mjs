/**
 * Anonymous approver / surveillance-free dual-control (Z5) -> ON-CHAIN (ORGAUTH).
 * Uses the SDK path the console uses (BenzoClient.proveOrgApproval):
 *   - 2 of 3 approvers sign  => approved true,  on-chain true (which members hidden)
 *   - 1 of 3 (sub-threshold) => approved false (count constraint unsat -> no proof)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/org-approval-onchain.mjs
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
const circuits = { shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"), orgSpendAuth: art("org_spend_auth") };
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("approver-test");

const SEEDS = [11, 12, 13];
const SPEND = 987654321n;

log("=== Anonymous approver / surveillance-free dual-control -> on-chain (ORGAUTH) ===");

log(`[1] 2 of 3 approvers sign — must prove & verify (which members hidden)…`);
const ok = await c.proveOrgApproval({ memberSeeds: SEEDS, signerIndices: [0, 1], threshold: 2n, spendMessage: SPEND });
log(`    approved=${ok.approved} approvers=${ok.approvers}-of-${ok.memberCount} verify_proof(ORGAUTH) on-chain=${ok.onChain}`);
if (!(ok.approved && ok.onChain)) { console.error("❌ 2-of-3 approval should verify on-chain"); process.exit(1); }

log(`[2] only 1 of 3 signs — must be refused (sub-threshold, no proof)…`);
const no = await c.proveOrgApproval({ memberSeeds: SEEDS, signerIndices: [0], threshold: 2n, spendMessage: SPEND });
log(`    approved=${no.approved} (must be false; below threshold)`);
if (no.approved) { console.error("❌ sub-threshold approval should NOT prove"); process.exit(1); }

log(`\n✅ Anonymous approval verified ON-CHAIN (ORGAUTH):`);
log(`   • >= threshold distinct approvers proven, WITHOUT revealing which signed`);
log(`   • a sub-threshold attempt is provably blocked (no proof)`);
process.exit(0);
