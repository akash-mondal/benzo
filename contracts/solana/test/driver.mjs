#!/usr/bin/env node
// Benzo cross-chain escrow, Solana test driver (docs/design/crosschain.md §7 step 2).
// Runs against a local solana-test-validator with the freshly built benzo_escrow.so loaded.
// Every expected failure asserts the specific custom-program error code, and all expectations
// (leaf/root/attestation bytes, instruction layouts) are computed here from the design §1/§3
// byte layouts, independent of the Rust program source.
//
// Behaviours: lock / release 2-of-3 Ed25519 / replay refusal / refund after deadline /
// per-recipient paid flags, plus the spoofed-sysvar refusal and the attestation binding.
//
// Output: one `PASS <id>` or `ERROR <id> <reason>` line per assertion; exit 0 only if all PASS.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3";

const RPC = process.env.BNZ_SOLANA_RPC ?? "http://127.0.0.1:8901";
const PROGRAM_ID = new PublicKey(process.argv[2] ?? process.env.BNZ_SOLANA_PROGRAM ?? "");
const conn = new Connection(RPC, "confirmed");

// ---------- canonical cross-chain encodings (design §1/§3; mirrored in contracts/evm + Rust) ----------
const utf8 = (s) => new TextEncoder().encode(s);
const be64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const beI64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n)); return b; };
const be16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const keccak = (...parts) => keccak_256(cat(...parts));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (b) => Buffer.from(b).toString("hex").slice(0, 16);

const ASSET_SOL = new Uint8Array(32); // native SOL is the zero asset id on every chain
const leafHash = (auctionId, index, asset, lotCount, kind, dest) =>
  keccak(utf8("benzo-leaf-v1"), auctionId, be64(index), asset, be64(lotCount), Uint8Array.of(kind), dest);
const pair = (a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? keccak(a, b) : keccak(b, a));
const rootHash = (leafCount, treeRoot) => keccak(utf8("benzo-root-v1"), be64(leafCount), treeRoot);

function buildTree(leaves) {
  // sorted-pair tree; returns {root: treeRoot, proofs: [[sibling, ...], ...]}
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1], next = [];
    for (let i = 0; i < cur.length; i += 2) {
      if (i + 1 < cur.length) next.push(pair(cur[i], cur[i + 1]));
      else next.push(cur[i]); // odd node promoted unchanged
    }
    levels.push(next);
  }
  const proofs = leaves.map((_, li) => {
    const proof = [];
    for (let l = 0; l < levels.length - 1; l++) {
      const idx = li >> l;
      const sib = idx ^ 1;
      if (sib < levels[l].length) proof.push(levels[l][sib]);
    }
    return proof;
  });
  return { treeRoot: levels[levels.length - 1][0], proofs };
}

const attestation = (genesis, programId, auctionId, resultHash, allocRoot, batch, nonce, expiry) =>
  cat(utf8("benzo-release-v1"), genesis, programId, auctionId, resultHash, allocRoot, be64(batch), be64(nonce), beI64(expiry));

// ---------- Solana instruction builders ----------
const TAG = (tag) => Uint8Array.of(1, tag); // version 1

