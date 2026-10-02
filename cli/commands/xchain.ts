// benzo xchain lock|attest|release|refund|status — cross-chain escrow operations
// (docs/design/crosschain.md §6/§7 step 3). Drives the EVM BenzoEscrow (ethers) and the Solana
// BenzoEscrow program (@solana/web3.js) against local chains or testnets. Key files are read,
// never printed. Allocation/attestation JSON is the signer-side record; the escrows verify it.
import { readFileSync, writeFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey, Keypair } from "@solana/web3.js";
import { Wallet, getAddress } from "ethers";
import {
  AllocationLeaf, allocationRoot, buildTree, bytesToHex, destinationBytes, hexToBytes, leafHash,
} from "../../crosschain/leaf";
import { AttestationFields, evmTypedData, solanaAttestationBytes } from "../../crosschain/attestation";
import {
  evmLock, evmProvider, evmRefund, evmRelease, evmStatus, EvmPayout,
} from "../../crosschain/evm";
import {
  auctionPda, batchPda, ed25519Instruction, lockInstruction, paidPda, refundInstruction,
  releaseInstruction, sendTx, solConnection, solStatus, SolPayout,
} from "../../crosschain/solana";

export const noun = "xchain";
export const help = [
  "benzo xchain lock   --chain evm|solana --auction HEX32 --amount WAD --lot WAD --lock-until TS --deadline TS --signers FILE --return ADDR --key FILE --rpc URL [--asset 0xADDR]",
  "benzo xchain attest --chain evm|solana --auction HEX32 --allocation FILE --result-hash HEX32 --batch N --nonce N --expiry TS --signer-key FILE [--signer-key FILE ...] --escrow ADDR --rpc URL --out FILE",
  "benzo xchain release --chain evm|solana --bundle FILE --key FILE --rpc URL [--only 0,2]",
  "benzo xchain refund --chain evm|solana --auction HEX32 --key FILE --rpc URL --escrow ADDR",
  "benzo xchain status --chain evm|solana --auction HEX32 --rpc URL --escrow ADDR [--bundle FILE]",
].join("\n");

type Args = Record<string, string | boolean | string[]>;
function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`usage: ${help}`);
    const key = k.slice(2);
    const v = argv[i + 1]?.startsWith("--") ? "true" : (argv[++i] ?? "true");
    // repeatable flags (e.g. --signer-key) collect into arrays
    if (key in a) a[key] = Array.isArray(a[key]) ? [...(a[key] as string[]), v] : [a[key] as string, v];
    else a[key] = v;
  }
  return a;
}
const need = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string" || !v) throw new Error(`missing --${k}`);
  return v;
};
const num = (a: Args, k: string): number => Number(need(a, k));

const b58ToBytes = (s: string): Uint8Array => new PublicKey(s).toBytes();

// --signers FILE: the three per-auction signer identities (evm: 0x addresses; solana: base58)
function readSigners(chain: string, file: string): string[] {
  const list = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(list) || list.length !== 3) throw new Error("--signers file must hold 3 keys");
  return chain === "evm"
    ? list.map((s) => getAddress(s))
    : list.map((s) => (s.startsWith("0x") ? new PublicKey(hexToBytes(s)).toBase58() : new PublicKey(s).toBase58()));
}

// signer keys for attest: hex 32-byte secrets (secp256k1 on evm, ed25519 on solana)
function evmSigner(secretHex: string): Wallet {
  return new Wallet(secretHex.startsWith("0x") ? secretHex : "0x" + secretHex);
}

interface Bundle {
  version: 1; chain: string; escrow: string;
  auction_id: string; result_hash: string; allocation_root: string;
  batch_index: number; nonce: number; expiry: number;
  standard_lot: string;
  leaves: AllocationLeaf[];
  payouts: { index: number; lot_count: number; destination_kind: number; destination: string; leaf_count: number; proof: string[] }[];
  signers: string[]; signatures: string[];
}

