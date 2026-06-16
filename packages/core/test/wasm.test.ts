/**
 * WasmProver test — the on-device proving backend. Proves from preloaded
 * Uint8Array artifacts (as the browser would, having fetched the wasm/zkey once)
 * rather than fs paths, confirming the proof is byte-valid and the witness never
 * needs a filesystem. Self-skips when the gitignored artifacts are absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { MerkleTreeMirror } from "../src/merkle.js";
import { deriveKeypair, noteCommitment } from "../src/notes.js";
import { proveBalance, verifyBalanceLocal } from "../src/balance.js";
import { WasmProver } from "../src/prover.js";

const root = fileURLToPath(new URL("../../../circuits/build", import.meta.url));
const wasmPath = `${root}/proof_of_balance/proof_of_balance_js/proof_of_balance.wasm`;
const zkeyPath = `${root}/proof_of_balance/proof_of_balance.zkey`;
const vk = () => JSON.parse(readFileSync(`${root}/proof_of_balance/proof_of_balance_vk.json`, "utf8"));
const HAVE = existsSync(zkeyPath);
const ASSET = 123_456_789n;

describe.skipIf(!HAVE)("WasmProver (on-device, preloaded buffers)", () => {
  it("proves from in-memory Uint8Array artifacts and reports progress", async () => {
    const spendSk = 31_337n;
    const pk = deriveKeypair(spendSk).publicKey;
    const tree = new MerkleTreeMirror(32);
    const notes = [
      { amount: 3_000_000n, blinding: 11n },
      { amount: 2_000_000n, blinding: 22n },
    ].map((n) => ({
      amount: n.amount,
      blinding: n.blinding,
      leafIndex: tree.insert(
        noteCommitment({ amount: n.amount, recipientPk: pk, blinding: n.blinding, assetId: ASSET }),
      ),
    }));

    // Browser-realistic: the artifacts are preloaded bytes, not fs paths.
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const zkey = new Uint8Array(readFileSync(zkeyPath));
    const stages: string[] = [];
    const prover = new WasmProver((s) => stages.push(s));

    const res = await proveBalance({
      prover,
      artifacts: { wasmPath: "", zkeyPath: "", wasm, zkey },
      spendSk,
      assetId: ASSET,
      threshold: 5_000_000n,
      root: tree.root(),
      tree,
      notes,
    });
    expect(res.publicSignals.length).toBe(4);
    expect(await verifyBalanceLocal(vk(), res.publicSignals, res.proof)).toBe(true);
    expect(stages.length).toBeGreaterThan(0); // progress callbacks fired
  }, 120_000);
});
