/**
 * Off-chain mirror of the on-chain incremental Merkle tree
 * (contracts/merkle): same Poseidon2 compression, same zero table, so paths
 * computed here fold to exactly the on-chain roots.
 */

import { compress, merkleZeros } from "./crypto/poseidon2.js";

export interface MerklePath {
  pathElements: bigint[];
  /** index of the leaf == path indices encoded as one integer */
  pathIndices: bigint;
}

export class MerkleTreeMirror {
  readonly levels: number;
  readonly zeros: bigint[];
  leaves: bigint[] = [];

  constructor(levels: number) {
    this.levels = levels;
    this.zeros = merkleZeros(levels);
  }

  insert(leaf: bigint): number {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }

  root(): bigint {
    let nodes = [...this.leaves];
    if (nodes.length === 0) return this.zeros[this.levels];
    for (let lvl = 0; lvl < this.levels; lvl++) {
      const next: bigint[] = [];
      for (let i = 0; i < nodes.length; i += 2) {
        const left = nodes[i];
        const right = i + 1 < nodes.length ? nodes[i + 1] : this.zeros[lvl];
        next.push(compress(left, right));
      }
      nodes = next;
    }
    return nodes[0];
  }

  path(index: number): MerklePath {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`leaf index ${index} out of range`);
    }
    const pathElements: bigint[] = [];
    let nodes = [...this.leaves];
    let idx = index;
    for (let lvl = 0; lvl < this.levels; lvl++) {
      const sibling = idx ^ 1;
      pathElements.push(sibling < nodes.length ? nodes[sibling] : this.zeros[lvl]);
      const next: bigint[] = [];
      for (let i = 0; i < nodes.length; i += 2) {
        const left = nodes[i];
        const right = i + 1 < nodes.length ? nodes[i + 1] : this.zeros[lvl];
        next.push(compress(left, right));
      }
      nodes = next;
      idx >>= 1;
    }
    return { pathElements, pathIndices: BigInt(index) };
  }
}