export async function run(argv: string[]): Promise<number> {
  const verb = argv[0];
  try {
    const a = parseArgs(argv.slice(1));
    const chain = need(a, "chain");
    if (chain !== "evm" && chain !== "solana") throw new Error("--chain must be evm or solana");

    if (verb === "lock") {
      const rpc = need(a, "rpc"), keyFile = need(a, "key"), escrow = need(a, "escrow");
      const auctionId = hexToBytes(need(a, "auction"));
      const amount = BigInt(need(a, "amount")), lot = BigInt(need(a, "lot"));
      const lockUntil = num(a, "lock-until"), deadline = num(a, "deadline");
      const signers = readSigners(chain, need(a, "signers"));
      const returnTo = need(a, "return");
      if (chain === "evm") {
        const keyHex = readFileSync(keyFile, "utf8").trim();
        const tx = await evmLock({
          rpc, keyHex, escrow, auctionId: bytesToHex(auctionId),
          asset: typeof a.asset === "string" ? a.asset : "0x0000000000000000000000000000000000000000",
          amount, lot, lockUntil, deadline, signers, returnTo,
        });
        console.log(JSON.stringify({ chain, auction_id: bytesToHex(auctionId), tx }));
        return 0;
      }
      const conn = solConnection(rpc);
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
      const programId = new PublicKey(escrow);
      const genesis = new PublicKey(await conn.getGenesisHash()).toBytes();
      const ix = lockInstruction({
        programId, seller: payer.publicKey, auctionPda: auctionPda(programId, auctionId),
        auctionId, genesis, amount, lot, lockUntil, deadline,
        signers: signers.map((s) => new PublicKey(s).toBytes()), returnTo: b58ToBytes(returnTo),
      });
      const tx = await sendTx(conn, payer, [ix]);
      console.log(JSON.stringify({ chain, auction_id: bytesToHex(auctionId), tx, escrow_pda: auctionPda(programId, auctionId).toBase58() }));
      return 0;
    }

    if (verb === "attest") {
      const chain2 = chain;
      const rpc = need(a, "rpc"), escrow = need(a, "escrow"), out = need(a, "out");
      const alloc = JSON.parse(readFileSync(need(a, "allocation"), "utf8"));
      const auctionId = hexToBytes(need(a, "auction"));
      const resultHash = hexToBytes(need(a, "result-hash"));
      const batchIndex = num(a, "batch"), nonce = num(a, "nonce"), expiry = num(a, "expiry");
      const standardLot = BigInt(alloc.standard_lot);
      const leaves: AllocationLeaf[] = alloc.leaves;
      const derived = leaves.map((l) =>
        leafHash(auctionId, { index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind, destination: destinationBytes(l.destination_kind, l.destination, b58ToBytes) }));
      const tree = buildTree(derived);
      const root = allocationRoot(tree, derived.length);

      const fields: AttestationFields = { auctionId, resultHash, allocationRoot: root, batchIndex, nonce, expiry };
      const keyFiles: string[] = Array.isArray(a["signer-key"]) ? a["signer-key"] as string[] : [need(a, "signer-key")];
      const signers: string[] = [], signatures: string[] = [];
      for (const f of keyFiles) {
        const secretHex = readFileSync(f, "utf8").trim();
        if (chain2 === "evm") {
          const w = evmSigner(secretHex);
          const td = evmTypedData(fields, (await evmProvider(rpc).getNetwork()).chainId, escrow);
          signers.push(w.address.toLowerCase());
          signatures.push(await w.signTypedData(td.domain, td.types, td.message));
        } else {
          const sk = hexToBytes(secretHex);
          const programId = new PublicKey(escrow);
          const genesis = new PublicKey(await solConnection(rpc).getGenesisHash()).toBytes();
          const msg = solanaAttestationBytes(fields, genesis, programId.toBytes());
          signers.push(new PublicKey(ed25519.getPublicKey(sk)).toBase58());
          signatures.push(bytesToHex(ed25519.sign(msg, sk)));
        }
      }
      const bundle: Bundle = {
        version: 1, chain: chain2, escrow,
        auction_id: bytesToHex(auctionId), result_hash: bytesToHex(resultHash), allocation_root: bytesToHex(root),
        batch_index: batchIndex, nonce, expiry,
        standard_lot: standardLot.toString(),
        leaves,
        payouts: leaves.map((l, i) => ({
          index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind,
          destination: l.destination, leaf_count: derived.length, proof: tree.proofs[i].map(bytesToHex),
        })),
        signers, signatures,
      };
      writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
      console.log(JSON.stringify({ chain: chain2, allocation_root: bytesToHex(root), leaves: derived.length, signers, out }));
      return 0;
    }

    if (verb === "release") {
      const rpc = need(a, "rpc"), keyFile = need(a, "key");
      const bundle: Bundle = JSON.parse(readFileSync(need(a, "bundle"), "utf8"));
      const only = typeof a.only === "string" ? new Set(a.only.split(",").map(Number)) : null;
      const auctionId = hexToBytes(bundle.auction_id);
      const fields: AttestationFields = {
        auctionId, resultHash: hexToBytes(bundle.result_hash), allocationRoot: hexToBytes(bundle.allocation_root),
        batchIndex: bundle.batch_index, nonce: bundle.nonce, expiry: bundle.expiry,
      };
      const chosen = bundle.payouts.filter((p) => !only || only.has(p.index));
      if (!chosen.length) throw new Error("--only selected no payouts");
      if (chain === "evm") {
        const keyHex = readFileSync(keyFile, "utf8").trim();
        const tx = await evmRelease({
          rpc, keyHex, escrow: bundle.escrow, chainId: (await evmProvider(rpc).getNetwork()).chainId,
          fields, signatures: bundle.signatures,
          payouts: chosen.map((p) => ({
            index: p.index, lotCount: p.lot_count, destinationKind: p.destination_kind,
            destination: p.destination.startsWith("0x") ? p.destination : bytesToHex(hexToBytes(p.destination)),
            leafCount: p.leaf_count, proof: p.proof,
          } as EvmPayout)),
        });
        console.log(JSON.stringify({ chain, tx, payouts: chosen.map((p) => p.index) }));
        return 0;
      }
      const conn = solConnection(rpc);
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
      const programId = new PublicKey(bundle.escrow);
      const genesis = new PublicKey(await conn.getGenesisHash()).toBytes();
      const att = solanaAttestationBytes(fields, genesis, programId.toBytes());
      const sigBytes = bundle.signatures.map((s) => hexToBytes(s));
      const pubBytes = bundle.signers.map((s) => new PublicKey(s).toBytes());
      const payouts: SolPayout[] = chosen.map((p) => {
        const dest = new PublicKey(destinationBytes(2, p.destination, b58ToBytes));
        return {
          index: p.index, lotCount: p.lot_count, destination: dest, destWritable: true,
          leafCount: p.leaf_count, proof: p.proof.map(hexToBytes),
          paidPda: paidPda(programId, auctionId, leafHash(auctionId, { index: p.index, lot_count: p.lot_count, destination_kind: 2, destination: dest.toBytes() })),
        };
      });
      const tx = await sendTx(conn, payer, [
        ed25519Instruction(sigBytes, pubBytes),
        releaseInstruction({
          programId, crank: payer.publicKey, auctionPda: auctionPda(programId, auctionId),
          batchPda: batchPda(programId, auctionId, bundle.batch_index), att, payouts,
        }),
      ]);
      console.log(JSON.stringify({ chain, tx, payouts: chosen.map((p) => p.index) }));
      return 0;
    }

    if (verb === "refund") {
      const rpc = need(a, "rpc"), keyFile = need(a, "key"), escrow = need(a, "escrow");
      const auctionId = hexToBytes(need(a, "auction"));
      if (chain === "evm") {
        const keyHex = readFileSync(keyFile, "utf8").trim();
        const tx = await evmRefund(rpc, keyHex, escrow, bytesToHex(auctionId));
        console.log(JSON.stringify({ chain, tx }));
        return 0;
      }
      const conn = solConnection(rpc);
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
      const programId = new PublicKey(escrow);
      const st = await solStatus(conn, programId, auctionId, []);
      const tx = await sendTx(conn, payer, [refundInstruction({
        programId, crank: payer.publicKey, auctionPda: auctionPda(programId, auctionId),
        returnTo: new PublicKey(st.returnTo), auctionId,
      })]);
      console.log(JSON.stringify({ chain, tx }));
      return 0;
    }

    if (verb === "status") {
      const rpc = need(a, "rpc"), escrow = need(a, "escrow");
      const auctionId = hexToBytes(need(a, "auction"));
      const bundle: Bundle | null = typeof a.bundle === "string"
        ? JSON.parse(readFileSync(a.bundle, "utf8")) : null;
      const leaves = bundle ? bundle.leaves.map((l) => leafHash(auctionId, {
        index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind,
        destination: destinationBytes(l.destination_kind, l.destination, b58ToBytes),
      })) : [];
      if (chain === "evm") {
        const st = await evmStatus(rpc, escrow, bytesToHex(auctionId), leaves.map(bytesToHex));
        console.log(JSON.stringify({ chain, escrow, auction: st }, null, 2));
        return 0;
      }
      const conn = solConnection(rpc);
      const programId = new PublicKey(escrow);
      const st = await solStatus(conn, programId, auctionId, leaves);
      console.log(JSON.stringify({ chain, escrow, auction: st }, null, 2));
      return 0;
    }

    throw new Error(`usage: ${help}`);
  } catch (e) {
    process.stderr.write(`ERROR xchain ${(e as Error).message}\n`);
    return 1;
  }
}
