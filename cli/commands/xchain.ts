// benzo xchain lock|attest|release|refund|status — cross-chain escrow operations
// (docs/design/crosschain.md §6/§7 step 3). Drives the EVM BenzoEscrow (ethers) and the Solana
// BenzoEscrow program (@solana/web3.js) against local chains or testnets. Key files are read,
// never printed. Allocation/attestation JSON is the signer-side record; the escrows verify it.
import { readFileSync, writeFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey, Keypair } from "@solana/web3.js";
import { Wallet, getAddress } from "ethers";
import {
  AllocationLeaf, allocationRoot, assetBytes32, buildTree, bytesToHex, destinationBytes, hexToBytes, leafHash,
} from "../../crosschain/leaf";
import { AttestationFields, evmTypedData, solanaAttestationBytes } from "../../crosschain/attestation";
import { openEnvelopePayload } from "../../envelope";
import { type Deliver, deliverSha256, requireDeliver } from "../../envelope/deliver";
import { deriveSettlementStealthAddress } from "../../crosschain/stealth";
import { loadPublicAuction } from "../../api/public-auction";
import { validEnvelope } from "../../settle/envelopes";
import { decryptPublished, publishedClient } from "../published-beacon";
import {
  evmApproved, evmApproval, evmLock, evmProvider, evmRefund, evmReleaseApproved, evmStatus, evmSubmitAttestation, EvmPayout,
} from "../../crosschain/evm";
import {
  approvalExists, approvalPda, auctionPda, ed25519Instruction, lockInstruction, paidPda, refundInstruction,
  sendReleaseApproved, sendTx, solApproval, solConnection, solStatus, SolPayout,
  submitAttestationInstruction,
} from "../../crosschain/solana";
import { hash } from "../../manifest/schema";

