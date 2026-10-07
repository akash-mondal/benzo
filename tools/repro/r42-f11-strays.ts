// Ruling R42 item 1 (F11, A20 item 1): the strays statement is deleted — a stray set is third-party-growable
// chain state and no signature may cover it as a set (R41's rule). A stray is attested PER ROW at payment in
// the approval maps of the batch that pays it ({party, memo_sha256}), and verify checks those attestations.
// source: adapted from Reviewer R's benzo-sol/lab/pr-a19/tests/r41-strays-wedge.mjs (same fixture: real
// quicknet beacon from docs/evidence/phase-4/cli, offline tlock memos, attacker owner keys, the shipped
// checkPublicAuction and the shipped witness primitives). Both legs of the reviewer's wedge must COMPLETE
// SETTLEMENT AND VERIFY here (they wedged before the fix — the red-before runs the reviewer's file verbatim
// against a pristine fda25b4 archive):
//   f11a-late-stray-settles-verifies   a stray note + owner-signed claim arriving AFTER both witnesses
//                                      certified is paid through its batch (attested per row in two agreeing
//                                      maps) and the settled document verifies clean — no closed set to outgrow;
//   f11b-stray-between-witness-runs    a stray landing BETWEEN the two witnesses' certification runs cannot
//                                      break the quorum (the witness set certifies the frozen root only — the
//                                      statement carries no chain set) and its claim settles and verifies;
//   f11c-unattested-claim-refused      control: a stray claim whose memo hash no map attests is refused with
//                                      the specific per-row attestation error.
// Run: npx esbuild tools/repro/r42-f11-strays.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/r42-f11-strays.mjs && node tmp/r42-f11-strays.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as schema from "../../manifest/schema";
import * as env from "../../envelope";
import * as api from "../../api/public-auction";
import * as seal from "../../settle/envelopes";
import * as witness from "../../witness";
import { deriveClaimOpenings, publishedClient } from "../../cli/published-beacon";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()}`);
console.log(`utc ${new Date().toISOString()}`);
for (const l of execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean)) console.log(`tree ${l}`);

const { timelockEncrypt } = await import(pathToFileURL(path.join(ROOT, "node_modules/tlock-js/index.js")).href);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const beacon = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/beacon.json"), "utf8"));
const packet = JSON.parse(readFileSync(path.join(ROOT, "docs/evidence/phase-4/cli/manifest.json"), "utf8"));
const manifest = JSON.parse(Buffer.from(packet.bytes, "base64").toString("utf8"));
const auctionId = manifest.auction_id;
const local = publishedClient(beacon);

let all = true;
const line = (id: string, ok: boolean, d: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`);
  if (!ok) { console.log(`ERROR ${id} ${d}`); all = false; }
};

// Two third-party strays: valid sealed-bid memos with attacker-chosen owner keys (exactly what anyone can
// send to a manifest-public deposit address before or after any certification).
const mintStray = async (tag: string) => {
  const owner = env.generateOwnerKey();
  const pt = Buffer.alloc(128);
  pt[0] = 0;
  Buffer.from(auctionId, "hex").copy(pt, 1);
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  pt[33] = tag.length; // vary the plaintext so the two ciphertexts differ
  const armored = await timelockEncrypt(beacon.round, pt, local as any);
  const b64 = armored.split("\n").filter((l) => l && !l.startsWith("-----")).join("");
  const ctHex = Buffer.from(b64, "base64").toString("hex");
  const memo = Buffer.alloc(512);
  Buffer.from("ff424e5a01", "hex").copy(memo, 0);
  memo.writeUInt16BE(ctHex.length / 2, 5);
  Buffer.from(ctHex, "hex").copy(memo, 7);
  const memo_hex = memo.toString("hex");
  if (seal.memoSealedBid(memo_hex)?.ciphertext_hex !== ctHex) throw new Error("memo framing mismatch");
  const party = `deposit:${createHash("sha256").update(`attacker-tx-${tag}`).digest("hex")}:ironwood:${tag === "A" ? 0 : 1}`;
  const claim_envelope_sha256 = createHash("sha256").update(`attacker envelope ${tag}`).digest("hex");
  const body = { kind: "claim-refund", auction_id: auctionId, party, claim_envelope_sha256 };
  const owner_sig = env.signStatement({ private_hex: owner.private_hex, public_hex: owner.public_hex } as any, body as any) as string;
  return { tag, owner, memo, memo_hex, party, claim_envelope_sha256, owner_sig, memo_sha256: sha(memo) };
};
const A = await mintStray("A"), B = await mintStray("B");
const openings = await deriveClaimOpenings([A, B].map((s) => ({ party: s.party, claim_envelope_sha256: s.claim_envelope_sha256, owner_sig: s.owner_sig, memo_hex: s.memo_hex })), beacon);

// The pinned witness set (fresh keys) and the manifest that pins it.
const edRaw = (k: ReturnType<typeof generateKeyPairSync>) => ({
  private_hex: (k as any).privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
  public_hex: (k as any).publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
});
const edPrivate = (h: string) => ({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(h, "hex")]), type: "pkcs8" as const, format: "der" as const });
const W = [edRaw(generateKeyPairSync("ed25519")), edRaw(generateKeyPairSync("ed25519"))];
const manifestSigner = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const witnessSet = schema.signRecord({ version: 1, auction_id: auctionId, q_w: 2, keys: W.map((w) => w.public_hex) }, manifestSigner);
const manifest2 = { ...manifest, witness_set_hash: schema.hash(schema.jsonBytes(witnessSet)) };
const packet2 = schema.signRecord(manifest2, manifestSigner);
const spec = witness.validateWitnessSet(schema.verifyRecord<witness.WitnessSet>(witnessSet, packet2.signer), auctionId);

