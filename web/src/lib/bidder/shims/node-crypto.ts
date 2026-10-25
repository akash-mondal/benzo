// The slice of node:crypto the repo's bid code uses, for the browser, on the audited noble libraries the repo already
// pins (@noble/curves ed25519, @noble/hashes sha256). Keys are the raw 32-byte ed25519 seed / public key; DER exports
// carry the same fixed PKCS#8 / SPKI prefixes node writes, so every hex value matches node byte for byte.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { Buffer } from "buffer";

const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex"), SPKI = Buffer.from("302a300506032b6570032100", "hex");
const bytes = (d: string | Uint8Array) => (typeof d === "string" ? Buffer.from(d, "utf8") : Buffer.from(d));

export function createHash(alg: string) {
  if (alg !== "sha256") throw new Error(`hash ${alg} not available in the browser`);
  const parts: Buffer[] = [];
  const h = {
    update(d: string | Uint8Array) { parts.push(bytes(d)); return h; },
    digest(enc?: string) { const out = Buffer.from(sha256(Buffer.concat(parts))); return enc === "hex" ? out.toString("hex") : enc === "base64" ? out.toString("base64") : out; },
  };
  return h;
}

export function randomBytes(n: number) { return Buffer.from(crypto.getRandomValues(new Uint8Array(n))); }

class KeyObject {
  readonly asymmetricKeyType = "ed25519";
  constructor(readonly type: "private" | "public", readonly raw: Uint8Array) {}
  export(o: { type: string; format: string }) {
    const der = this.type === "private" ? Buffer.concat([PKCS8, this.raw]) : Buffer.concat([SPKI, this.raw]);
    if (o.format === "der") return der;
    const label = this.type === "private" ? "PRIVATE KEY" : "PUBLIC KEY";
    return `-----BEGIN ${label}-----\n${der.toString("base64")}\n-----END ${label}-----\n`;
  }
}
const fromInput = (k: any): Uint8Array => {
  if (typeof k === "string") return Buffer.from(k.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  if (k?.key !== undefined) return fromInput(k.key);
  return Buffer.from(k);
};
export function createPrivateKey(k: any) { const der = fromInput(k); return new KeyObject("private", der.slice(der.length - 32)); }
export function createPublicKey(k: any) {
  if (k instanceof KeyObject) return k.type === "public" ? k : new KeyObject("public", ed25519.getPublicKey(k.raw));
  const der = fromInput(k);
  return new KeyObject("public", der.slice(der.length - 32));
}
export function generateKeyPairSync(alg: string) {
  if (alg !== "ed25519") throw new Error(`key type ${alg} not available in the browser`);
  const seed = ed25519.utils.randomPrivateKey();
  return { privateKey: new KeyObject("private", seed), publicKey: new KeyObject("public", ed25519.getPublicKey(seed)) };
}
export function sign(_alg: null, data: Uint8Array, key: KeyObject) { return Buffer.from(ed25519.sign(bytes(data), key.raw)); }
export function verify(_alg: null, data: Uint8Array, key: KeyObject, sig: Uint8Array) {
  try { return ed25519.verify(bytes(sig), bytes(data), key.type === "public" ? key.raw : ed25519.getPublicKey(key.raw)); } catch { return false; }
}
export default { createHash, randomBytes, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify };
