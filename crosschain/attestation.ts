// Attestation message builders, domain-separated per chain.
//
// EVM: EIP-712 typed data over the BenzoRelease struct; the domain binds chainId +
// verifyingContract and the domain name binds the "benzo-release-v1" string:
//   benzo-release-v1 ‖ chain_id ‖ escrow_address ‖ auction_id ‖ result_hash ‖ allocation_root
//     ‖ batch_index ‖ nonce ‖ expiry
// Solana: the same fields in one fixed 200-byte layout with the cluster genesis hash and the
// program ID, signed raw with Ed25519:
//   "benzo-release-v1" (16) ‖ genesis_hash (32) ‖ program_id (32) ‖ auction_id (32)
//     ‖ result_hash (32) ‖ allocation_root (32) ‖ batch_index u64be ‖ nonce u64be ‖ expiry i64be
//
// Each (auction_id, batch_index) is releasable once on chain (lessons 1, 3).
import { be64, concat } from "./leaf";

export interface AttestationFields {
  auctionId: Uint8Array; // 32 bytes
  resultHash: Uint8Array; // 32 bytes
  allocationRoot: Uint8Array; // 32 bytes
  batchIndex: number;
  nonce: number;
  expiry: number; // unix seconds
}

export const SOLANA_ATT_LEN = 200;

export function solanaAttestationBytes(f: AttestationFields, genesis: Uint8Array, programId: Uint8Array): Uint8Array {
  for (const [name, b] of [["auctionId", f.auctionId], ["resultHash", f.resultHash], ["allocationRoot", f.allocationRoot], ["genesis", genesis], ["programId", programId]] as const) {
    if (b.length !== 32) throw new Error(`${name} must be 32 bytes`);
  }
  return concat(
    new TextEncoder().encode("benzo-release-v1"),
    genesis, programId, f.auctionId, f.resultHash, f.allocationRoot,
    be64(f.batchIndex), be64(f.nonce),
    // i64 big-endian (two's complement; expiry is a positive unix timestamp)
    be64(BigInt.asUintN(64, BigInt(f.expiry))),
  );
}

// EIP-712 domain/type names must match contracts/evm/src/BenzoEscrow.sol exactly.
export const EVM_DOMAIN_NAME = "benzo-release-v1";
export const EVM_DOMAIN_VERSION = "1";
export const EVM_RELEASE_TYPES = {
  BenzoRelease: [
    { name: "auctionId", type: "bytes32" },
    { name: "resultHash", type: "bytes32" },
    { name: "allocationRoot", type: "bytes32" },
    { name: "batchIndex", type: "uint64" },
    { name: "nonce", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
};

export function evmTypedData(f: AttestationFields, chainId: bigint, verifyingContract: string) {
  return {
    domain: { name: EVM_DOMAIN_NAME, version: EVM_DOMAIN_VERSION, chainId, verifyingContract },
    types: EVM_RELEASE_TYPES,
    message: {
      auctionId: "0x" + Buffer.from(f.auctionId).toString("hex"),
      resultHash: "0x" + Buffer.from(f.resultHash).toString("hex"),
      allocationRoot: "0x" + Buffer.from(f.allocationRoot).toString("hex"),
      batchIndex: f.batchIndex,
      nonce: f.nonce,
      expiry: f.expiry,
    },
  };
}
