#!/usr/bin/env node
// Benzo cross-chain escrow, Solana test driver (docs/design/crosschain.md §7 step 2 + §9).
// Runs against a local solana-test-validator with the freshly built benzo_escrow.so loaded.
// Every expected failure asserts the specific custom-program error code, and all expectations
// (leaf/root/attestation bytes, instruction layouts) are computed here from the design §1/§3/§9
// byte layouts, independent of the Rust program source.
//
// §9 "attest once, release many": submit_attestation (2-of-3 Ed25519, once per
// (auction_id, batch_index), writes the Approval PDA) then release_approved (anyone, no
// signatures, repeatedly until every leaf is paid). Tests: submit twice refused; release with no
// Approval refused; expired approval refused; release after refund refused; leaf not in the root
// refused; every leaf paid exactly once across several crank calls; spoofed sysvar on
// submit_attestation refused. §10 item 1 (reviewer F-1): a dusted `paid` PDA must not read as
// "already paid" — a paid flag counts only if program-owned with the PAID_V1 marker. R8 item 1
// (G9): a dusted escrow state PDA must not block the auction either — lock counts as done only
// when the program owns the state PDA with STATE_LEN data, and a dusted PDA is topped up and
// completed (allocate + assign), never read as "already locked". R9 item 1: the state account
// records its account-layout version and every instruction checks it — a layout-v1 account
// (loaded at genesis by test/old-layout-account.mjs) is refused with BadLayout, never read as
// this layout's state. The
// before/after payouts-per-transaction table at proof depths 0–6
// is measured from real serialized transactions (1232-byte packet limit) and printed as
// `SIZE depth=…` lines; it is recorded in docs/STATUS-B.md.
//
// Output: one `PASS <id>` or `ERROR <id> <reason>` line per assertion; exit 0 only if all PASS.

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
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
const le64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
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

// ---------- Solana instruction builders (design §9 wire layouts) ----------
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

// native Ed25519 verification instruction with 2-3 signatures; the message lives in the
// submit-attestation instruction and is referenced cross-instruction (strictly checked:
// index == submit ix, offset 2)
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
// the attestation message is at offset 2 of the submit instruction, which sits at message index 1
const MSG_REF = { ixIndex: 1, offset: 2, size: 200 };

function submitIx(crank, auctionPda, approvalPda, att) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: crank.publicKey, isSigner: true, isWritable: true },
      { pubkey: auctionPda, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: approvalPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(cat(TAG(2), att)),
  });
}

function releaseApprovedIx(crank, auctionPda, approvalPda, payouts) {
  // payouts: [{index, lotCount, dest, leafCount, proof, paidPda, destAi, destWritable}]
  const parts = [cat(TAG(4), be16(payouts.length))];
  for (const p of payouts) {
    parts.push(be64(p.index), be64(p.lotCount), Uint8Array.of(2), p.dest, be64(p.leafCount), be16(p.proof.length), ...p.proof);
  }
  const keys = [
    { pubkey: crank.publicKey, isSigner: true, isWritable: true },
    { pubkey: auctionPda, isSigner: false, isWritable: true },
    { pubkey: approvalPda, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  for (const p of payouts) {
    keys.push({ pubkey: p.destAi, isSigner: false, isWritable: p.destWritable });
    keys.push({ pubkey: p.paidPda, isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(cat(...parts)) });
}

// The REMOVED signature-carrying release layout ([ver, tag 2, att, payouts...]). Built here only
// to measure the "before" wire size for the §9 table; never sent — the program no longer accepts it.
function legacyReleaseIx(crank, auctionPda, batchPda, att, payouts) {
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
// design §9: seeds ["approval", auction_id, batch_index u64 le]
const approvalPdaFor = (auctionId, batch) => pda([Buffer.from("approval"), Buffer.from(auctionId), Buffer.from(le64(batch))]);
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
  // fail loudly (AGENTS): web3.js confirmTransaction resolves even when the landed transaction
  // carries an error — a landed failure must throw here, never be swallowed
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`transaction ${sig} failed on chain: ${JSON.stringify(res.value.err)}`);
  return sig;
};

// ---------- versioned tx + address lookup table (design §9 size remedy) ----------
const PACKET_LIMIT = 1232;

// create a real lookup table holding `addresses`, extend it in chunks, and wait (bounded poll on
// slot advance) until its entries are live before returning it
async function createLookupTable(payer, addresses) {
  // the lookup-table program requires recentSlot in SlotHashes — a completed slot, not the tip:
  // walk back from the tip until the create is accepted (bounded)
  let tableAddress = null;
  const tip = await conn.getSlot("processed");
  for (let back = 1; back <= 16 && tableAddress === null; back++) {
    const [createIx, key] = AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey, payer: payer.publicKey, recentSlot: tip - back,
    });
    try {
      await send(payer, createIx);
      tableAddress = key;
    } catch (e) {
      if (!/is not a recent slot/.test(String(e?.message))) throw e;
    }
  }
  if (tableAddress === null) throw new Error(`no recent slot accepted for lookup-table creation (tip ${tip})`);
  for (let i = 0; i < addresses.length; i += 20) {
    await send(payer, AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey, authority: payer.publicKey, lookupTable: tableAddress,
      addresses: addresses.slice(i, i + 20),
    }));
  }
  const startSlot = await conn.getSlot();
  const deadlineMs = Date.now() + 30_000;
  let filled = null;
  for (;;) {
    const got = await conn.getAddressLookupTable(tableAddress);
    if (got.value && got.value.state.addresses.length >= addresses.length) { filled = got.value; break; }
    if (Date.now() > deadlineMs) throw new Error(`lookup table ${tableAddress.toBase58()} did not fill`);
    await new Promise((r) => setTimeout(r, 200));
    if ((await conn.getSlot()) < startSlot) throw new Error("slot went backwards");
  }
  // lookup-table entries land in the loader's cache at the next slot: wait (bounded) for the
  // slot to advance past the extend before any transaction uses the table
  const fillSlot = await conn.getSlot();
  for (;;) {
    if ((await conn.getSlot()) > fillSlot) return filled;
    if (Date.now() > deadlineMs) throw new Error("slot did not advance after lookup-table fill");
    await new Promise((r) => setTimeout(r, 200));
  }
}

