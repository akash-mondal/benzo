// Settlement-envelope destinations (gate W, R3 item 7): an envelope may carry only a shielded destination.
// Transparent addresses (t-addrs), TEX addresses and unified addresses without a shielded receiver are refused
// at seal and again at open, so no refund/delivery can be directed into the transparent pool (threat #7, #32).
// Classification follows the pinned zcash_address 0.13.0 decode order — unified (bech32m, ZIP 316 container
// under F4Jumble) -> Sapling (bech32) -> TEX (bech32m) -> Base58Check transparent — with the HRP constants and
// receiver typecodes of zcash_protocol 0.10.5 / zcash_address 0.13.0 (P2PKH 0x00, P2SH 0x01, Sapling 0x02, Orchard 0x03).
import { createHash } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";
import { requireThat } from "../manifest/schema";

const CHAR = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32 = 1, BECH32M = 0x2bc830a3;
const UA_HRPS = ["u", "utest", "uregtest"];
const SAPLING_HRPS = ["zs", "ztestsapling", "zregtestsapling"];
const TEX_HRPS = ["tex", "textest", "texregtest"];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string): number[] => [...hrp].map(c => c.charCodeAt(0) >>> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));

// Split a bech32/bech32m string into hrp + 5-bit data and report which checksums hold (a UA/TEX is bech32m, Sapling is bech32).
function bech32Split(s: string): { hrp: string; data: number[]; bech32: boolean; bech32m: boolean } | null {
  if (s.length < 8 || s.length > 200 || s !== s.toLowerCase()) return null;
  const at = s.lastIndexOf("1");
  if (at < 1 || at + 7 > s.length) return null;
  const hrp = s.slice(0, at), data: number[] = [];
  for (const c of s.slice(at + 1)) {
    const v = CHAR.indexOf(c);
    if (v < 0) return null;
    data.push(v);
  }
  const pm = polymod(hrpExpand(hrp).concat(data));
  return { hrp, data: data.slice(0, -6), bech32: pm === BECH32, bech32m: pm === BECH32M };
}
function toBytes(data: number[]): Buffer | null {
  let acc = 0, bits = 0;
  const out: number[] = [];
  for (const v of data) {
    acc = (acc << 5) | v; bits += 5;
    while (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 0xff); }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null;
  return Buffer.from(out);
}

// F4Jumble^-1 (f4jumble 0.1.1): unkeyed 4-round Feistel, inverse order h1,g1,h0,g0 (ZIP 316).
const hPers = (i: number) => Uint8Array.from([85, 65, 95, 70, 52, 74, 117, 109, 98, 108, 101, 95, 72, i, 0, 0]);
const gPers = (i: number, j: number) => Uint8Array.from([85, 65, 95, 70, 52, 74, 117, 109, 98, 108, 101, 95, 71, i, j & 0xff, (j >> 8) & 0xff]);
function gRound(left: Buffer, right: Buffer, i: number): void {
  for (let j = 0; j < Math.ceil(right.length / 64); j++) {
    const h = blake2b(left, { dkLen: 64, personalization: gPers(i, j) });
    for (let k = 0; k < h.length && j * 64 + k < right.length; k++) right[j * 64 + k]! ^= h[k]!;
  }
}
function hRound(left: Buffer, right: Buffer, i: number): void {
  const h = blake2b(right, { dkLen: left.length, personalization: hPers(i) });
  for (let k = 0; k < left.length; k++) left[k]! ^= h[k]!;
}
function f4jumbleInv(buf: Buffer): Buffer {
  requireThat(buf.length >= 48 && buf.length <= 4194368, "unified encoding length");
  const m = Buffer.from(buf), left = m.subarray(0, Math.min(64, m.length >> 1)), right = m.subarray(left.length);
  hRound(left, right, 1); gRound(left, right, 1); hRound(left, right, 0); gRound(left, right, 0);
  return m;
}
function compactSize(buf: Buffer, at: number): { value: number; next: number } | null {
  const b = buf[at];
  if (b === undefined) return null;
  if (b < 0xfd) return { value: b, next: at + 1 };
  const n = b === 0xfd ? 2 : b === 0xfe ? 4 : 8;
  if (at + 1 + n > buf.length || n === 8) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v += buf[at + 1 + i]! * 2 ** (8 * i);
  return { value: v, next: at + 1 + n };
}