function lockIx(seller, auctionPda, { auctionId, genesis, amount, lot, lockUntil, deadline, signers, returnTo }) {
  const data = cat(TAG(1), auctionId, genesis, be64(amount), be64(lot), beI64(lockUntil), beI64(deadline),
    signers[0], signers[1], signers[2], returnTo);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// native Ed25519 verification instruction with 2-3 signatures; the message lives in the release
// instruction and is referenced cross-instruction (strictly checked: index == release ix, offset 2)
function ed25519Ix(signatures, pubkeys, msgRef) {
  const n = signatures.length;
  const header = 2 + 14 * n;
  const sigStart = header, pkStart = sigStart + 64 * n;
  const head = new Uint8Array(header);
  head[0] = n; // data[1] unused
  for (let i = 0; i < n; i++) {
    const dv = new DataView(head.buffer);
    const o = 2 + 14 * i;
    dv.setUint16(o, sigStart + 64 * i, true); dv.setUint16(o + 2, 0xffff, true);
    dv.setUint16(o + 4, pkStart + 32 * i, true); dv.setUint16(o + 6, 0xffff, true);
    dv.setUint16(o + 8, msgRef.offset, true); dv.setUint16(o + 10, msgRef.size, true);
    dv.setUint16(o + 12, msgRef.ixIndex, true);
  }
  return new TransactionInstruction({
    programId: new PublicKey("Ed25519SigVerify111111111111111111111111111"),
    keys: [],
    data: Buffer.from(cat(head, ...signatures, ...pubkeys)),
  });
}
// the attestation message is at offset 2 of the release instruction, which sits at message index 1
const MSG_REF = { ixIndex: 1, offset: 2, size: 200 };

function releaseIx(crank, auctionPda, batchPda, att, payouts) {
  // payouts: [{index, lotCount, dest, leafCount, proof, paidPda, destAi, destWritable}]
  const parts = [cat(TAG(2), att, be16(payouts.length))];
  for (const p of payouts) {
    parts.push(be64(p.index), be64(p.lotCount), Uint8Array.of(2), p.dest, be64(p.leafCount), be16(p.proof.length), ...p.proof);
  }
  const keys = [
    { pubkey: crank.publicKey, isSigner: true, isWritable: true },
    { pubkey: auctionPda, isSigner: false, isWritable: true },
    { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: batchPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  for (const p of payouts) {
    keys.push({ pubkey: p.destAi, isSigner: false, isWritable: p.destWritable });
    keys.push({ pubkey: p.paidPda, isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(cat(...parts)) });
}

function refundIx(crank, auctionPda, returnTo, auctionId) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: crank.publicKey, isSigner: true, isWritable: true },
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: returnTo, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(cat(TAG(3), auctionId)),
  });
}

// ---------- PDA helpers ----------
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const auctionPdaFor = (auctionId) => pda([Buffer.from("escrow"), Buffer.from(auctionId)]);
const batchPdaFor = (auctionId, batch) => pda([Buffer.from("batch"), Buffer.from(auctionId), Buffer.from(be64(batch))]);
const paidPdaFor = (auctionId, leaf) => pda([Buffer.from("paid"), Buffer.from(auctionId), Buffer.from(leaf)]);

// ---------- assertion plumbing ----------
let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
function check(id, cond, reason) { if (cond) pass(id); else fail(id, reason); }