// f11b first — the certification sequence. The witness statement is the FROZEN ROOT only (fixed before R):
// the two runs see different stray sets and still certify the same statement, so the quorum stands.
const frozen = { root: sha(Buffer.from("frozen root fixture")), leaf_count: 1 };
const statement = witness.freezeStatement(manifest2 as any, frozen);
const w1Cert = { statement, signatures: [witness.signStatement(statement, W[1].private_hex)] }; // run 1: scan [A]
// ... a third-party stray B lands HERE, between the two certification runs ...
const w0Cert = { statement, signatures: [witness.signStatement(statement, W[0].private_hex)] }; // run 2: scan [A, B]
let quorumOk = false, quorumDetail = "";
try {
  witness.checkCertificates([w1Cert, w0Cert], spec, statement);
  quorumOk = true;
  quorumDetail = "both certifications carry the same frozen statement (2-of-2 quorum)";
} catch (e) {
  quorumDetail = `threw ${(e as Error).message}`;
}

// The settled document: batch 1 pays stray A, batch 2 pays the late stray B — each batch's two agreeing maps
// attest the stray they pay (note identity + this host's own scanned memo hash), exactly as sign-approve signs.
const mkMaps = (who: typeof W, txid: string, batch: number, s: typeof A, output_index: number) => {
  const body = {
    auction_id: auctionId, batch, txid, outputs: [{ party: s.party, output_index }], defaults: [], balance_refunds: [],
    strays: [{ party: s.party, memo_sha256: s.memo_sha256 }],
  };
  return [witness.signApprovalMap(body as any, who[0].private_hex), witness.signApprovalMap(body as any, who[1].private_hex)];
};
const txidA = createHash("sha256").update("mined-A").digest("hex"), txidB = createHash("sha256").update("mined-B").digest("hex");
const settledRows = [A, B].map((s, i) => ({ party: s.party, kind: "refund", amount_zats: "1000", state: "paid" }));
const settledReceipts = [A, B].map((s, i) => ({ auction_id: auctionId, party: s.party, txid: i ? txidB : txidA, pool: "ironwood", output_index: i, amount_zats: "1000" }));
const claims = [A, B].map((s) => ({ party: s.party, claim_envelope_sha256: s.claim_envelope_sha256, owner_sig: s.owner_sig, memo_hex: s.memo_hex }));
const settled = {
  dir: ROOT, signer: packet2.signer, legacy: true, state: "REFUNDING",
  manifestPacket: packet2, manifest: manifest2, manifest_hash: schema.hash(Buffer.from(packet2.bytes, "base64")),
  frozen: null, opened: [], beacon, serialBeacon: null, launchInput: undefined,
  result: null, resultBytes: null, receipts: [], envelopes: [], witnessSet, witnessCerts: [],
  settlement: {
    rows: settledRows, receipts: settledReceipts,
    approval_maps: [...mkMaps(W, txidA, 1, A, 0), ...mkMaps(W, txidB, 2, B, 1)],
  },
  claims,
};
const errs = (p: unknown) => api.checkPublicAuction(p as any, { claimOpenings: openings } as any).filter((c: any) => c.error);
const settledErrors = errs(settled);

// f11a: the late stray (B, after BOTH witnesses certified) settles and the document verifies clean.
line("f11a-late-stray-settles-verifies",
  settledErrors.length === 0 && quorumOk,
  `stray B settled in batch 2 (attested per row in two agreeing maps); verify errors ${JSON.stringify(settledErrors.map((e: any) => `${e.id}: ${e.error}`))}`);

// f11b: the stray between the two witness runs cannot break the quorum, and its claim settles and verifies.
line("f11b-stray-between-witness-runs",
  quorumOk && settledErrors.length === 0,
  `certification: ${quorumDetail}; the in-between stray's claim paid and verify errors ${JSON.stringify(settledErrors.map((e: any) => `${e.id}: ${e.error}`))}`);

// f11c control: the same claim with a memo no map attests (the forged-memo attack) is refused, specifically.
const forged = { ...A, memo_sha256: sha(Buffer.from("other memo")) };
const forgedClaims = [{ ...claims[0], memo_hex: A.memo_hex }, claims[1]];
const forgedMaps = [...mkMaps(W, txidA, 1, forged, 0), ...mkMaps(W, txidB, 2, B, 1)];
const forgedErrors = errs({ ...settled, claims: forgedClaims, settlement: { ...settled.settlement, approval_maps: forgedMaps } });
line("f11c-unattested-claim-refused",
  forgedErrors.length === 1 && /claim 0 memo is not attested by two agreeing host-signed approval maps of its paying batch/.test(forgedErrors[0].error ?? ""),
  `forged attestation refused: ${JSON.stringify(forgedErrors.map((e: any) => `${e.id}: ${e.error}`))}`);

console.log(all ? "RESULT PASS r42-f11-strays" : "RESULT FAIL r42-f11-strays");
process.exitCode = all ? 0 : 1;
