/**
 * FULL real-USDC org dual-control SETTLE on live testnet (not just verify_proof).
 *
 * Proves the in-circuit M-of-N org spend end-to-end on the live pool, with real
 * Circle testnet USDC, against the canonical JSPLITORG VK:
 *
 *   1. SHIELD real USDC into an ORG note whose recipientPk = orgRecipientPk(
 *      memberRoot, threshold, akGroup) — a preimage no single key can satisfy.
 *   2. pool.transfer_org: spend that org note under a 2-of-3 member quorum
 *      (joinsplit_org proof) into two fresh consumer notes — settles on-chain
 *      (org nullifier recorded, 2 output commitments inserted, root advances).
 *   3. WITHDRAW one output to a DIFFERENT public account — real USDC exits,
 *      completing a full round-trip THROUGH M-of-N dual control.
 *
 * The org note's value can ONLY move because ≥threshold members signed in-circuit;
 * the existing joinsplit-org-onchain.mjs proves the sub-threshold case is unprovable.
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/joinsplit-org-settle-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import {
  BenzoPoolClient, StellarCli, NodeProver, configFromEnv,
  MvkRegistryMirror, MerkleTreeMirror, DEFAULT_MVK_KEY_META, fetchMvkRegistryLeaves,
  deriveKeypair, deriveTvk, generateViewingKeypair, viewingPubToScalar,
  newNote, encodeNotePlain, seal, randomFieldElement, aspLeaf,
  noteCommitment, noteNullifier, mvkTag, mvkRegistryLeaf,
  orgRecipientPk, orgNullifier,
} from "@benzo/core";
import { transferRelayFnArgs } from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const log = (...a) => console.log(...a);
const explorer = (tx) => `https://stellar.expert/explorer/testnet/tx/${tx}`;
const hex = (u8) => Buffer.from(u8).toString("hex");

// depth-safe bigint -> string (the org witness has 3D member-path arrays)
const deepStr = (v) => (Array.isArray(v) ? v.map(deepStr) : v.toString());
const strInput = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepStr(v)]));

const B = `${repo}/circuits/build/joinsplit_org`;
const ORG_WASM = `${B}/joinsplit_org_js/joinsplit_org.wasm`;
const ORG_ZKEY = `${B}/joinsplit_org.zkey`; // canonical proving key
const POOL_DEPTH = dep.treeLevels, MVKL = 16, ML = 16;

const eddsa = await buildEddsa();
const poseidon = await buildPoseidon();
const F = poseidon.F;

function member(seed) {
  const prv = Buffer.alloc(32, seed);
  const pub = eddsa.prv2pub(prv);
  const Ax = F.toObject(pub[0]), Ay = F.toObject(pub[1]);
  return { prv, Ax, Ay, keyId: F.toObject(poseidon([Ax, Ay])) };
}

const sender = process.env.DEPLOYER_PUBLIC;
const exitAccount = process.env.ANCHOR_DISTRIBUTION_PUBLIC;
const relayerAddr = process.env.RELAYER_PUBLIC;
if (!sender || !exitAccount || !relayerAddr) throw new Error("load .env first (DEPLOYER_PUBLIC, ANCHOR_DISTRIBUTION_PUBLIC, RELAYER_PUBLIC)");

const circuits = Object.fromEntries(["shield", "joinsplit", "unshield"].map((c) => [c, {
  wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`,
  zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey`,
}]));
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
const poolUsdc = async () => BigInt(await cli.view(dep.token, "benzo-deployer", ["balance", "--id", dep.pool]));

log("=== FULL real-USDC org dual-control settle (testnet) → pool.transfer_org ===");
log(`pool=${dep.pool}`);
log(`JSPLITORG VK = canonical (ceremony tx ${dep.ceremonies?.[0]?.rotateVkTx ?? "?"})`);

const assetId = await client.assetId();

// --- 0. rebuild mirrors from chain (pool tree + ASP allow-tree) ----------
const { fetchAspLeaves, BenzoIndexer, syncFromRpc } = await import("@benzo/indexer");
client.aspRebuild(await fetchAspLeaves(process.env.SOROBAN_RPC_URL, dep.aspMembership, 1));
const poolIdx = new BenzoIndexer(dep.treeLevels, 1);
await syncFromRpc(poolIdx, process.env.SOROBAN_RPC_URL, [dep.pool], 1);
client.poolRebuild(poolIdx.orderedLeaves());
await client.assertSynced();
log(`[0] mirrors synced to chain (pool root=${client.poolTree.root()})`);

// --- 0b. authorized-MVK registry: register this run's MVK on-chain + mirror
const myMvk = generateViewingKeypair();
const myMvkScalar = viewingPubToScalar(myMvk.publicKey);
const scope = "2026-Q2/org-settle";
const myTvk = deriveTvk(myMvk.secret, scope);
const mvkReg = new MvkRegistryMirror();
mvkReg.syncLeaves(await fetchMvkRegistryLeaves(process.env.SOROBAN_RPC_URL, dep.mvkRegistry, 1));
await cli.invoke({ contractId: dep.mvkRegistry, source: "benzo-deployer", send: true,
  fnArgs: ["register_mvk", "--mvk_pub", myMvkScalar.toString(), "--key_meta", DEFAULT_MVK_KEY_META.toString()] });
mvkReg.register(myMvkScalar, DEFAULT_MVK_KEY_META);
const onchainMvkRoot = BigInt(await cli.view(dep.mvkRegistry, "benzo-deployer", ["current_root"]));
if (mvkReg.root() !== onchainMvkRoot) throw new Error(`mvk mirror drift: ${mvkReg.root()} != ${onchainMvkRoot}`);
client.useMvkRegistry(mvkReg);
log(`[0b] MVK registered on-chain; registeredMvkRoot=${onchainMvkRoot}`);

// --- 0c. ASP allowlist the depositor (shield admission) ------------------
const aspBlinding = randomFieldElement();
const depositorScalar = await client.depositorScalar(sender);
const allowLeaf = aspLeaf(depositorScalar, aspBlinding);
const rAsp = await cli.invoke({ contractId: dep.aspMembership, source: "benzo-deployer", send: true,
  fnArgs: ["insert_leaf", "--leaf", allowLeaf.toString()] });
const aspLeafIndex = client.aspMirrorInsert(allowLeaf);
log(`[0c] depositor allowlisted (tx ${rAsp.txHash})`);

// --- the ORG identity: a 2-of-3 member set (held by one operator here) ----
const members = [member(11), member(12), member(13)];
const memberTree = new MerkleTreeMirror(ML);
const mIdx = members.map((m) => memberTree.insert(m.keyId));
const memberRoot = memberTree.root();
const threshold = 2n, akGroup = 0x42_4e_5a_6fn; // "BNZo" group spend-auth secret
const orgPk = orgRecipientPk(memberRoot, threshold, akGroup);

// --- 1. SHIELD real USDC into the ORG note -------------------------------
const ORG_AMT = 2_000_000n; // 0.2 USDC (7dp)
const orgBlinding = randomFieldElement();
const orgNote = { amount: ORG_AMT, recipientPk: orgPk, blinding: orgBlinding, assetId };
const orgPlain = encodeNotePlain(orgNote);
const beforePool = await poolUsdc();
const sh = await client.shield({
  source: "benzo-deployer", from: sender, note: orgNote, mvkPubScalar: myMvkScalar,
  aspBlinding, aspLeafIndex,
  noteCt: seal(orgPlain, myMvk.publicKey).bytes, mvkCt: seal(orgPlain, myTvk.publicKey).bytes,
});
const li0 = sh.leafIndex;
log(`[1] SHIELD ${ORG_AMT} stroops USDC -> ORG note @ leaf ${li0}`);
log(`    org recipientPk = ${orgPk}`);
log(`    commitment = ${sh.commitment}  (tx ${sh.txHash})`);
log(`    ${explorer(sh.txHash)}`);

// --- 2. build the joinsplit_org witness against LIVE state ----------------
const root = client.poolTree.root();           // live pool root (org note is in it)
const orgPath = client.poolTree.path(li0);      // real authentication path
// input1 = genuine zero dummy (circuit disables root check for amount==0)
const dSk = randomFieldElement(), dBl = randomFieldElement();
const li1 = Number(randomFieldElement() % BigInt(2 ** 31));
const n0 = orgNullifier(akGroup, orgBlinding, BigInt(li0));
const n1 = noteNullifier(dSk, BigInt(li1));

// outputs: two fresh consumer notes (so one can later be withdrawn to public)
const fee = 0n;
const recipient = deriveKeypair(randomFieldElement()); // we hold this -> withdraw later
const change = deriveKeypair(randomFieldElement());
const out0 = { amount: ORG_AMT / 2n, recipientPk: recipient.publicKey, blinding: randomFieldElement(), assetId };
const out1 = { amount: ORG_AMT - ORG_AMT / 2n - fee, recipientPk: change.publicKey, blinding: randomFieldElement(), assetId };
const c0 = noteCommitment(out0), c1 = noteCommitment(out1);
const tag0 = mvkTag(myMvkScalar, out0.blinding), tag1 = mvkTag(myMvkScalar, out1.blinding);

// MVK membership path for the outputs' (shared) MVK under the live registry root
const mvkP = mvkReg.pathFor(myMvkScalar);

// ext-data hash: must bind the EXACT bytes we submit to transfer_org
const out0Plain = encodeNotePlain(out0), out1Plain = encodeNotePlain(out1);
const recipientView = generateViewingKeypair();
const noteCt0 = seal(out0Plain, recipientView.publicKey).bytes;
const noteCt1 = seal(out1Plain, myMvk.publicKey).bytes;
const mvkCt0 = seal(out0Plain, myTvk.publicKey).bytes;
const mvkCt1 = seal(out1Plain, myTvk.publicKey).bytes;
const extHash = BigInt(await cli.view(dep.pool, "benzo-deployer", [
  "transfer_ext_hash", "--relayer", relayerAddr, "--fee", fee.toString(),
  "--note_ct0", hex(noteCt0), "--note_ct1", hex(noteCt1), "--mvk_ct0", hex(mvkCt0), "--mvk_ct1", hex(mvkCt1),
]));

// member signatures over spendMessage = Poseidon(n0,n1,c0,c1) — sign LAST
const spendMessage = F.toObject(poseidon([n0, n1, c0, c1]));
const msgEl = F.e(spendMessage);
const sigs = members.map((m) => eddsa.signPoseidon(m.prv, msgEl));
const paths = mIdx.map((ix) => memberTree.path(ix));
const signers = [0, 1]; // 2-of-3 quorum
const sgOrg = {
  enabled: members.map((_, i) => (signers.includes(i) ? 1n : 0n)),
  Ax: members.map((m) => m.Ax), Ay: members.map((m) => m.Ay),
  S: sigs.map((g) => g.S), R8x: sigs.map((g) => F.toObject(g.R8[0])), R8y: sigs.map((g) => F.toObject(g.R8[1])),
  pathElements: paths.map((p) => p.pathElements), pathIndices: paths.map((p) => BigInt(p.pathIndices)),
};
const sgNone = { enabled: members.map(() => 0n), Ax: sgOrg.Ax, Ay: sgOrg.Ay, S: sgOrg.S, R8x: sgOrg.R8x, R8y: sgOrg.R8y, pathElements: sgOrg.pathElements, pathIndices: sgOrg.pathIndices };

const witness = {
  root, assetId, inputNullifier: [n0, n1], outputCommitment: [c0, c1], fee,
  extDataHash: extHash, mvkTag: [tag0, tag1], registeredMvkRoot: mvkReg.root(),
  inAmount: [ORG_AMT, 0n], inOrgSpendId: [0n, dSk], inBlinding: [orgBlinding, dBl],
  inPathIndices: [BigInt(li0), BigInt(li1)],
  inPathElements: [orgPath.pathElements, new Array(POOL_DEPTH).fill(0n)],
  outAmount: [out0.amount, out1.amount], outPubkey: [out0.recipientPk, out1.recipientPk], outBlinding: [out0.blinding, out1.blinding],
  outMvkPub: [myMvkScalar, myMvkScalar], mvkKeyMeta: [DEFAULT_MVK_KEY_META, DEFAULT_MVK_KEY_META],
  mvkPathElements: [mvkP.pathElements, mvkP.pathElements], mvkPathIndices: [BigInt(mvkP.pathIndices), BigInt(mvkP.pathIndices)],
  inIsOrg: [1n, 0n], orgMemberRoot: [memberRoot, memberRoot], orgThreshold: [threshold, 0n], akGroup: [akGroup, 0n],
  mEnabled: [sgOrg.enabled, sgNone.enabled], mAx: [sgOrg.Ax, sgNone.Ax], mAy: [sgOrg.Ay, sgNone.Ay],
  mS: [sgOrg.S, sgNone.S], mR8x: [sgOrg.R8x, sgNone.R8x], mR8y: [sgOrg.R8y, sgNone.R8y],
  mPathElements: [sgOrg.pathElements, sgNone.pathElements], mPathIndices: [sgOrg.pathIndices, sgNone.pathIndices],
};

log(`[2] proving 2-of-3 org transfer on-device (joinsplit_org, ~147k constraints)…`);
const t0 = Date.now();
const proof = await new NodeProver().prove({ wasmPath: ORG_WASM, zkeyPath: ORG_ZKEY }, strInput(witness));
log(`    proved in ${Date.now() - t0}ms (${proof.sorobanPublics.length} public inputs)`);

// --- 3. submit pool.transfer_org (real settle) ---------------------------
const fnArgs = transferRelayFnArgs({
  submitter: await cli.keyAddress("benzo-deployer"),
  root: root.toString(), nullifier0: n0.toString(), nullifier1: n1.toString(),
  outCommitment0: c0.toString(), outCommitment1: c1.toString(),
  fee: fee.toString(), relayerAddress: relayerAddr,
  mvkTag0: tag0.toString(), mvkTag1: tag1.toString(),
  noteCt0: hex(noteCt0), noteCt1: hex(noteCt1), mvkCt0: hex(mvkCt0), mvkCt1: hex(mvkCt1),
  registeredMvkRoot: mvkReg.root().toString(), proof: JSON.stringify(proof.sorobanProof),
});
fnArgs[0] = "transfer_org"; // identical arg shape; settles under JSPLITORG VK
const nextBefore = Number(await cli.view(dep.merkle, "benzo-deployer", ["next_index"]));
const settle = await cli.invoke({ contractId: dep.pool, source: "benzo-deployer", send: true, fnArgs });
log(`[3] pool.transfer_org SETTLED on-chain (tx ${settle.txHash})`);
log(`    ${explorer(settle.txHash)}`);

// mirror the two new outputs locally + re-sync
const i0 = client.poolTree.insert(c0);
const i1 = client.poolTree.insert(c1);
await client.assertSynced();

// --- 4. on-chain settle evidence -----------------------------------------
const orgSpent = await cli.view(dep.nullifierSet, "benzo-deployer", ["is_spent", "--nullifier", n0.toString()]);
const dummySpent = await cli.view(dep.nullifierSet, "benzo-deployer", ["is_spent", "--nullifier", n1.toString()]);
const nextAfter = Number(await cli.view(dep.merkle, "benzo-deployer", ["next_index"]));
log(`[4] settle evidence:`);
log(`    org nullifier spent on-chain   = ${orgSpent}`);
log(`    dummy nullifier spent on-chain = ${dummySpent}`);
log(`    merkle next_index ${nextBefore} -> ${nextAfter} (2 org outputs inserted)`);
if (orgSpent !== true) { console.error("❌ org nullifier not recorded — settle failed"); process.exit(1); }
if (nextAfter !== nextBefore + 2) { console.error("❌ output commitments not inserted"); process.exit(1); }

// --- 5. WITHDRAW one org-derived output -> real USDC exits ---------------
const beforeExit = await usdcBalance(exitAccount);
const exitChangeKp = deriveKeypair(randomFieldElement());
const exitChange = { amount: 0n, recipientPk: exitChangeKp.publicKey, blinding: randomFieldElement(), assetId };
const exitChangePlain = encodeNotePlain(exitChange);
const wd = await client.withdraw({
  source: "benzo-deployer",
  input: { note: out0, spendSk: recipient.spendSk, leafIndex: i0 },
  amount: out0.amount, to: exitAccount,
  changeNote: exitChange, changeMvkPubScalar: myMvkScalar,
  changeNoteCt: seal(exitChangePlain, recipientView.publicKey).bytes,
  changeMvkCt: seal(exitChangePlain, myTvk.publicKey).bytes,
});
const afterExit = await usdcBalance(exitAccount);
const afterPool = await poolUsdc();
log(`[5] WITHDRAW org-derived output ${out0.amount} stroops USDC -> ${exitAccount}`);
log(`    org-output nullifier spent = ${await cli.view(dep.nullifierSet, "benzo-deployer", ["is_spent", "--nullifier", wd.nullifier.toString()])}`);
log(`    exit USDC: ${beforeExit} -> ${afterExit}   (tx ${wd.txHash})`);
log(`    ${explorer(wd.txHash)}`);
if (!(Number(afterExit) > Number(beforeExit))) { console.error("❌ exit account USDC did not increase"); process.exit(1); }

log(`\n✅ FULL real-USDC org dual-control round-trip, ON-CHAIN:`);
log(`   • real USDC shielded into an ORG note (recipientPk = M-of-N preimage)`);
log(`   • spent via pool.transfer_org under a 2-of-3 quorum (JSPLITORG canonical VK) — settled`);
log(`   • org nullifier recorded + 2 outputs inserted (next_index +2)`);
log(`   • one output WITHDRAWN to a public account — real USDC exited the pool`);
log(`   ⇒ org funds moved only because ≥threshold members signed in-circuit. Not a server. Real money.`);
