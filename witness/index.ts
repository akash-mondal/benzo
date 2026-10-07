// Witness certificates (gate X): a board-witness quorum (n_w, q_w, keys separate from custody shares) co-signs
// the frozen root before round R — (auction_id, frozen_root, leaf_count, T_freeze, chain anchor) — so no single
// coordinator can equivocate on the accepted set (threat #5, #6, #22). Two certificates for different roots are
// always refused; one root per auction.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { hash, jsonBytes, requireThat, type Signed } from "../manifest/schema";

export type WitnessSpec = { q_w: number; keys: string[] }; // signed witness_set packet: n_w = keys.length
export type WitnessSet = { version: 1; auction_id: string; q_w: number; keys: string[] };
export type WitnessStatement = { version: 1; auction_id: string; frozen_root: string; leaf_count: number; T_freeze: number; chain_anchor: string };
export type WitnessCert = { statement: WitnessStatement; signatures: { witness: string; signature: string }[] };

// Ruling R42 (F11): the closed "one strays statement per auction" design is DELETED. A stray set is
// third-party-growable chain state (deposit addresses stay public forever), so no signature may ever cover
// it as a set — exactly R41's rule. A stray is attested PER ROW, at payment, in the approval maps of the
// batch that pays it ({party, memo_sha256} — the note identity and its scanned memo hash), and verify
// checks those attestations map-to-map. The witness set certifies the frozen root only, fixed before R.

// R23 item 2: envelope-opens reports are signed by the reporting signer's own witness key (a member of
// the same pinned witness set), and the settlement plan counts only reports whose signature verifies —
// one per witness key. The body carries no destination (only per-row ok flags and destination hashes).
export type OpensBody = { signer: string; opens: { leaf: number | null; party: string; ok: boolean; dest_sha256: string | null }[] };
export type OpensReport = OpensBody & { witness: string; signature: string };

// R4 item 2: the signed manifest optionally carries `witness_set_hash` = SHA-256 of the signed witness-set
// side-packet (its canonical JSON bytes: bytes, sha256, signer, signature). Binding the whole packet makes a
// removed or substituted witness set detectable by any reader holding the manifest alone.
export const witnessSetHash = (packet: Signed): string => hash(jsonBytes(packet));

const edPrivate = (h: string) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(h, "hex")]), type: "pkcs8", format: "der" });
const edPublic = (h: string) => createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(h, "hex")]), type: "spki", format: "der" });

