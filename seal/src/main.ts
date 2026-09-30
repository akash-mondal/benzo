// Benzo sealer: builds the 128-byte plaintext v0, tlock-encrypts it to drand quicknet round R and wraps the binary age
// ciphertext in the 512-byte memo envelope (docs/PHASE-1.md section 6). No network request is made: the tlock client is
// built from the pinned chain info, and the plaintext stays in memory.
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
// tlock-js only calls chain().info() while encrypting; answering from the pins keeps sealing offline.
const pinnedClient = { chain: () => ({ info: async () => QUICKNET }) } as any;

const MEMO_LEN = 512;
const HEADER = [0xff, 0x42, 0x4e, 0x5a, 0x01]; // 0xFF "BNZ" v1

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

function plaintext(auctionId: Uint8Array, price: bigint, quantity: number): Uint8Array {
  const pt = new Uint8Array(128);
  const view = new DataView(pt.buffer);
  pt[0] = 0x00;
  pt.set(auctionId, 1);
  view.setBigUint64(33, price, false);
  view.setUint32(41, quantity, false);
  pt.set(random(16), 45); // nonce
  pt.set(random(32), 61); // owner_pubkey (random in Phase 1)
  pt.set(random(32), 93); // settlement_commitment (random in Phase 1)
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
  if (HEADER.length + 2 + ct.length > MEMO_LEN) throw new Error(`ciphertext too long: ${ct.length} bytes`);

  const envelope = new Uint8Array(MEMO_LEN); // zero-padded
  envelope.set(HEADER, 0);
  new DataView(envelope.buffer).setUint16(HEADER.length, ct.length, false);
  envelope.set(ct, HEADER.length + 2);

  $("round").textContent = String(round);
  $("envelope").textContent = hex(envelope);
  $("uri").textContent = `zcash:${address}?amount=${zecDecimal(collateral)}&memo=${base64url(envelope)}`;
}

document.getElementById("bid")!.addEventListener("submit", (e) => {
  e.preventDefault();
  for (const id of ["error", "round", "envelope", "uri"]) $(id).textContent = "";
  seal().catch((err) => ($("error").textContent = String(err.message ?? err)));
});
