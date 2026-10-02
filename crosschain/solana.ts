// Solana escrow client (@solana/web3.js): lock/submit-attestation/release-approved/refund/status
// against a local solana-test-validator or devnet. Instruction and attestation layouts mirror
// contracts/solana/src/lib.rs exactly (design §9: attest once — `submit_attestation` writes the
// Approval PDA — then release many — `release_approved` is signature-free and repeatable). They
// are proven against the program by contracts/solana/test/driver.mjs and the cross-chain demo.
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection, Keypair, MessageV0, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AttestationFields, SOLANA_ATT_LEN, solanaAttestationBytes } from "./attestation";
import { be16, be64, bytesToHex, concat } from "./leaf";

export { solanaAttestationBytes };

export const IX_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");
export const ED25519_PROGRAM = new PublicKey("Ed25519SigVerify111111111111111111111111111");

/** Solana's transaction packet limit: everything the release path sends stays within it. */
export const PACKET_LIMIT = 1232;

export function solConnection(rpc: string): Connection {
  return new Connection(rpc, "confirmed");
}

const TAG = (tag: number) => Uint8Array.of(1, tag); // version 1
const le64 = (n: number | bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};

export function auctionPda(programId: PublicKey, auctionId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), Buffer.from(auctionId)], programId)[0];
}
/** design §9: seeds ["approval", auction_id, batch_index u64 le] */
export function approvalPda(programId: PublicKey, auctionId: Uint8Array, batch: number): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("approval"), Buffer.from(auctionId), Buffer.from(le64(batch))], programId)[0];
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

/** Native Ed25519 verification instruction; the message is the submit-attestation ix's
 *  attestation bytes (message index 1 in the [verify, submit] transaction, offset 2, size 200) —
 *  strictly checked by the program. */
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

/** `submit_attestation` (design §9): verify 2-of-3 and write the Approval PDA. No transfers. */
export function submitAttestationInstruction(args: {
  programId: PublicKey; crank: PublicKey; auctionPda: PublicKey; approvalPda: PublicKey; att: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.crank, isSigner: true, isWritable: true },
      { pubkey: args.auctionPda, isSigner: false, isWritable: false },
      { pubkey: IX_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: args.approvalPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concat(TAG(2), args.att)),
  });
}

/** `release_approved` (design §9): pay payouts against a verified Approval. No signatures;
 *  anyone may call it repeatedly until every leaf is paid. */
export function releaseApprovedInstruction(args: {
  programId: PublicKey; crank: PublicKey; auctionPda: PublicKey; approvalPda: PublicKey; payouts: SolPayout[];
}): TransactionInstruction {
  const parts = [concat(TAG(4), be16(args.payouts.length))];
  for (const p of args.payouts) {
    parts.push(be64(p.index), be64(p.lotCount), Uint8Array.of(2), p.destination.toBytes(), be64(p.leafCount), be16(p.proof.length), ...p.proof);
  }
  const keys = [
    { pubkey: args.crank, isSigner: true, isWritable: true },
    { pubkey: args.auctionPda, isSigner: false, isWritable: true },
    { pubkey: args.approvalPda, isSigner: false, isWritable: false },
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

/** Serialized byte length of a transaction; web3.js refuses to serialize oversize ones, so the
 *  reported number from its error is used instead. */
function txSize(tx: VersionedTransaction | Transaction): number {
  try {
    return tx.serialize().length;
  } catch (e) {
    const m = /Transaction too large: (\d+)/.exec((e as Error)?.message ?? "");
    if (m) return Number(m[1]);
    throw e;
  }
}

/** Create + fill a lookup table holding `addresses` (in payout order) and wait (bounded poll)
 *  until its entries are active for lookups (the runtime ignores entries extended in the slot
 *  the transaction is processed in). */
export async function createLookupTableOn(
  conn: Connection, payer: Keypair, addresses: PublicKey[],
): Promise<{ table: AddressLookupTableAccount; txs: string[] }> {
  const slot = await conn.getSlot("finalized");
  const [createIx, tableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot,
  });
  const txs: string[] = [];
  txs.push(await sendTx(conn, payer, [createIx]));
  for (let i = 0; i < addresses.length; i += 20) {
    txs.push(await sendTx(conn, payer, [AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey, authority: payer.publicKey, lookupTable: tableAddress,
      addresses: addresses.slice(i, i + 20),
    })]));
  }
  const deadlineMs = Date.now() + 60_000;
  let filled: AddressLookupTableAccount | null = null;
  for (;;) {
    const got = await conn.getAddressLookupTable(tableAddress);
    if (got.value && got.value.state.addresses.length >= addresses.length) { filled = got.value; break; }
    if (Date.now() > deadlineMs) throw new Error(`lookup table ${tableAddress.toBase58()} did not fill`);
    await new Promise((r) => setTimeout(r, 200));
  }
  // entries extended at slot F are usable only from slot F+1 (state.rs get_active_addresses_len)
  const fillSlot = await conn.getSlot();
  for (;;) {
    if ((await conn.getSlot()) > fillSlot) return { table: filled!, txs };
    if (Date.now() > deadlineMs) throw new Error("slot did not advance after lookup-table fill");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Send `release_approved` payouts, chunked to fit the packet limit, as versioned transactions
 *  with the destination + paid-flag accounts in an address lookup table (design §9 size remedy:
 *  the measured capacity without a table is below 4 payouts at proof depth 4). Returns the
 *  payout indexes of each sent chunk and the transaction signatures. */
export async function sendReleaseApproved(conn: Connection, payer: Keypair, args: {
  programId: PublicKey; auctionPda: PublicKey; approvalPda: PublicKey; payouts: SolPayout[];
}): Promise<{ chunks: number[][]; txs: string[]; lookupTable: string }> {
  // lookup-table order follows usage order (dest_i, paid_i): compiled lookup indexes ascend
  const addresses = args.payouts.flatMap((p) => [p.destination, p.paidPda]);
  const { table, txs: setup } = await createLookupTableOn(conn, payer, addresses);
  const chunks: SolPayout[][] = [];
  let cur: SolPayout[] = [];
  for (const p of args.payouts) {
    const trial = [...cur, p];
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const msg = MessageV0.compile({
      payerKey: payer.publicKey,
      instructions: [releaseApprovedInstruction({ ...args, crank: payer.publicKey, payouts: trial })],
      recentBlockhash: blockhash,
      addressLookupTableAccounts: [table],
    });
    if (txSize(new VersionedTransaction(msg)) <= PACKET_LIMIT) cur = trial;
    else {
      if (!cur.length) throw new Error(`payout ${p.index} alone exceeds the transaction packet limit`);
      chunks.push(cur);
      cur = [p];
    }
  }
  if (cur.length) chunks.push(cur);
  const txs = [...setup];
  const sent: number[][] = [];
  for (const chunk of chunks) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const msg = MessageV0.compile({
      payerKey: payer.publicKey,
      instructions: [releaseApprovedInstruction({ ...args, crank: payer.publicKey, payouts: chunk })],
      recentBlockhash: blockhash,
      addressLookupTableAccounts: [table],
    });
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    txs.push(sig);
    sent.push(chunk.map((p) => p.index));
  }
  return { chunks: sent, txs, lookupTable: table.key.toBase58() };
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
