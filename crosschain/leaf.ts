// Canonical cross-chain allocation leaves (docs/design/crosschain.md §3).
//
//   leaf = keccak256("benzo-leaf-v1" ‖ auction_id(32) ‖ index u64be ‖ asset(32) ‖ lot_count u64be
//                     ‖ destination_kind(u8) ‖ destination_bytes)
//   root = keccak256("benzo-root-v1" ‖ leaf_count u64be ‖ tree_root)
//   tree: sorted-pair keccak parents (OpenZeppelin MerkleProof convention)
//
// Amounts are never in a leaf: payout = lot_count × standard_lot (§3, lesson 6). Nothing from
// Zcash or the funding path enters a leaf (lesson 5). The same layout is enforced on chain by
// contracts/evm/src/BenzoEscrow.sol and contracts/solana/src/lib.rs.
import { keccak_256 } from "@noble/hashes/sha3";

export type DestinationKind = 1 | 2; // 1 = EVM address (20 bytes), 2 = Solana pubkey (32 bytes)

export interface AllocationLeaf {
  index: number;
  lot_count: number;
  destination_kind: DestinationKind;
  /** kind 1: 0x-prefixed 20-byte hex; kind 2: base58 pubkey or 0x-prefixed 32-byte hex */
  destination: string;
}

export const ASSET_SOL = new Uint8Array(32); // native SOL/ETH is the zero asset id on every chain

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2 !== 0) throw new Error(`bad hex: ${hex}`);
  return Uint8Array.from(h.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
}

export function bytesToHex(b: Uint8Array): string {
  return "0x" + Buffer.from(b).toString("hex");
}

export function be64(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
}

export function be16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n);
  return b;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const keccak = (...parts: Uint8Array[]): Uint8Array => keccak_256(concat(...parts));

/** Destination bytes for a leaf: kind 1 is a 20-byte EVM address, kind 2 a 32-byte Solana pubkey. */
export function destinationBytes(kind: DestinationKind, destination: string, base58ToBytes: (s: string) => Uint8Array): Uint8Array {
  if (kind === 1) {
    const b = hexToBytes(destination);
    if (b.length !== 20) throw new Error(`EVM destination must be 20 bytes: ${destination}`);
    return b;
  }
  if (kind === 2) {
    if (destination.startsWith("0x")) {
      const b = hexToBytes(destination);
      if (b.length !== 32) throw new Error(`Solana destination must be 32 bytes: ${destination}`);
      return b;
    }
    const b = base58ToBytes(destination);
    if (b.length !== 32) throw new Error(`Solana destination must be 32 bytes: ${destination}`);
    return b;
  }
  throw new Error(`unknown destination kind ${kind as number}`);
}

export function leafHash(
  auctionId: Uint8Array,
  leaf: { index: number; lot_count: number; destination_kind: number; destination: Uint8Array },
  asset: Uint8Array = ASSET_SOL,
): Uint8Array {
  return keccak(
    new TextEncoder().encode("benzo-leaf-v1"),
    auctionId,
    be64(leaf.index),
    asset,
    be64(leaf.lot_count),
    Uint8Array.of(leaf.destination_kind),
    leaf.destination,
  );
}

const pair = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? keccak(a, b) : keccak(b, a);

export interface Tree {
  treeRoot: Uint8Array;
  proofs: Uint8Array[][];
}

/** Sorted-pair Merkle tree; odd nodes are promoted unchanged (both chains fold proofs the same way). */
export function buildTree(leaves: Uint8Array[]): Tree {
  if (leaves.length === 0) throw new Error("empty allocation");
  const levels: Uint8Array[][] = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1], next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pair(cur[i], cur[i + 1]) : cur[i]);
    levels.push(next);
  }
  const proofs = leaves.map((_, li) => {
    const proof: Uint8Array[] = [];
    for (let l = 0; l < levels.length - 1; l++) {
      const sib = (li >> l) ^ 1;
      if (sib < levels[l].length) proof.push(levels[l][sib]);
    }
    return proof;
  });
  return { treeRoot: levels[levels.length - 1][0], proofs };
}

export function rootHash(leafCount: number, treeRoot: Uint8Array): Uint8Array {
  return keccak(new TextEncoder().encode("benzo-root-v1"), be64(leafCount), treeRoot);
}

export function allocationRoot(tree: Tree, leafCount: number): Uint8Array {
  return rootHash(leafCount, tree.treeRoot);
}
