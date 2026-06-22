/**
 * ORG proof-of-balance (funded ✓ / reserves / solvency) -> verified ON-CHAIN
 * (vk_id ORGBAL). Funds an org treasury note, then:
 *   - prove treasury >= a floor it covers     => holds true, on-chain true
 *   - prove treasury >= a floor it can't cover => holds false (no proof)
 * Reveals only the threshold, never the balance.
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/org-balance-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BenzoClient, StellarCli, NodeProver, configFromEnv,
  MvkRegistryMirror, DEFAULT_MVK_KEY_META, fetchMvkRegistryLeaves,
} from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const rpc = process.env.SOROBAN_RPC_URL;
const funder = process.env.DEPLOYER_PUBLIC;
const log = (...a) => console.log(...a);
const art = (c) => ({ wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`, zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey` });
const circuits = {
  shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"),
  proofOfBalance: art("proof_of_balance"), proofOfSum: art("proof_of_sum"),
  proofOfSumOrg: art("proof_of_sum_org"), proofOfBalanceOrg: art("proof_of_balance_org"),
  joinsplitOrg: { wasmPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org_js/joinsplit_org.wasm`, zkeyPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org.zkey` },
};
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("acme-funded");
async function wireMvk() {
  try { await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true, fnArgs: ["register_mvk", "--mvk_pub", c.account.mvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] }); } catch {}
  const reg = new MvkRegistryMirror();
  reg.syncWithOwnedKey(await fetchMvkRegistryLeaves(rpc, dep.mvkRegistry, 1), c.account.mvkScalar, DEFAULT_MVK_KEY_META);
  c.pool.useMvkRegistry(reg);
}

log("=== ORG proof-of-balance (funded ✓ / reserves / solvency) -> on-chain ===");
await wireMvk();
const org = await c.orgIdentity({ orgId: "acme-funded", memberCount: 3, threshold: 2n });
const f = await c.fundTreasury({ org, amount: 3_000_000n, fromAddress: funder, fromSource: "benzo-deployer" });
log(`[1] funded treasury 0.3 USDC (tx ${f.txHash?.slice(0,8)}…)`);

log(`[2] "Payroll funded ✓" — prove treasury >= run total 0.25 (covered)…`);
const ok = await c.proveOrgBalance({ org, minTotal: 2_500_000n, context: 1n });
log(`    holds=${ok.holds} verify_proof(ORGBAL) on-chain=${ok.onChain}`);
if (!(ok.holds && ok.onChain)) { console.error("❌ funded proof should verify on-chain"); process.exit(1); }

log(`[3] over-budget — prove treasury >= 0.9 (NOT covered) must be refused…`);
const no = await c.proveOrgBalance({ org, minTotal: 9_000_000n, context: 2n });
log(`    holds=${no.holds} (must be false; treasury can't cover -> no proof)`);
if (no.holds) { console.error("❌ over-budget run should NOT prove funded"); process.exit(1); }

log(`\n✅ ORG proof-of-balance verified ON-CHAIN (ORGBAL):`);
log(`   • treasury >= run total proven (funded ✓) without revealing the balance`);
log(`   • an over-budget run is provably blocked (no proof)`);
log(`   ⇒ one circuit powers funded✓, reserves-to-lender, and solvency (different floors).`);
process.exit(0); // BenzoClient keeps an RPC keep-alive socket open; exit cleanly for CI.