type Item = { typecode: number; data: Buffer };
const ITEM_LEN: Record<number, number> = { 0x00: 20, 0x01: 20, 0x02: 43, 0x03: 43 };
function parseUnified(s: string): Item[] | null {
  const parts = bech32Split(s);
  if (!parts || !parts.bech32m || !UA_HRPS.includes(parts.hrp)) return null;
  const raw = toBytes(parts.data);
  if (!raw) return null;
  const body = f4jumbleInv(raw);
  const padding = Buffer.alloc(16);
  Buffer.from(parts.hrp, "ascii").copy(padding);
  if (body.length < 16 || !body.subarray(body.length - 16).equals(padding)) return null;
  const encoded = body.subarray(0, body.length - 16);
  const items: Item[] = [];
  let at = 0;
  while (at < encoded.length) {
    const tc = compactSize(encoded, at);
    const len = tc && compactSize(encoded, tc.next);
    if (!tc || !len || len.next + len.value > encoded.length) return null;
    // Known receivers must carry their canonical length (zcash_address 0.13.0 item parsing).
    if (ITEM_LEN[tc.value] !== undefined && ITEM_LEN[tc.value] !== len.value) return null;
    items.push({ typecode: tc.value, data: encoded.subarray(len.next, len.next + len.value) });
    at = len.next + len.value;
  }
  return items;
}
function base58Payload(s: string): Buffer | null {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  for (let i = 0; i < s.length - 1 && s[i] === "1"; i++) hex = "00" + hex;
  const raw = Buffer.from(hex, "hex");
  if (raw.length < 5) return null;
  const [body, sum] = [raw.subarray(0, raw.length - 4), raw.subarray(raw.length - 4)];
  const check = createHash("sha256").update(createHash("sha256").update(body).digest()).digest();
  return check.subarray(0, 4).equals(sum) ? body : null;
}

export type DestinationKind = "sapling" | "unified" | "transparent" | "tex" | "other";
export function classifyDestination(destination: string): { kind: DestinationKind; shielded: boolean } {
  requireThat(typeof destination === "string" && destination.length > 0, "destination");
  const parts = bech32Split(destination);
  if (parts && parts.bech32m && UA_HRPS.includes(parts.hrp)) {
    const items = parseUnified(destination);
    requireThat(items !== null, "invalid unified address");
    return { kind: "unified", shielded: items!.some(i => i.typecode === 0x02 || i.typecode === 0x03) };
  }
  if (parts && parts.bech32 && SAPLING_HRPS.includes(parts.hrp)) {
    const data = toBytes(parts.data);
    return { kind: "sapling", shielded: data !== null && data.length === 43 };
  }
  if (parts && parts.bech32m && TEX_HRPS.includes(parts.hrp)) return { kind: "tex", shielded: false };
  const payload = base58Payload(destination);
  if (payload && payload.length === 22) return { kind: "transparent", shielded: false };
  return { kind: "other", shielded: false };
}

// The envelope validator: only a Sapling address or a unified address with a shielded receiver is admissible.
export function requireShieldedDestination(destination: string): void {
  const { kind, shielded } = classifyDestination(destination);
  if (kind === "transparent") requireThat(false, "transparent address (t-addr)");
  if (kind === "tex") requireThat(false, "TEX address");
  if (kind === "unified") requireThat(shielded, "UA without a shielded receiver");
  requireThat(shielded, "not a shielded destination");
}
