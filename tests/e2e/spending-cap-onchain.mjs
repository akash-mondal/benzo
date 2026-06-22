/**
 * In-ZK spending policy (Z3) -> verified ON-CHAIN (vk_id SPENDCAP).
 * Proves a payout's amount is within an approved per-payout cap WITHOUT revealing
 * the amount, bound to the payout's public note commitment.
 *   - payout 0.10 with cap 0.20 (within)   => withinCap true,  on-chain true
 *   - payout 0.50 with cap 0.20 (over)      => withinCap false (constraint unsat -> no proof)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/spending-cap-onchain.mjs
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
const circuits = {
  shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"),
  spendingCap: art("spending_cap"),
};
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("employer");
c.createAccount("contractor");
const recipient = c.address(); // contractor's payment address (spendPub)

log("=== In-ZK spending policy (per-payout cap) -> on-chain (SPENDCAP) ===");
const CAP = 2_000_000n; // 0.20 USDC

log(`[1] payout 0.10 USDC, cap 0.20 (within) — must prove & verify…`);
const ok = await c.proveOrgPayoutCap({ to: recipient, amount: 1_000_000n, cap: CAP, context: 1n });
log(`    withinCap=${ok.withinCap} verify_proof(SPENDCAP) on-chain=${ok.onChain}`);
if (!(ok.withinCap && ok.onChain)) { console.error("❌ within-cap payout should verify on-chain"); process.exit(1); }

log(`[2] payout 0.50 USDC, cap 0.20 (over) — must be refused (no proof)…`);
const no = await c.proveOrgPayoutCap({ to: recipient, amount: 5_000_000n, cap: CAP, context: 2n });
log(`    withinCap=${no.withinCap} (must be false; amount>cap -> constraint unsatisfiable)`);
if (no.withinCap) { console.error("❌ over-cap payout should NOT prove"); process.exit(1); }

log(`\n✅ In-ZK spending policy verified ON-CHAIN (SPENDCAP):`);
log(`   • a within-cap payout proves amount <= cap without revealing the amount`);
log(`   • an over-cap payout is provably blocked (the limit is a circuit constraint)`);
process.exit(0);
