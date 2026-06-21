/**
 * proof_of_balance (BALANCE) + proof_of_sum (SUM) → ON-CHAIN verify.
 *
 * Closes the automated-test gap the prod-readiness audit found: both proofs were
 * verified on-chain only by the live BFF/UI path (balance.test.ts / sum.test.ts do
 * LOCAL snarkjs verify), so a regression in the on-chain leg would not be caught by
 * `pnpm test`. This builds real proofs on-device and calls the LIVE verifier:
 *   - verify_proof(BALANCE) over a real >= threshold proof  => true
 *   - verify_proof(SUM)     over a real exact-total proof    => true
 *   - a tampered public input                                => false (fail-closed)
 * Run: set -a; . ./.env; set +a; node tests/e2e/sum-balance-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  StellarCli, configFromEnv, NodeProver, MerkleTreeMirror,
  deriveKeypair, noteCommitment, proveBalance, proveSum,
} from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const prover = new NodeProver();
const build = `${repo}/circuits/build`;
const ASSET = 123456789n;
const log = (...a) => console.log(...a);

/** Two notes (3M + 2M = 5M) owned by one spend key, in a depth-32 tree. */
function fixture() {
  const spendSk = 31337n;
  const pk = deriveKeypair(spendSk).publicKey;
  const tree = new MerkleTreeMirror(32);
  const notes = [
    { amount: 3_000_000n, blinding: 11n },
    { amount: 2_000_000n, blinding: 22n },
  ].map((n) => ({
    ...n,
    leafIndex: tree.insert(noteCommitment({ amount: n.amount, recipientPk: pk, blinding: n.blinding, assetId: ASSET })),
  }));
  return { spendSk, tree, notes };
}

async function onChain(vkId, res) {
  return cli.view(dep.verifier, "benzo-deployer", [
    "verify_proof", "--vk_id", vkId,
    "--proof", JSON.stringify(res.sorobanProof),
    "--public_inputs", JSON.stringify(res.sorobanPublics),
  ]);
}

log("=== proof_of_balance + proof_of_sum → on-chain verify ===");

// 1) BALANCE: prove holding >= 5,000,000 (the real total) on-device.
const fb = fixture();
log("[1] proving balance >= 5,000,000 on-device…");
const bal = await proveBalance({
  prover, artifacts: { wasmPath: `${build}/proof_of_balance/proof_of_balance_js/proof_of_balance.wasm`, zkeyPath: `${build}/proof_of_balance/proof_of_balance.zkey` },
  spendSk: fb.spendSk, assetId: ASSET, threshold: 5_000_000n, root: fb.tree.root(), tree: fb.tree, notes: fb.notes,
});
log(`    proof generated (${bal.sorobanPublics.length} public inputs)`);
const balOk = await onChain("BALANCE", bal);
log(`    verify_proof BALANCE => ${balOk}`);
if (balOk !== true) { console.error("❌ BALANCE proof did NOT verify on-chain"); process.exit(1); }

// 2) SUM: prove the exact total = 5,000,000 (auditor disclose-total) on-device.
const fs2 = fixture();
log("[2] proving exact total = 5,000,000 on-device…");
const sum = await proveSum({
  prover, artifacts: { wasmPath: `${build}/proof_of_sum/proof_of_sum_js/proof_of_sum.wasm`, zkeyPath: `${build}/proof_of_sum/proof_of_sum.zkey` },
  spendSk: fs2.spendSk, assetId: ASSET, claimedTotal: 5_000_000n, root: fs2.tree.root(), tree: fs2.tree, notes: fs2.notes,
});
log(`    proof generated; disclosed total = ${sum.sorobanPublics[1] ?? "?"}`);
const sumOk = await onChain("SUM", sum);
log(`    verify_proof SUM => ${sumOk}`);
if (sumOk !== true) { console.error("❌ SUM proof did NOT verify on-chain"); process.exit(1); }

// 3) Fail-closed: tamper the SUM disclosed-total public input -> must be rejected.
// The verifier rejects an invalid proof by TRAPPING (Error(Contract,#4)), surfaced
// here as a thrown error — so a throw OR an explicit `false` both count as rejection;
// only a `true` is a soundness failure.
log("[3] adversarial: tampered SUM public input must be rejected…");
const forged = { ...sum, sorobanPublics: [...sum.sorobanPublics] };
forged.sorobanPublics[1] = (BigInt(forged.sorobanPublics[1]) + 1n).toString();
let forgedOk;
try {
  forgedOk = await onChain("SUM", forged);
} catch {
  forgedOk = false; // contract trap = fail-closed rejection (expected)
}
log(`    verify_proof SUM (forged total) => ${forgedOk} (rejected)`);
if (forgedOk === true) { console.error("❌ tampered SUM proof WRONGLY verified on-chain"); process.exit(1); }

log("✅ BALANCE + SUM proofs VERIFIED ON-CHAIN; tampered proof rejected (fail-closed)");
