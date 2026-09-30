// merkle_root_v1: leaf SHA256(00 || ciphertext SHA256 bytes || canonical deposit JSON),
// parent SHA256(01 || left || right), odd last node duplicated, empty root SHA256(02).
import { hash, jsonBytes, requireThat, verifyRecord, type Signed } from "../manifest/schema";
export type Deposit = { txid: string; pool: "ironwood"; address: string; diversifier_index: string };
export type Receipt = { auction_id: string; manifest_hash: string; ciphertext_hash: string; deposit: Deposit; leaf_index: number };
export type Leaf = Receipt & { ciphertext_hex: string };
export type Path = { side: "left" | "right"; hash: string }[];
export type Frozen = { auction_id: string; manifest_hash: string; root: string; leaf_count: number; cutoff: number; published_at: number; leaves: Leaf[]; paths: Path[] };
export const leafHash = (ciphertextHash: string, deposit: Deposit) => hash(Buffer.concat([Buffer.from([0]),Buffer.from(ciphertextHash,"hex"),jsonBytes(deposit)]));
const parent = (left: string, right: string) => hash(Buffer.concat([Buffer.from([1]),Buffer.from(left,"hex"),Buffer.from(right,"hex")]));
export function tree(leaves: Leaf[]): { root: string; paths: Path[] } {
  const levels = [leaves.map(l => leafHash(l.ciphertext_hash,l.deposit))];
  while (levels[levels.length - 1].length > 1) {
    const level = levels[levels.length - 1], next: string[] = [];
    for (let i=0;i<level.length;i+=2) next.push(parent(level[i],level[i+1] ?? level[i]));
    levels.push(next);
  }
  const paths = leaves.map((_, index) => {
    const path: Path = [];
    for (const level of levels.slice(0,-1)) {
      path.push({side:index % 2 ? "left":"right",hash:level[index ^ 1] ?? level[index]}); index = Math.floor(index/2);
    }
    return path;
  });
  return { root: levels[levels.length-1][0] ?? hash(Buffer.from([2])), paths };
}
export function member(ciphertextHash: string, deposit: Deposit, index: number, count: number, path: Path, root: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(ciphertextHash) || !Number.isInteger(index) || index < 0 || index >= count || path.length !== Math.ceil(Math.log2(count))) return false;
  let node = leafHash(ciphertextHash,deposit);
  for (const sibling of path) {
    if (!/^[0-9a-f]{64}$/.test(sibling.hash) || sibling.side !== (index % 2 ? "left":"right")) return false;
    node = sibling.side === "left" ? parent(sibling.hash,node) : parent(node,sibling.hash); index = Math.floor(index/2);
  }
  return node === root;
}
export function checkFrozen(frozen: Frozen, auctionId: string, manifestHash: string): void {
  requireThat(frozen.auction_id === auctionId && frozen.manifest_hash === manifestHash && frozen.leaf_count === frozen.leaves.length, "freeze auction/count");
  const refs = new Set<string>(), ciphertexts = new Set<string>();
  for (const [i,l] of frozen.leaves.entries()) {
    requireThat(l.auction_id === auctionId && l.manifest_hash === manifestHash && l.leaf_index === i &&
      /^[0-9a-f]+$/.test(l.ciphertext_hex) && l.ciphertext_hex.length % 2 === 0 && hash(Buffer.from(l.ciphertext_hex,"hex")) === l.ciphertext_hash, "freeze leaf binding");
    const ref = jsonBytes(l.deposit).toString("utf8");
    requireThat(!refs.has(ref) && !ciphertexts.has(l.ciphertext_hash), "duplicate frozen leaf"); refs.add(ref); ciphertexts.add(l.ciphertext_hash);
  }
  requireThat(tree(frozen.leaves).root === frozen.root, "freeze root");
}
export function receiptMember(packet: Signed, frozen: Frozen, signer: string): boolean {
  const r = verifyRecord<Receipt>(packet,signer);
  return r.auction_id === frozen.auction_id && r.manifest_hash === frozen.manifest_hash &&
    member(r.ciphertext_hash,r.deposit,r.leaf_index,frozen.leaf_count,frozen.paths[r.leaf_index] ?? [],frozen.root);
}
