/**
 * joinsplit_org (in-circuit M-of-N dual-control TRANSFER) → ON-CHAIN verify.
 *
 * Builds a real 2-in/2-out org transfer (input0 = an ORG note spent by a 2-of-3
 * member quorum; input1 = a consumer dummy), proves it on-device, and verifies on
 * the live verifier (JSPLITORG VK) — the same on-chain proof-of-life as
 * ORGAUTH/BALANCE/SUM, but for the full dual-control transfer.
 *   - verify_proof(JSPLITORG) over a valid org transfer => true
 *   - a tampered public input                           => rejected (fail-closed)
 * Run: set -a; . ./.env; set +a; node tests/e2e/joinsplit-org-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import {
  StellarCli, configFromEnv, MerkleTreeMirror, NodeProver,
  deriveKeypair, noteCommitment, noteNullifier, mvkTag, mvkRegistryLeaf,
  orgRecipientPk, orgNullifier, // <-- the SDK org-note primitives (packages/core/notes.ts)
} from "@benzo/core";

// Depth-safe bigint -> string (the witness has 3D member-path arrays).
const deepStr = (v) => (Array.isArray(v) ? v.map(deepStr) : v.toString());
const strInput = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepStr(v)]));

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const B = `${repo}/circuits/build/joinsplit_org`;
const wasm = `${B}/joinsplit_org_js/joinsplit_org.wasm`;
const zkey = `${B}/joinsplit_org.zkey`;
const log = (...a) => console.log(...a);

const ASSET = 123456789n;
const POOL = 32, MVKL = 16, ML = 16;

const eddsa = await buildEddsa();
const poseidon = await buildPoseidon();
const F = poseidon.F;
// orgRecipientPk / orgNullifier now come from @benzo/core (the SDK primitives).

function member(seed) {
  const prv = Buffer.alloc(32, seed);
  const pub = eddsa.prv2pub(prv);
  const Ax = F.toObject(pub[0]), Ay = F.toObject(pub[1]);
  return { prv, Ax, Ay, keyId: F.toObject(poseidon([Ax, Ay])) };
}

function buildInput(signers = [0, 1]) {
  const members = [member(11), member(12), member(13)];
  const memberTree = new MerkleTreeMirror(ML);
  const mIdx = members.map((m) => memberTree.insert(m.keyId));
  const memberRoot = memberTree.root();
  const threshold = 2n, akGroup = 0x6772_70n;

  const pool = new MerkleTreeMirror(POOL);
  // input0: org note (4,000,000)
  const inAmt = 4_000_000n, inBl = 0xb10n;
  const orgPk = orgRecipientPk(memberRoot, threshold, akGroup);
  const li0 = pool.insert(noteCommitment({ amount: inAmt, recipientPk: orgPk, blinding: inBl, assetId: ASSET }));
  const n0 = orgNullifier(akGroup, inBl, BigInt(li0));
  // input1: consumer dummy (0)
  const dSk = 99999n, dBl = 1n, li1 = 90042;
  const n1 = noteNullifier(dSk, BigInt(li1));

  const fee = 10n, total = inAmt;
  const out0 = { amount: (total - fee) / 2n, recipientPk: deriveKeypair(777777n).publicKey, blinding: 11n, assetId: ASSET };
  const out1 = { amount: total - fee - (total - fee) / 2n, recipientPk: deriveKeypair(888888n).publicKey, blinding: 22n, assetId: ASSET };
  const mvkTree = new MerkleTreeMirror(MVKL);
  const mvkP = mvkTree.path(mvkTree.insert(mvkRegistryLeaf(777n, 0n)));

  const inputNullifier = [n0, n1];
  const outputCommitment = [noteCommitment(out0), noteCommitment(out1)];
  const spendMessage = F.toObject(poseidon([n0, n1, outputCommitment[0], outputCommitment[1]]));
  const msgEl = F.e(spendMessage);
  const sigs = members.map((m) => eddsa.signPoseidon(m.prv, msgEl));
  const paths = mIdx.map((ix) => memberTree.path(ix));
  const mk = (enabledIdxs) => ({
    enabled: members.map((_, i) => (enabledIdxs.includes(i) ? 1n : 0n)),
    Ax: members.map((m) => m.Ax), Ay: members.map((m) => m.Ay),
    S: sigs.map((g) => g.S), R8x: sigs.map((g) => F.toObject(g.R8[0])), R8y: sigs.map((g) => F.toObject(g.R8[1])),
    pathElements: paths.map((p) => p.pathElements), pathIndices: paths.map((p) => BigInt(p.pathIndices)),
  });
  const sgOrg = mk(signers); // threshold quorum (2-of-3 by default)
  const sgNone = mk([]);

  return {
    root: pool.root(), assetId: ASSET, inputNullifier, outputCommitment, fee,
    extDataHash: 0xabcdefn, mvkTag: [mvkTag(777n, out0.blinding), mvkTag(777n, out1.blinding)], registeredMvkRoot: mvkTree.root(),
    inAmount: [inAmt, 0n], inOrgSpendId: [0n, dSk], inBlinding: [inBl, dBl],
    inPathIndices: [BigInt(li0), BigInt(li1)],
    inPathElements: [pool.path(li0).pathElements, new Array(POOL).fill(0n)],
    outAmount: [out0.amount, out1.amount], outPubkey: [out0.recipientPk, out1.recipientPk], outBlinding: [out0.blinding, out1.blinding],
    outMvkPub: [777n, 777n], mvkKeyMeta: [0n, 0n], mvkPathElements: [mvkP.pathElements, mvkP.pathElements], mvkPathIndices: [BigInt(mvkP.pathIndices), BigInt(mvkP.pathIndices)],
    inIsOrg: [1n, 0n], orgMemberRoot: [memberRoot, memberRoot], orgThreshold: [threshold, 0n], akGroup: [akGroup, 0n],
    mEnabled: [sgOrg.enabled, sgNone.enabled], mAx: [sgOrg.Ax, sgNone.Ax], mAy: [sgOrg.Ay, sgNone.Ay],
    mS: [sgOrg.S, sgNone.S], mR8x: [sgOrg.R8x, sgNone.R8x], mR8y: [sgOrg.R8y, sgNone.R8y],
    mPathElements: [sgOrg.pathElements, sgNone.pathElements], mPathIndices: [sgOrg.pathIndices, sgNone.pathIndices],
  };
}

async function onChain(sorobanProof, sorobanPublics) {
  return cli.view(dep.verifier, "benzo-deployer", [
    "verify_proof", "--vk_id", "JSPLITORG",
    "--proof", JSON.stringify(sorobanProof),
    "--public_inputs", JSON.stringify(sorobanPublics),
  ]);
}

log("=== joinsplit_org (in-circuit M-of-N transfer) → on-chain verify ===");
log("[1] proving a 2-of-3 org transfer on-device (this is the 147k-constraint circuit)…");
const input = buildInput();
const prover = new NodeProver();
const res = await prover.prove({ wasmPath: wasm, zkeyPath: zkey }, strInput(input));
const sp = res.sorobanProof, spub = res.sorobanPublics;
log(`    proof generated (${spub.length} public inputs)`);

log("[2] verifier.verify_proof(JSPLITORG) on-chain…");
const ok = await onChain(sp, spub);
log(`    verify_proof JSPLITORG => ${ok}`);
if (ok !== true) { console.error("❌ org transfer proof did NOT verify on-chain"); process.exit(1); }

log("[3] adversarial: tampered public input must be rejected…");
let bad;
try { bad = await onChain(sp, [...spub.slice(0, 2), (BigInt(spub[2]) + 1n).toString(), ...spub.slice(3)]); }
catch { bad = false; } // contract trap = fail-closed
log(`    verify_proof JSPLITORG (forged nullifier) => ${bad} (rejected)`);
if (bad === true) { console.error("❌ tampered org-transfer proof WRONGLY verified on-chain"); process.exit(1); }

log("[4] adversarial: a SUB-THRESHOLD spend (1-of-2 sigs) cannot even produce a proof…");
let subRejected = false;
try {
  await prover.prove({ wasmPath: wasm, zkeyPath: zkey }, strInput(buildInput([0])));
} catch {
  subRejected = true; // the circuit's threshold constraint fails at witness generation
}
log(`    sub-threshold (1-of-2) prove rejected = ${subRejected}`);
if (!subRejected) { console.error("❌ SOUNDNESS BREAK: a 1-of-2 spend produced a valid proof"); process.exit(1); }

log("\n✅ SOUND in-circuit M-of-N dual-control, proven ON-CHAIN:");
log("   • a 2-of-3 org-note transfer (joinsplit_org) verifies on JSPLITORG  => true");
log("   • a tampered public input is rejected                              => false");
log("   • a sub-threshold (1-of-2) spend cannot even be proven             => rejected");
log("   ⇒ org funds are unspendable on a single key — enforced in-circuit, not by a server.");
