/**
 * Verifier-parity oracle.
 *
 * The on-chain Groth16 verifier reads BN254 points in a precise byte layout
 * (G1 = x‖y = 64B; G2 = x.c1‖x.c0‖y.c1‖y.c0 = 128B, i.e. snarkjs's [c0,c1]
 * REORDERED to c1‖c0). A silent mismatch here makes every proof fail (or, worse,
 * a malformed VK). These tests pin the encoding produced from the *real* deployed
 * circuit verification keys against that exact layout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vkToSoroban, proofToSoroban, publicsToSoroban, g1Hex, g2Hex } from "../src/crypto/groth16.js";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(`${repo}/${p}`, "utf8"));
const fe = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");

describe("verifier-parity oracle: snarkjs → Soroban encoding", () => {
  for (const c of ["shield", "joinsplit", "unshield"]) {
    it(`${c} VK encodes to the exact Soroban byte shape`, () => {
      const vk = read(`circuits/build/${c}/${c}_vk.json`);
      const s = vkToSoroban(vk);
      expect(s.alpha).toHaveLength(128); // G1 = 64 bytes
      for (const g2 of [s.beta, s.gamma, s.delta]) expect(g2).toHaveLength(256); // G2 = 128 bytes
      expect(s.ic.length).toBe(vk.IC.length);
      expect(s.ic.length).toBe(Number(vk.nPublic) + 1); // IC = nPublic + 1
      for (const h of [s.alpha, s.beta, s.gamma, s.delta, ...s.ic]) expect(h).toMatch(/^[0-9a-f]+$/);
    });
  }

  it("trivial proof encodes to the exact Soroban byte shape", () => {
    const s = proofToSoroban(read("circuits/build/trivial/proof.json"));
    expect(s.a).toHaveLength(128);
    expect(s.b).toHaveLength(256);
    expect(s.c).toHaveLength(128);
  });

  it("public inputs are decimal U256 (Bn254Fr CLI form)", () => {
    expect(publicsToSoroban(["42", 43n, "0x2a"])).toEqual(["42", "43", "42"]);
  });

  it("G2 applies the snarkjs [c0,c1] → Soroban c1‖c0 reordering", () => {
    // x=[c0=1,c1=2], y=[c0=3,c1=4] ⇒ expect 2,1,4,3
    expect(g2Hex([["1", "2"], ["3", "4"], ["1", "0"]])).toBe(fe(2) + fe(1) + fe(4) + fe(3));
  });

  it("rejects non-affine points (catches silent encoding bugs)", () => {
    expect(() => g1Hex(["1", "2", "2"])).toThrow(); // z != 1
    expect(() => g2Hex([["1", "2"], ["3", "4"], ["1", "1"]])).toThrow(); // z != [1,0]
  });
});