export const noun = "xchain";
export const help = [
  "benzo xchain lock   --chain evm|solana --auction HEX32 --amount WAD --lot WAD --lock-until TS --deadline TS --signers FILE --return ADDR --key FILE --rpc URL [--asset 0xADDR]",
  "benzo xchain attest --chain evm|solana --auction HEX32 --result FILE --dir PUBLIC --envelope-key FILE [--envelope-key FILE ...] [--result-hash HEX32] --batch N --nonce N --expiry TS --signer-key FILE [--signer-key FILE ...] --escrow ADDR --rpc URL --out FILE --asset 0xADDR (--result is a result the signer has itself validated per docs/AUDITS.md: its bytes decide the result hash and the allocation leaves; --dir is the published auction directory: attest derives every winner's opening ITSELF from the frozen leaf's ciphertext and the published, BLS-verified beacon (R21 — no opening or record comes from operator files), checks SHA-256(ciphertext) against the root-committed ciphertext_hash and the published record's owner signature + settlement commitment, then derives the leaf's destination from each --envelope-key signer's own opening of the winner's v2 envelope deliver.to (R19) — --allocation and --envelopes are removed and refused, a leaf is attested only when at least 2 --envelope-key signers agree on SHA-256(deliver), winners without a valid deliver go to the bundle's exception queue; a mismatching --result-hash is refused; --asset is required: the escrow's asset is read from chain and must match; no default)",
  "benzo xchain release --chain evm|solana --bundle FILE --key FILE --rpc URL [--only 0,2] [--submit-only]   (--only is a crank aid: release only these payout indexes now — the stored approval is never consumed and the rest stays payable)",
  "benzo xchain refund --chain evm|solana --auction HEX32 --key FILE --rpc URL --escrow ADDR",
  "benzo xchain status --chain evm|solana --auction HEX32 --rpc URL --escrow ADDR [--bundle FILE] [--result FILE]   (--result is the published result.json: its sha256 is compared with the escrow's approved resultHash and the command exits 1 on mismatch)",
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
  asset: string; // 0x address (EVM) or the zero address (native ETH/SOL); bound in every leaf
  standard_lot: string;
  leaves: (AllocationLeaf & { deliver_kind?: string })[];
  exceptions: { index: number; lot_count: number; reason: string }[]; // R19: winners without an attestable deliver
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
      // R19 item 2: no operator destinations. R21: no operator openings/records either — --allocation and
      // --envelopes are removed; attest derives every leaf's opening itself from the published directory.
      if (typeof a.allocation === "string") {
        throw new Error("--allocation is removed (R19): destinations come from the bidder's sealed envelope (--dir + --envelope-key)");
      }
      if (typeof a.envelopes === "string") {
        throw new Error("--envelopes is removed (R21): attest derives winner openings itself from the published directory (--dir)");
      }
      const auctionId = hexToBytes(need(a, "auction"));
      // R17 item 4 (Reviewer R F7): --result FILE is a result the signer has itself validated (the signer
      // procedure is documented in docs/AUDITS.md). The result hash is recomputed from those exact bytes and
      // the allocation leaves are derived from the result's winner set and lot counts, so no operator input
      // can move either; --result-hash and --allocation are cross-checks and any mismatch is refused before
      // any key is read or any chain is contacted.
      const norm = (h: string) => h.replace(/^0x/, "").toLowerCase();
      const resultBytes = readFileSync(need(a, "result"));
      const resultHashHex = hash(resultBytes); // manifest/schema hash: sha256 over the raw bytes — the product's published result hash
      if (typeof a["result-hash"] === "string" && norm(a["result-hash"]) !== resultHashHex) {
        throw new Error(`mismatching --result-hash ${a["result-hash"]}: the validated result bytes hash to ${resultHashHex}`);
      }
      let resultDoc: any;
      try { resultDoc = JSON.parse(resultBytes.toString("utf8")); } catch { throw new Error("--result is not a JSON result"); }
      const resultAuction = resultDoc && typeof resultDoc.auction_id === "string" ? norm(resultDoc.auction_id) : "";
      if (resultAuction !== norm(bytesToHex(auctionId))) {
        throw new Error(`--result auction_id ${resultAuction} does not match --auction ${norm(bytesToHex(auctionId))}`);
      }
      // the leaves derive from the result: winners with a positive fill (product ClearResult) or the
      // cross-chain result's winners[].lot_count — index and lot_count come from the result only; the
      // destinations come from the winners' envelopes (R19), never from an operator file
      const derived: { index: number; lot_count: number }[] = Array.isArray(resultDoc.allocations)
        ? resultDoc.allocations.filter((x: any) => x && Number(x.fill) > 0).map((x: any) => ({ index: Number(x.leaf_index), lot_count: Number(x.fill) }))
        : Array.isArray(resultDoc.winners)
          ? resultDoc.winners.map((w: any) => ({ index: Number(w.leaf), lot_count: Number(w.lot_count) }))
          : [];
      if (!derived.length || derived.some((d) => !Number.isSafeInteger(d.index) || d.index < 0 || !Number.isSafeInteger(d.lot_count) || d.lot_count <= 0) || new Set(derived.map((d) => d.index)).size !== derived.length) {
        throw new Error("--result does not derive a unique positive allocation leaf set (allocations[].fill or winners[].lot_count)");
      }
      const resultHash = hexToBytes(resultHashHex);
      const batchIndex = num(a, "batch"), nonce = num(a, "nonce"), expiry = num(a, "expiry");
      // §10 F-2: signers must attest expiry <= deadline (both chains refuse otherwise); the
      // deadline comes from the locked auction on chain. R9 item 2: so does the asset — the
      // leaves bind exactly what the escrow locked, and --asset must be present and match it
      // (no silent default).
      let chainAsset: string, escrowDeadline: number, chainLot: string;
      if (chain2 === "evm") {
        const st = await evmStatus(rpc, escrow, bytesToHex(auctionId), []);
        escrowDeadline = st.deadline;
        chainAsset = getAddress(st.asset); // from the escrow state on chain
        chainLot = st.standardLot;
      } else {
        const st = await solStatus(solConnection(rpc), new PublicKey(escrow), auctionId, []);
        escrowDeadline = st.deadline;
        chainAsset = "0x0000000000000000000000000000000000000000"; // the program's fixed native-SOL asset (ASSET_SOL)
        chainLot = st.standardLot;
      }
      if (expiry > escrowDeadline) {
        throw new Error(`--expiry ${expiry} must be <= the auction deadline ${escrowDeadline} (crosschain §10 F-2)`);
      }
      if (typeof a.asset !== "string" || !a.asset) {
        throw new Error(`--asset is required: the escrow's asset is ${chainAsset} (read from chain); there is no default`);
      }
      let given: string;
      try { given = getAddress(a.asset); } catch { throw new Error(`--asset ${a.asset} is not a valid 20-byte hex address`); }
      if (given !== chainAsset) {
        throw new Error(`--asset ${given} does not match the escrow's asset ${chainAsset} on chain`);
      }
      // R21: every winner's opening is derived HERE — the frozen leaf's own ciphertext (SHA-256 of it is
      // the root-committed ciphertext_hash) decrypted with the published, BLS-verified beacon through
      // `cli/published-beacon` decryptPublished (the same derivation `benzo verify` uses). The published
      // record for that hash must then pass the shared owner-signature + settlement-commitment rule
      // (settle/envelopes validEnvelope) against that opening. Only then is the winner's `deliver` opened
      // (R19: at least 2 --envelope-key signers agree on SHA-256(deliver), else the exception queue).
      const pub = loadPublicAuction(need(a, "dir"));
      if (!pub.frozen || !pub.beacon) throw new Error("attest needs the frozen leaves and the published beacon in --dir");
      if (pub.manifest.auction_id !== bytesToHex(auctionId).slice(2)) {
        throw new Error(`--dir auction ${pub.manifest.auction_id} does not match --auction ${bytesToHex(auctionId).slice(2)}`);
      }
      const local = publishedClient(pub.beacon);
      const envKeyFiles: string[] = Array.isArray(a["envelope-key"]) ? a["envelope-key"] as string[] : [need(a, "envelope-key")];
      const envPrivates = envKeyFiles.map((f) => readFileSync(f, "utf8").trim());
      const exceptions: { index: number; lot_count: number; reason: string }[] = [];
      const leaves: (AllocationLeaf & { deliver_kind?: string })[] = [];
      for (const d of derived) {
        const ex = (reason: string) => { exceptions.push({ index: d.index, lot_count: d.lot_count, reason }); };
        const fl: any = pub.frozen!.leaves[d.index];
        if (!fl || typeof fl.ciphertext_hex !== "string" || typeof fl.ciphertext_hash !== "string") { ex("no frozen leaf"); continue; }
        if (hash(Buffer.from(fl.ciphertext_hex, "hex")) !== fl.ciphertext_hash) { ex("ciphertext hash mismatch"); continue; }
        let ptHex: string | null = null;
        try { ptHex = await decryptPublished(fl.ciphertext_hex, local); } catch (e) { ex(`bid did not open: ${(e as Error).message}`); continue; }
        if (!ptHex) { ex("bid did not open"); continue; }
        const opened = Buffer.from(ptHex, "hex");
        if (opened.length !== 128 || opened[0] !== 0 || opened.subarray(1, 33).toString("hex") !== pub.manifest.auction_id) { ex("opened bid layout"); continue; }
        const rec = pub.envelopes.find((e) => e.ciphertext_hash === fl.ciphertext_hash) as any;
        if (!rec || typeof rec.envelope_ct !== "string" || typeof rec.owner_sig !== "string") { ex("no envelope record"); continue; }
        // R21 check 3: the record's owner_sig and settlement commitment against THIS opening (shared rule)
        const auth = validEnvelope({ manifest: pub.manifestPacket, frozen: { leaves: [fl] }, opened: [{ leaf_index: 0, plaintext_hex: ptHex }], envelopes: [rec] } as any, 0);
        if (!auth) { ex("no valid owner-signed settlement envelope"); continue; }
        const openings: { sha: string; deliver: Deliver }[] = [];
        let openedOk = 0, noDeliver = 0;
        let malformed: string | null = null;
        for (const priv of envPrivates) {
          let payload;
          try { payload = openEnvelopePayload(rec.envelope_ct, priv); } catch { continue; } // not this signer's envelope / bad wrap
          openedOk++;
          if (payload.deliver === undefined) { noDeliver++; continue; }
          try {
            const dd = requireDeliver(payload.deliver);
            openings.push({ sha: deliverSha256(dd), deliver: dd });
          } catch (e) { malformed = (e as Error).message.replace(/^refused: /, ""); }
        }
        const agreed = openings.find((o) => openings.filter((x) => x.sha === o.sha).length >= 2) ?? null;
        if (agreed === null) {
          if (openedOk >= 2 && noDeliver >= 2) ex("no deliver");
          else if (openedOk >= 2 && malformed !== null) ex(`malformed deliver: ${malformed}`);
          else ex("signers could not agree on the envelope deliver");
          continue;
        }
        const dd = agreed.deliver;
        if (dd.chain === "solana") {
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 2, destination: dd.to, deliver_kind: dd.kind });
        } else if (dd.kind === "stealth") {
          // one signer-reproducible fresh stealth address per (settlement, leaf) — the announcement
          // carries the matching ephemeral key (crosschain/stealth.ts, docs/AUDITS.md)
          const one = deriveSettlementStealthAddress(dd, { deliverSha256Hex: agreed.sha, auctionId, batchIndex: num(a, "batch"), leafIndex: d.index });
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 1, destination: one.stealthAddress, deliver_kind: dd.kind });
        } else if (dd.kind === "railgun") {
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 3, destination: dd.to, deliver_kind: dd.kind });
        } else {
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 1, destination: dd.to, deliver_kind: dd.kind });
        }
      }
      if (!leaves.length) {
        throw new Error(`attest derives no attested leaves (${exceptions.length} winner(s) in the exception queue)`);
      }
      const standardLot = BigInt(chainLot); // pinned by the signed manifest and locked on chain; never operator input
      // design §3: every leaf binds the auction's asset (left-padded to 32 bytes; native = zeros)
      const asset = chainAsset;
      const asset32 = assetBytes32(asset);
      const leafHashes = leaves.map((l) =>
        leafHash(auctionId, { index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind, destination: destinationBytes(l.destination_kind, l.destination, b58ToBytes) }, asset32));
      const tree = buildTree(leafHashes);
      const root = allocationRoot(tree, leafHashes.length);

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
        asset,
        standard_lot: standardLot.toString(),
        leaves,
        exceptions,
        payouts: leaves.map((l, i) => ({
          index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind,
          destination: l.destination, leaf_count: leaves.length, proof: tree.proofs[i].map(bytesToHex),
        })),
        signers, signatures,
      };
      writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
      console.log(JSON.stringify({ chain: chain2, allocation_root: bytesToHex(root), result_hash: resultHashHex, leaves: leaves.length, exceptions, signers, out }));
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
      // R9 item 3 (Solana's model, design §9) on both chains: attest once (submitAttestation
      // stores the approved root per (auction, batch)), then release many (releaseApproved is
      // signature-free, repeatable and never consumes the approval — a partial or failed release
      // leaves the remainder payable). --submit-only runs just the submit step unconditionally,
      // so replaying a used batch is refused on chain with BatchReplayed.
      const submitTx = async () => chain === "evm"
        ? evmSubmitAttestation({
            rpc, keyHex: readFileSync(keyFile, "utf8").trim(), escrow: bundle.escrow,
            chainId: (await evmProvider(rpc).getNetwork()).chainId,
            fields, signatures: bundle.signatures,
          })
        : (async () => {
            const c2 = solConnection(rpc);
            const p2 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
            const pid = new PublicKey(bundle.escrow);
            const g2 = new PublicKey(await c2.getGenesisHash()).toBytes();
            const att2 = solanaAttestationBytes(fields, g2, pid.toBytes());
            return sendTx(c2, p2, [
              ed25519Instruction(bundle.signatures.map((s) => hexToBytes(s)), bundle.signers.map((s) => new PublicKey(s).toBytes())),
              submitAttestationInstruction({ programId: pid, crank: p2.publicKey, auctionPda: auctionPda(pid, auctionId), approvalPda: approvalPda(pid, auctionId, bundle.batch_index), att: att2 }),
            ]);
          })();
      if (a["submit-only"]) {
        const tx = await submitTx();
        console.log(JSON.stringify({ chain, tx, submitted: true, payouts: [] }));
        return 0;
      }
      const submitted = chain === "evm"
        ? !(await evmApproved(rpc, bundle.escrow, bytesToHex(auctionId), bundle.batch_index))
        // §10 F-3: the Approval exists only if program-owned with the APPROVAL_V1 marker — a
        // dusted PDA must not block the submit step
        : !(await approvalExists(solConnection(rpc), new PublicKey(bundle.escrow), approvalPda(new PublicKey(bundle.escrow), auctionId, bundle.batch_index)));
      const setupTxs: string[] = [];
      if (submitted) setupTxs.push(await submitTx());
      if (chain === "evm") {
        const tx = await evmReleaseApproved({
          rpc, keyHex: readFileSync(keyFile, "utf8").trim(), escrow: bundle.escrow,
          auctionId: bytesToHex(auctionId), batchIndex: bundle.batch_index,
          payouts: chosen.map((p) => ({
            index: p.index, lotCount: p.lot_count, destinationKind: p.destination_kind,
            destination: p.destination.startsWith("0x") ? p.destination : bytesToHex(hexToBytes(p.destination)),
            leafCount: p.leaf_count, proof: p.proof,
          } as EvmPayout)),
        });
        console.log(JSON.stringify({ chain, submitted, tx, payouts: chosen.map((p) => p.index) }));
        return 0;
      }
      const conn = solConnection(rpc);
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8"))));
      const programId = new PublicKey(bundle.escrow);
      const escrowPda = auctionPda(programId, auctionId);
      const approval = approvalPda(programId, auctionId, bundle.batch_index);
      const payouts: SolPayout[] = chosen.map((p) => {
        const dest = new PublicKey(destinationBytes(2, p.destination, b58ToBytes));
        return {
          index: p.index, lotCount: p.lot_count, destination: dest, destWritable: true,
          leafCount: p.leaf_count, proof: p.proof.map(hexToBytes),
          paidPda: paidPda(programId, auctionId, leafHash(auctionId, { index: p.index, lot_count: p.lot_count, destination_kind: 2, destination: dest.toBytes() })),
        };
      });
      const rel = await sendReleaseApproved(conn, payer, {
        programId, auctionPda: escrowPda, approvalPda: approval, payouts,
      });
      const txs = [...setupTxs, ...rel.txs];
      console.log(JSON.stringify({
        chain, submitted, chunks: rel.chunks, lookup_table: rel.lookupTable,
        tx: txs[txs.length - 1], txs, payouts: chosen.map((p) => p.index),
      }));
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
      // R14 item 4 (reviewer R F3): --result FILE is the published result.json. Its hash — the
      // product's published result hash (manifest/schema `hash`, sha256 over the raw file bytes,
      // the same value `benzo verify` and the API report as result_hash) — is printed beside the
      // resultHash the escrow approved and compared with it, so "publish one result while
      // settling another" is visible from this command and it exits 1 on mismatch.
      const resultFile = typeof a.result === "string" ? a.result : null;
      if (resultFile && !bundle) throw new Error("--result requires --bundle (it names the batch whose approval to compare)");
      const asset32 = bundle ? assetBytes32(bundle.asset ?? "0x0000000000000000000000000000000000000000") : new Uint8Array(32);
      const leaves = bundle ? bundle.leaves.map((l) => leafHash(auctionId, {
        index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind,
        destination: destinationBytes(l.destination_kind, l.destination, b58ToBytes),
      }, asset32)) : [];
      const st = chain === "evm"
        ? await evmStatus(rpc, escrow, bytesToHex(auctionId), leaves.map(bytesToHex))
        : await solStatus(solConnection(rpc), new PublicKey(escrow), auctionId, leaves);
      const approval = bundle
        ? (chain === "evm"
            ? await evmApproval(rpc, escrow, bytesToHex(auctionId), bundle.batch_index)
            : await solApproval(solConnection(rpc), new PublicKey(escrow), auctionId, bundle.batch_index))
        : null;
      let resultHashCheck: { published: string; chain: string; match: boolean } | null = null;
      if (resultFile && approval && bundle) {
        const published = hash(readFileSync(resultFile));
        const norm = (h: string) => h.replace(/^0x/, "").toLowerCase();
        resultHashCheck = {
          published,
          chain: approval.resultHash,
          match: approval.exists && norm(approval.resultHash) === norm(published),
        };
      }
      console.log(JSON.stringify({ chain, escrow, auction: st, approval, result_hash: resultHashCheck }, null, 2));
      if (resultHashCheck && !resultHashCheck.match) {
        process.stderr.write(approval!.exists
          ? `ERROR xchain result hash mismatch: chain ${resultHashCheck.chain.replace(/^0x/, "")} published ${resultHashCheck.published}\n`
          : `ERROR xchain result hash mismatch: batch ${bundle!.batch_index} has no approval on chain\n`);
        return 1;
      }
      return 0;
    }

    throw new Error(`usage: ${help}`);
  } catch (e) {
    process.stderr.write(`ERROR xchain ${(e as Error).message}\n`);
    return 1;
  }
}
