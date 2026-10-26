// benzo xchain lock|attest|release|refund|status — cross-chain escrow operations
// (docs/design/crosschain.md §6/§7 step 3). Drives the EVM BenzoEscrow (ethers) and the Solana
// BenzoEscrow program (@solana/web3.js) against local chains or testnets. Key files are read,
// never printed. Allocation/attestation JSON is the signer-side record; the escrows verify it.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey, Keypair } from "@solana/web3.js";
import { NonceManager, TypedDataEncoder, Wallet, getAddress, verifyTypedData } from "ethers";
import { createPublicClient, http } from "viem";
import {
  AllocationLeaf, allocationRoot, assetBytes32, buildTree, bytesToHex, destinationBytes, hexToBytes, leafHash,
} from "../../crosschain/leaf";
import { AttestationFields, evmTypedData, solanaAttestationBytes } from "../../crosschain/attestation";
import { envelopePublicKey, openEnvelopePayload } from "../../envelope";
import { type Deliver, deliverSha256, requireDeliver } from "../../envelope/deliver";
import { CANONICAL_ERC5564_ANNOUNCER, deriveSettlementStealthAddress, prepareAnnouncement } from "../../crosschain/stealth";
import { checkPublicAuction, loadCompletePublicAuction } from "../../api/public-auction";
import { readOrder } from "../../clear/layout";
import { modeEntry } from "../../clear/registry";
import { validEnvelope } from "../../settle/envelopes";
import { decryptPublished, deriveClaimOpenings, publishedClient } from "../published-beacon";
import { openSealedBid } from "../../envelope/opening";
import { requireReserveOpening } from "../../manifest/reserve";
import { verifyBeacon } from "drand-client/beacon-verification.js";
import type { Opened } from "../../clear/core";
import {
  evmApproved, evmApproval, evmLock, evmProvider, evmRefund, evmReleaseApproved, evmStatus, evmSubmitAttestation, EvmPayout, repoRoot,
} from "../../crosschain/evm";
import {
  approvalExists, approvalPda, auctionPda, ed25519Instruction, lockInstruction, paidPda, refundInstruction,
  sendReleaseApproved, sendTx, solApproval, solConnection, solStatus, SolPayout,
  submitAttestationInstruction,
} from "../../crosschain/solana";
import { hash, requireThat } from "../../manifest/schema";

