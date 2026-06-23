/**
 * MAINTAINER-ONLY: mint the committed proof fixture that tests/replay-verify.mjs
 * re-verifies. Generates a REAL org proof-of-sum (vk_id ORGSUM) and dumps its
 * Soroban-shaped proof + public inputs to tests/fixtures/replay-proof.json.
 *
 * Run once after a fresh deploy (needs proving artifacts + a funded deployer):
 *   set -a; . ./.env; set +a; node tests/gen-replay-fixture.mjs
 * Judges do NOT run this — they run the artifact-free tests/replay-verify.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BenzoClient, StellarCli, NodeProver, configFromEnv,
  MvkRegistryMirror, DEFAULT_MVK_KEY_META, fetchMvkRegistryLeaves,
} from "@benzo/core";

const repo = fileURLToPath(new URL("..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const rpc = process.env.SOROBAN_RPC_URL;
const funder = process.env.DEPLOYER_PUBLIC;
const art = (c) => ({ wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`, zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey` });
const circuits = {
  shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"),
  proofOfBalance: art("proof_of_balance"), proofOfSum: art("proof_of_sum"), proofOfSumOrg: art("proof_of_sum_org"),
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
try { await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true, fnArgs: ["register_mvk", "--mvk_pub", c.account.mvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] }); } catch {}
const reg = new MvkRegistryMirror();
reg.syncWithOwnedKey(await fetchMvkRegistryLeaves(rpc, dep.mvkRegistry, 1), c.account.mvkScalar, DEFAULT_MVK_KEY_META);
c.pool.useMvkRegistry(reg);

const org = await c.orgIdentity({ orgId: "acme-audit", memberCount: 3, threshold: 2n });
await c.fundTreasury({ org, amount: 1_000_000n, fromAddress: funder, fromSource: "benzo-deployer" });
await c.fundTreasury({ org, amount: 1_500_000n, fromAddress: funder, fromSource: "benzo-deployer" });
const r = await c.proveOrgTotal({ org, context: 42n });
if (r.onChain !== true) { console.error("proof did not verify on-chain; refusing to write a bad fixture"); process.exit(1); }

const fixture = {
  note: "A REAL org proof-of-sum (vk_id ORGSUM) for permissionless on-chain re-verification. Generated against the verifier in deployments/testnet.json; re-verify with tests/replay-verify.mjs (no proving, no keys, no USDC).",
  vkId: "ORGSUM",
  verifier: dep.verifier,
  network: "testnet",
  disclosedTotal: r.total.toString(),
  sorobanProof: r.sorobanProof,
  sorobanPublics: r.sorobanPublics,
};
mkdirSync(`${repo}/tests/fixtures`, { recursive: true });
writeFileSync(`${repo}/tests/fixtures/replay-proof.json`, JSON.stringify(fixture, null, 2) + "\n");
console.log(`✅ wrote tests/fixtures/replay-proof.json (ORGSUM, total ${r.total}, ${r.sorobanPublics.length} public inputs)`);