// build (but do not send) a v0 release_approved tx over `table`; returns the signed bytes length
function buildReleaseV0(payer, auctionPda, approvalPda, payouts, table, blockhash) {
  const ix = releaseApprovedIx(payer, auctionPda, approvalPda, payouts);
  const msg = MessageV0.compile({
    payerKey: payer.publicKey, instructions: [ix], recentBlockhash: blockhash,
    addressLookupTableAccounts: [table],
  });
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return tx;
}

// web3.js refuses to serialize a transaction over the packet limit; report the real size anyway
function txSize(tx) {
  try {
    return tx.serialize().length;
  } catch (e) {
    const m = /Transaction too large: (\d+)/.exec(e?.message ?? "");
    if (m) return Number(m[1]);
    throw e;
  }
}

const sendV0 = async (payer, tx) => {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  // fail loudly, like send()
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`transaction ${sig} failed on chain: ${JSON.stringify(res.value.err)}`);
  return sig;
};

// ---------- scenarios ----------
async function main() {
  if (!PROGRAM_ID.toBase58() || PROGRAM_ID.toBase58() === "11111111111111111111111111111111")
    throw new Error("usage: driver.mjs <program id base58>  (BNZ_SOLANA_RPC to override the RPC)");

  // local dev keys, generated fresh for this run (never persisted)
  const seller = Keypair.generate();
  const crank = Keypair.generate();
  const duster = Keypair.generate(); // unrelated key for the §10 F-1/F-3 dusting scenarios
  const returnTo = Keypair.generate();
  for (const kp of [seller, crank, duster]) {
    const sig = await conn.requestAirdrop(kp.publicKey, 20 * LAMPORTS_PER_SOL);
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
  // The auction window must outlive the test sequence that runs before the refund section
  // (~40 s of chain time): with the earlier deadline = t0 + 40, `submit(11)` — whose expiry is
  // exactly `deadline`, per the F-2 rule the tests exercise — sat on the clock boundary and
  // landed `Expired` in some runs (web3.js swallowed the landed error; `send` now throws on one).
  const lockUntil = t0 + 5, deadline = t0 + 120;
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
    const ok = info && info.owner.equals(PROGRAM_ID) && d.length === 236 && d[0] === 1 && d[235] === 2 && d[2] === 0 &&
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

  {
    // ---- R8 item 1 (G9): a dusted escrow state PDA must not block the auction ----
    // 1,000,000 lamports from an unrelated key to the predictable ["escrow", auction_id] PDA
    // before lock (reviewer G's live griefing probe); the auction must still lock and record
    // state, and only a real program-owned STATE_LEN state may read as "already locked".
    const dustId = randomBytes(32), dustPda = auctionPdaFor(dustId), dustAmount = 1n * LOT;
    await send(duster, SystemProgram.transfer({ fromPubkey: duster.publicKey, toPubkey: dustPda, lamports: 1_000_000 }));
    const params = { auctionId: dustId, genesis, amount: dustAmount, lot: LOT, lockUntil: t0 + 3600, deadline: t0 + 7200, signers, returnTo: returnTo.publicKey.toBytes() };
    let lockErr = null;
    try { await send(seller, lockIx(seller, dustPda, params)); } catch (e) { lockErr = e; }
    const info = await conn.getAccountInfo(dustPda);
    const d = info?.data;
    const ok = info && info.owner.equals(PROGRAM_ID) && d.length === 236 && d[0] === 1 && d[235] === 2 &&
      eq(d.slice(3, 35), dustId) && eq(d.slice(35, 67), genesis) && d.readBigUInt64LE(195) === dustAmount;
    check("escrow-pda-dusted-lock-succeeds",
      lockErr === null && ok,
      `lock after 1,000,000-lamport dust ${lockErr ? `refused (0x${(customErrorCode(lockErr) ?? -1).toString(16)})` : "landed"}; ` +
        `state PDA owner ${info?.owner.toBase58()} len ${d?.length} (want program-owned 236 with layout version 2)`);
    await expectCustomError("escrow-pda-dusted-lock-twice-refused", 3, () =>
      send(seller, lockIx(seller, dustPda, params)));
  }

  {
    // ---- R9 item 1: the state records its layout version and every instruction checks it ----
    // A program that changes the account layout ships under a new program ID (never an in-place
    // upgrade over live auctions). As the on-chain second line of defence, the state records
    // LAYOUT_VERSION and every instruction refuses any other version before interpreting bytes.
    // The probe account is a pre-R9 (layout v1) state loaded at genesis (run.sh --account, written
    // by test/old-layout-account.mjs) — the only way to hand the program an account layout it did
    // not write.
    const info = await conn.getAccountInfo(auctionPda);
    const d = info?.data;
    check("layout-version-recorded-in-state",
      Boolean(info && d.length === 236 && d[235] === 2),
      `state len ${d?.length} layout byte ${d?.[235]} (want program-owned 236 with layout version 2)`);

    const oldAuctionId = createHash("sha256").update("benzo-escrow-layout-v1-probe").digest();
    const oldPda = auctionPdaFor(oldAuctionId);
    await expectCustomError("layout-v1-state-lock-refused", 20, () =>
      send(seller, lockIx(seller, oldPda, {
        auctionId: oldAuctionId, genesis, amount: LOT, lot: LOT, lockUntil: t0 + 3600, deadline: t0 + 7200,
        signers, returnTo: returnTo.publicKey.toBytes(),
      })));
    const oldAtt = attestation(genesis, programIdBytes, oldAuctionId, randomBytes(32), randomBytes(32), 0, 0, deadline);
    await expectCustomError("layout-v1-state-submit-refused", 20, () =>
      send(crank, ed25519Ix([sign(0, oldAtt), sign(2, oldAtt)], [signers[0], signers[2]], MSG_REF),
        submitIx(crank, oldPda, approvalPdaFor(oldAuctionId, 0), oldAtt)));
    await expectCustomError("layout-v1-state-release-refused", 20, () =>
      send(crank, releaseApprovedIx(crank, oldPda, approvalPdaFor(oldAuctionId, 0), [{
        index: 0, lotCount: 1, dest: dest(r1), destAi: r1.publicKey, destWritable: true,
        leafCount: 1, proof: [], paidPda: paidPdaFor(oldAuctionId, new Uint8Array(32)),
      }])));
    await expectCustomError("layout-v1-state-refund-refused", 20, () =>
      send(crank, refundIx(crank, oldPda, returnTo.publicKey, oldAuctionId)));
  }

  // ---- 2. submit_attestation + release_approved (design §9) ----
  const mkPayout = (kp, index, lotCount, leaves, proofs, writable = true) => ({
    index, lotCount, dest: dest(kp), destAi: kp.publicKey, destWritable: writable,
    leafCount: leaves.length, proof: proofs[index],
    paidPda: paidPdaFor(auctionId, leaves[index]),
    leaf: leaves[index],
  });
  const bal = async (kp) => await conn.getBalance(kp.publicKey);
  const submit = async (batch, att, sigIdx, pkIdx) =>
    send(crank, ed25519Ix(sigIdx.map((i) => sign(i, att)), pkIdx.map((i) => signers[i]), MSG_REF),
      submitIx(crank, auctionPda, approvalPdaFor(auctionId, batch), att));

  // batch 0 tree: [r1 lot1, r2 lot1]
  const leafA = leafHash(auctionId, 0, ASSET_SOL, 1, 2, dest(r1));
  const leafB = leafHash(auctionId, 1, ASSET_SOL, 1, 2, dest(r2));
  const tree0 = buildTree([leafA, leafB]);
  const root0 = rootHash(2, tree0.treeRoot);

  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root0, 0, 0, deadline);
    await submit(0, att, [0, 2], [0, 2]); // alice + carol
    const ai = await conn.getAccountInfo(approvalPdaFor(auctionId, 0));
    const d = ai?.data;
    // §10 F-3 layout: APPROVAL_V1 marker (11 bytes) then the §9 fields
    const ok = ai && ai.owner.equals(PROGRAM_ID) && d.length === 164 &&
      eq(d.slice(0, 11), utf8("APPROVAL_V1")) &&
      eq(d.slice(11, 43), auctionId) && d.readBigUInt64LE(43) === 0n &&
      eq(d.slice(51, 83), root0) && eq(d.slice(83, 115), resultHash) &&
      d.readBigUInt64LE(115) === 0n && BigInt(d.readBigInt64LE(123)) === BigInt(deadline) &&
      eq(d.slice(131, 163), genesis);
    check("submit-2of3-records-approval", ok, "Approval PDA state differs from the attested fields");
  }

  {
    const b1 = await bal(r1), b2 = await bal(r2);
    await send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 0), [
      mkPayout(r1, 0, 1, [leafA, leafB], tree0.proofs),
      mkPayout(r2, 1, 1, [leafA, leafB], tree0.proofs),
    ]));
    const a1 = await bal(r1), a2 = await bal(r2);
    const f1 = await conn.getAccountInfo(paidPdaFor(auctionId, leafA));
    const f2 = await conn.getAccountInfo(paidPdaFor(auctionId, leafB));
    check("release-approved-pays",
      BigInt(a1 - b1) === LOT && BigInt(a2 - b2) === LOT && f1 !== null && f2 !== null,
      `balances r1 +${a1 - b1} r2 +${a2 - b2} (want ${LOT}), paid flags ${f1 !== null}/${f2 !== null}`);
  }

  // §9: submit twice -> refused (the Approval PDA is created exactly once per batch)
  await expectCustomError("submit-twice-refused", 9, async () => {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root0, 0, 0, deadline);
    await submit(0, att, [0, 2], [0, 2]);
  });

  // §9: release with no Approval -> refused
  await expectCustomError("release-no-approval-refused", 19, () =>
    send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 99), [
      mkPayout(r1, 0, 1, [leafA, leafB], tree0.proofs),
    ])));

  // ---- per-recipient paid flags: one failing recipient never reverts the call ----
  const leafC = leafHash(auctionId, 0, ASSET_SOL, 1, 2, dest(r3));
  const leafD = leafHash(auctionId, 1, ASSET_SOL, 1, 2, dest(r4));
  const tree1 = buildTree([leafC, leafD]);
  const root1 = rootHash(2, tree1.treeRoot);

  {
    // batch 1: r3's account is readonly (cannot receive) -> skipped; r4 is paid regardless
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 1, 0, deadline);
    await submit(1, att, [1, 2], [1, 2]);
    const b3 = await bal(r3), b4 = await bal(r4);
    await send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 1), [
      mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, false), // readonly = failing recipient
      mkPayout(r4, 1, 1, [leafC, leafD], tree1.proofs, true),
    ]));
    const a3 = await bal(r3), a4 = await bal(r4);
    check("recipient-flag-failure-skipped-not-reverted",
      a3 - b3 === 0 && BigInt(a4 - b4) === LOT,
      `r3 +${a3 - b3} (want 0: skipped), r4 +${a4 - b4} (want ${LOT}: paid despite sibling failure)`);
  }

  {
    // batch 2, same leaves/root, new batch index: the failed item is claimable, the paid one is not
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 2, 0, deadline);
    await submit(2, att, [0, 1], [0, 1]);
    const b3 = await bal(r3), b4 = await bal(r4);
    await send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 2), [
      mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs, true),
      mkPayout(r4, 1, 1, [leafC, leafD], tree1.proofs, true),
    ]));
    const a3 = await bal(r3), a4 = await bal(r4);
    check("recipient-flag-claimable-later-no-double-pay",
      BigInt(a3 - b3) === LOT && a4 - b4 === 0,
      `r3 +${a3 - b3} (want ${LOT}: claimable), r4 +${a4 - b4} (want 0: paid flag blocks double pay)`);
  }

  // ---- submit_attestation refusals (specific errors) ----
  {
    // one signature is not 2-of-3
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 3, 0, deadline);
    await expectCustomError("submit-1sig-refused", 11, () => submit(3, att, [0], [0]));
  }
  {
    // two signatures from outside the signer set
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 4, 0, deadline);
    const outPks = [randomBytes(32), randomBytes(32)];
    const sigs = [ed25519.sign(att, outPks[0]), ed25519.sign(att, outPks[1])];
    await expectCustomError("submit-outsider-signatures-refused", 12, () =>
      send(crank, ed25519Ix(sigs, [ed25519.getPublicKey(outPks[0]), ed25519.getPublicKey(outPks[1])], MSG_REF),
        submitIx(crank, auctionPda, approvalPdaFor(auctionId, 4), att)));
  }
  {
    // the same signer twice is one signature, not two
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 5, 0, deadline);
    await expectCustomError("submit-one-signer-twice-refused", 12, () => submit(5, att, [0, 0], [0, 0]));
  }
  {
    // cross-cluster binding: a correctly signed attestation for another genesis hash is refused
    const att = attestation(new Uint8Array(32), programIdBytes, auctionId, resultHash, root1, 6, 0, deadline);
    await expectCustomError("submit-wrong-genesis-refused", 18, () => submit(6, att, [0, 1], [0, 1]));
  }
  {
    // expired attestation is refused at submit (now <= expiry required)
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 7, 0, t0 - 10);
    await expectCustomError("submit-expired-refused", 8, () => submit(7, att, [0, 1], [0, 1]));
  }
  {
    // §10 item 2 (F-2): an attestation whose expiry outlives the auction's deadline is refused
    // at submit — otherwise the refund window (now > deadline) would overlap the release window
    // (now <= expiry) and a refund racing the release could capture attested payouts
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 12, 0, deadline + 1000);
    await expectCustomError("submit-expiry-after-deadline-refused", 5, () => submit(12, att, [0, 1], [0, 1]));
  }
  {
    // ---- §10 item 3 (F-3): a dusted Approval PDA must not block the batch ----
    const batch13 = 13;
    const dusted = approvalPdaFor(auctionId, batch13);
    await send(duster, SystemProgram.transfer({ fromPubkey: duster.publicKey, toPubkey: dusted, lamports: 1_000_000 }));
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, batch13, 0, deadline);
    let submitErr = null;
    try { await submit(batch13, att, [0, 1], [0, 1]); } catch (e) { submitErr = e; }
    const ai = await conn.getAccountInfo(dusted);
    const d = ai?.data;
    const ok = ai && ai.owner.equals(PROGRAM_ID) && d.length === 164 &&
      eq(d.slice(0, 11), utf8("APPROVAL_V1")) &&
      eq(d.slice(11, 43), auctionId) && d.readBigUInt64LE(43) === BigInt(batch13) &&
      eq(d.slice(51, 83), root1) && eq(d.slice(83, 115), resultHash) &&
      d.readBigUInt64LE(115) === 0n && BigInt(d.readBigInt64LE(123)) === BigInt(deadline) &&
      eq(d.slice(131, 163), genesis);
    check("approval-pda-dusted-submit-works-once",
      submitErr === null && ok,
      `submit ${submitErr ? `refused (0x${(customErrorCode(submitErr) ?? -1).toString(16)})` : "landed"}; ` +
        `dusted Approval PDA owner ${ai?.owner.toBase58()} len ${d?.length} ` +
        `(want program-owned 164 with the APPROVAL_V1 marker)`);
    await expectCustomError("approval-pda-dusted-second-submit-refused", 9, () =>
      submit(batch13, att, [0, 1], [0, 1]));
  }
  {
    // §9: a spoofed sysvar on submit_attestation -> refused (the 2022 Wormhole class)
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 8, 0, deadline);
    const fakeSysvar = Keypair.generate().publicKey;
    const ix = submitIx(crank, auctionPda, approvalPdaFor(auctionId, 8), att);
    ix.keys[2] = { pubkey: fakeSysvar, isSigner: false, isWritable: false }; // spoofed sysvar account
    await expectCustomError("spoofed-sysvar-on-submit-refused", 10, () =>
      send(crank, ed25519Ix([sign(0, att), sign(1, att)], [signers[0], signers[1]], MSG_REF), ix));
  }

  // ---- release_approved leaf checks (against the approved root) ----
  {
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 9, 0, deadline);
    await submit(9, att, [0, 1], [0, 1]);
  }
  {
    const bad = { ...mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs), index: 2, leafCount: 2 };
    await expectCustomError("release-leaf-index-bound-refused", 14, () =>
      send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 9), [bad])));
  }
  {
    // §9: a leaf not in the root -> refused
    const bad = { ...mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs), proof: [leafB] }; // wrong sibling
    await expectCustomError("release-leaf-not-in-root-refused", 15, () =>
      send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 9), [bad])));
  }

  // ---- §9: an expired approval -> refused ----
  {
    const shortExpiry = (await chainTime()) + 3;
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 10, 0, shortExpiry);
    await submit(10, att, [0, 1], [0, 1]);
    await waitUntilChainTime(shortExpiry, "approval expiry");
    await expectCustomError("approval-expired-release-refused", 8, () =>
      send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 10), [
        mkPayout(r3, 0, 1, [leafC, leafD], tree1.proofs),
      ])));
  }

  // ---- §9: every leaf paid exactly once across several crank calls (v0 tx + lookup table) ----
  {
    const auction2Id = randomBytes(32);
    const auction2Pda = auctionPdaFor(auction2Id);
    const dests = Array.from({ length: 8 }, () => Keypair.generate());
    const leaves = dests.map((kp, i) => leafHash(auction2Id, i, ASSET_SOL, 1, 2, dest(kp)));
    const tree = buildTree(leaves);
    const root = rootHash(8, tree.treeRoot);
    const t2 = await chainTime();
    await send(seller, lockIx(seller, auction2Pda, {
      auctionId: auction2Id, genesis, amount: 8n * LOT, lot: LOT,
      lockUntil: t2 + 600, deadline: t2 + 1200,
      signers, returnTo: returnTo.publicKey.toBytes(),
    }));
    const att = attestation(genesis, programIdBytes, auction2Id, resultHash, root, 0, 0, t2 + 600);
    await send(crank,
      ed25519Ix([sign(0, att), sign(1, att)], [signers[0], signers[1]], MSG_REF),
      submitIx(crank, auction2Pda, approvalPdaFor(auction2Id, 0), att));

    const payoutAt = (i, writable = true) => ({
      index: i, lotCount: 1, dest: dest(dests[i]), destAi: dests[i].publicKey, destWritable: writable,
      leafCount: 8, proof: tree.proofs[i], paidPda: paidPdaFor(auction2Id, leaves[i]), leaf: leaves[i],
    });
    // lookup-table order is payout order (dest_i, paid_i): the compiled lookup indexes must
    // come out ascending, which they do when the table follows usage order
    const table = await createLookupTable(crank,
      dests.flatMap((d, i) => [d.publicKey, paidPdaFor(auction2Id, leaves[i])]));
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    // chunk 8 payouts into several crank calls (3+3+2), each its own v0 transaction
    const chunks = [[0, 1, 2], [3, 4, 5], [6, 7]];
    for (const chunk of chunks) {
      const tx = buildReleaseV0(crank, auction2Pda, approvalPdaFor(auction2Id, 0), chunk.map((i) => payoutAt(i)), table, blockhash);
      if (txSize(tx) > PACKET_LIMIT) {
        fail("every-leaf-paid-exactly-once", `release chunk tx ${txSize(tx)} bytes exceeds ${PACKET_LIMIT}`);
      }
      await sendV0(crank, tx);
    }
    // two further crank calls re-present every leaf: all skipped, nothing paid twice
    for (let round = 0; round < 2; round++) {
      // 8 payouts cannot fit one tx: split by the measured limit and send each
      // (fresh blockhash per round: identical bytes would be refused as already processed)
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const fits = [];
      let cur = [];
      for (const p of dests.map((_, i) => payoutAt(i))) {
        const trial = buildReleaseV0(crank, auction2Pda, approvalPdaFor(auction2Id, 0), [...cur, p], table, blockhash);
        if (txSize(trial) <= PACKET_LIMIT) cur.push(p);
        else { fits.push(cur); cur = [p]; }
      }
      if (cur.length) fits.push(cur);
      for (const f of fits) {
        const t = buildReleaseV0(crank, auction2Pda, approvalPdaFor(auction2Id, 0), f, table, blockhash);
        await sendV0(crank, t);
      }
    }
    const got = await Promise.all(dests.map((kp) => bal(kp)));
    const exactlyOnce = got.every((g) => BigInt(g) === LOT);
    const info = await conn.getAccountInfo(auction2Pda);
    const paidTotal = info.data.readBigUInt64LE(211);
    check("every-leaf-paid-exactly-once",
      exactlyOnce && paidTotal === 8n * LOT,
      `balances [${got.join(",")}] (want each ${LOT}), escrow paid ${paidTotal} (want ${8n * LOT})`);
  }

  // ---- 4. refund after deadline + §9 release after refund ----
  await expectCustomError("refund-before-deadline-refused", 16, () =>
    send(crank, refundIx(crank, auctionPda, returnTo.publicKey, auctionId)));

  {
    // approval submitted before the refund, released after it -> refused
    const att = attestation(genesis, programIdBytes, auctionId, resultHash, root1, 11, 0, deadline);
    await submit(11, att, [0, 1], [0, 1]);
    await waitUntilChainTime(deadline, "deadline");
    const b = await bal(returnTo);
    await send(crank, refundIx(crank, auctionPda, returnTo.publicKey, auctionId));
    const a = await bal(returnTo);
    // paid 4 lots of 5 locked -> remainder 1 lot returns to the pinned address
    check("refund-after-deadline-returns-remainder", BigInt(a - b) === LOT,
      `return address +${a - b}, want remainder ${LOT} (5 lots locked, 4 paid)`);

    const info = await conn.getAccountInfo(auctionPda);
    check("refund-sets-closed-flag", info.data[2] === 1, `refunded flag is ${info.data[2]}, want 1`);

    await expectCustomError("release-after-refund-refused", 7, () =>
      send(crank, releaseApprovedIx(crank, auctionPda, approvalPdaFor(auctionId, 11), [
        mkPayout(r4, 1, 1, [leafC, leafD], tree1.proofs),
      ])));
    await expectCustomError("refund-twice-refused", 17, () =>
      send(crank, refundIx(crank, auctionPda, returnTo.publicKey, auctionId)));
  }

  {
    // ---- §10 item 2 (F-2): an approved but unreleased batch cannot be refunded until its
    // expiry has passed. Refund requires now > deadline and every approval's expiry is ≤
    // deadline, so the windows are disjoint by construction — asserted from the chain state ----
    const auction4Id = randomBytes(32);
    const auction4Pda = auctionPdaFor(auction4Id);
    const r5 = Keypair.generate();
    const t4 = await chainTime();
    const d4 = t4 + 15;
    await send(seller, lockIx(seller, auction4Pda, {
      auctionId: auction4Id, genesis, amount: 1n * LOT, lot: LOT,
      lockUntil: t4 + 5, deadline: d4,
      signers, returnTo: returnTo.publicKey.toBytes(),
    }));
    const f2Leaf = leafHash(auction4Id, 0, ASSET_SOL, 1, 2, dest(r5));
    const f2Tree = buildTree([f2Leaf]);
    const f2Root = rootHash(1, f2Tree.treeRoot);
    const f2Att = attestation(genesis, programIdBytes, auction4Id, resultHash, f2Root, 0, 0, d4); // expiry == deadline
    await send(crank,
      ed25519Ix([sign(0, f2Att), sign(1, f2Att)], [signers[0], signers[1]], MSG_REF),
      submitIx(crank, auction4Pda, approvalPdaFor(auction4Id, 0), f2Att));
    const aai = await conn.getAccountInfo(approvalPdaFor(auction4Id, 0));
    const sai = await conn.getAccountInfo(auction4Pda);
    const aexp = aai.data.readBigInt64LE(123), dl = sai.data.readBigInt64LE(227);
    check("approval-expiry-not-after-deadline", BigInt(aexp) <= BigInt(dl),
      `approval expiry ${aexp} must be <= the auction deadline ${dl}`);
    await expectCustomError("approved-unreleased-refund-premature-refused", 16, () =>
      send(crank, refundIx(crank, auction4Pda, returnTo.publicKey, auction4Id)));
    await waitUntilChainTime(d4, "F-2 deadline");
    await expectCustomError("approved-unreleased-release-expired-when-refund-opens", 8, () =>
      send(crank, releaseApprovedIx(crank, auction4Pda, approvalPdaFor(auction4Id, 0), [{
        index: 0, lotCount: 1, dest: dest(r5), destAi: r5.publicKey, destWritable: true,
        leafCount: 1, proof: f2Tree.proofs[0], paidPda: paidPdaFor(auction4Id, f2Leaf), leaf: f2Leaf,
      }])));
    const rb2 = await bal(returnTo);
    await send(crank, refundIx(crank, auction4Pda, returnTo.publicKey, auction4Id));
    const ra2 = await bal(returnTo);
    const now2 = await chainTime();
    check("refund-only-after-approval-expired", BigInt(ra2 - rb2) === LOT && now2 > aexp,
      `refund returned ${ra2 - rb2} (want the whole unpaid ${LOT}) at chain time ${now2}, approval expiry was ${aexp}`);
  }

  {
    // ---- §10 item 4 (F-4): the pre-§9 client wire format can never release ----
    // `crosschain/solana.ts` at 3a23f15 (the reviewed commit) serialized release as
    // TAG(2) ‖ att ‖ be16(n) ‖ payouts… with the be64-seeded ["batch", …] PDA. That routes to
    // submit_attestation, which requires the instruction to end right after the 200-byte
    // attestation, so the shipped client of that commit could never release anything (reviewer
    // probe D). Locked out permanently here; the shipped client speaks submit_attestation +
    // release_approved with the le64 batch seed (crosschain/solana.ts:38-40).
    const legacyAtt = attestation(genesis, programIdBytes, auctionId, resultHash, root0, 0, 0, deadline);
    const legacyBatchPda = pda([Buffer.from("batch"), Buffer.from(auctionId), Buffer.from(be64(0))]); // the old be64 seed
    await expectCustomError("legacy-client-release-refused", 1, () =>
      send(crank,
        ed25519Ix([sign(0, legacyAtt), sign(1, legacyAtt)], [signers[0], signers[1]], MSG_REF),
        legacyReleaseIx(crank, auctionPda, legacyBatchPda, legacyAtt, [
          mkPayout(r1, 0, 1, [leafA, leafB], tree0.proofs),
        ])));
  }

  {
    // ---- §10 item 1 (F-1): a dusted paid PDA must not read as "already paid" ----
    // dust paidPda(leafA) from an unrelated key, then crank: rA must still be paid
    // exactly once (the flag counts only if program-owned with the PAID_V1 marker), and the refund
    // must return only the unpaid remainder — never rA's or rB's paid lot
    const auction3Id = randomBytes(32);
    const auction3Pda = auctionPdaFor(auction3Id);
    const rA = Keypair.generate(), rB = Keypair.generate();
    const fLeaves = [
      leafHash(auction3Id, 0, ASSET_SOL, 1, 2, dest(rA)),
      leafHash(auction3Id, 1, ASSET_SOL, 1, 2, dest(rB)),
    ];
    const ftree = buildTree(fLeaves);
    const froot = rootHash(2, ftree.treeRoot);
    const t3 = await chainTime();
    const fDeadline = t3 + 30;
    await send(seller, lockIx(seller, auction3Pda, {
      auctionId: auction3Id, genesis, amount: 3n * LOT, lot: LOT,
      lockUntil: t3 + 5, deadline: fDeadline,
      signers, returnTo: returnTo.publicKey.toBytes(),
    }));
    const fAtt = attestation(genesis, programIdBytes, auction3Id, resultHash, froot, 0, 0, fDeadline);
    await send(crank,
      ed25519Ix([sign(0, fAtt), sign(1, fAtt)], [signers[0], signers[1]], MSG_REF),
      submitIx(crank, auction3Pda, approvalPdaFor(auction3Id, 0), fAtt));

    // dust the paid PDA of leaf A from an unrelated key (the runtime refuses any dust below the
    // 0-byte rent-exempt minimum of 890,880 lamports, so a real dust is at least that; 900,000 is
    // also below the 7-byte flag's rent need, exercising the top-up-then-allocate path)
    const dusted = paidPdaFor(auction3Id, fLeaves[0]);
    await send(duster, SystemProgram.transfer({ fromPubkey: duster.publicKey, toPubkey: dusted, lamports: 900_000 }));

    const fp = (i, kp) => ({
      index: i, lotCount: 1, dest: dest(kp), destAi: kp.publicKey, destWritable: true,
      leafCount: 2, proof: ftree.proofs[i], paidPda: paidPdaFor(auction3Id, fLeaves[i]), leaf: fLeaves[i],
    });
    const bA = await bal(rA), bB = await bal(rB);
    await send(crank, releaseApprovedIx(crank, auction3Pda, approvalPdaFor(auction3Id, 0), [fp(0, rA), fp(1, rB)]));
    const aA = await bal(rA), aB = await bal(rB);
    const flagA = await conn.getAccountInfo(dusted);
    check("paid-pda-dusted-payout-still-made-once",
      BigInt(aA - bA) === LOT && BigInt(aB - bB) === LOT &&
        flagA !== null && flagA.owner.equals(PROGRAM_ID) && eq(new Uint8Array(flagA.data), utf8("PAID_V1")),
      `rA +${aA - bA} (want ${LOT} despite the dust), rB +${aB - bB} (want ${LOT}), ` +
        `flag owner ${flagA?.owner.toBase58()} data ${hex(new Uint8Array(flagA?.data ?? []))} (want program-owned PAID_V1)`);

    // exactly once: re-presenting both leaves pays nothing again
    await send(crank, releaseApprovedIx(crank, auction3Pda, approvalPdaFor(auction3Id, 0), [fp(0, rA), fp(1, rB)]));
    const zA = await bal(rA), zB = await bal(rB);
    check("paid-pda-dusted-paid-exactly-once",
      BigInt(zA - aA) === 0n && BigInt(zB - aB) === 0n,
      `re-crank paid again: rA +${zA - aA}, rB +${zB - aB} (want 0 each)`);

    // the refund returns only the 1 unpaid lot (3 locked, 2 paid) — the attested lots stay paid
    await waitUntilChainTime(fDeadline, "F-1 refund deadline");
    const rb = await bal(returnTo);
    await send(crank, refundIx(crank, auction3Pda, returnTo.publicKey, auction3Id));
    const ra = await bal(returnTo);
    check("paid-pda-dusted-refund-omits-paid-lot", BigInt(ra - rb) === LOT,
      `refund returned ${ra - rb}, want the 1 unpaid lot (the two attested lots must not return to the locker)`);
  }

  // ---- §9: before/after payouts-per-transaction table at proof depths 0–6 ----
  // before = the removed signature-carrying release (ed25519 verify ix + attestation in the same
  // transaction); after = release_approved. Sizes are real serialized transactions against the
  // 1232-byte packet limit. after_legacy is a plain transaction; after_alt is a versioned
  // transaction with the destination + paid-flag accounts in an address lookup table.
  {
    const measureAt = (depth, mode) => {
      const fakeBh = PublicKey.default.toBase58();
      const nleaves = 2 ** depth;
      const aid = randomBytes(32);
      const mdests = Array.from({ length: nleaves }, () => Keypair.generate());
      const mleaves = mdests.map((kp, i) => leafHash(aid, i, ASSET_SOL, 1, 2, dest(kp)));
      const mtree = buildTree(mleaves);
      const mroot = rootHash(nleaves, mtree.treeRoot);
      const matt = attestation(genesis, programIdBytes, aid, resultHash, mroot, 0, 0, deadline);
      const mpayouts = mdests.map((kp, i) => ({
        index: i, lotCount: 1, dest: dest(kp), destAi: kp.publicKey, destWritable: true,
        leafCount: nleaves, proof: mtree.proofs[i], paidPda: paidPdaFor(aid, mleaves[i]),
      }));
      let max = 0;
      for (let p = 1; p <= mpayouts.length; p++) {
        const sel = mpayouts.slice(0, p);
        let size = 0;
        try {
        if (mode === "before") {
          const tx = new Transaction();
          const fakeCrank = crank;
          tx.add(ed25519Ix([new Uint8Array(64), new Uint8Array(64)], [signers[0], signers[1]], MSG_REF),
            legacyReleaseIx(fakeCrank, auctionPda, auctionPda, matt, sel));
          tx.recentBlockhash = fakeBh;
          tx.feePayer = crank.publicKey;
          tx.sign(crank);
          size = txSize(tx);
        } else {
          const table = new AddressLookupTableAccount({
            key: PublicKey.findProgramAddressSync([randomBytes(32)], PROGRAM_ID)[0],
            state: {
              deactivationSlot: BigInt("18446744073709551615"),
              lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
              addresses: [...mdests.map((d) => d.publicKey), ...mleaves.map((l) => paidPdaFor(aid, l))],
            },
          });
          const ix = releaseApprovedIx(crank, auctionPda, auctionPda, sel);
          if (mode === "after_alt") {
            const msg = MessageV0.compile({
              payerKey: crank.publicKey, instructions: [ix], recentBlockhash: fakeBh,
              addressLookupTableAccounts: [table],
            });
            const tx = new VersionedTransaction(msg);
            tx.sign([crank]);
            size = txSize(tx);
          } else {
            const tx = new Transaction().add(ix);
            tx.recentBlockhash = fakeBh;
            tx.feePayer = crank.publicKey;
            tx.sign(crank);
            size = txSize(tx);
          }
        }
        } catch {
          size = 10_000_000; // serializer refused: the transaction cannot be sent at this size
        }
        if (size <= PACKET_LIMIT) max = p;
        else break;
      }
      return max;
    };
    let tableLines = [];
    for (let depth = 0; depth <= 6; depth++) {
      const before = measureAt(depth, "before");
      const afterLegacy = measureAt(depth, "after_legacy");
      const afterAlt = measureAt(depth, "after_alt");
      tableLines.push(`SIZE depth=${depth} before=${before} after_legacy=${afterLegacy} after_alt=${afterAlt}`);
    }
    console.log(tableLines.join("\n"));
    check("size-table-measured", tableLines.length === 7, "size table incomplete");
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
