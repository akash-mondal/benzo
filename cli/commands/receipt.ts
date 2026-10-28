// benzo receipt show|prove|statement — public receipts. Flags, not positional arguments.
//   show: inclusion receipt + settlement receipt if any (T2 receipt shape).
//   prove: self-contained inclusion proof against the frozen root; --check rechecks one offline.
//   statement: owner-key-signed settlement statement (auction, leaf, fill, price, payout/refund
//   txid); --check verifies it against result.json and the opened owner key.
import { missingBidProof, checkMissingBidProof, type MissingBidProof } from "../../api/missing-deposits";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireThat, type Signed } from "../../manifest/schema";
import { ownerPublic, signStatement, type OwnerKey } from "../../envelope/index";
import {
  checkInclusionProof, checkSettlementStatement, inclusionProof, loadPublicAuction, receiptShow,
  settlementStatementBody, type InclusionProof, type SettlementStatement,
} from "../../api/public-auction";
import { repoRoot } from "../../manifest/root";

export const noun = "receipt";
export const verb = "";
export const help = "benzo receipt show --dir <public-auction-dir> --ciphertext-hash <hex> [--receipt <signed-receipt.json>] | benzo receipt prove --dir <public-auction-dir> --ciphertext-hash <hex> [--note-id <txid:ironwood:index>] | benzo receipt prove --check <inclusion-proof.json> | benzo receipt statement --dir <public-auction-dir> --ciphertext-hash <hex> | benzo receipt statement --dir <public-auction-dir> --ciphertext-hash <hex> --check <statement.json>";

export async function run(argv: string[]): Promise<number> {
  const mode = argv[0];
  if (argv.includes("--help") || !["show", "prove", "statement"].includes(mode)) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  let dir = "", ciphertextHash = "", noteId = "", packet: Signed | undefined, check = "";
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i] ?? "");
    else if (argv[i] === "--ciphertext-hash") ciphertextHash = argv[++i] ?? "";
    else if (argv[i] === "--receipt") packet = JSON.parse(readFileSync(argv[++i] ?? "", "utf8")) as Signed;
    else if (argv[i] === "--note-id") noteId = argv[++i] ?? "";
    else if (argv[i] === "--check") check = argv[++i] ?? "";
    else {
      process.stderr.write(`ERROR receipt usage: ${help}\n`);
      return 2;
    }
  }
  try {
    if (mode === "prove" && check) {
      // Offline check: the proof bundle alone decides inclusion — no directory, no network.
      const proof = JSON.parse(readFileSync(check, "utf8")) as InclusionProof | MissingBidProof;
      if ("kind" in proof && proof.kind === "missing_bid_refund") {
        checkMissingBidProof(proof as MissingBidProof);
        process.stdout.write("OK not included; refund owed (publisher chain observations)\n"); return 0;
      }
      requireThat(checkInclusionProof(proof as InclusionProof), "inclusion proof does not verify");
      process.stdout.write("OK inclusion proof\n");
      return 0;
    }
    requireThat(!noteId || mode === "prove", "--note-id only with prove");
    requireThat(mode !== "show" || !check, "--check only with prove or statement");
    if (!dir || !/^[0-9a-f]{64}$/.test(ciphertextHash)) {
      process.stderr.write(`ERROR receipt usage: ${help}\n`);
      return 2;
    }
    const pub = loadPublicAuction(dir);
    if (mode === "show") {
      process.stdout.write(JSON.stringify(receiptShow(pub, ciphertextHash, packet), null, 2) + "\n");
      return 0;
    }
    if (mode === "prove") {
      if (noteId || !pub.frozen?.leaves.some(l=>l.ciphertext_hash===ciphertextHash)) {
        process.stdout.write(JSON.stringify(missingBidProof(pub,ciphertextHash,noteId || undefined),null,2)+"\n"); return 0;
      }
      const proof = inclusionProof(pub, ciphertextHash);
      requireThat(proof.included, "not included in the frozen root");
      process.stdout.write(JSON.stringify(proof, null, 2) + "\n");
      return 0;
    }
    if (check) {
      checkSettlementStatement(pub, ciphertextHash, JSON.parse(readFileSync(check, "utf8")) as SettlementStatement);
      process.stdout.write("OK settlement statement\n");
      return 0;
    }
    // Emit: sign the recomputed body with the bid's one-time owner key, which must be the one in the opening.
    const body = settlementStatementBody(pub, ciphertextHash);
    const root = repoRoot();
    const state = path.resolve(root, process.env.BNZ_STATE_DIR || ".benzo");
    const keyFile = path.join(state, "bids", body.auction_id, `${ciphertextHash}.json`);
    requireThat(existsSync(keyFile), "owner key not under BNZ_STATE_DIR/bids");
    const saved = JSON.parse(readFileSync(keyFile, "utf8")) as { owner_private_hex: string };
    requireThat(/^[0-9a-f]{64}$/.test(saved.owner_private_hex), "owner private key");
    const owner: OwnerKey = { private_hex: saved.owner_private_hex, public_hex: ownerPublic(saved.owner_private_hex) };
    requireThat(owner.public_hex === body.owner_pubkey, "owner key does not match the opening");
    process.stdout.write(JSON.stringify({ ...body, signature: signStatement(owner, body as unknown as Record<string, unknown>) }, null, 2) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR receipt ${(e as Error).message}\n`);
    return 1;
  }
}
