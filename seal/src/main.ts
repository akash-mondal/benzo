// Benzo sealer: builds the 128-byte plaintext v0, tlock-encrypts it to drand quicknet round R and wraps the binary age
// ciphertext in the 512-byte memo envelope, framing v2:
// ff424e5a02 || u16be ct_len || tlock_ct || envelope_tag (18) || zero pad, where envelope_tag is the first
// 18 bytes of SHA-256(envelope_ct), or 18 zero bytes for a bid without an envelope. Exact 512-byte fit at
// ct_len = 487; any longer ciphertext is refused. No network request is made: the tlock client is built
// from the pinned chain info, and the plaintext stays in memory.
import { timelockEncrypt, Buffer } from "tlock-js";
import { decodeArmor } from "tlock-js/age/armor";

const QUICKNET = {
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};
// tlock-js only calls chain.info while encrypting; answering from the pins keeps sealing offline.
const pinnedClient = { chain: () => ({ info: async () => QUICKNET }) } as any;

const MEMO_LEN = 512;
const HEADER = [0xff, 0x42, 0x4e, 0x5a, 0x02]; // 0xFF "BNZ" v2 (memo framing v2)
const ENVELOPE_TAG_LEN = 18; // First 18 bytes of SHA-256(envelope_ct); 5 + 2 + 487 + 18 = 512 exactly

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function parseUint(s: string, max: bigint, what: string): bigint {
  if (!/^[0-9]+$/.test(s)) throw new Error(`${what} must be a non-negative integer`);
  const v = BigInt(s);
  if (v > max) throw new Error(`${what} is too large`);
  return v;
}

// First round at or after UTC time t (seconds).
function roundAt(t: number): number {
  return 1 + Math.ceil((t - QUICKNET.genesis_time) / QUICKNET.period);
}

// Owner material is filled by the driver (benzo bid seal produces real one-time owner keys and the salted
// settlement commitment); the standalone form falls back to random bytes. The 128-byte layout is unchanged.
function material(id: string, n: number): Uint8Array {
  const v = $(id).value.trim();
  if (!v) return random(n);
  if (!new RegExp(`^[0-9a-f]{${n * 2}}$`).test(v)) throw new Error(`${id} must be ${n * 2} hex characters`);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// The memo's envelope binding: the deposit memo commits to the first 18 bytes of
// SHA-256(envelope_ct) of the bid's settlement envelope, or 18 zero bytes when the bid carries no envelope.
// 18 bytes stop a third party from substituting an envelope for someone else's deposit at 2^144 (second
// preimage). The driver (benzo bid seal) fills the hidden field; the standalone form has no envelope and
// commits to zeros.
function envelopeTag(): Uint8Array {
  const v = $("envelope_tag").value.trim();
  if (!v) return new Uint8Array(ENVELOPE_TAG_LEN);
  if (!new RegExp(`^[0-9a-f]{${ENVELOPE_TAG_LEN * 2}}$`).test(v)) throw new Error(`envelope_tag must be ${ENVELOPE_TAG_LEN * 2} hex characters`);
  const out = new Uint8Array(ENVELOPE_TAG_LEN);
  for (let i = 0; i < ENVELOPE_TAG_LEN; i++) out[i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Part 2 (every registry mode): the driver may set the mode's layout version byte, a binding (a multi-lot round's lot id
// instead of the auction id) and the launch holder flag (byte 125). Unset, this is the unchanged v0 layout.
function plaintext(auctionId: Uint8Array, price: bigint, quantity: number): Uint8Array {
  const pt = new Uint8Array(128);
  const view = new DataView(pt.buffer);
  const version = $("layout_version").value.trim(), binding = $("binding").value.trim().toLowerCase(), holder = $("holder").value.trim();
  if (version && !/^[0-9]{1,3}$/.test(version)) throw new Error("layout version must be 0-255");
  if (binding && !/^[0-9a-f]{64}$/.test(binding)) throw new Error("binding must be 64 hex characters");
  pt[0] = version ? Number(version) & 0xff : 0x00;
  pt.set(binding ? Buffer.from(binding, "hex") : auctionId, 1);
  if (holder === "1") pt[125] = 1;
  view.setBigUint64(33, price, false);
  view.setUint32(41, quantity, false);
  pt.set(material("nonce", 16), 45);
  pt.set(material("owner", 32), 61);
  pt.set(material("commitment", 32), 93);
  return pt;
}

function zecDecimal(zats: bigint): string {
  const frac = (zats % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return (zats / 100_000_000n).toString() + (frac ? "." + frac : "");
}

function base64url(b: Uint8Array): string {
  return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function seal(): Promise<void> {
  const t = Date.parse($("opening").value.trim());
  if (Number.isNaN(t)) throw new Error("opening time is not a valid UTC timestamp");
  const auctionHex = $("auction").value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(auctionHex)) throw new Error("auction ID must be 64 hex characters");
  const price = parseUint($("price").value.trim(), 2n ** 64n - 1n, "price");
  const quantity = Number(parseUint($("quantity").value.trim(), 2n ** 32n - 1n, "quantity"));
  const collateral = parseUint($("collateral").value.trim(), 2_100_000_000_000_000n, "collateral");
  const address = $("address").value.trim();
  if (!/^[a-z0-9]+$/.test(address)) throw new Error("deposit address is not a unified address");

  const round = roundAt(t / 1000);
  const current = 1 + Math.floor((Date.now() / 1000 - QUICKNET.genesis_time) / QUICKNET.period);
  if (round <= current) throw new Error(`refused: round ${round} is not in the future (current round ${current})`);

  const pt = plaintext(Buffer.from(auctionHex, "hex"), price, quantity);
  const armored = await timelockEncrypt(round, Buffer.from(pt), pinnedClient);
  pt.fill(0);
  const ct = Buffer.from(decodeArmor(armored), "binary");
  const eh = envelopeTag();
  if (HEADER.length + 2 + ct.length + ENVELOPE_TAG_LEN > MEMO_LEN) throw new Error(`ciphertext too long: ${ct.length} bytes (max 487)`);

  const envelope = new Uint8Array(MEMO_LEN); // zero-padded
  envelope.set(HEADER, 0);
  new DataView(envelope.buffer).setUint16(HEADER.length, ct.length, false);
  envelope.set(ct, HEADER.length + 2);
  envelope.set(eh, HEADER.length + 2 + ct.length); // envelope_tag

  $("round").textContent = String(round);
  $("envelope").textContent = hex(envelope);
  $("uri").textContent = `zcash:${address}?amount=${zecDecimal(collateral)}&memo=${base64url(envelope)}`;
}

document.getElementById("bid")!.addEventListener("submit", (e) => {
  e.preventDefault();
  for (const id of ["error", "round", "envelope", "uri"]) $(id).textContent = "";
  seal().catch((err) => ($("error").textContent = String(err.message ?? err)));
});
