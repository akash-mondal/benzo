// B43 (docs/design/phase7-h13-h14.md items 1-2): the one sealed-bid shape rule and the one opener.
//
// A sealed bid is exactly one age file over this auction's drand round (measured on a real tlock-js 0.9.0
// ciphertext of a 128-byte bid; the layout is fixed):
//   - the version line `age-encryption.org/v1`;
//   - ONE stanza `tlock <R> <chain_hash>` whose body is 128 bytes (the pinned tlock-js readAge decodes the
//     171 base64 characters into it; they sit on 3 lines of 64, 64 and 43 characters);
//   - a 32-byte header MAC after the `--- ` marker (43 unpadded base64 characters);
//   - a payload of exactly 16 + 128 + 16 = 160 bytes (age's STREAM construction: one 16-byte chunk tag,
//     the 128-byte plaintext, the 16-byte final-chunk tag).
// Anything else is not a sealed bid of this auction: `bid seal` and `bid deposit` refuse it at admission so
// the bidder sees it, and a frozen leaf carrying it opens as `undecryptable` — one malformed bid can no
// longer stop every other bidder's open (H14). The rule is called at ADMISSION ONLY: never inside
// memoTlockCiphertext or anything else an old published directory's verify goes through.
//
// openSealedBid is the only path that turns a sealed bid into a plaintext. It returns the plaintext as hex,
// or null when the bid itself is at fault — the shape rule fails, either authenticated-ciphertext MAC
// failure (the decryptPublished contract below), or a plaintext that is not exactly 128 bytes (tlock-js
// happily returns an EMPTY plaintext for a payload cut short, where Go tle reported a MAC failure). It
// THROWS only for problems that are not the leaf's — an unverified beacon client or a ciphertext naming a
// round other than the beacon's (the publishedClient contract) — so a broken beacon or packet stops the
// caller instead of being blamed on a bid.
import { timelockDecrypt, type ChainClient } from "tlock-js";
import { readAge } from "tlock-js/age/age-reader-writer.js";
import { QUICKNET, requireThat } from "../manifest/schema";

// The 128-byte bid/ask order layout (clear/layout.ts LAYOUT_V0.bytes); every registry mode's layout has this
// length, only the version byte and the padding differ.
const BID_BYTES = 128;
// The age payload of a 128-byte plaintext: one 16-byte chunk tag + the plaintext + the 16-byte final tag.
const PAYLOAD_BYTES = 16 + 128 + 16;

export type SealedBidShape = { ok: true } | { ok: false; reason: string };

// The one sealed-bid shape rule. `R` is the auction's drand round (admission) — the stanza must name exactly
// `tlock <R> <quicknet chain>`. Returns `ok` or the reason; it never throws (the pinned parser's own errors
// become reasons, so a griefing ciphertext is data, not a crash).
export function sealedBidShape(ciphertextHex: string, R: number): SealedBidShape {
  const fail = (reason: string): SealedBidShape => ({ ok: false, reason });
  if (typeof ciphertextHex !== "string" || !/^[0-9a-f]+$/.test(ciphertextHex) || ciphertextHex.length % 2 !== 0) return fail("ciphertext is not even-length hex");
  let parsed: ReturnType<typeof readAge>;
  try {
    parsed = readAge(Buffer.from(ciphertextHex, "hex").toString("binary"));
  } catch (e) {
    return fail(`age parse: ${(e as Error).message}`);
  }
  if (parsed.header.version !== "age-encryption.org/v1") return fail(`version is ${JSON.stringify(parsed.header.version)}, not age-encryption.org/v1`);
  if (parsed.header.recipients.length !== 1) return fail(`${parsed.header.recipients.length} stanzas, not exactly one tlock stanza`);
  const stanza = parsed.header.recipients[0];
  if (stanza.type !== "tlock" || stanza.args.length !== 2) return fail("stanza is not tlock <round> <chain>");
  if (stanza.args[1] !== QUICKNET.chain_hash) return fail(`stanza chain is ${stanza.args[1]}, not ${QUICKNET.chain_hash}`);
  if (stanza.args[0] !== String(R)) return fail(`stanza round is ${stanza.args[0]}, not ${R}`);
  if (stanza.body.length !== BID_BYTES) return fail(`stanza body is ${stanza.body.length} bytes, not ${BID_BYTES}`);
  if (parsed.header.mac.length !== 32) return fail(`header mac is ${parsed.header.mac.length} bytes, not 32`);
  if (parsed.body.length !== PAYLOAD_BYTES) return fail(`payload is ${parsed.body.length} bytes, not ${PAYLOAD_BYTES}`);
  return { ok: true };
}

