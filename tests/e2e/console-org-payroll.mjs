/**
 * Console-LAYER confidential payroll via BenzoClient.orgPayroll (M-of-N).
 *
 * Exercises the exact SDK surface the business console-api calls — NOT an inline
 * witness and NOT the low-level pool client. Proves the console's pay path now
 * routes through pool.transfer_org (dual control), end to end, with real USDC:
 *
 *   1. derive the org's M-of-N identity from the account seed (deterministic)
 *   2. fundTreasury  -> shield real USDC into an ORG note (recipientPk = M-of-N)
 *   3. orgPayroll    -> one transfer_org per employee (2-of-3 quorum), change
 *                       rolls into a fresh org note (treasury stays dual-controlled)
 *   4. an employee rediscovers their pay in a FRESH wallet client (console -> wallet)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/console-org-payroll.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BenzoClient, StellarCli, NodeProver, configFromEnv, createAccount, paymentAddress,
  MvkRegistryMirror, DEFAULT_MVK_KEY_META, fetchMvkRegistryLeaves, mvkRegistryLeaf,
} from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const rpc = process.env.SOROBAN_RPC_URL;
const log = (...a) => console.log(...a);
const explorer = (tx) => `https://stellar.expert/explorer/testnet/tx/${tx}`;
const funder = process.env.DEPLOYER_PUBLIC;
const relayerAddr = process.env.RELAYER_PUBLIC;
if (!funder || !relayerAddr || !rpc) throw new Error("load .env (DEPLOYER_PUBLIC, RELAYER_PUBLIC, SOROBAN_RPC_URL)");

const art = (c) => ({
  wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`,
  zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey`,
});
const circuits = {
  shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"),
  proofOfBalance: art("proof_of_balance"), proofOfSum: art("proof_of_sum"),
  joinsplitOrg: {
    wasmPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org_js/joinsplit_org.wasm`,
    zkeyPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org.zkey`,
  },
};
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};

function makeClient() {
  const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
  return c;
}

// wire the account MVK into a chain-synced registry mirror (so check_mvk_root passes)
async function wireMvk(c) {
  try {
    await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true,
      fnArgs: ["register_mvk", "--mvk_pub", c.account.mvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] });
  } catch { /* already registered */ }
  const reg = new MvkRegistryMirror();
  const leaves = await fetchMvkRegistryLeaves(rpc, dep.mvkRegistry, 1);
  reg.syncWithOwnedKey(leaves, c.account.mvkScalar, DEFAULT_MVK_KEY_META);
  c.pool.useMvkRegistry(reg);
  return reg;
}

log("=== Console-layer confidential payroll (BenzoClient.orgPayroll, M-of-N) ===");
log(`pool=${dep.pool}  (JSPLITORG = TEE-rotated VK)`);

// --- the org (employer) -------------------------------------------------
const org = makeClient();
org.createAccount("acme-treasury");
await wireMvk(org);
const orgId = await org.orgIdentity({ orgId: "acme", memberCount: 3, threshold: 2n });
log(`[org] derived 2-of-3 identity; recipientPk=${orgId.recipientPk}`);
log(`      memberRoot=${orgId.memberRoot} (deterministic from account seed)`);

// --- 1. fund the treasury (shield into an org note) ---------------------
const TREASURY = 4_000_000n; // 0.4 USDC
const f = await org.fundTreasury({ org: orgId, amount: TREASURY, fromAddress: funder, fromSource: "benzo-deployer" });
log(`[1] fundTreasury ${TREASURY} -> org note @ leaf ${f.leafIndex} (tx ${f.txHash})`);
log(`    ${explorer(f.txHash)}`);
const bal0 = await org.orgTreasuryBalance(orgId);
log(`    treasury balance (rediscovered from chain) = ${bal0}`);
if (bal0 < TREASURY) { console.error(`❌ treasury balance ${bal0} < funded ${TREASURY}`); process.exit(1); }

// --- 2. employees (consumer-wallet recipients) --------------------------
const empAClient = makeClient(); empAClient.createAccount("grace");
const empBClient = makeClient(); empBClient.createAccount("ada");
const empA = paymentAddress(empAClient.account);
const empB = paymentAddress(empBClient.account);

// --- 3. confidential payroll run via M-of-N transfer_org ---------------
log(`[3] orgPayroll: 2 confidential payouts under a 2-of-3 quorum (signers [0,1])…`);
const res = await org.orgPayroll({
  org: orgId,
  payouts: [
    { to: empA, amount: 1_000_000n, memo: "2026-06 salary" },
    { to: empB, amount: 1_500_000n, memo: "2026-06 salary" },
  ],
  signerIndices: [0, 1],
  relayer: relayerAddr,
});
for (const r of res) log(`    paid ${r.amount} to ${r.to.label} — tx ${r.txHash} (${r.provingMs}ms)  ${explorer(r.txHash)}`);
const bal1 = await org.orgTreasuryBalance(orgId);
log(`    treasury balance after run = ${bal1} (expected ${TREASURY - 2_500_000n})`);
if (bal1 !== TREASURY - 2_500_000n) { console.error(`❌ treasury balance ${bal1} != ${TREASURY - 2_500_000n}`); process.exit(1); }

// --- 4. console -> wallet: employee A rediscovers their pay -------------
await empAClient.sync();
const empABal = await empAClient.getBalance();
log(`[4] employee A (fresh wallet client) discovered shielded balance = ${empABal} (expected 1000000)`);
if (empABal !== 1_000_000n) { console.error(`❌ employee A balance ${empABal} != 1000000`); process.exit(1); }

log(`\n✅ CONSOLE-LAYER confidential payroll, ON-CHAIN:`);
log(`   • org treasury funded as an M-of-N org note via BenzoClient.fundTreasury`);
log(`   • BenzoClient.orgPayroll settled each payout via pool.transfer_org (2-of-3 quorum)`);
log(`   • treasury rediscovered from chain (no backend storage) — change stays dual-controlled`);
log(`   • an employee rediscovered their pay in a fresh wallet client (console -> wallet interop)`);
log(`   ⇒ the console's pay path is wired through M-of-N dual control, not single-key.`);
