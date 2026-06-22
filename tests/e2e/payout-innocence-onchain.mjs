/**
 * Per-payout proof-of-innocence (Z4) -> verified ON-CHAIN (vk_id POIPAYOUT).
 * Proves a payout's RECIPIENT is NOT on a sanctions / deny SMT, recipient hidden.
 *   - clean recipient                         => innocent true,  on-chain true
 *   - sanctioned recipient (inserted in deny) => innocent false (find_key found -> no proof)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/payout-innocence-onchain.mjs
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
const circuits = { shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"), payoutInnocence: art("payout_innocence") };
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("clean-recipient");
const clean = c.address();
c.createAccount("sanctioned-recipient");
const sanctioned = c.address();

log("=== Per-payout proof-of-innocence (recipient deny screen) -> on-chain (POIPAYOUT) ===");

// Place the sanctioned recipient's pk on the deny SMT (OFAC-style entry).
log(`[1] sanctioning a recipient: insert recipientPk into the deny SMT…`);
await cli.invoke({
  contractId: dep.aspNonMembership, source: "benzo-deployer", send: true,
  fnArgs: ["insert_leaf", "--key", sanctioned.spendPub.toString(), "--value", "1"],
});
log(`    inserted (deny set now contains the sanctioned recipient).`);

log(`[2] clean recipient — must prove innocent & verify on-chain…`);
const ok = await c.proveOrgPayoutInnocence({ to: clean, amount: 1_000_000n, context: 1n });
log(`    innocent=${ok.innocent} verify_proof(POIPAYOUT) on-chain=${ok.onChain}`);
if (!(ok.innocent && ok.onChain)) { console.error("❌ clean recipient should verify on-chain"); process.exit(1); }

log(`[3] sanctioned recipient — must be refused (in deny set, no proof)…`);
const no = await c.proveOrgPayoutInnocence({ to: sanctioned, amount: 1_000_000n, context: 2n });
log(`    innocent=${no.innocent} (must be false; recipient is on the deny set)`);
if (no.innocent) { console.error("❌ sanctioned recipient should NOT prove innocent"); process.exit(1); }

log(`\n✅ Per-payout proof-of-innocence verified ON-CHAIN (POIPAYOUT):`);
log(`   • a clean recipient is proven not-sanctioned without revealing who`);
log(`   • a sanctioned recipient is provably blocked (no non-inclusion proof exists)`);
process.exit(0);
