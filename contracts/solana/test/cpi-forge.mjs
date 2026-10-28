#!/usr/bin/env node
// CPI-forgery regression fixture. source: a lab proof of concept
// `benzo-sol/lab/pr-b-r9/lab-only/cpi-forge.mjs` + `proxy/`, adapted so the forged CPI submit is
// the regression: it must be REFUSED (the PoC asserted it landed). The proxy program
// (test/proxy, a 20-line attacker program) invokes `submit_attestation` via CPI with one
// attestation while its own top-level instruction data carries the signers' signed bytes at
// offset 2 — exactly the indirection that fooled the pre-fix program's Ed25519 message check.
//
// Four questions (test-audit rule):
// 1. Behavior protected: `submit_attestation` accepts only its own top-level attestation bytes —
//    no CPI (get_stack_height == TRANSACTION_LEVEL_STACK_HEIGHT) and the instruction at
//    `current` must be this program's own with data[2..2+ATT_LEN] == the parsed att (
//    design §9).
// 2. Credible regression: a CPI caller presents the signers' signatures over one honest message
//    and passes a forged attestation (attacker-chosen allocation root) — the approval is written,
//    release_approved drains the escrow (R's live PoC drained 5 SOL at 4d9c0e6).
// 3. Why no existing test catches it: nothing else submits the attestation via CPI — every
//    driver test invokes the program directly (R's report: "no test anywhere submits the Solana
//    attestation via CPI").
// 4. No production seam: the fixture drives the real boundary — a second on-chain program, the
//    native Ed25519 precompile, and the shipped entry point on a real solana-test-validator.
//
// Run via `bash contracts/solana/test/run.sh` (builds both programs, boots the validator).
// Output: one `PASS <id>` or `ERROR <id> <reason>` line per assertion; exit 0 only if all PASS.
import { randomBytes } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3";

const RPC = process.env.BNZ_SOLANA_RPC ?? "http://127.0.0.1:8901";
const PROGRAM_ID = new PublicKey(process.argv[2] ?? "");
const PROXY_ID = new PublicKey(process.argv[3] ?? "");
const conn = new Connection(RPC, "confirmed");

const utf8 = (s) => new TextEncoder().encode(s);
const be64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const le64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const beI64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n)); return b; };
const be16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const keccak = (...parts) => keccak_256(cat(...parts));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const ASSET_SOL = new Uint8Array(32);
const leafHash = (auctionId, index, asset, lotCount, kind, dest) =>
  keccak(utf8("benzo-leaf-v1"), auctionId, be64(index), asset, be64(lotCount), Uint8Array.of(kind), dest);
const pair = (a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? keccak(a, b) : keccak(b, a));
const rootHash = (leafCount, treeRoot) => keccak(utf8("benzo-root-v1"), be64(leafCount), treeRoot);
const attestation = (genesis, programId, auctionId, resultHash, allocRoot, batch, nonce, expiry) =>
  cat(utf8("benzo-release-v1"), genesis, programId, auctionId, resultHash, allocRoot, be64(batch), be64(nonce), beI64(expiry));

const TAG = (tag) => Uint8Array.of(1, tag);
const MSG_REF = { ixIndex: 1, offset: 2, size: 200 };
const IX_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");
const ED25519 = new PublicKey("Ed25519SigVerify111111111111111111111111111");
// The two new refusals (custom codes asserted by number, as in test/driver.mjs)
const ERR_VIA_CPI = 21; // ViaCpi: submit_attestation reached through a CPI
const ERR_MESSAGE_NOT_SELF = 22; // MessageNotSelf: ix[current] is not this program's own attestation

function ed25519Ix(signatures, pubkeys, msgRef) {
  const n = signatures.length;
  const header = 2 + 14 * n;
  const sigStart = header, pkStart = sigStart + 64 * n;
  const head = new Uint8Array(header);
  head[0] = n;
  const dv = new DataView(head.buffer);
  for (let i = 0; i < n; i++) {
    const o = 2 + 14 * i;
    dv.setUint16(o, sigStart + 64 * i, true); dv.setUint16(o + 2, 0xffff, true);
    dv.setUint16(o + 4, pkStart + 32 * i, true); dv.setUint16(o + 6, 0xffff, true);
    dv.setUint16(o + 8, msgRef.offset, true); dv.setUint16(o + 10, msgRef.size, true);
    dv.setUint16(o + 12, msgRef.ixIndex, true);
  }
  return new TransactionInstruction({ programId: ED25519, keys: [], data: Buffer.from(cat(head, ...signatures, ...pubkeys)) });
}

const lockIx = (seller, auctionPda, { auctionId, genesis, amount, lot, lockUntil, deadline, signers, returnTo }) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(cat(TAG(1), auctionId, genesis, be64(amount), be64(lot), beI64(lockUntil), beI64(deadline),
      signers[0], signers[1], signers[2], returnTo)),
  });

