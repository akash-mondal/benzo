// Signed auction parameters and byte-stable JSON. All money is decimal zatoshis; no floating-point amounts.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const QUICKNET = {
  chain_hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  public_key: "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  scheme: "bls-unchained-g1-rfc9380", genesis: 1692803367, period: 3,
};
export type Manifest = {
  version: 1; network: "test"; auction_id: string; escrow_ua: string; frost_group_key: string;
  lot: string; supply: number; reserve_zats: string; tick_zats: string; B_max_zats: string;
  q_max: number; C_zats: string; fee_zats: string; deposit_addresses: string[];
  drand: typeof QUICKNET & { R: number }; T_submit: number; T_freeze: number; confirmations: 10;
  clearing: { band: "floor_pro_rata_units"; dust: "ascending_leaf_index"; tie: "ascending_leaf_index"; minimum_fill: number };
  refund: { invalid: "C_minus_fee"; reorg: "C_minus_fee_remove_leaf"; cancel: "full_C" };
  freeze: "merkle_root_v1";
};
export type Signed = { bytes: string; sha256: string; signer: string; signature: string };
export const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const requireThat = (ok: unknown, reason: string): void => { if (!ok) throw new Error(`refused: ${reason}`); };

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  requireThat(value !== undefined && (typeof value !== "number" || Number.isFinite(value)), "non-JSON value");
  return JSON.stringify(value);
}
export const jsonBytes = (value: unknown) => Buffer.from(canonical(value) + "\n");
export function zats(value: unknown, name: string): bigint {
  requireThat(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), `${name} must be decimal zatoshis`);
  const n = BigInt(value as string);
  requireThat(n <= 2_100_000_000_000_000n, `${name} exceeds money range`);
  return n;
}
function integer(n: unknown, name: string, min = 1, max = 2 ** 32 - 1) {
  requireThat(Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max, `${name} is out of range`);
}
function keys(object: any, expected: string) {
  requireThat(object && typeof object === "object" && !Array.isArray(object), "expected object");
  requireThat(Object.keys(object).sort().join(",") === expected.split(" ").sort().join(","), "unknown or missing manifest field");
}
export function validateManifest(m: Manifest): void {
  keys(m, "version network auction_id escrow_ua frost_group_key lot supply reserve_zats tick_zats B_max_zats q_max C_zats fee_zats deposit_addresses drand T_submit T_freeze confirmations clearing refund freeze");
  requireThat(m.version === 1 && m.network === "test", "manifest version/network");
  requireThat(/^[0-9a-f]{64}$/.test(m.auction_id) && /^[0-9a-f]{64}$/.test(m.frost_group_key), "auction/group key");
  requireThat(typeof m.lot === "string" && m.lot.length > 0 && m.lot.length <= 256, "lot");
  requireThat(/^utest1[a-z0-9]+$/.test(m.escrow_ua), "testnet escrow address");
  requireThat(Array.isArray(m.deposit_addresses) && m.deposit_addresses.length > 0 &&
    m.deposit_addresses.every(a => /^utest1[a-z0-9]+$/.test(a)) && new Set(m.deposit_addresses).size === m.deposit_addresses.length, "per-bid addresses");
  integer(m.supply, "supply"); integer(m.q_max, "q_max");
  const reserve = zats(m.reserve_zats, "reserve"), tick = zats(m.tick_zats, "tick"), cap = zats(m.B_max_zats, "B_max");
  const C = zats(m.C_zats, "C"), fee = zats(m.fee_zats, "fee");
  requireThat(tick > 0n && reserve <= cap && reserve % tick === 0n && cap % tick === 0n &&
    C >= BigInt(m.q_max) * cap + fee && fee < C, "collateral/caps/tick/fee");
  keys(m.drand, "chain_hash public_key scheme genesis period R");
  for (const k of Object.keys(QUICKNET) as (keyof typeof QUICKNET)[])
    requireThat(m.drand[k] === QUICKNET[k], `quicknet ${k}`);
  integer(m.drand.R, "R", 1, Number.MAX_SAFE_INTEGER);
  integer(m.T_submit, "T_submit", 1, Number.MAX_SAFE_INTEGER); integer(m.T_freeze, "T_freeze", 1, Number.MAX_SAFE_INTEGER);
  requireThat(m.T_submit < m.T_freeze && m.T_freeze - m.T_submit >= 750 &&
    m.T_freeze < QUICKNET.genesis + (m.drand.R - 1) * QUICKNET.period, "submit/freeze/release ordering or confirmation buffer");
  requireThat(m.confirmations === 10 && m.freeze === "merkle_root_v1", "confirmations/freeze");
  keys(m.clearing, "band dust tie minimum_fill");
  requireThat(m.clearing.band === "floor_pro_rata_units" && m.clearing.dust === "ascending_leaf_index" && m.clearing.tie === "ascending_leaf_index", "clearing rules");
  integer(m.clearing.minimum_fill, "minimum fill", 1, m.supply);
  keys(m.refund, "invalid reorg cancel");
  requireThat(m.refund.invalid === "C_minus_fee" && m.refund.reorg === "C_minus_fee_remove_leaf" && m.refund.cancel === "full_C", "refund policies");
}

// Both signing and verification use every canonical byte, including the exact drand round.
export function signingBytes(bytes: Buffer): Buffer { return bytes; }
export function signRecord(value: unknown, privatePem: string): Signed {
  const bytes = jsonBytes(value), key = createPrivateKey(privatePem);
  requireThat(key.asymmetricKeyType === "ed25519", "signer must be Ed25519");
  return { bytes: bytes.toString("base64"), sha256: hash(bytes), signer: createPublicKey(key).export({type:"spki",format:"der"}).toString("hex"),
    signature: sign(null, signingBytes(bytes), key).toString("hex") };
}
export function verifyRecord<T>(packet: Signed, trustedSigner: string): T {
  requireThat(packet && /^[0-9a-f]{88}$/.test(trustedSigner) && packet.signer === trustedSigner, "untrusted manifest/receipt signer");
  requireThat(typeof packet.bytes === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(packet.bytes), "manifest bytes");
  const bytes = Buffer.from(packet.bytes, "base64");
  requireThat(bytes.toString("base64") === packet.bytes && hash(bytes) === packet.sha256, "manifest byte hash");
  requireThat(/^[0-9a-f]{128}$/.test(packet.signature), "manifest signature length");
  const key = createPublicKey({key:Buffer.from(trustedSigner,"hex"),type:"spki",format:"der"});
  requireThat(key.asymmetricKeyType === "ed25519" && verify(null, signingBytes(bytes), key, Buffer.from(packet.signature,"hex")), "manifest signature");
  const value = JSON.parse(bytes.toString("utf8"));
  requireThat(jsonBytes(value).equals(bytes), "noncanonical manifest/receipt bytes");
  return value as T;
}
export function client(packet: Signed, trustedSigner: string) {
  const manifest = verifyRecord<Manifest>(packet, trustedSigner);
  validateManifest(manifest);
  return { manifest_hash: hash(Buffer.from(packet.bytes,"base64")), manifest };
}
