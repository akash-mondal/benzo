// Witness certificates (gate X): a board-witness quorum (n_w, q_w, keys separate from custody shares) co-signs
// the frozen root before round R — (auction_id, frozen_root, leaf_count, T_freeze, chain anchor) — so no single
// coordinator can equivocate on the accepted set (threat #5, #6, #22). Two certificates for different roots are
// always refused; one root per auction.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { hash, jsonBytes, requireThat, zats, type Signed } from "../manifest/schema";
import { isDepositParty } from "../settle/deposits";

export type WitnessSpec = { q_w: number; keys: string[] }; // signed witness_set packet: n_w = keys.length
export type WitnessSet = { version: 1; auction_id: string; q_w: number; keys: string[] };
export type WitnessStatement = { version: 1; auction_id: string; frozen_root: string; leaf_count: number; T_freeze: number; chain_anchor: string };
export type WitnessCert = { statement: WitnessStatement; signatures: { witness: string; signature: string }[] };

// R23 item 1: the strays statement. After settlement each witness signs what ITS OWN scan saw at the
// auction's deposit addresses outside the frozen set — party (the output-position identity), the SHA-256
// of the deposit's memo bytes and the received value — so a published stray claim can be bound to the
// chain: verify requires every stray claim's SHA-256(memo_hex) in a q_w-certified strays statement with
// the same party. One statement per auction (conflicting statements are refused, like one frozen root).
export type StraysEntry = { party: string; memo_sha256: string; value_zats: string };
export type StraysStatement = { version: 1; auction_id: string; strays: StraysEntry[] };
export type StraysCert = { statement: StraysStatement; signatures: { witness: string; signature: string }[] };

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

// R23 item 1 (Reviewer G G1): the strays statement binds a published stray claim to the chain through the
// witnesses' own scans. Domain-separated like the freeze statement ("benzo-strays-v1").
export function straysStatementBytes(st: StraysStatement): Buffer {
  requireThat(st && typeof st === "object" && Object.keys(st).sort().join(",") === "auction_id,strays,version", "strays statement fields");
  requireThat(st.version === 1 && /^[0-9a-f]{64}$/.test(String(st.auction_id)), "strays statement binding");
  requireThat(Array.isArray(st.strays), "strays statement entries");
  const seen = new Set<string>();
  for (const e of st.strays) {
    requireThat(e && typeof e === "object" && Object.keys(e).sort().join(",") === "memo_sha256,party,value_zats", "strays entry fields");
    requireThat(isDepositParty(e.party), "strays entry party");
    requireThat(/^[0-9a-f]{64}$/.test(String(e.memo_sha256)), "strays entry memo hash");
    zats(e.value_zats, "strays entry value");
    requireThat(!seen.has(e.party), "duplicate strays entry party");
    seen.add(e.party);
  }
  return jsonBytes(st);
}

export function signStrays(st: StraysStatement, privateHex: string): { witness: string; signature: string } {
  requireThat(/^[0-9a-f]{64}$/.test(privateHex), "witness private key");
  const key = edPrivate(privateHex);
  return { witness: createPublicKey(key).export({ type: "spki", format: "der" }).subarray(12).toString("hex"),
    signature: sign(null, Buffer.concat([Buffer.from("benzo-strays-v1"), straysStatementBytes(st)]), key).toString("hex") };
}

// One strays statement per auction (conflicting statements refuse, like one frozen root), q_w-of-n_w over
// distinct pinned witness keys. Returns the certified statement.
export function checkStraysCerts(certs: StraysCert[], spec: WitnessSpec): StraysStatement {
  requireThat(Array.isArray(certs) && certs.length > 0, "missing strays statement");
  for (const c of certs) {
    requireThat(c && typeof c === "object" && c.statement && Array.isArray(c.signatures), "strays certificate shape");
    requireThat(c.signatures.length > 0, "strays certificate without signatures");
    for (const s of c.signatures) requireThat(s && /^[0-9a-f]{64}$/.test(String(s.witness)) && /^[0-9a-f]{128}$/.test(String(s.signature)), "strays signature shape");
    straysStatementBytes(c.statement);
  }
  const wanted = straysStatementBytes(certs[0].statement).toString("hex");
  for (const c of certs) requireThat(straysStatementBytes(c.statement).toString("hex") === wanted, "two strays statements for one auction");
  const signed = new Set<string>();
  for (const c of certs) for (const s of c.signatures) {
    if (signed.has(s.witness)) continue;
    requireThat(spec.keys.includes(s.witness), "strays signature not from the witness set");
    requireThat(verify(null, Buffer.concat([Buffer.from("benzo-strays-v1"), straysStatementBytes(c.statement)]), edPublic(s.witness), Buffer.from(s.signature, "hex")), `witness ${s.witness} strays signature`);
    signed.add(s.witness);
  }
  requireThat(signed.size >= spec.q_w, `strays witness quorum ${signed.size}-of-${spec.keys.length}`);
  return certs[0].statement;
}
