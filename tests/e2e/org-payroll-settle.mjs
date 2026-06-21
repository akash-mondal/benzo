/**
 * Confidential PAYROLL via the SDK's BenzoPoolClient.transferOrg (M-of-N).
 *
 * Proves the *product* path (not an inline witness): the org treasury is an org
 * note (M-of-N owned); each payout spends it via pool.transfer_org under a
 * 2-of-3 quorum, paying the employee and rolling the remainder into a fresh
 * CHANGE org note so the treasury stays confidential AND dual-controlled across
 * payouts. Individual salaries are never revealed on-chain (each is its own
 * confidential transfer; amounts live only in commitments). Then an employee
 * withdraws their note → real USDC exits.
 *
 *   payroll run:  treasury(0.3) --transfer_org--> [empA 0.1 | change-org 0.2]
 *                 change(0.2)   --transfer_org--> [empB 0.1 | change-org 0.1]
 *   employee A withdraws 0.1 -> public account (real USDC out)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/org-payroll-settle.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BenzoPoolClient, StellarCli, NodeProver, configFromEnv,
  MvkRegistryMirror, DEFAULT_MVK_KEY_META, fetchMvkRegistryLeaves,
  buildOrgIdentity, generateOrgMember, signOrgSpend,
  deriveKeypair, deriveTvk, generateViewingKeypair, viewingPubToScalar,
  encodeNotePlain, seal, randomFieldElement, aspLeaf,
} from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const log = (...a) => console.log(...a);
const explorer = (tx) => `https://stellar.expert/explorer/testnet/tx/${tx}`;
const hex = (u8) => Buffer.from(u8).toString("hex");

const sender = process.env.DEPLOYER_PUBLIC;
const exitAccount = process.env.ANCHOR_DISTRIBUTION_PUBLIC;
const relayerAddr = process.env.RELAYER_PUBLIC;
if (!sender || !exitAccount || !relayerAddr) throw new Error("load .env (DEPLOYER_PUBLIC, ANCHOR_DISTRIBUTION_PUBLIC, RELAYER_PUBLIC)");

const circuits = Object.fromEntries(
  ["shield", "joinsplit", "unshield"].map((c) => [c, {
    wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`,
    zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey`,
  }]),
);
// the M-of-N org circuit (TEE-rotated canonical proving key)
circuits.joinsplitOrg = {
  wasmPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org_js/joinsplit_org.wasm`,
  zkeyPath: `${repo}/circuits/build/joinsplit_org/joinsplit_org.zkey`,
};

const client = new BenzoPoolClient(cli, {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
}, circuits, "benzo-deployer", new NodeProver());

async function usdcBalance(account) {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${account}`);
  if (!res.ok) return "0";
  const body = await res.json();
  const line = body.balances.find((b) => b.asset_code === "USDC" && b.asset_issuer === process.env.USDC_ISSUER);
  return line ? line.balance : "0";
}

log("=== Confidential PAYROLL via SDK transferOrg (M-of-N) — live testnet ===");
log(`pool=${dep.pool}  (JSPLITORG = TEE-rotated VK)`);

const assetId = await client.assetId();

// --- 0. sync mirrors from chain -----------------------------------------
const { fetchAspLeaves, BenzoIndexer, syncFromRpc } = await import("@benzo/indexer");
client.aspRebuild(await fetchAspLeaves(process.env.SOROBAN_RPC_URL, dep.aspMembership, 1));
const poolIdx = new BenzoIndexer(dep.treeLevels, 1);
await syncFromRpc(poolIdx, process.env.SOROBAN_RPC_URL, [dep.pool], 1);
client.poolRebuild(poolIdx.orderedLeaves());
await client.assertSynced();
log(`[0] mirrors synced (pool root=${client.poolTree.root()})`);

// --- 0b. org auditor MVK: register on-chain + use shared mirror ----------
const orgMvk = generateViewingKeypair();
const orgMvkScalar = viewingPubToScalar(orgMvk.publicKey);
const orgTvk = deriveTvk(orgMvk.secret, "2026-Q2/payroll");
const mvkReg = new MvkRegistryMirror();
mvkReg.syncLeaves(await fetchMvkRegistryLeaves(process.env.SOROBAN_RPC_URL, dep.mvkRegistry, 1));
await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true,
  fnArgs: ["register_mvk", "--mvk_pub", orgMvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] });
mvkReg.register(orgMvkScalar, DEFAULT_MVK_KEY_META);
client.useMvkRegistry(mvkReg);
log(`[0b] org auditor MVK registered; registeredMvkRoot=${mvkReg.root()}`);

// --- 0c. ASP-allowlist the depositor ------------------------------------
const aspBlinding = randomFieldElement();
const allowLeaf = aspLeaf(await client.depositorScalar(sender), aspBlinding);
await cli.invoke({ contractId: dep.aspMembership, source: "benzo-deployer", send: true,
  fnArgs: ["insert_leaf", "--leaf", allowLeaf.toString()] });
const aspLeafIndex = client.aspMirrorInsert(allowLeaf);
log(`[0c] depositor allowlisted (asp leaf ${aspLeafIndex})`);

// --- the ORG identity: a real 2-of-3 member set -------------------------
const members = [await generateOrgMember(), await generateOrgMember(), await generateOrgMember()];
const akGroup = randomFieldElement();
const org = await buildOrgIdentity(members, 2n, akGroup);
log(`[org] 2-of-3 member set; recipientPk=${org.recipientPk}`);
log(`      memberRoot=${org.memberRoot}`);

// --- 1. SHIELD the treasury into an ORG note ----------------------------
const TREASURY = 3_000_000n; // 0.3 USDC
let orgNote = { amount: TREASURY, recipientPk: org.recipientPk, blinding: randomFieldElement(), assetId };
const orgPlain = encodeNotePlain(orgNote);
const sh = await client.shield({
  source: "benzo-deployer", from: sender, note: orgNote, mvkPubScalar: orgMvkScalar,
  aspBlinding, aspLeafIndex,
  noteCt: seal(orgPlain, orgMvk.publicKey).bytes, mvkCt: seal(orgPlain, orgTvk.publicKey).bytes,
});
let treasuryLeaf = sh.leafIndex;
log(`[1] SHIELD treasury ${TREASURY} -> ORG note @ leaf ${treasuryLeaf} (tx ${sh.txHash})`);
log(`    ${explorer(sh.txHash)}`);

// helper: one confidential payout via M-of-N transfer_org -----------------
async function payout({ label, treasuryNote, treasuryLeaf, pay, employeeSpendSk, signerIndices, useApproverCallback }) {
  const employeeKp = deriveKeypair(employeeSpendSk);
  const employeeView = generateViewingKeypair();
  const change = treasuryNote.amount - pay; // fee 0
  const out0 = { amount: pay, recipientPk: employeeKp.publicKey, blinding: randomFieldElement(), assetId };
  const out1 = { amount: change, recipientPk: org.recipientPk, blinding: randomFieldElement(), assetId };
  const out0Plain = encodeNotePlain(out0), out1Plain = encodeNotePlain(out1);
  // optional: model true maker-checker self-signing (each approver signs)
  const sign = useApproverCallback
    ? async (memberIndex, message) => signOrgSpend(org.members[memberIndex], message)
    : undefined;
  const r = await client.transferOrg({
    source: "benzo-deployer", org, signerIndices,
    input: { note: treasuryNote, leafIndex: treasuryLeaf },
    outputs: [
      { note: out0, mvkPubScalar: orgMvkScalar },
      { note: out1, mvkPubScalar: orgMvkScalar },
    ],
    fee: 0n, relayer: relayerAddr,
    noteCts: [seal(out0Plain, employeeView.publicKey).bytes, seal(out1Plain, orgMvk.publicKey).bytes],
    mvkCts: [seal(out0Plain, orgTvk.publicKey).bytes, seal(out1Plain, orgTvk.publicKey).bytes],
    sign,
  });
  const orgSpent = await cli.view(dep.nullifierSet, "benzo-deployer", ["is_spent", "--nullifier", r.nullifiers[0].toString()]);
  log(`[pay:${label}] paid ${pay} to employee, change ${change} -> new org note; proved in ${r.provingMs}ms`);
  log(`    transfer_org tx ${r.txHash}  (org nullifier spent=${orgSpent})`);
  log(`    ${explorer(r.txHash)}`);
  if (orgSpent !== true) { console.error("❌ org nullifier not spent"); process.exit(1); }
  return {
    employeeNote: out0, employeeSpendSk, employeeLeaf: r.outLeafIndices[0],
    changeNote: out1, changeLeaf: r.outLeafIndices[1],
  };
}

// --- 2. payroll run: two confidential payouts, treasury stays M-of-N -----
const empA = await payout({
  label: "A", treasuryNote: orgNote, treasuryLeaf, pay: 1_000_000n,
  employeeSpendSk: randomFieldElement(), signerIndices: [0, 1], useApproverCallback: false,
});
// payout #2 spends the CHANGE org note (still dual-controlled) — different quorum [1,2]
const empB = await payout({
  label: "B", treasuryNote: empA.changeNote, treasuryLeaf: empA.changeLeaf, pay: 1_000_000n,
  employeeSpendSk: randomFieldElement(), signerIndices: [1, 2], useApproverCallback: true,
});
log(`[2] payroll run settled: 2 employees paid, treasury rolled to a fresh org note (${empB.changeNote.amount} left)`);

// --- 3. sub-threshold guard (client refuses < threshold approvals) -------
let guarded = false;
try {
  await client.transferOrg({
    source: "benzo-deployer", org, signerIndices: [0], // only 1 < threshold 2
    input: { note: empB.changeNote, leafIndex: empB.changeLeaf },
    outputs: [
      { note: { amount: 1n, recipientPk: deriveKeypair(1n).publicKey, blinding: 1n, assetId }, mvkPubScalar: orgMvkScalar },
      { note: { amount: empB.changeNote.amount - 1n, recipientPk: org.recipientPk, blinding: 2n, assetId }, mvkPubScalar: orgMvkScalar },
    ],
    fee: 0n, relayer: relayerAddr,
    noteCts: [seal(new Uint8Array(8), orgMvk.publicKey).bytes, seal(new Uint8Array(8), orgMvk.publicKey).bytes],
    mvkCts: [seal(new Uint8Array(8), orgTvk.publicKey).bytes, seal(new Uint8Array(8), orgTvk.publicKey).bytes],
  });
} catch { guarded = true; }
log(`[3] sub-threshold payout (1-of-3) refused by dual-control = ${guarded}`);
if (!guarded) { console.error("❌ sub-threshold payout was NOT refused"); process.exit(1); }

// --- 4. employee A withdraws their note -> real USDC exits ---------------
const beforeExit = await usdcBalance(exitAccount);
const exitChangeKp = deriveKeypair(randomFieldElement());
const exitChange = { amount: 0n, recipientPk: exitChangeKp.publicKey, blinding: randomFieldElement(), assetId };
const exitPlain = encodeNotePlain(exitChange);
const exitView = generateViewingKeypair();
const wd = await client.withdraw({
  source: "benzo-deployer",
  input: { note: empA.employeeNote, spendSk: empA.employeeSpendSk, leafIndex: empA.employeeLeaf },
  amount: empA.employeeNote.amount, to: exitAccount,
  changeNote: exitChange, changeMvkPubScalar: orgMvkScalar,
  changeNoteCt: seal(exitPlain, exitView.publicKey).bytes, changeMvkCt: seal(exitPlain, orgTvk.publicKey).bytes,
});
const afterExit = await usdcBalance(exitAccount);
log(`[4] employee A withdrew ${empA.employeeNote.amount} -> ${exitAccount}: USDC ${beforeExit} -> ${afterExit} (tx ${wd.txHash})`);
log(`    ${explorer(wd.txHash)}`);
if (!(Number(afterExit) > Number(beforeExit))) { console.error("❌ exit USDC did not increase"); process.exit(1); }

log(`\n✅ CONFIDENTIAL PAYROLL via SDK transferOrg, ON-CHAIN:`);
log(`   • treasury is an M-of-N org note; each payout settled via pool.transfer_org (2-of-3 quorum)`);
log(`   • two employees paid; individual amounts never revealed on-chain (separate confidential transfers)`);
log(`   • treasury change rolled into a fresh org note each time — stays confidential AND dual-controlled`);
log(`   • a sub-threshold (1-of-3) payout is refused by dual control`);
log(`   • employee withdrew their pay to a public account — real USDC exited`);
log(`   ⇒ the PRODUCT pay flow now goes through M-of-N, not the single-key path.`);