// The witness set is a signed side-packet from the manifest signer (trusted through the same --signer anchor),
// so it never changes the manifest shape or the Mode A clearing path.
export function validateWitnessSet(set: WitnessSet, auctionId: string): WitnessSpec {
  requireThat(set && typeof set === "object" && !Array.isArray(set), "witness set");
  requireThat(Object.keys(set).sort().join(",") === "auction_id,keys,q_w,version", "witness set field set");
  requireThat(set.version === 1 && set.auction_id === auctionId, "witness set binding");
  requireThat(Array.isArray(set.keys) && set.keys.length >= 2 && set.keys.length <= 16, "witness key count");
  for (const k of set.keys) requireThat(typeof k === "string" && /^[0-9a-f]{64}$/.test(k), "witness key");
  requireThat(new Set(set.keys).size === set.keys.length, "duplicate witness key");
  requireThat(Number.isInteger(set.q_w) && set.q_w >= 1 && set.q_w <= set.keys.length, "witness quorum");
  return { q_w: set.q_w, keys: set.keys };
}
export function statementBytes(st: WitnessStatement): Buffer {
  requireThat(st && st.version === 1 && /^[0-9a-f]{64}$/.test(String(st.auction_id)) && /^[0-9a-f]{64}$/.test(String(st.frozen_root)) &&
    Number.isSafeInteger(st.leaf_count) && st.leaf_count >= 0 && Number.isSafeInteger(st.T_freeze) && /^[0-9a-f]{64}$/.test(String(st.chain_anchor)), "witness statement");
  return jsonBytes(st);
}
// The certified statement is exactly (auction_id, frozen_root, leaf_count, T_freeze, chain anchor).
export function freezeStatement(m: { auction_id: string; T_freeze: number; drand: { chain_hash: string } }, frozen: { root: string; leaf_count: number }): WitnessStatement {
  return { version: 1, auction_id: m.auction_id, frozen_root: frozen.root, leaf_count: frozen.leaf_count, T_freeze: m.T_freeze, chain_anchor: m.drand.chain_hash };
}
export function generateWitnessKey(): { public_hex: string; private_hex: string } {
  const k = generateKeyPairSync("ed25519");
  return { private_hex: k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(16).toString("hex"),
    public_hex: k.publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex") };
}
export function signStatement(st: WitnessStatement, privateHex: string): { witness: string; signature: string } {
  requireThat(/^[0-9a-f]{64}$/.test(privateHex), "witness private key");
  const key = edPrivate(privateHex);
  return { witness: createPublicKey(key).export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
    signature: sign(null, Buffer.concat([Buffer.from("benzo-witness-v1"), statementBytes(st)]), key).toString("hex") };
}

// Every certificate must carry the same statement as the frozen set the manifest releases; conflicting roots refuse.
export function checkCertificates(certs: WitnessCert[], spec: WitnessSpec, statement: WitnessStatement): void {
  requireThat(Array.isArray(certs) && certs.length > 0, "missing certificate");
  for (const c of certs) {
    requireThat(c && typeof c === "object" && c.statement && Array.isArray(c.signatures), "certificate shape");
    requireThat(c.signatures.length > 0, "certificate without signatures");
    for (const s of c.signatures) requireThat(s && /^[0-9a-f]{64}$/.test(String(s.witness)) && /^[0-9a-f]{128}$/.test(String(s.signature)), "certificate signature shape");
    statementBytes(c.statement); // shape of the certified statement
  }
  // Equivocation first: one root per auction, always (threat #6).
  const roots = new Set(certs.map(c => c.statement.frozen_root));
  requireThat(roots.size === 1, "two certificates for different roots");
  const wanted = statementBytes(statement).toString("hex");
  for (const c of certs) requireThat(statementBytes(c.statement).toString("hex") === wanted, "certificate statement differs");
  // q_w-of-n_w over distinct witness keys: one witness never counts twice, no matter how many certificates repeat it.
  const signed = new Set<string>();
  for (const c of certs) for (const s of c.signatures) {
    if (signed.has(s.witness)) continue;
    requireThat(spec.keys.includes(s.witness), "signature not from the witness set");
    requireThat(verify(null, Buffer.concat([Buffer.from("benzo-witness-v1"), statementBytes(c.statement)]), edPublic(s.witness), Buffer.from(s.signature, "hex")), `witness ${s.witness} signature`);
    signed.add(s.witness);
  }
  requireThat(signed.size >= spec.q_w, `witness quorum ${signed.size}-of-${spec.keys.length}`);
}

export function signOpensReport(body: OpensBody, privateHex: string): { witness: string; signature: string } {
  requireThat(/^[0-9a-f]{64}$/.test(privateHex), "witness private key");
  requireThat(body && typeof body.signer === "string" && Array.isArray(body.opens), "opens report body");
  const key = edPrivate(privateHex);
  return { witness: createPublicKey(key).export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
    signature: sign(null, Buffer.concat([Buffer.from("benzo-envelope-opens-v1"), jsonBytes({ signer: body.signer, opens: body.opens })]), key).toString("hex") };
}

// Total: a forged or unsigned report is "not verified", never a throw.
export function verifyOpensReport(r: OpensReport, keys: string[] | null): boolean {
  try {
    return !!r && Array.isArray(keys) && typeof r.signer === "string" && typeof r.witness === "string" &&
      keys.includes(r.witness) && /^[0-9a-f]{128}$/.test(String(r.signature)) &&
      verify(null, Buffer.concat([Buffer.from("benzo-envelope-opens-v1"), jsonBytes({ signer: r.signer, opens: r.opens })]), edPublic(r.witness), Buffer.from(r.signature, "hex"));
  } catch {
    return false;
  }
}

// Reviewer G's G-4: an approving host's signed map from each non-change output index to the party it derived for it, over
// the candidate's txid — receipts are attributed from two hosts' agreeing maps, never from the coordinator's relayed
// build.json. Domain-separated from every other witness-key signature. R33 item 3 (P1-3): the map also carries the
// defaults list the host derived from its own scan, so `settlement.defaults` can never be a coordinator-only list.
// Ruling R41 (F7): `balance_refunds` carries ONLY the refund rows THIS BATCH pays (the rows among its own outputs,
// a set fixed at signing) — never the host's live row set, which third parties can still grow. A refund row is
// attested here, at paid time, and nowhere else; no signature ever covers a set that can still change.
// Ruling R42 (F11): `strays` carries ONLY the stray deposit rows this batch pays, each with its note
// identity and scanned memo hash — the per-row attestation that replaces the deleted strays statement.
export type StrayAttestation = { party: string; memo_sha256: string };
export type ApprovalMapBody = { auction_id: string; batch: number; txid: string; outputs: { party: string; output_index: number }[]; defaults: number[]; balance_refunds: import("../clear/features").BalanceRefund[]; strays?: StrayAttestation[] };
export type ApprovalMap = ApprovalMapBody & { witness: string; signature: string };
// Maps signed before R42 carry no `strays` field and keep their exact signed bytes (the field joins the
// signed body only when present); maps signed after R42 attest their strays per row over the same bytes.
const mapBytes = (b: ApprovalMapBody) => Buffer.concat([Buffer.from("benzo-approval-map-v1"), jsonBytes({ auction_id: b.auction_id, batch: b.batch, txid: b.txid, outputs: b.outputs, defaults: b.defaults, balance_refunds: b.balance_refunds, ...(b.strays !== undefined ? { strays: b.strays } : {}) })]);
export function signApprovalMap(body: ApprovalMapBody, privateHex: string): ApprovalMap {
  requireThat(/^[0-9a-f]{64}$/.test(privateHex), "witness private key");
  const key = edPrivate(privateHex);
  return { ...body, witness: createPublicKey(key).export({ type: "spki", format: "der" }).subarray(12).toString("hex"), signature: sign(null, mapBytes(body), key).toString("hex") };
}
// Total: a forged or unsigned map is "not verified", never a throw.
export function verifyApprovalMap(m: ApprovalMap, keys: string[]): boolean {
  try {
    return !!m && keys.includes(m.witness) && /^[0-9a-f]{128}$/.test(String(m.signature)) && Array.isArray(m.outputs) &&
      verify(null, mapBytes(m), edPublic(m.witness), Buffer.from(m.signature, "hex"));
  } catch { return false; }
}
// Ruling R41 (F7): the worker's finalize binding over one batch's signed maps — the two agreeing maps of THAT
// batch (same txid, same outputs/defaults/refund rows/strays, distinct pinned witnesses), plus the stable
// defaults list binding (R33 P1-3). A refund-row set or stray set is NEVER compared to a live plan: the maps
// attest only the rows this batch pays, so nothing a third party adds to the chain can move this check.
// Ruling R42 (F12): `defaults` is compared map-to-map only, never against a fresh derivation — the two host
// signatures already rule out a coordinator-only list, and a fresh-vs-signed comparison is the F12 wedge.
export function agreedBatchMaps(maps: unknown, keys: string[], txid: string): ApprovalMap[] {
  const ms = maps as ApprovalMap[];
  requireThat(Array.isArray(ms) && ms.length === 2 && ms.every((mp) => mp && verifyApprovalMap(mp, keys) && mp.txid === txid) &&
    ms[0].witness !== ms[1].witness && jsonBytes(ms[0].outputs).equals(jsonBytes(ms[1].outputs)) &&
    jsonBytes(ms[0].defaults ?? null).equals(jsonBytes(ms[1].defaults ?? null)) &&
    jsonBytes(ms[0].balance_refunds ?? null).equals(jsonBytes(ms[1].balance_refunds ?? null)) &&
    jsonBytes(ms[0].strays ?? null).equals(jsonBytes(ms[1].strays ?? null)),
    "the signing hosts' output maps are missing, unsigned or disagree");
  return ms;
}

// Ruling R40 item 3 (F4): the canonical launch delivery list is host-signed. Each host opens the sealed
// delivery records with its own envelope key, checks every owner signature against its own openings, builds
// the canonical list (clear/launch.ts deliveryBatch) and signs `benzo-delivery-list-v1` over its
// allocation_file_hash with its witness key. `benzo verify` requires two valid signatures from distinct
// pinned signers — integrity rests on the same 2-of-3 trust as settlement. Domain-separated like every other
// witness-key signature.
export type DeliveryListBody = { version: 1; auction_id: string; allocation_file_hash: string };
export type DeliveryListSig = { witness: string; signature: string };
const deliveryListBytes = (b: DeliveryListBody) => Buffer.concat([Buffer.from("benzo-delivery-list-v1"),
  jsonBytes({ version: b.version, auction_id: b.auction_id, allocation_file_hash: b.allocation_file_hash })]);
export function signDeliveryList(body: DeliveryListBody, privateHex: string): DeliveryListSig {
  requireThat(/^[0-9a-f]{64}$/.test(privateHex), "witness private key");
  requireThat(body && body.version === 1 && /^[0-9a-f]{64}$/.test(String(body.auction_id)) && /^[0-9a-f]{64}$/.test(String(body.allocation_file_hash)), "delivery list body");
  const key = edPrivate(privateHex);
  return { witness: createPublicKey(key).export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
    signature: sign(null, deliveryListBytes(body), key).toString("hex") };
}
// Total: a forged or unsigned signature is "not verified", never a throw.
export function verifyDeliveryListSig(s: DeliveryListSig, body: DeliveryListBody, keys: string[]): boolean {
  try {
    return !!s && Array.isArray(keys) && keys.includes(s.witness) && /^[0-9a-f]{128}$/.test(String(s.signature)) &&
      verify(null, deliveryListBytes(body), edPublic(s.witness), Buffer.from(s.signature, "hex"));
  } catch { return false; }
}