// The exact failure contract every caller maps (H11, docs/design/phase7-h10-h11.md item 3): a null return is an
// AUTHENTICATED-CIPHERTEXT failure — the header MAC ("The MAC did not validate for the fileKey and payload!") or a
// payload-chunk MAC ("Error during decryption!") — the only bad-bid cases; every other failure (a bad beacon, the
// wrong round/chain, a structural parse error) THROWS and stops the caller. tlock-js 0.9.0 raises exactly those two
// messages at exactly its two MAC checks (age-encrypt-decrypt.js header MAC; stream-cipher.js ChaCha20Poly1305.open),
// so the split is exact, and an unknown failure message can only fail closed (it throws). This function moved here
// from cli/published-beacon.ts with B43 so the one opener and the contract it maps live in one module; the raw
// decrypt stays the sealed-reserve path (a reserve is not a sealed bid, so the shape and 128-byte rules do not
// apply to it).
export async function decryptPublished(ciphertextHex: string, client: ChainClient): Promise<string | null> {
  const ciphertext = Buffer.from(ciphertextHex, "hex").toString("binary");
  // tlock-js 0.9.0 does not check the stanza chain hash; bind both stanza arguments here.
  const info = await client.chain().info();
  const stanza = ciphertext.match(/\n-> tlock ([1-9][0-9]*) ([0-9a-f]{64})\n/);
  requireThat(stanza && stanza[2] === info.hash, "ciphertext tlock stanza/chain");
  await client.get(Number(stanza![1]));
  // Pinned tlock-js prints each public beacon. Keep CLI output bounded while awaiting its decrypt call.
  const log = console.log;
  console.log = () => {};
  try { return (await timelockDecrypt(ciphertext, client)).toString("hex"); }
  catch (e) {
    if (/^(The MAC did not validate for the fileKey and payload!|Error during decryption!)$/.test((e as Error).message)) return null;
    throw e;
  } finally { console.log = log; }
}

// The one opener (item 2). See the module header for the exact null/throw contract. Every path that turns a
// sealed bid into a plaintext calls this: auction `open`, verify's re-derivation, the hosts' deriveRows and
// memo openings, authenticatedMemoEnvelope, the settlement plan, sign delivery and xchain. No product path
// spawns Go `tle` any more.
export async function openSealedBid(ciphertextHex: string, client: ChainClient): Promise<string | null> {
  const text = Buffer.from(ciphertextHex, "hex").toString("binary");
  const stanza = text.match(/\n-> tlock ([1-9][0-9]*) ([0-9a-f]{64})\n/);
  // A ciphertext naming a round other than the beacon's is a beacon/packet disagreement, not a bad bid: the
  // client refuses the round (the publishedClient contract) and the refusal stops the caller here.
  const round = stanza ? Number(stanza[1]) : 0;
  if (stanza) await client.get(round);
  const shape = sealedBidShape(ciphertextHex, round);
  if (!shape.ok) return null;
  const plaintext = await decryptPublished(ciphertextHex, client);
  if (plaintext === null || plaintext.length !== BID_BYTES * 2) return null;
  return plaintext;
}
