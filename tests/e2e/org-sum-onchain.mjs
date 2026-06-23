/**
 * ORG proof-of-sum (auditor disclose-total over the M-of-N treasury) -> verified
 * ON-CHAIN (vk_id ORGSUM). Funds two org treasury notes, proves their EXACT total
 * with a Groth16 proof, and confirms:
 *   - verify_proof(ORGSUM) over the real total  => true
 *   - a tampered claimedTotal public input       => false (fail-closed)
 * Reveals only the total — never an individual amount.
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/org-sum-onchain.mjs
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
const ex = (tx) => `https://stellar.expert/explorer/testnet/tx/${tx}`;
const art = (c) => ({ wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`, zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey` });
const circuits = {
  shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"),
  proofOfBalance: art("proof_of_balance"), proofOfSum: art("proof_of_sum"),
  proofOfSumOrg: art("proof_of_sum_org"),
  joinsplitOrg: { wasmPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org_js/joinsplit_org.wasm`, zkeyPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org.zkey` },
};
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("acme-audit");
async function wireMvk() {
  try { await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true, fnArgs: ["register_mvk", "--mvk_pub", c.account.mvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] }); } catch {}
  const reg = new MvkRegistryMirror();
  reg.syncWithOwnedKey(await fetchMvkRegistryLeaves(rpc, dep.mvkRegistry, 1), c.account.mvkScalar, DEFAULT_MVK_KEY_META);
  c.pool.useMvkRegistry(reg);
}

log("=== ORG proof-of-sum (auditor disclose-total) -> on-chain verify ===");
await wireMvk();
const org = await c.orgIdentity({ orgId: "acme-audit", memberCount: 3, threshold: 2n });

// fund two org treasury notes so the sum spans multiple notes
const a = await c.fundTreasury({ org, amount: 1_000_000n, fromAddress: funder, fromSource: "benzo-deployer" });
const b = await c.fundTreasury({ org, amount: 1_500_000n, fromAddress: funder, fromSource: "benzo-deployer" });
log(`[1] funded two org notes: 0.1 (tx ${a.txHash}) + 0.15 (tx ${b.txHash})`);
log(`    ${ex(a.txHash)}`);
log(`    ${ex(b.txHash)}`);

log(`[2] proving ORG sum over the treasury notes…`);
const r = await c.proveOrgTotal({ org, context: 42n });
log(`    disclosed total = ${r.total} (expected >= 2500000)`);
log(`    verify_proof(ORGSUM) on-chain => ${r.onChain}`);
if (r.onChain !== true) { console.error("❌ org-sum proof did NOT verify on-chain"); process.exit(1); }
if (r.total < 2_500_000n) { console.error(`❌ total ${r.total} < funded 2500000`); process.exit(1); }

log(`[3] adversarial: tamper the claimedTotal public input (index 1)…`);
const tampered = [...r.sorobanPublics];
tampered[1] = (BigInt(tampered[1]) + 1n).toString();
let bad;
try { bad = await c.verifyProofOnChain("ORGSUM", r.sorobanProof, tampered); } catch { bad = false; }
log(`    verify_proof(ORGSUM) with a forged total => ${bad} (must be false)`);
if (bad === true) { console.error("❌ tampered org-sum WRONGLY verified"); process.exit(1); }

log(`\n✅ ORG proof-of-sum verified ON-CHAIN (vk_id ORGSUM):`);
log(`   • the M-of-N treasury total is disclosed as a real Groth16 proof — only the total, no individual amount`);
log(`   • a forged total is rejected (fail-closed)`);
log(`   ⇒ auditor disclosure over org notes is now a true on-chain ZK proof, not a view-key reveal.`);
process.exit(0);
