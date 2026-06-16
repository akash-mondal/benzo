/**
 * MvkRegistryMirror — the off-chain twin the witness builders use for the
 * authorized-MVK membership proof. Verifies dedup, the nonzero rule, path
 * availability, and that the mirror's root equals a plain tree built from the
 * same `mvkRegistryLeaf` values (so a synced mirror matches the on-chain tree
 * the contract maintains).
 */
import { describe, it, expect } from "vitest";
import { MvkRegistryMirror, MVK_REGISTRY_DEPTH } from "../src/mvk-registry.js";
import { MerkleTreeMirror } from "../src/merkle.js";
import { mvkRegistryLeaf } from "../src/notes.js";

describe("MvkRegistryMirror", () => {
  it("registers, dedups by mvkPub, and exposes a path", () => {
    const reg = new MvkRegistryMirror();
    const i0 = reg.register(111n);
    const i1 = reg.register(222n);
    expect([i0, i1]).toEqual([0, 1]);
    // re-registering the same key is a no-op (mirrors the contract's MvkSeen)
    expect(reg.register(111n)).toBe(0);
    expect(reg.isRegistered(111n)).toBe(true);
    expect(reg.isRegistered(999n)).toBe(false);
    expect(reg.pathFor(111n).pathElements).toHaveLength(MVK_REGISTRY_DEPTH);
  });

  it("rejects the zero key and an unregistered path lookup", () => {
    const reg = new MvkRegistryMirror();
    expect(() => reg.register(0n)).toThrow(/nonzero/);
    expect(() => reg.pathFor(123n)).toThrow(/not registered/);
  });

  it("root matches a plain tree built from the same leaves", () => {
    const keys = [10n, 20n, 30n];
    const reg = new MvkRegistryMirror();
    const plain = new MerkleTreeMirror(MVK_REGISTRY_DEPTH);
    for (const k of keys) {
      reg.register(k);
      plain.insert(mvkRegistryLeaf(k, 0n));
    }
    expect(reg.root()).toBe(plain.root());
  });

  it("syncLeaves resumes prior on-chain leaves, then register appends in lockstep", () => {
    // Simulate a registry that already holds two MVKs (e.g. a prior flow).
    const priorA = 10n;
    const priorB = 20n;
    const onchain = new MerkleTreeMirror(MVK_REGISTRY_DEPTH);
    onchain.insert(mvkRegistryLeaf(priorA, 0n));
    onchain.insert(mvkRegistryLeaf(priorB, 0n));
    const priorLeaves = [mvkRegistryLeaf(priorA, 0n), mvkRegistryLeaf(priorB, 0n)];

    const reg = new MvkRegistryMirror();
    reg.syncLeaves(priorLeaves);
    expect(reg.root()).toBe(onchain.root()); // resumed root matches

    // Appending a fresh MVK lands at index 2 — same as the chain would.
    const idx = reg.register(30n);
    expect(idx).toBe(2);
    onchain.insert(mvkRegistryLeaf(30n, 0n));
    expect(reg.root()).toBe(onchain.root());
    expect(reg.pathFor(30n)).toEqual(onchain.path(2));
    // A synced-but-not-registered prior key has no path (we only track ours).
    expect(() => reg.pathFor(priorA)).toThrow(/not registered/);
  });

  it("singleLeaf builds a one-entry registry with a valid membership path", () => {
    const reg = MvkRegistryMirror.singleLeaf(777n);
    const plain = new MerkleTreeMirror(MVK_REGISTRY_DEPTH);
    plain.insert(mvkRegistryLeaf(777n, 0n));
    expect(reg.root()).toBe(plain.root());
    expect(reg.pathFor(777n)).toEqual(plain.path(0));
  });
});