export const noun = "xchain";
export const help = [
  "benzo xchain keygen --chain evm|solana --name SIGNER [--show]   (runs ON a signer host: writes state/xchain/<chain>-<name>.key mode 0600, refuses to replace it, and prints only the public part; --show prints the EXISTING public part and refuses when there is none — the EVM address or the Solana pubkey)",
  "benzo xchain lock   --chain evm|solana --auction HEX32 --amount WAD --lot WAD --lock-until TS --deadline TS --signers FILE --return ADDR --key FILE --rpc URL [--asset 0xADDR]",
  "benzo xchain attest --chain evm|solana --auction HEX32 --result FILE --dir PUBLIC --envelope-key FILE [--envelope-key FILE ...] [--result-hash HEX32] --batch N --nonce N --expiry TS --signer-key FILE [--signer-key FILE ...] --escrow ADDR --rpc URL --out FILE --asset 0xADDR [--host-record] (--result is the PRODUCT result the signer has itself validated per docs/AUDITS.md: its bytes must equal the published --dir/result.json and its allocations[].fill is the only source of the allocation leaves (the cross-chain winners[] shape is removed — R24 item 2); --dir is the published auction directory: attest runs the same public checks as `benzo verify` on it (re-derived openings, witness certificates, clearing recomputed through the registry) and refuses on any ERROR (R22), then derives every winner's opening ITSELF from the frozen leaf's ciphertext and the published, BLS-verified beacon (R21 — no opening or record comes from operator files), checks SHA-256(ciphertext) against the root-committed ciphertext_hash and the published record's owner signature + settlement commitment, then derives the leaf's destination from each --envelope-key signer's own opening of the winner's v2 envelope deliver.to (R19) — --allocation and --envelopes are removed and refused, a leaf is attested only when at least 2 --envelope-key signers agree on SHA-256(deliver) (in --host-record mode — one signer host's own single envelope key and xchain key — the leaf is attested from that opening alone and the 2-of-3 rule is enforced at release from two host records over the identical attestation bytes; without the flag one key can never attest a leaf), winners without a valid deliver go to the bundle's exception queue; the output is the host's SIGNATURE record (attestation bytes, this host's own signature, its own derived payouts) and it is the only thing printed; a mismatching --result-hash is refused; --asset is required: the escrow's asset is read from chain and must match; no default)",,
  "benzo xchain release --chain evm|solana (--bundle FILE | --attestation FILE --attestation FILE ...) --key FILE --rpc URL [--only 0,2] [--submit-only] [--stipend WAD] [--announcer ADDR]   (--attestation collects HOST signature records (one per signer host, produced by `xchain attest` on each host): release requires records over the identical attestation bytes from at least 2 distinct signers of the escrow's pinned set, takes every destination from those records — never from the coordinator — and signs nothing itself (--signer-key is refused; --key is the crank/payer key only); --only is a crank aid: release only these payout indexes now — the stored approval is never consumed and the rest stays payable; --stipend sends a tiny native gas stipend with each fresh stealth payout and --announcer publishes its ERC-5564 announcement on the canonical Announcer — design §4 lesson 6, the delivery flow for deliver.kind=stealth)",
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
const num = (a: Args, k: string): number => {
  const v = need(a, k);
  // R25 item 6: numeric CLI arguments are validated — no silent NaN/float coercion past parsing
  if (!/^\d+$/.test(v)) throw new Error(`--${k} must be a non-negative integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`--${k} is out of range`);
  return n;
};
const big = (a: Args, k: string): bigint => {
  const v = need(a, k);
  if (!/^\d+$/.test(v)) throw new Error(`--${k} must be a non-negative integer`);
  return BigInt(v);
};

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
  /** the exact bytes every signer signed (EIP-712 digest on evm, the 200-byte message on solana):
   *  two host records that derived the same leaves carry identical attestation bytes */
  attestation_bytes?: string;
  leaves: (AllocationLeaf & { deliver_kind?: string; announce?: { scheme_id: number; stealth_address: string; ephemeral_pubkey: string; metadata: string } })[];
  exceptions: { index: number; lot_count: number; reason: string }[]; // R19: winners without an attestable deliver
  payouts: { index: number; lot_count: number; destination_kind: number; destination: string; leaf_count: number; proof: string[] }[];
  signers: string[]; signatures: string[];
}

// Host signature records collected by the coordinator (part 2 §2): `xchain release --attestation`
// takes one record per signer host (what `xchain attest` printed on that host) and releases only when
// the records carry the identical attestation bytes and the derived payout sets agree, with valid
// signatures from >= 2 DISTINCT signers of the escrow's pinned set. R28: every destination comes from
// these host-derived records; the coordinator never holds a signer key and never names a destination.
async function collectAttestations(files: string[], chain: "evm" | "solana", rpc: string): Promise<Bundle> {
  if (files.length < 2) throw new Error("release needs at least 2 --attestation records (one per signer host)");
  const recs = files.map((f) => {
    try { return JSON.parse(readFileSync(f, "utf8")) as Bundle; } catch (e) { throw new Error(`--attestation ${f}: ${(e as Error).message}`); }
  });
  for (const [i, r] of recs.entries()) {
    if (r.version !== 1 || !r.chain || !r.escrow || !r.auction_id || !Array.isArray(r.payouts) || !r.payouts.length
      || !Array.isArray(r.signers) || !Array.isArray(r.signatures) || r.signers.length !== r.signatures.length || !r.signers.length
      || typeof r.attestation_bytes !== "string") {
      throw new Error(`--attestation ${files[i]}: not a signature record (fields, payouts, signers/signatures, attestation_bytes)`);
    }
    if (r.chain !== chain) throw new Error(`--attestation ${files[i]}: record chain ${r.chain} does not match --chain ${chain}`);
  }
  // identical attestation bytes: the records must agree on every attested field AND on the payout set
  // each host derived from its own envelope key — a host that opened a different deliver produces a
  // different allocation root, hence different bytes, and is refused here.
  const shape = (r: Bundle) => JSON.stringify({
    escrow: r.escrow, auction_id: r.auction_id, result_hash: r.result_hash, allocation_root: r.allocation_root,
    batch_index: r.batch_index, nonce: r.nonce, expiry: r.expiry, asset: r.asset, standard_lot: r.standard_lot,
    attestation_bytes: r.attestation_bytes, leaves: r.leaves, payouts: r.payouts,
  });
  for (let i = 1; i < recs.length; i++) {
    if (recs[i].attestation_bytes!.toLowerCase() !== recs[0].attestation_bytes!.toLowerCase()) {
      throw new Error(`--attestation ${files[i]}: attestation bytes differ from ${files[0]} (hosts did not derive the same allocation)`);
    }
    if (shape(recs[i]) !== shape(recs[0])) {
      throw new Error(`--attestation ${files[i]}: records disagree on the derived payouts/fields (${files[0]})`);
    }
  }
  // the attestation bytes must be exactly what the fields and the chain inputs hash to
  const fields: AttestationFields = {
    auctionId: hexToBytes(recs[0].auction_id), resultHash: hexToBytes(recs[0].result_hash),
    allocationRoot: hexToBytes(recs[0].allocation_root), batchIndex: recs[0].batch_index, nonce: recs[0].nonce, expiry: recs[0].expiry,
  };
  let td: ReturnType<typeof evmTypedData> | null = null;
  let expected: string;
  if (chain === "evm") {
    td = evmTypedData(fields, (await evmProvider(rpc).getNetwork()).chainId, recs[0].escrow);
    expected = TypedDataEncoder.hash(td.domain, td.types, td.message);
  } else {
    const pid = new PublicKey(recs[0].escrow);
    const genesis = new PublicKey(await solConnection(rpc).getGenesisHash()).toBytes();
    expected = bytesToHex(solanaAttestationBytes(fields, genesis, pid.toBytes()));
  }
  if (recs[0].attestation_bytes!.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`attestation bytes do not match the record's fields and chain inputs (expected ${expected})`);
  }
  // every signature verifies, and every signer is a member of the escrow's OWN pinned signer set (from chain)
  const pinned = chain === "evm"
    ? new Set((await evmStatus(rpc, recs[0].escrow, recs[0].auction_id, [])).signers.map((s) => getAddress(s).toLowerCase()))
    : new Set((await solStatus(solConnection(rpc), new PublicKey(recs[0].escrow), hexToBytes(recs[0].auction_id), [])).signers.map((s) => new PublicKey(hexToBytes(s)).toBase58()));
  const collected: { signer: string; signature: string }[] = [];
  for (const [i, r] of recs.entries()) {
    for (let j = 0; j < r.signers.length; j++) {
      const signer = r.signers[j];
      let norm: string, ok: boolean;
      try {
        if (chain === "evm") {
          norm = getAddress(signer).toLowerCase();
          ok = verifyTypedData(td!.domain, td!.types, td!.message, r.signatures[j]).toLowerCase() === norm;
        } else {
          norm = new PublicKey(signer).toBase58();
          ok = ed25519.verify(hexToBytes(r.signatures[j]), hexToBytes(r.attestation_bytes!), b58ToBytes(signer));
        }
      } catch { throw new Error(`--attestation ${files[i]}: malformed signer/signature (${signer})`); }
      if (!ok) throw new Error(`--attestation ${files[i]}: signature does not verify for signer ${signer}`);
      if (!pinned.has(norm)) throw new Error(`--attestation ${files[i]}: signer ${signer} is not in the escrow's pinned signer set`);
      collected.push({ signer: norm, signature: r.signatures[j] });
    }
  }
  const distinct = [...new Set(collected.map((c) => c.signer))];
  if (distinct.length < 2) {
    throw new Error(`release needs attestations from at least 2 distinct pinned signers, got ${distinct.length}`);
  }
  return { ...recs[0], signers: collected.map((c) => c.signer), signatures: collected.map((c) => c.signature) };
}

export async function run(argv: string[]): Promise<number> {
  const verb = argv[0];
  try {
    const a = parseArgs(argv.slice(1));
    const chain = need(a, "chain");
    if (chain !== "evm" && chain !== "solana") throw new Error("--chain must be evm or solana");

    if (verb === "keygen") {
      // Part 2 §2: a signer host generates its OWN cross-chain key here (secp256k1 on evm, ed25519 on
      // solana). Only the public part is printed (the escrow's pinned signer set carries it); the
      // private half never leaves this machine's state dir.
      const name = need(a, "name");
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) throw new Error("--name must be [a-z0-9][a-z0-9-]{0,31}");
      const st = path.resolve(repoRoot(), process.env.BNZ_STATE_DIR ?? ".benzo");
      const f = path.join(st, "xchain", `${chain}-${name}.key`);
      if (a.show === "true") {
        // --show: the EXISTING public half (the host's registry entry on the operator's machine can be rebuilt from it);
        // refuses when there is none. The private half is read here, on its own host, and never printed.
        requireThat(existsSync(f), "no xchain key on this host yet; run keygen without --show");
        const have = Buffer.from(readFileSync(f, "utf8").trim(), "hex");
        const shown = chain === "evm" ? new Wallet("0x" + have.toString("hex")).address : new PublicKey(ed25519.getPublicKey(have)).toBase58();
        process.stdout.write(JSON.stringify({ chain, name, public: shown }) + "\n");
        return 0;
      }
      requireThat(!existsSync(f), "xchain key already exists; refusing to replace it");
      mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      const sk = randomBytes(32);
      writeFileSync(f, sk.toString("hex") + "\n", { mode: 0o600, flag: "wx" });
      const pub = chain === "evm"
        ? new Wallet("0x" + sk.toString("hex")).address
        : new PublicKey(ed25519.getPublicKey(sk)).toBase58();
      process.stdout.write(JSON.stringify({ chain, name, public: pub }) + "\n");
      return 0;
    }

    if (verb === "lock") {
      const rpc = need(a, "rpc"), keyFile = need(a, "key"), escrow = need(a, "escrow");
      const auctionId = hexToBytes(need(a, "auction"));
      const amount = big(a, "amount"), lot = big(a, "lot");
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
      // R24 item 2 (Q6 (a)): the leaves derive from the PRODUCT result only — the allocations[].fill of the
      // result the signer validated. The cross-chain winners[] branch is removed, so R22's full
      // checkPublicAuction run on --dir covers the attested result exactly.
      const derived: { index: number; lot_count: number }[] = Array.isArray(resultDoc.allocations)
        ? resultDoc.allocations.filter((x: any) => x && Number(x.fill) > 0).map((x: any) => ({ index: Number(x.leaf_index), lot_count: Number(x.fill) }))
        : [];
      if (!derived.length || derived.some((d) => !Number.isSafeInteger(d.index) || d.index < 0 || !Number.isSafeInteger(d.lot_count) || d.lot_count <= 0) || new Set(derived.map((d) => d.index)).size !== derived.length) {
        throw new Error("--result does not derive a unique positive allocation leaf set (allocations[].fill)");
      }
      // R22: attest runs the same public checks as `benzo verify` on --dir and refuses on any ERROR, and
      // --result must be the directory's own published result.json bytes — so what is attested is exactly
      // the published, witness-certified result, never a parallel one.
      const pub = loadCompletePublicAuction(need(a, "dir"));
      if (!resultBytes.equals(pub.resultBytes)) {
        throw new Error(`--result does not equal --dir/result.json bytes (R22): --result hashes to ${resultHashHex}, the published result.json to ${hash(pub.resultBytes)}`);
      }
      if (!pub.beacon) throw new Error("attest needs the published beacon in --dir");
      const local = publishedClient(pub.beacon);
      // the same checks `benzo verify` runs: openings re-derived from the ciphertexts, claims opened from
      // their published memos, the sealed reserve and serial beacon authenticated, then checkPublicAuction
      const derivedOpenings: Opened[] = [];
      for (const leaf of pub.frozen.leaves) {
        const plaintext = await openSealedBid(leaf.ciphertext_hex, local);
        derivedOpenings.push(plaintext === null ? { leaf_index: leaf.leaf_index, plaintext_hex: null, error: "undecryptable" }
          : { leaf_index: leaf.leaf_index, plaintext_hex: plaintext });
      }
      if (pub.opened.length) {
        requireThat(pub.opened.length === derivedOpenings.length, "published opening count");
        const publishedOpenings = new Map(pub.opened.map(o => [o.leaf_index, o]));
        for (const d of derivedOpenings) {
          const p = publishedOpenings.get(d.leaf_index);
          requireThat(p && p.plaintext_hex === d.plaintext_hex && (p.error ?? null) === (d.error ?? null),
            `opening ${d.leaf_index} published differs from re-derived`);
        }
      }
      pub.opened = derivedOpenings;
      const claimOpenings = await deriveClaimOpenings(pub.claims ?? [], pub.beacon);
      if (pub.manifest.sealed_reserve !== undefined) {
        const reserve = await decryptPublished(pub.manifest.sealed_reserve, local);
        requireReserveOpening(pub.manifest, pub.reserveOpening, reserve);
      } else requireReserveOpening(pub.manifest, pub.reserveOpening, null);
      if (pub.manifest.serials) {
        const round = pub.manifest.drand.R + pub.manifest.serials.seed_round_offset;
        requireThat(pub.result.serial_assignment && pub.result.serial_beacon_round === round, "serial result round/assignment");
        const serialBeacon = pub.serialBeacon;
        requireThat(serialBeacon, "missing published serial beacon");
        const d = pub.manifest.drand;
        requireThat(await verifyBeacon({ public_key: d.public_key, period: d.period, genesis_time: d.genesis,
          hash: d.chain_hash, groupHash: "", schemeID: d.scheme, metadata: { beaconID: "quicknet" } },
          { ...serialBeacon!, randomness: hash(Buffer.from(serialBeacon!.signature, "hex")) }, round), "serial beacon BLS signature");
      }
      const checks = checkPublicAuction(pub, { claimOpenings });
      for (const c of checks) if (c.warn) process.stderr.write(`WARN ${c.id} ${c.warn}\n`);
      const errors = checks.filter(c => c.error);
      for (const c of errors) process.stderr.write(`ERROR ${c.id} ${c.error}\n`);
      if (errors.length) {
        throw new Error(`attest refuses: ${errors.length} public check(s) failed on --dir (${errors.map(c => c.id).join(", ")})`);
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
      if (pub.manifest.auction_id !== bytesToHex(auctionId).slice(2)) {
        throw new Error(`--dir auction ${pub.manifest.auction_id} does not match --auction ${bytesToHex(auctionId).slice(2)}`);
      }
      // R25 item 2: --envelope-key values are deduplicated by public key and must be distinct members
      // of the signed manifest's envelope_keys — one key passed twice counts once, never as a second
      // signer (a duplicated key must not manufacture a 2-of-3 agreement).
      const envKeyFiles: string[] = Array.isArray(a["envelope-key"]) ? a["envelope-key"] as string[] : [need(a, "envelope-key")];
      // --host-record: this is ONE signer host's signature record (part 2 §2) — exactly its own single
      // envelope key and its own single xchain key; the 2-of-3 agreement happens when the coordinator
      // releases from two such records over the identical attestation bytes.
      const hostRecord = a["host-record"] === "true" || a["host-record"] === true;
      const keyFiles: string[] = Array.isArray(a["signer-key"]) ? a["signer-key"] as string[] : [need(a, "signer-key")];
      if (hostRecord && (envKeyFiles.length !== 1 || keyFiles.length !== 1)) {
        throw new Error("--host-record takes exactly one --envelope-key and one --signer-key (this host's own)");
      }
      const envPrivates: string[] = [];
      const envSeen = new Set<string>();
      for (const f of envKeyFiles) {
        // a host's own key file is the shipped `sign envelope-key` JSON ({private_hex}); a raw hex file works too
        const raw = readFileSync(f, "utf8").trim();
        const priv = (() => { try { const j = JSON.parse(raw); if (j && typeof j.private_hex === "string") return j.private_hex.trim(); } catch {} return raw; })();
        let pubHex: string;
        try { pubHex = envelopePublicKey(priv); } catch { throw new Error(`--envelope-key ${f}: not a valid X25519 key`); }
        requireThat(Array.isArray(pub.manifest.envelope_keys) && pub.manifest.envelope_keys.includes(pubHex),
          `--envelope-key ${f}: not a member of the manifest's envelope_keys`);
        if (envSeen.has(pubHex)) continue; // one key passed twice counts once
        envSeen.add(pubHex);
        envPrivates.push(priv);
      }
      const standardLot = BigInt(chainLot); // pinned by the signed manifest and locked on chain; never operator input
      const exceptions: { index: number; lot_count: number; reason: string }[] = [];
      const leaves: (AllocationLeaf & { deliver_kind?: string; announce?: { scheme_id: number; stealth_address: string; ephemeral_pubkey: string; metadata: string } })[] = [];
      for (const d of derived) {
        const ex = (reason: string) => { exceptions.push({ index: d.index, lot_count: d.lot_count, reason }); };
        const fl: any = pub.frozen!.leaves[d.index];
        if (!fl || typeof fl.ciphertext_hex !== "string" || typeof fl.ciphertext_hash !== "string") { ex("no frozen leaf"); continue; }
        if (hash(Buffer.from(fl.ciphertext_hex, "hex")) !== fl.ciphertext_hash) { ex("ciphertext hash mismatch"); continue; }
        let ptHex: string | null = null;
        try { ptHex = await openSealedBid(fl.ciphertext_hex, local); } catch (e) { ex(`bid did not open: ${(e as Error).message}`); continue; }
        if (!ptHex) { ex("bid did not open"); continue; }
        const opened = Buffer.from(ptHex, "hex");
        // gate EN: the opened order parses under the MANIFEST MODE's own plaintext layout (uniform/buyback
        // LAYOUT_V0, OTC version 3, …) with the auction (or lot) binding — never a hardcoded shape
        const layout = modeEntry(pub.manifestPacket as any).layout;
        const order = readOrder(layout, ptHex, (pub.manifest as any).lots ?? [pub.manifest.auction_id]);
        if (opened.length !== layout.bytes || order.reason !== "") { ex("opened bid layout"); continue; }
        const rec = pub.envelopes.find((e) => e.ciphertext_hash === fl.ciphertext_hash) as any;
        if (!rec || typeof rec.envelope_ct !== "string" || typeof rec.owner_sig !== "string") { ex("no envelope record"); continue; }
        // R21 check 3: the record's owner_sig and settlement commitment against THIS opening (shared rule)
        const auth = validEnvelope({ manifest: pub.manifestPacket, frozen: { leaves: [fl] }, opened: [{ leaf_index: 0, plaintext_hex: ptHex }], envelopes: [rec] } as any, 0);
        if (!auth) { ex("no valid owner-signed settlement envelope"); continue; }
        const openings: { sha: string; deliver: Deliver }[] = [];
        let noDeliver = 0;
        let malformed: string | null = null;
        for (const priv of envPrivates) {
          let payload;
          try { payload = openEnvelopePayload(rec.envelope_ct, priv, (pub.manifest as any).network); } catch { continue; } // not this signer's envelope / bad wrap
          if (payload.deliver === undefined) { noDeliver++; continue; }
          try {
            const dd = requireDeliver(payload.deliver);
            openings.push({ sha: deliverSha256(dd), deliver: dd });
          } catch (e) { malformed = (e as Error).message.replace(/^refused: /, ""); }
        }
        // With 2+ distinct envelope keys a leaf needs their agreement on SHA-256(deliver). In
        // --host-record mode (part 2 §2 host custody: this host's own single envelope key and xchain
        // key) the leaf is attested from that opening alone: the 2-of-3 rule is then enforced when
        // `xchain release --attestation` accepts only host records over the identical attestation bytes
        // from 2 distinct pinned signers — two hosts that opened a different deliver cannot agree on
        // the allocation root. Without the flag one key can never attest a leaf (R25 item 2).
        const agreed = openings.find((o) => openings.filter((x) => x.sha === o.sha).length >= 2)
          ?? (hostRecord && openings.length === 1 ? openings[0] : null);
        if (agreed === null) {
          if (malformed !== null && openings.length === 0) ex(`malformed deliver: ${malformed}`);
          else if (noDeliver >= 1 && openings.length === 0) ex("no deliver");
          else ex("signers could not agree on the envelope deliver");
          continue;
        }
        const dd = agreed.deliver;
        // R25 item 3 (Reviewer R F4): a leaf is attested only if THIS chain's escrow can pay its
        // deliver.kind — EVM takes address and stealth, Solana takes address. A chain mismatch or any
        // other kind (ct, railgun) goes to this chain's exception queue, never into the tree.
        if (dd.chain !== chain2) { ex(`deliver chain ${dd.chain} does not match chain ${chain2}`); continue; }
        if (chain2 === "evm" && dd.kind === "stealth") {
          // one signer-reproducible fresh stealth address per (settlement, leaf) — and the ERC-5564
          // announcement the release crank publishes so the winner's viewing key finds the payment
          // (crosschain/stealth.ts, docs/AUDITS.md)
          const one = deriveSettlementStealthAddress(dd, { deliverSha256Hex: agreed.sha, auctionId, batchIndex: num(a, "batch"), leafIndex: d.index, amountWei: BigInt(d.lot_count) * standardLot });
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 1, destination: one.stealthAddress, deliver_kind: dd.kind,
            announce: { scheme_id: 1, stealth_address: one.stealthAddress, ephemeral_pubkey: one.ephemeralPublicKey, metadata: one.metadata } });
        } else if (chain2 === "evm" && dd.kind === "address") {
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 1, destination: dd.to, deliver_kind: dd.kind });
        } else if (chain2 === "solana" && dd.kind === "address") {
          leaves.push({ index: d.index, lot_count: d.lot_count, destination_kind: 2, destination: dd.to, deliver_kind: dd.kind });
        } else {
          ex(`deliver.kind ${dd.kind} is not payable by the ${chain2} escrow`);
        }
      }
      if (!leaves.length) {
        throw new Error(`attest derives no attested leaves (${exceptions.length} winner(s) in the exception queue)`);
      }
      // design §3: every leaf binds the auction's asset (left-padded to 32 bytes; native = zeros)
      const asset = chainAsset;
      const asset32 = assetBytes32(asset);
      const leafHashes = leaves.map((l) =>
        leafHash(auctionId, { index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind, destination: destinationBytes(l.destination_kind, l.destination, b58ToBytes) }, asset32));
      const tree = buildTree(leafHashes);
      // R25 item 3 (sparse per-chain trees): leaves keep their winner (frozen leaf) index, so the root
      // commits the leaf INDEX BOUND — the highest attested index + 1 — for the escrows' strict
      // `index < leaf_count` check (crosschain §3, the Hyperbridge out-of-bounds lesson). The same
      // winner keeps the same leaf hash across batches, so the per-leaf paid flag blocks double payment.
      const leafBound = Math.max(...leaves.map((l) => l.index)) + 1;
      const root = allocationRoot(tree, leafBound);

      const fields: AttestationFields = { auctionId, resultHash, allocationRoot: root, batchIndex, nonce, expiry };
      const signers: string[] = [], signatures: string[] = [];
      // The exact bytes every signer signs (the EIP-712 digest on evm, the 200-byte message on solana).
      // They are part of the signature record: `xchain release --attestation` releases only from host
      // records that carry identical attestation bytes (part 2 §2, R28).
      let attBytes: Uint8Array;
      if (chain2 === "evm") {
        const td = evmTypedData(fields, (await evmProvider(rpc).getNetwork()).chainId, escrow);
        attBytes = hexToBytes(TypedDataEncoder.hash(td.domain, td.types, td.message));
        for (const f of keyFiles) {
          const w = evmSigner(readFileSync(f, "utf8").trim());
          signers.push(w.address.toLowerCase());
          signatures.push(await w.signTypedData(td.domain, td.types, td.message));
        }
      } else {
        const programId = new PublicKey(escrow);
        const genesis = new PublicKey(await solConnection(rpc).getGenesisHash()).toBytes();
        attBytes = solanaAttestationBytes(fields, genesis, programId.toBytes());
        for (const f of keyFiles) {
          const sk = hexToBytes(readFileSync(f, "utf8").trim());
          signers.push(new PublicKey(ed25519.getPublicKey(sk)).toBase58());
          signatures.push(bytesToHex(ed25519.sign(attBytes, sk)));
        }
      }
      const bundle: Bundle = {
        version: 1, chain: chain2, escrow,
        auction_id: bytesToHex(auctionId), result_hash: bytesToHex(resultHash), allocation_root: bytesToHex(root),
        batch_index: batchIndex, nonce, expiry,
        asset, standard_lot: standardLot.toString(),
        attestation_bytes: bytesToHex(attBytes),
        leaves,
        exceptions,
        payouts: leaves.map((l, i) => ({
          index: l.index, lot_count: l.lot_count, destination_kind: l.destination_kind,
          destination: l.destination, leaf_count: leafBound, proof: tree.proofs[i].map(bytesToHex),
        })),
        signers, signatures,
      };
      writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
      // "prints only the signature record": the record carries what the coordinator collects (the
      // attested bytes, this host's signature and its own derived payouts); nothing else — no keys,
      // no openings — reaches stdout.
      process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
      return 0;
    }

    if (verb === "release") {
      const rpc = need(a, "rpc"), keyFile = need(a, "key");
      // R28/part 2 §2: the coordinator signs nothing — --key is the crank/payer key only. A signer
      // key on this command line would mean the coordinator holds one; refused outright.
      if (typeof a["signer-key"] === "string" || Array.isArray(a["signer-key"])) {
        throw new Error("the coordinator never holds a signer key: --signer-key is refused on release (host records come in via --attestation)");
      }
      const attFiles: string[] = Array.isArray(a.attestation) ? a.attestation as string[] : typeof a.attestation === "string" ? [a.attestation] : [];
      const bundle: Bundle = attFiles.length
        ? await collectAttestations(attFiles, chain as "evm" | "solana", rpc)
        : JSON.parse(readFileSync(need(a, "bundle"), "utf8"));
      const only = typeof a.only === "string" ? new Set((() => { if (!/^\d+(,\d+)*$/.test(a.only)) throw new Error("--only must be a comma-separated list of payout indexes"); return a.only.split(",").map(Number); })()) : null;
      // R25 item 6: --announcer must be THE canonical ERC-5564 Announcer (the same address on every
      // chain) — an announcement on any other contract is invisible to every ERC-5564 wallet, and a
      // malicious one could fake or hide deliveries. Refused before anything is signed or sent.
      if (typeof a.announcer === "string") {
        let ann: string;
        try { ann = getAddress(a.announcer); } catch { throw new Error(`--announcer ${a.announcer} is not a valid EVM address`); }
        if (ann !== CANONICAL_ERC5564_ANNOUNCER) {
          throw new Error(`--announcer must be the canonical ERC-5564 Announcer ${CANONICAL_ERC5564_ANNOUNCER}`);
        }
      }
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
        // design §4 lesson 6: the release flow delivers each fresh stealth destination too — the tiny
        // native gas stipend (--stipend WAD) so the winner never funds the one-time address from a
        // known wallet, and the ERC-5564 announcement (--announcer ADDR) whose bytes were fixed at
        // attest time, so the winner finds the payment with its viewing key alone.
        const stipend = typeof a.stipend === "string" ? big(a, "stipend") : 0n;
        const wallet = new NonceManager(new Wallet(readFileSync(keyFile, "utf8").trim(), evmProvider(rpc)));
        const stipendTxs: string[] = [], announceTxs: string[] = [];
        for (const p of chosen) {
          const leaf: any = bundle.leaves.find((l) => l.index === p.index);
          if (leaf?.deliver_kind !== "stealth") continue;
          if (stipend > 0n) {
            const t = await wallet.sendTransaction({ to: p.destination, value: stipend });
            await t.wait();
            stipendTxs.push(t.hash);
          }
          if (typeof a.announcer === "string") {
            if (!leaf.announce) throw new Error(`bundle leaf ${p.index} carries no announcement`);
            const call = await prepareAnnouncement(
              { publicClient: createPublicClient({ transport: http(rpc) }) },
              (await wallet.getAddress()) as `0x${string}`, getAddress(a.announcer) as `0x${string}`,
              { stealthAddress: leaf.announce.stealth_address as `0x${string}`, ephemeralPublicKey: leaf.announce.ephemeral_pubkey as `0x${string}`, metadata: leaf.announce.metadata as `0x${string}` });
            const t = await wallet.sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n });
            await t.wait();
            announceTxs.push(t.hash);
          }
        }
        console.log(JSON.stringify({ chain, submitted, tx, payouts: chosen.map((p) => p.index), stipend_txs: stipendTxs, announce_txs: announceTxs }));
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
