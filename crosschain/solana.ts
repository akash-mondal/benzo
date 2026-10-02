// Solana escrow client (@solana/web3.js): lock/release/refund/status against a local
// solana-test-validator or devnet. Instruction and attestation layouts mirror
// contracts/solana/src/lib.rs exactly (they are proven against the program by
// contracts/solana/test/driver.mjs and by the cross-chain demo).
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { AttestationFields, SOLANA_ATT_LEN, solanaAttestationBytes } from "./attestation";
import { be16, be64, bytesToHex, concat } from "./leaf";

export { solanaAttestationBytes };

export const IX_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");
export const ED25519_PROGRAM = new PublicKey("Ed25519SigVerify111111111111111111111111111");

export function solConnection(rpc: string): Connection {
  return new Connection(rpc, "confirmed");
}

const TAG = (tag: number) => Uint8Array.of(1, tag); // version 1

export function auctionPda(programId: PublicKey, auctionId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), Buffer.from(auctionId)], programId)[0];
}
export function batchPda(programId: PublicKey, auctionId: Uint8Array, batch: number): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("batch"), Buffer.from(auctionId), Buffer.from(be64(batch))], programId)[0];
}
export function paidPda(programId: PublicKey, auctionId: Uint8Array, leaf: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("paid"), Buffer.from(auctionId), Buffer.from(leaf)], programId)[0];
}

export function lockInstruction(args: {
  programId: PublicKey; seller: PublicKey; auctionPda: PublicKey;
  auctionId: Uint8Array; genesis: Uint8Array; amount: bigint; lot: bigint;
  lockUntil: number; deadline: number; signers: Uint8Array[]; returnTo: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.seller, isSigner: true, isWritable: true },
      { pubkey: args.auctionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concat(
      TAG(1), args.auctionId, args.genesis,
      be64(args.amount), be64(args.lot),
      be64(BigInt.asUintN(64, BigInt(args.lockUntil))), be64(BigInt.asUintN(64, BigInt(args.deadline))),
      args.signers[0], args.signers[1], args.signers[2], args.returnTo,
    )),
  });
}

/** Native Ed25519 verification instruction; the message is the release ix's attestation bytes
 *  (message index 1 in the [verify, release] transaction, offset 2, size 200) — strictly checked. */
export function ed25519Instruction(signatures: Uint8Array[], pubkeys: Uint8Array[]): TransactionInstruction {
  const n = signatures.length;
  const header = 2 + 14 * n;
  const sigStart = header, pkStart = sigStart + 64 * n;
  const head = new Uint8Array(header);
  head[0] = n;
  for (let i = 0; i < n; i++) {
    const dv = new DataView(head.buffer);
    const o = 2 + 14 * i;
    dv.setUint16(o, sigStart + 64 * i, true); dv.setUint16(o + 2, 0xffff, true);
    dv.setUint16(o + 4, pkStart + 32 * i, true); dv.setUint16(o + 6, 0xffff, true);
    dv.setUint16(o + 8, 2, true); dv.setUint16(o + 10, SOLANA_ATT_LEN, true); dv.setUint16(o + 12, 1, true);
  }
  return new TransactionInstruction({
    programId: ED25519_PROGRAM,
    keys: [],
    data: Buffer.from(concat(head, ...signatures, ...pubkeys)),
  });
}

export interface SolPayout {
  index: number;
  lotCount: number;
  destination: PublicKey;
  destWritable: boolean;
  leafCount: number;
  proof: Uint8Array[];
  paidPda: PublicKey;
}

export function releaseInstruction(args: {
  programId: PublicKey; crank: PublicKey; auctionPda: PublicKey; batchPda: PublicKey;
  att: Uint8Array; payouts: SolPayout[];
}): TransactionInstruction {
  const parts = [concat(TAG(2), args.att, be16(args.payouts.length))];
  for (const p of args.payouts) {
    parts.push(be64(p.index), be64(p.lotCount), Uint8Array.of(2), p.destination.toBytes(), be64(p.leafCount), be16(p.proof.length), ...p.proof);
  }
  const keys = [
    { pubkey: args.crank, isSigner: true, isWritable: true },
    { pubkey: args.auctionPda, isSigner: false, isWritable: true },
    { pubkey: IX_SYSVAR, isSigner: false, isWritable: false },
    { pubkey: args.batchPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  for (const p of args.payouts) {
    keys.push({ pubkey: p.destination, isSigner: false, isWritable: p.destWritable });
    keys.push({ pubkey: p.paidPda, isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({
    programId: args.programId,
    keys,
    data: Buffer.from(concat(...parts)),
  });
}

export function refundInstruction(args: {
  programId: PublicKey; crank: PublicKey; auctionPda: PublicKey; returnTo: PublicKey; auctionId: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.crank, isSigner: true, isWritable: true },
      { pubkey: args.auctionPda, isSigner: false, isWritable: true },
      { pubkey: args.returnTo, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(concat(TAG(3), args.auctionId)),
  });
}

/** Send [verify ix, release ix] (or any ix list) with an explicit blockhash; returns the tx signature. */
export async function sendTx(conn: Connection, payer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

export interface SolStatus {
  bump: number; refunded: boolean; auctionId: string; genesis: string;
  signers: string[]; returnTo: string; amount: string; standardLot: string; paid: string;
  lockUntil: number; deadline: number; paidLeaves: Record<string, boolean>;
}

export function parseAuctionState(data: Buffer): Omit<SolStatus, "paidLeaves"> {
  if (data.length !== 235 || data[0] !== 1) throw new Error("not a BenzoEscrow auction account");
  return {
    bump: data[1], refunded: data[2] !== 0,
    auctionId: bytesToHex(new Uint8Array(data.subarray(3, 35))),
    genesis: bytesToHex(new Uint8Array(data.subarray(35, 67))),
    signers: [0, 1, 2].map((i) => bytesToHex(new Uint8Array(data.subarray(67 + 32 * i, 99 + 32 * i)))),
    returnTo: new PublicKey(data.subarray(163, 195)).toBase58(),
    amount: data.readBigUInt64LE(195).toString(),
    standardLot: data.readBigUInt64LE(203).toString(),
    paid: data.readBigUInt64LE(211).toString(),
    lockUntil: Number(data.readBigInt64LE(219)),
    deadline: Number(data.readBigInt64LE(227)),
  };
}

export async function solStatus(conn: Connection, programId: PublicKey, auctionId: Uint8Array, leaves: Uint8Array[]): Promise<SolStatus> {
  const info = await conn.getAccountInfo(auctionPda(programId, auctionId));
  if (!info) throw new Error("auction account not found");
  const base = parseAuctionState(Buffer.from(info.data));
  const paidLeaves: Record<string, boolean> = {};
  for (const leaf of leaves) {
    const flag = await conn.getAccountInfo(paidPda(programId, auctionId, leaf));
    paidLeaves[bytesToHex(leaf)] = flag !== null && (flag.lamports > 0 || flag.data.length > 0);
  }
  return { ...base, paidLeaves };
}
