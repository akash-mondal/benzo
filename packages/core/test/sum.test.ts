/**
 * Proof-of-sum (confidential disclose-total) SDK tests. Proves owned notes sum
 * to an EXACT total, revealing only that figure. Heavy proving tests self-skip
 * when the gitignored artifacts are absent (CI).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { MerkleTreeMirror } from "../src/merkle.js";
import { deriveKeypair, noteCommitment } from "../src/notes.js";
import { proveSum, verifySumLocal } from "../src/sum.js";
import { NodeProver } from "../src/prover.js";

const prover = new NodeProver();

const root = fileURLToPath(new URL("../../../circuits/build", import.meta.url));
const artifacts = {
  wasmPath: `${root}/proof_of_sum/proof_of_sum_js/proof_of_sum.wasm`,
  zkeyPath: `${root}/proof_of_sum/proof_of_sum.zkey`,
};
const vk = () => JSON.parse(readFileSync(`${root}/proof_of_sum/proof_of_sum_vk.json`, "utf8"));
const HAVE = existsSync(artifacts.zkeyPath);

const ASSET = 123456789n;

function fixture() {
  const spendSk = 31337n;
  const pk = deriveKeypair(spendSk).publicKey;
  const tree = new MerkleTreeMirror(32);
  const notes = [
    { amount: 3_000_000n, blinding: 11n },
    { amount: 2_000_000n, blinding: 22n },
  ].map((n) => {
    const leafIndex = tree.insert(
      noteCommitment({ amount: n.amount, recipientPk: pk, blinding: n.blinding, assetId: ASSET }),
    );
    return { amount: n.amount, blinding: n.blinding, leafIndex };
  });
  return { spendSk, tree, notes }; // total 5,000,000
}

describe.skipIf(!HAVE)("proof-of-sum (disclose-total)", () => {
  it("proves the exact total (5,000,000) and reveals only that figure", async () => {
    const { spendSk, tree, notes } = fixture();
    const res = await proveSum({
      prover, artifacts, spendSk, assetId: ASSET, claimedTotal: 5_000_000n, root: tree.root(), tree, notes,
    });
    expect(res.publicSignals.length).toBe(4); // root, claimedTotal, assetId, context
    expect(BigInt(res.publicSignals[1])).toBe(5_000_000n);
    expect(await verifySumLocal(vk(), res.publicSignals, res.proof)).toBe(true);
  }, 120_000);

  it("rejects a claimedTotal that doesn't match the notes (off-circuit guard)", async () => {
    const { spendSk, tree, notes } = fixture();
    await expect(
      proveSum({
        prover, artifacts, spendSk, assetId: ASSET, claimedTotal: 4_000_000n, root: tree.root(), tree, notes,
      }),
    ).rejects.toThrow(/must equal the sum/);
  });
});