const submitIx = (crank, auctionPda, approvalPda, att) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: crank.publicKey, isSigner: true, isWritable: true },
      { pubkey: auctionPda, isSigner: false, isWritable: false },
      { pubkey: IX_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: approvalPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(cat(TAG(2), att)),
  });

const releaseApprovedIx = (crank, auctionPda, approvalPda, payouts) => {
  const parts = [cat(TAG(4), be16(payouts.length))];
  for (const p of payouts) parts.push(be64(p.index), be64(p.lotCount), Uint8Array.of(2), p.dest, be64(p.leafCount), be16(p.proof.length), ...p.proof);
  const keys = [
    { pubkey: crank.publicKey, isSigner: true, isWritable: true },
    { pubkey: auctionPda, isSigner: false, isWritable: true },
    { pubkey: approvalPda, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  for (const p of payouts) {
    keys.push({ pubkey: p.destAi, isSigner: false, isWritable: true });
    keys.push({ pubkey: p.paidPda, isSigner: false, isWritable: true });
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(cat(...parts)) });
};

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const auctionPdaFor = (auctionId) => pda([Buffer.from("escrow"), Buffer.from(auctionId)]);
const approvalPdaFor = (auctionId, batch) => pda([Buffer.from("approval"), Buffer.from(auctionId), Buffer.from(le64(batch))]);
const paidPdaFor = (auctionId, leaf) => pda([Buffer.from("paid"), Buffer.from(auctionId), Buffer.from(leaf)]);

const send = async (payer, ...ixs) => {
  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash; tx.feePayer = payer.publicKey; tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) { const e = new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`); e.logs = (await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 }))?.meta?.logMessages ?? []; throw e; }
  return sig;
};

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id) : fail(id, reason));
function customErrorCode(e) {
  const text = `${e?.message ?? ""}\n${(e?.logs ?? []).join("\n")}`;
  const m = text.match(/custom program error: 0x([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) : null;
}

async function main() {
  const seller = Keypair.generate(), returnTo = Keypair.generate();
  const attacker = Keypair.generate();
  const signerKs = [0, 1, 2].map(() => ed25519.utils.randomSecretKey());
  const signers = signerKs.map((k) => ed25519.getPublicKey(k));
  const sign = (i, att) => ed25519.sign(att, signerKs[i]);

  for (const k of [seller, returnTo, attacker]) {
    const sig = await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  }

  const slot = await conn.getSlot();
  const t0 = await conn.getBlockTime(slot);
  const auctionId = keccak(randomBytes(32));
  const genesis = new PublicKey(await conn.getGenesisHash()).toBytes();
  const programIdBytes = PROGRAM_ID.toBytes();
  const auctionPda = auctionPdaFor(auctionId);
  const LOT = BigInt(LAMPORTS_PER_SOL);
  const amount = 5n * LOT;

  await send(seller, lockIx(seller, auctionPda, {
    auctionId, genesis, amount, lot: LOT, lockUntil: t0 + 600, deadline: t0 + 3600,
    signers, returnTo: returnTo.publicKey.toBytes(),
  }));
  pass("cpi-lock-ok");

  // ---- the honest signers' message: batch 7, the correct 2-leaf allocation ----
  const dest1 = Keypair.generate(), dest2 = Keypair.generate();
  const legitLeaves = [
    leafHash(auctionId, 0, ASSET_SOL, 2n, 2, dest1.publicKey.toBytes()),
    leafHash(auctionId, 1, ASSET_SOL, 3n, 2, dest2.publicKey.toBytes()),
  ];
  const R_legit = rootHash(2n, pair(legitLeaves[0], legitLeaves[1]));
  const A_signed = attestation(genesis, programIdBytes, auctionId, keccak(utf8("result")), R_legit, 7, 0, t0 + 3600);
  const sigs = [sign(0, A_signed), sign(1, A_signed)];
  const pks = [signers[0], signers[1]];

  // ---- the forged attestation the program must never accept under those signatures ----
  const forgedLeaf = leafHash(auctionId, 0, ASSET_SOL, 5n, 2, attacker.publicKey.toBytes());
  const R_forge = rootHash(1n, forgedLeaf);
  const A_forged = attestation(genesis, programIdBytes, auctionId, keccak(utf8("result")), R_forge, 0, 0, t0 + 3600);
  check("cpi-distinct-messages", !eq(A_signed, A_forged), "A_signed and A_forged must differ");

  // ---- control: the same sigs used the normal way (top-level submit of A_forged) ----
  // the precompile verifies over ix1.data[2..202] = A_forged, but the sigs are over A_signed
  // -> the transaction must fail at Ed25519 verification, at instruction 0, before the program
  {
    let err = null;
    try {
      await send(attacker,
        ed25519Ix(sigs, pks, MSG_REF),
        submitIx(attacker, auctionPda, approvalPdaFor(auctionId, 0), A_forged));
    } catch (e) { err = e; }
    const text = `${err?.message ?? ""}\n${(err?.logs ?? []).join("\n")}`;
    // the precompile refuses with its own error at instruction 0 (Ed25519 signature check),
    // never one of this program's custom codes — the program is never reached
    check("cpi-control-direct-forge-refused",
      err !== null && customErrorCode(err) === 2 && /(Error processing Instruction 0|\"InstructionError\":\[0)/.test(text),
      err ? `expected precompile error 0x2 at ix 0, got: ${text.slice(0, 120)}` : "direct submit unexpectedly succeeded");
  }

  // ---- the attack: ix1 is the PROXY program; its own data carries A_signed at offset 2,
  // and it CPIs submit_attestation with A_forged ----
  const proxyData = cat(new Uint8Array(2), A_signed, TAG(2), A_forged); // 2 + 200 + 2 + 200
  const proxyIx = new TransactionInstruction({
    programId: PROXY_ID,
    keys: [
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },   // [0] target program
      { pubkey: attacker.publicKey, isSigner: true, isWritable: true }, // [1] crank
      { pubkey: auctionPda, isSigner: false, isWritable: true },   // [2] auction
      { pubkey: IX_SYSVAR, isSigner: false, isWritable: false },    // [3] instructions sysvar
      { pubkey: approvalPdaFor(auctionId, 0), isSigner: false, isWritable: true }, // [4] approval
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },     // [5] system
    ],
    data: Buffer.from(proxyData),
  });
  {
    let err = null;
    try {
      await send(attacker, ed25519Ix(sigs, pks, MSG_REF), proxyIx);
    } catch (e) { err = e; }
    const got = customErrorCode(err);
    check("cpi-forged-submit-refused",
      err !== null && got === ERR_VIA_CPI,
      err === null
        ? "forged CPI submit LANDED (the CPI-forgery bypass is back)"
        : `expected custom error 0x${ERR_VIA_CPI.toString(16)} (ViaCpi), got ${got === null ? `no custom code (${`${err.message}`.slice(0, 90)})` : `0x${got.toString(16)}`}`);
    // and nothing may have been written for the forged batch
    const apInfo = await conn.getAccountInfo(approvalPdaFor(auctionId, 0));
    check("cpi-forged-root-not-approved", apInfo === null,
      apInfo ? `approval PDA for the forged batch exists (owner ${apInfo.owner.toBase58()})` : "no approval");
  }

  // ---- the honest direct submit and release must still pass ----
  {
    let err = null;
    try {
      await send(attacker,
        ed25519Ix(sigs, pks, MSG_REF),
        submitIx(attacker, auctionPda, approvalPdaFor(auctionId, 7), A_signed));
    } catch (e) { err = e; }
    check("cpi-honest-submit-lands", err === null,
      err ? `honest direct submit refused: ${`${err.message}`.slice(0, 120)}` : "landed");
    const apInfo = await conn.getAccountInfo(approvalPdaFor(auctionId, 7));
    const gotRoot = apInfo ? new Uint8Array(apInfo.data.slice(51, 83)) : null;
    check("cpi-honest-root-approved", apInfo !== null && eq(gotRoot, R_legit),
      apInfo ? `approval root ${Buffer.from(gotRoot).toString("hex").slice(0, 16)} (want ${Buffer.from(R_legit).toString("hex").slice(0, 16)})` : "no approval for the signed batch 7");

    const d1Before = await conn.getBalance(dest1.publicKey), d2Before = await conn.getBalance(dest2.publicKey);
    const escrowBefore = await conn.getBalance(auctionPda);
    await send(attacker, releaseApprovedIx(attacker, auctionPda, approvalPdaFor(auctionId, 7), [
      { index: 0, lotCount: 2, dest: dest1.publicKey.toBytes(), destAi: dest1.publicKey, leafCount: 2, proof: [legitLeaves[1]], paidPda: paidPdaFor(auctionId, legitLeaves[0]) },
      { index: 1, lotCount: 3, dest: dest2.publicKey.toBytes(), destAi: dest2.publicKey, leafCount: 2, proof: [legitLeaves[0]], paidPda: paidPdaFor(auctionId, legitLeaves[1]) },
    ]));
    const d1After = await conn.getBalance(dest1.publicKey), d2After = await conn.getBalance(dest2.publicKey);
    const escrowAfter = await conn.getBalance(auctionPda);
    check("cpi-honest-release-pays",
      d1After - d1Before === 2 * LAMPORTS_PER_SOL && d2After - d2Before === 3 * LAMPORTS_PER_SOL &&
      escrowBefore - escrowAfter === 5 * LAMPORTS_PER_SOL,
      `dest1 +${d1After - d1Before}, dest2 +${d2After - d2Before}, escrow -${escrowBefore - escrowAfter} lamports (want +2e9, +3e9, -5e9)`);
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