function customErrorCode(e) {
  const text = `${e?.message ?? ""}\n${(e?.logs ?? []).join("\n")}`;
  const m = text.match(/custom program error: 0x([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) : null;
}

async function expectCustomError(id, code, fn) {
  try {
    await fn();
    fail(id, `expected custom error 0x${code.toString(16)}, transaction succeeded`);
  } catch (e) {
    const got = customErrorCode(e);
    if (got === code) pass(id);
    else fail(id, `expected custom error 0x${code.toString(16)}, got ${got === null ? `no custom code (${e.message})` : `0x${got.toString(16)}`}`);
  }
}

async function chainTime() {
  const slot = await conn.getSlot();
  return await conn.getBlockTime(slot);
}

async function waitUntilChainTime(t, label) {
  const deadlineMs = Date.now() + 90_000;
  for (;;) {
    const now = await chainTime();
    if (now > t) return now;
    if (Date.now() > deadlineMs) throw new Error(`timed out waiting for chain time > ${t} (${label}); last ${now}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

const send = async (payer, ...ixs) => {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
};

// ---------- scenarios ----------
async function main() {
  if (!PROGRAM_ID.toBase58() || PROGRAM_ID.toBase58() === "11111111111111111111111111111111")
    throw new Error("usage: driver.mjs <program id base58>  (BNZ_SOLANA_RPC to override the RPC)");

  // local dev keys, generated fresh for this run (never persisted)
  const seller = Keypair.generate();
  const crank = Keypair.generate();
  const returnTo = Keypair.generate();
  for (const kp of [seller, crank]) {
    const sig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig);
  }

  const genesis = new PublicKey(await conn.getGenesisHash()).toBytes();
  const auctionId = randomBytes(32);
  const programIdBytes = PROGRAM_ID.toBytes();
  const resultHash = randomBytes(32);

  // three Ed25519 signer keys (the alice/bob/carol roles, per-auction per design §1)
  const signerPks = [randomBytes(32), randomBytes(32), randomBytes(32)];
  const signers = signerPks.map((sk) => ed25519.getPublicKey(sk)); // 32-byte pubkeys
  const sign = (i, att) => ed25519.sign(att, signerPks[i]); // signers sign the raw 200-byte attestation

  const t0 = await chainTime();
  const lockUntil = t0 + 5, deadline = t0 + 40;
  const LOT = BigInt(LAMPORTS_PER_SOL); // 1 SOL per lot
  const AMOUNT = 5n * LOT; // five lots locked; four get paid, one is refunded as remainder

  const r1 = Keypair.generate(), r2 = Keypair.generate(), r3 = Keypair.generate(), r4 = Keypair.generate();
  const dest = (kp) => kp.publicKey.toBytes();

  // ---- 1. lock ----
  const auctionPda = auctionPdaFor(auctionId);
  await send(seller, lockIx(seller, auctionPda, {
    auctionId, genesis, amount: AMOUNT, lot: LOT, lockUntil, deadline,
    signers, returnTo: returnTo.publicKey.toBytes(),
  }));
  {
    const info = await conn.getAccountInfo(auctionPda);
    const d = info?.data;
    const ok = info && info.owner.equals(PROGRAM_ID) && d.length === 235 && d[0] === 1 && d[2] === 0 &&
      eq(d.slice(3, 35), auctionId) && eq(d.slice(35, 67), genesis) &&
      eq(d.slice(67, 99), signers[0]) && eq(d.slice(99, 131), signers[1]) && eq(d.slice(131, 163), signers[2]) &&
      eq(d.slice(163, 195), returnTo.publicKey.toBytes()) &&
      d.readBigUInt64LE(195) === AMOUNT && d.readBigUInt64LE(203) === LOT &&
      d.readBigUInt64LE(211) === 0n &&
      BigInt(d.readBigInt64LE(219)) === BigInt(lockUntil) && BigInt(d.readBigInt64LE(227)) === BigInt(deadline);
    check("lock-records-state", ok, "auction PDA state differs from the locked values");
  }

  await expectCustomError("lock-twice-refused", 3, () =>
    send(seller, lockIx(seller, auctionPda, {
      auctionId, genesis, amount: AMOUNT, lot: LOT, lockUntil, deadline, signers,
      returnTo: returnTo.publicKey.toBytes(),
    })));

  {
    // lock refused after T_submit (poll the chain clock past lockUntil — no fixed sleeps)
    await waitUntilChainTime(lockUntil, "lockUntil");
    const lateId = randomBytes(32);
    const latePda = auctionPdaFor(lateId);
    await expectCustomError("lock-after-submit-refused", 4, () =>
      send(seller, lockIx(seller, latePda, {
        auctionId: lateId, genesis, amount: AMOUNT, lot: LOT, lockUntil, deadline, signers,
        returnTo: returnTo.publicKey.toBytes(),
      })));
  }

  // ---- 2. release with 2-of-3 Ed25519 ----
  const mkPayout = (kp, index, lotCount, leaves, proofs, batch, writable = true) => ({
    index, lotCount, dest: dest(kp), destAi: kp.publicKey, destWritable: writable,
    leafCount: leaves.length, proof: proofs[index],
    paidPda: paidPdaFor(auctionId, leaves[index]),
    leaf: leaves[index], batch,
  });
  const bal = async (kp) => await conn.getBalance(kp.publicKey);

  // batch 0 tree: [r1 lot1, r2 lot1]
  const leafA = leafHash(auctionId, 0, ASSET_SOL, 1, 2, dest(r1));
  const leafB = leafHash(auctionId, 1, ASSET_SOL, 1, 2, dest(r2));
  const tree0 = buildTree([leafA, leafB]);
  const root0 = rootHash(2, tree0.treeRoot);

  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root0, 0, 0, deadline);
    const sigs = [sign(0, att), sign(2, att)]; // alice + carol
    const p0 = mkPayout(r1, 0, 1, [leafA, leafB], tree0.proofs, 0);
    const p1 = mkPayout(r2, 1, 1, [leafA, leafB], tree0.proofs, 0);
    const b1 = await bal(r1), b2 = await bal(r2);
    await send(crank, ed25519Ix(sigs, [signers[0], signers[2]], MSG_REF),
      releaseIx(crank, auctionPda, batchPdaFor(auctionId, 0), att, [p0, p1]));
    const a1 = await bal(r1), a2 = await bal(r2);
    const f1 = await conn.getAccountInfo(paidPdaFor(auctionId, leafA));
    const f2 = await conn.getAccountInfo(paidPdaFor(auctionId, leafB));
    check("release-2of3-pays",
      BigInt(a1 - b1) === LOT && BigInt(a2 - b2) === LOT && f1 !== null && f2 !== null,
      `balances r1 +${a1 - b1} r2 +${a2 - b2} (want ${LOT}), paid flags ${f1 !== null}/${f2 !== null}`);
  }

  await expectCustomError("replay-refused", 9, async () => {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root0, 0, 0, deadline);
    const sigs = [sign(0, att), sign(2, att)];
    const p0 = mkPayout(r1, 0, 1, [leafA, leafB], tree0.proofs, 0);
    const p1 = mkPayout(r2, 1, 1, [leafA, leafB], tree0.proofs, 0);
    await send(crank, ed25519Ix(sigs, [signers[0], signers[2]], MSG_REF),
      releaseIx(crank, auctionPda, batchPdaFor(auctionId, 0), att, [p0, p1]));
  });

  // ---- per-recipient paid flags: one failing recipient never reverts the batch ----
  const leafC = leafHash(auctionId, 0, ASSET_SOL, 1, 2, dest(r3));
  const leafD = leafHash(auctionId, 1, ASSET_SOL, 1, 2, dest(r4));
  const tree1 = buildTree([leafC, leafD]);
  const root1 = rootHash(2, tree1.treeRoot);

  {
    // batch 1: r3's account is readonly (cannot receive) -> skipped; r4 is paid regardless
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 1, 0, deadline);
    const sigs = [sign(1, att), sign(2, att)];
    const pC = mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 1, false); // readonly = failing recipient
    const pD = mkPayout(r4, 1, 1, [leafC, leafD], tree1.proofs, 1, true);
    const b3 = await bal(r3), b4 = await bal(r4);
    await send(crank, ed25519Ix(sigs, [signers[1], signers[2]], MSG_REF),
      releaseIx(crank, auctionPda, batchPdaFor(auctionId, 1), att, [pC, pD]));
    const a3 = await bal(r3), a4 = await bal(r4);
    check("recipient-flag-failure-skipped-not-reverted",
      a3 - b3 === 0 && BigInt(a4 - b4) === LOT,
      `r3 +${a3 - b3} (want 0: skipped), r4 +${a4 - b4} (want ${LOT}: paid despite sibling failure)`);
  }

  {
    // batch 2, same leaves/root, new batch index: the failed item is claimable, the paid one is not
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 2, 0, deadline);
    const sigs = [sign(0, att), sign(1, att)];
    const pC = mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 2, true);
    const pD = mkPayout(r4, 1, 1, [leafC, leafD], tree1.proofs, 2, true);
    const b3 = await bal(r3), b4 = await bal(r4);
    await send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF),
      releaseIx(crank, auctionPda, batchPdaFor(auctionId, 2), att, [pC, pD]));
    const a3 = await bal(r3), a4 = await bal(r4);
    check("recipient-flag-claimable-later-no-double-pay",
      BigInt(a3 - b3) === LOT && a4 - b4 === 0,
      `r3 +${a3 - b3} (want ${LOT}: claimable), r4 +${a4 - b4} (want 0: paid flag blocks double pay)`);
  }

  // ---- attestation refusals (specific errors) ----
  {
    // one signature is not 2-of-3
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 3, 0, deadline);
    const sigs = [sign(0, att)];
    await expectCustomError("release-1sig-refused", 11, () =>
      send(crank, ed25519Ix(sigs, [signers[0]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 3), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 3)])));
  }
  {
    // two signatures from outside the signer set
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 4, 0, deadline);
    const outPks = [randomBytes(32), randomBytes(32)];
    const sigs = [ed25519.sign(att, outPks[0]), ed25519.sign(att, outPks[1])];
    await expectCustomError("release-outsider-signatures-refused", 12, () =>
      send(crank, ed25519Ix(sigs, [ed25519.getPublicKey(outPks[0]), ed25519.getPublicKey(outPks[1])], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 4), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 4)])));
  }
  {
    // the same signer twice is one signature, not two
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 5, 0, deadline);
    const sigs = [sign(0, att), sign(0, att)];
    await expectCustomError("release-one-signer-twice-refused", 12, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[0]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 5), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 5)])));
  }
  {
    // cross-cluster binding: a correctly signed attestation for another genesis hash is refused
    const att = attestation(new Uint8Array(32), programIdBytes, auctionId, resultHash, root1, 6, 0, deadline);
    const sigs = [sign(0, att), sign(1, att)];
    await expectCustomError("release-wrong-genesis-refused", 18, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 6), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 6)])));
  }
  {
    // expired attestation is refused
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 7, 0, t0 - 10);
    const sigs = [sign(0, att), sign(1, att)];
    await expectCustomError("release-expired-refused", 8, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 7), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 7)])));
  }

  // ---- spoofed-sysvar refusal (the 2022 Wormhole class) ----
  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 8, 0, deadline);
    const sigs = [sign(0, att), sign(1, att)];
    const fakeSysvar = Keypair.generate().publicKey;
    const ix = releaseIx(crank, auctionPda, batchPdaFor(auctionId, 8), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 8)]);
    ix.keys[2] = { pubkey: fakeSysvar, isSigner: false, isWritable: false }; // spoofed sysvar account
    await expectCustomError("spoofed-sysvar-refused", 10, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF), ix));
  }

  // ---- leaf bounds and root membership ----
  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 9, 0, deadline);
    const sigs = [sign(0, att), sign(1, att)];
    const bad = { ...mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 9), index: 2, leafCount: 2 };
    await expectCustomError("release-leaf-index-bound-refused", 14, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 9), att, [bad])));
  }
  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 10, 0, deadline);
    const sigs = [sign(0, att), sign(1, att)];
    const bad = { ...mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 10), proof: [leafB] }; // wrong sibling
    await expectCustomError("release-leaf-not-in-root-refused", 15, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 10), att, [bad])));
  }

  // ---- 4. refund after deadline ----
  {
    await expectCustomError("refund-before-deadline-refused", 16, () =>
      send(crank, refundIx(crank, auctionPda, returnTo.publicKey, auctionId)));

    await waitUntilChainTime(deadline, "deadline");
    const b = await bal(returnTo);
    await send(crank, refundIx(crank, auctionPda, returnTo.publicKey, auctionId));
    const a = await bal(returnTo);
    // paid 4 lots of 5 locked -> remainder 1 lot returns to the pinned address
    check("refund-after-deadline-returns-remainder", BigInt(a - b) === LOT,
      `return address +${a - b}, want remainder ${LOT} (5 lots locked, 4 paid)`);

    const info = await conn.getAccountInfo(auctionPda);
    check("refund-sets-closed-flag", info.data[2] === 1, `refunded flag is ${info.data[2]}, want 1`);
  }

  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 11, 0, deadline);
    const sigs = [sign(0, att), sign(1, att)];
    await expectCustomError("release-after-refund-refused", 7, () =>
      send(crank, ed25519Ix(sigs, [signers[0], signers[1]], MSG_REF),
        releaseIx(crank, auctionPda, batchPdaFor(auctionId, 11), att, [mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, 11)])));
    await expectCustomError("refund-twice-refused", 17, () =>
      send(crank, refundIx(crank, auctionPda, returnTo.publicKey, auctionId)));
  }

  console.log(failures === 0
    ? "RESULT PASS all Solana escrow assertions"
    : `RESULT FAIL ${failures} assertion(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`ERROR driver ${e.message}`);
  if (Array.isArray(e.logs) && e.logs.length) console.error(e.logs.join("\n"));
  process.exitCode = 1;
});
