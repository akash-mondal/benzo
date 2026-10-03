// Envelope payload v2 `deliver` (docs/PHASE-5.md R19 item 1): the cross-chain delivery destination the
// bidder seals inside its own settlement envelope — never an operator file. Checked per chain:
//
//   chain "solana", kind "address": to = a base58 32-byte Solana key
//   chain "solana", kind "ct":     to = a base58 32-byte Solana key, elgamal = 32-byte hex ElGamal pubkey
//   chain "evm",    kind "address":  to = an EIP-55 checksummed 20-byte EVM address
//   chain "evm",    kind "railgun":  to = a Railgun 0zk address (bech32m, 73-byte payload)
//   chain "evm",    kind "stealth": to = an ERC-5564 stealth meta-address (0x… or st:eth:0x…, 66 bytes)
//
// A leaf is attested only when at least 2 signers agree on SHA-256(deliver) — the bytes hashed are the
// canonical JSON below (manifest/schema `canonical`, keys sorted), the same bytes inside the payload.
// Encodings are decoded with pinned libraries (@scure/base: base58 + bech32m, the same bech32m the
// Railgun engine uses; @noble/hashes keccak for EIP-55), never hand-rolled checksums.
import { keccak_256 } from "@noble/hashes/sha3";
import { bech32m, base58 } from "@scure/base";
import { createHash } from "node:crypto";
import { canonical, requireThat } from "../manifest/schema";

export type DeliverChain = "solana" | "evm";
export type DeliverKind = "address" | "ct" | "railgun" | "stealth";
export interface Deliver {
  chain: DeliverChain;
  kind: DeliverKind;
  to: string;
  elgamal?: string;
}

// Canonical JSON of a deliver (sorted keys, no whitespace): the exact bytes of SHA-256(deliver).
export function canonicalDeliverJson(d: Deliver): string {
  return canonical(
    d.elgamal === undefined
      ? { chain: d.chain, kind: d.kind, to: d.to }
      : { chain: d.chain, kind: d.kind, to: d.to, elgamal: d.elgamal },
  );
}
export function deliverSha256(d: Deliver): string {
  return createHash("sha256").update(canonicalDeliverJson(d), "utf8").digest("hex");
}

const HEX32 = /^[0-9a-f]{64}$/;
function eip55(lowerHex40: string): string {
  const h = Buffer.from(keccak_256(Buffer.from(lowerHex40, "ascii"))).toString("hex");
  let out = "0x";
  for (let i = 0; i < lowerHex40.length; i++) out += parseInt(h[i], 16) >= 8 ? lowerHex40[i].toUpperCase() : lowerHex40[i];
  return out;
}

// Validate (and return unchanged) a deliver that crossed a trust boundary (opened envelope payload).
// Throws `refused: …` on anything malformed — the attest layer classifies the throw into the chain's
// exception queue (R19 item 2). The sealer runs the same rule before sealing.
export function requireDeliver(v: unknown): Deliver {
  requireThat(v !== null && typeof v === "object" && !Array.isArray(v), "deliver must be an object");
  const d = v as Record<string, unknown>;
  requireThat(
    Object.keys(d).every((k) => k === "chain" || k === "kind" || k === "to" || k === "elgamal"),
    "deliver fields",
  );
  requireThat(d.chain === "solana" || d.chain === "evm", "deliver.chain must be solana or evm");
  requireThat(
    d.kind === "address" || d.kind === "ct" || d.kind === "railgun" || d.kind === "stealth",
    "deliver.kind must be address, ct, railgun or stealth",
  );
  requireThat(typeof d.to === "string" && d.to.length > 0, "deliver.to");
  if (d.elgamal !== undefined) requireThat(d.kind === "ct", "deliver.elgamal is only for kind ct");
  const chain = d.chain as DeliverChain, kind = d.kind as DeliverKind, to = d.to as string;

  if (chain === "solana") {
    requireThat(kind === "address" || kind === "ct", "solana deliver.kind must be address or ct");
    try {
      requireThat(base58.decode(to).length === 32, "deliver.to must be a Solana base58 32-byte key");
    } catch {
      requireThat(false, "deliver.to must be a Solana base58 32-byte key");
    }
    if (kind === "ct") {
      requireThat(typeof d.elgamal === "string" && HEX32.test(d.elgamal), "deliver.elgamal must be 32-byte hex");
    }
    return kind === "ct"
      ? { chain, kind, to, elgamal: d.elgamal as string }
      : { chain, kind, to };
  }

  requireThat(kind === "address" || kind === "railgun" || kind === "stealth", "evm deliver.kind must be address, railgun or stealth");
  if (kind === "address") {
    requireThat(/^0x[0-9a-fA-F]{40}$/.test(to) && to === eip55(to.toLowerCase().slice(2)), "deliver.to must be an EIP-55 checksummed EVM address");
    return { chain, kind, to };
  }
  if (kind === "railgun") {
    // Railgun 0zk address: bech32m (HRP "0zk", 127 chars) over a 73-byte payload
    // version(1) ‖ masterPublicKey(32) ‖ networkID(8) ‖ viewingPublicKey(32) (Railgun engine bech32.ts).
    try {
      const dec = bech32m.decode(to as `${string}1${string}`, 127);
      requireThat(dec.prefix === "0zk", "deliver.to must be a Railgun 0zk address");
      const bytes = bech32m.fromWords(dec.words);
      requireThat(bytes.length === 73 && bytes[0] === 1, "deliver.to must be a Railgun 0zk address");
    } catch {
      requireThat(false, "deliver.to must be a Railgun 0zk address");
    }
    return { chain, kind, to };
  }
  // ERC-5564 stealth meta-address: two 33-byte compressed secp256k1 keys (spending ‖ viewing),
  // raw 0x… or in the ERC-5564 URI form st:eth:0x….
  const m = /^(st:eth:)?(0x[0-9a-fA-F]{132})$/.exec(to);
  requireThat(
    m !== null && (m[2].slice(2, 4) === "02" || m[2].slice(2, 4) === "03") &&
      (m[2].slice(68, 70) === "02" || m[2].slice(68, 70) === "03"),
    "deliver.to must be an ERC-5564 stealth meta-address",
  );
  return { chain, kind, to };
}
