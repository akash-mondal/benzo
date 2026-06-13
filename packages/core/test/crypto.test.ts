import { describe, expect, it } from "vitest";
import {
  FIELD_MODULUS,
  compress,
  hash,
  merkleZeros,
  permutation,
} from "../src/crypto/poseidon2.js";
import { MerkleTreeMirror } from "../src/merkle.js";
import {
  deriveKeypair,
  mvkTag,
  noteCommitment,
  noteNullifier,
  NULLIFIER_DOMAIN,
} from "../src/notes.js";
import {
  deriveTvk,
  decodeNotePlain,
  encodeNotePlain,
  generateViewingKeypair,
  open,
  seal,
  viewingPubToScalar,
} from "../src/viewkeys.js";

/**
 * The on-chain pinned zero table (contracts/common/soroban-utils
 * `get_zeroes`, byte-for-byte). zeros[0] = Poseidon2("XLM") (t=4,
 * inputs [88, 76, 77], domain 0); zeros[i+1] = compress(z_i, z_i).
 * If the TS permutation deviates from the CAP-0075 host parameterization
 * by a single byte, these assertions fail.
 */
const ONCHAIN_ZEROS_HEX = [
  "25302288db99350344974183ce310d63b53abb9ef0f8575753eed36e0118f9ce",
  "21f4ea2492ade006a8ee7fb764060a95a4eef5ca931e037bcdf05fc28067d008",
  "0ebfb4d2f05bb6a473c9bff72586fec806f1ac237015c570d7c78249cf7d7740",
  "066882a5dab186d4d63fa6600f9ea3d5cdfef2a2811c89731128a729d7e8b897",
];

describe("Poseidon2 byte-identity with the Soroban host parameterization", () => {
  it("reproduces the on-chain zero table", () => {
    const zeros = merkleZeros(32);
    for (let i = 0; i < ONCHAIN_ZEROS_HEX.length - 1; i++) {
      expect(zeros[i].toString(16).padStart(64, "0")).toBe(ONCHAIN_ZEROS_HEX[i]);
    }
    // last vector of the sampled prefix
    expect(zeros[3].toString(16).padStart(64, "0")).toBe(
      // zeros[3] from the pinned table starts 0668..., asserted above via loop
      ONCHAIN_ZEROS_HEX[3],
    );
    expect(zeros.length).toBe(33);
  });

  it("permutation widths 2..4 work and reject others", () => {
    expect(() => permutation([1n, 2n])).not.toThrow();
    expect(() => permutation([1n, 2n, 3n])).not.toThrow();
    expect(() => permutation([1n, 2n, 3n, 4n])).not.toThrow();
    expect(() => permutation([1n, 2n, 3n, 4n, 5n])).toThrow();
  });

  it("compress is deterministic and order-sensitive", () => {
    expect(compress(1n, 2n)).toBe(compress(1n, 2n));
    expect(compress(1n, 2n)).not.toBe(compress(2n, 1n));
    expect(compress(1n, 2n)).toBeLessThan(FIELD_MODULUS);
  });
});

describe("notes", () => {
  it("commitment binds every field", () => {
    const base = { amount: 5n, recipientPk: 7n, blinding: 9n, assetId: 11n };
    const c = noteCommitment(base);
    expect(noteCommitment({ ...base, amount: 6n })).not.toBe(c);
    expect(noteCommitment({ ...base, recipientPk: 8n })).not.toBe(c);
    expect(noteCommitment({ ...base, blinding: 10n })).not.toBe(c);
    expect(noteCommitment({ ...base, assetId: 12n })).not.toBe(c);
  });

  it("nullifier = Poseidon2(spend_sk, leaf_index, NULLIFIER_DOMAIN)", () => {
    expect(noteNullifier(3n, 4n)).toBe(hash([3n, 4n], NULLIFIER_DOMAIN));
    expect(noteNullifier(3n, 4n)).not.toBe(noteNullifier(3n, 5n));
    expect(noteNullifier(3n, 4n)).not.toBe(noteNullifier(4n, 4n));
  });

  it("keypair and tag derivations are deterministic", () => {
    const kp = deriveKeypair(42n);
    expect(kp.publicKey).toBe(deriveKeypair(42n).publicKey);
    expect(mvkTag(1n, 2n)).toBe(mvkTag(1n, 2n));
  });
});

describe("merkle mirror", () => {
  it("path folds to root for every leaf", () => {
    const t = new MerkleTreeMirror(8);
    const leaves = [11n, 22n, 33n, 44n, 55n];
    leaves.forEach((l) => t.insert(l));
    const root = t.root();
    for (let i = 0; i < leaves.length; i++) {
      const { pathElements, pathIndices } = t.path(i);
      // fold manually
      let node = leaves[i];
      let idx = Number(pathIndices);
      for (let lvl = 0; lvl < 8; lvl++) {
        node =
          (idx & 1) === 0
            ? compress(node, pathElements[lvl])
            : compress(pathElements[lvl], node);
        idx >>= 1;
      }
      expect(node).toBe(root);
    }
  });
});

describe("viewing keys", () => {
  it("seal/open round-trips for the right key and fails for others", () => {
    const recipient = generateViewingKeypair();
    const other = generateViewingKeypair();
    const pt = encodeNotePlain({
      amount: 123n,
      recipientPk: 456n,
      blinding: 789n,
      assetId: 1n,
    });
    const box = seal(pt, recipient.publicKey);
    const opened = open(box.bytes, recipient.secret);
    expect(opened).not.toBeNull();
    expect(decodeNotePlain(opened!).amount).toBe(123n);
    expect(open(box.bytes, other.secret)).toBeNull();
  });

  it("TVK derivation is one-way and scope-separated", () => {
    const mvk = generateViewingKeypair();
    const q1 = deriveTvk(mvk.secret, "2026-Q1");
    const q2 = deriveTvk(mvk.secret, "2026-Q2");
    expect(Buffer.from(q1.secret).toString("hex")).not.toBe(
      Buffer.from(q2.secret).toString("hex"),
    );
    // deterministic per scope
    const q1again = deriveTvk(mvk.secret, "2026-Q1");
    expect(Buffer.from(q1.secret).toString("hex")).toBe(
      Buffer.from(q1again.secret).toString("hex"),
    );
    // scalar mapping stays in-field
    expect(viewingPubToScalar(mvk.publicKey)).toBeLessThan(FIELD_MODULUS);
  });
});
