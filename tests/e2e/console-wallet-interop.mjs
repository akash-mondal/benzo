/**
 * Console <-> wallet INTEROP, end to end on live testnet (real USDC):
 *   org funds treasury -> orgPayroll pays a contractor (M-of-N transfer_org)
 *   -> the contractor's OWN wallet client rediscovers the pay from chain
 *   -> the contractor SENDS part of it onward (spends, a consumer joinsplit)
 *   -> the contractor CASHES OUT the rest (withdraw to a public account).
 * The two apps share the protocol, not a backend.
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/console-wallet-interop.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BenzoClient, StellarCli, NodeProver, configFromEnv, createAccount, paymentAddress,
  MvkRegistryMirror, DEFAULT_MVK_KEY_META, fetchMvkRegistryLeaves,
} from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const rpc = process.env.SOROBAN_RPC_URL;
const log = (...a) => console.log(...a);
const ex = (tx) => `https://stellar.expert/explorer/testnet/tx/${tx}`;
const funder = process.env.DEPLOYER_PUBLIC;
const relayerAddr = process.env.RELAYER_PUBLIC;
const exitAccount = process.env.ANCHOR_DISTRIBUTION_PUBLIC;
if (!funder || !relayerAddr || !exitAccount || !rpc) throw new Error("load .env");

const art = (c) => ({ wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`, zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey` });
const circuits = {
  shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"),
  proofOfBalance: art("proof_of_balance"), proofOfSum: art("proof_of_sum"),
  joinsplitOrg: { wasmPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org_js/joinsplit_org.wasm`, zkeyPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org.zkey` },
};
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const makeClient = () => new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
async function wireMvk(c) {
  try { await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true, fnArgs: ["register_mvk", "--mvk_pub", c.account.mvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] }); } catch {}
  const reg = new MvkRegistryMirror();
  reg.syncWithOwnedKey(await fetchMvkRegistryLeaves(rpc, dep.mvkRegistry, 1), c.account.mvkScalar, DEFAULT_MVK_KEY_META);
  c.pool.useMvkRegistry(reg);
}
async function usdc(account) {
  const r = await fetch(`https://horizon-testnet.stellar.org/accounts/${account}`); if (!r.ok) return "0";
  const b = (await r.json()).balances.find((x) => x.asset_code === "USDC" && x.asset_issuer === process.env.USDC_ISSUER); return b ? b.balance : "0";
}

log("=== Console <-> wallet interop (M-of-N payroll -> contractor spends + cashes out) ===");

// --- employer (console) ---
const org = makeClient(); org.createAccount("acme"); await wireMvk(org);
const orgId = await org.orgIdentity({ orgId: "acme-interop", memberCount: 3, threshold: 2n });
const f = await org.fundTreasury({ org: orgId, amount: 5_000_000n, fromAddress: funder, fromSource: "benzo-deployer" });
log(`[1] employer funded treasury 0.5 USDC (tx ${f.txHash})`);

// --- contractor signs up in the wallet (a separate account/app) ---
const contractor = makeClient(); contractor.createAccount("grace-wallet");
const payAddr = paymentAddress(contractor.account);

// --- console pays the contractor via M-of-N transfer_org ---
const pay = await org.orgPayroll({ org: orgId, payouts: [{ to: payAddr, amount: 2_000_000n, memo: "salary" }], signerIndices: [0, 1], relayer: relayerAddr });
log(`[2] console paid contractor 0.2 via transfer_org (2-of-3) — tx ${pay[0].txHash}  ${ex(pay[0].txHash)}`);

// --- contractor's wallet rediscovers the pay from chain ---
await contractor.sync();
const got = await contractor.getBalance();
log(`[3] contractor wallet discovered shielded balance = ${got} (expected 2000000)`);
if (got !== 2_000_000n) { console.error("❌ contractor did not receive pay"); process.exit(1); }

// --- contractor SPENDS part onward (a consumer joinsplit) ---
await wireMvk(contractor);
const friend = createAccount({ label: "friend" });
const sendRes = await contractor.send({ amount: 800_000n, to: paymentAddress(friend), memo: "split dinner" }).settled();
log(`[4] contractor SENT 0.08 onward to a friend (consumer joinsplit) — tx ${sendRes?.txHash}  ${ex(sendRes?.txHash)}`);
if (!sendRes?.txHash) { console.error("❌ contractor send failed"); process.exit(1); }

// --- contractor CASHES OUT the remainder to a public account ---
await contractor.sync();
const remaining = await contractor.getBalance();
const beforeExit = await usdc(exitAccount);
const cashOut = await contractor.unshield({ amount: 1_000_000n, toAddress: exitAccount });
const afterExit = await usdc(exitAccount);
log(`[5] contractor remaining shielded = ${remaining}; cashed out 0.1 to ${exitAccount} — exit USDC ${beforeExit} -> ${afterExit} (tx ${cashOut.txHash})  ${ex(cashOut.txHash)}`);
if (!(Number(afterExit) > Number(beforeExit))) { console.error("❌ cash-out did not increase exit USDC"); process.exit(1); }

log(`\n✅ CONSOLE <-> WALLET INTEROP, ON-CHAIN:`);
log(`   • console paid a contractor via M-of-N transfer_org`);
log(`   • the contractor's own wallet rediscovered the pay from chain (no backend)`);
log(`   • the contractor SPENT part onward (consumer joinsplit) and CASHED OUT the rest`);
log(`   ⇒ the business app and the consumer wallet interoperate over one shielded pool.`);
