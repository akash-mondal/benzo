/**
 * Cross-entity private netting (Z8) -> verified ON-CHAIN (vk_id NETTING).
 * Two orgs net mutual invoices and settle only the difference, grosses hidden.
 *   - A owes 0.30, B owes 0.18 => net 0.12, A pays; verify on-chain true
 *   - claim the WRONG payer direction => rejected (false | error)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/cross-netting-onchain.mjs
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
const circuits = { shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"), crossNetting: art("cross_netting") };
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });

log("=== Cross-entity private netting (settle the difference, grosses hidden) -> on-chain (NETTING) ===");

log("[1] A owes B 0.30, B owes A 0.18 -> prove the net…");
const r = await c.proveCrossNetting({ aOwesB: 3_000_000n, bOwesA: 1_800_000n, context: 1n });
log(`    net = ${r.net} (0.12 USDC), payerIsA = ${r.payerIsA}`);
log(`    verify_proof(NETTING) on-chain => ${r.onChain}`);
if (!(r.onChain && r.net === 1_200_000n && r.payerIsA === 1n)) { console.error("❌ netting should verify on-chain at net 0.12, A pays"); process.exit(1); }

log("[2] adversarial: claim B pays (wrong direction) -> must be rejected…");
const forged = [...r.sorobanPublics];
forged[1] = "0x0"; // payerIsA = 0 (claim B pays) — but A owes more
let bad;
try {
  bad = await cli.view(dep.verifier, "benzo-deployer", [
    "verify_proof", "--vk_id", "NETTING", "--proof", JSON.stringify(r.sorobanProof), "--public_inputs", JSON.stringify(forged),
  ]);
} catch { bad = "rejected"; }
log(`    verify_proof(NETTING) with the wrong direction => ${bad} (rejected: false | error)`);
if (bad === true) { console.error("❌ wrong direction must be rejected"); process.exit(1); }

log(`\n✅ Cross-entity private netting verified ON-CHAIN (NETTING):`);
log(`   • two parties net mutual invoices and settle only the difference`);
log(`   • the net + payer are proven correct; neither gross invoice total is revealed`);
process.exit(0);
