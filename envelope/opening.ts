// The one sealed-bid shape rule and the one opener.
//
// A sealed bid is exactly one age file over this auction's drand round (measured on a real tlock-js 0.9.0
// ciphertext of a 128-byte bid; the layout is fixed):
//   - the version line `age-encryption.org/v1`;
//   - ONE stanza `tlock <R> <chain_hash>` whose body is 128 bytes (the pinned tlock-js readAge decodes the
//     171 base64 characters into it; they sit on 3 lines of 64, 64 and 43 characters) and whose first 96
//     bytes decode as a valid compressed BLS12-381 G2 point (the IBE point U — a real sealer always writes
//     one);
//   - a 32-byte header MAC after the `--- ` marker (43 unpadded base64 characters);
//   - a payload of exactly 16 + 128 + 16 = 160 bytes (age's STREAM construction: one 16-byte chunk tag,
//     the 128-byte plaintext, the 16-byte final-chunk tag).
// Anything else is not a sealed bid of this auction: `bid seal` and `bid deposit` refuse it at admission so
// the bidder sees it, and a frozen leaf carrying it opens as `undecryptable` — one malformed bid can no
// longer stop every other bidder's open. The rule runs at ADMISSION (the two call sites above) and as
// the one opener's own shape gate below — never inside memoTlockCiphertext or any other intake parse. Old
// published directories were sealed honestly, so their ciphertexts keep passing it (the phase-7 folds replay
// them).
//
// openSealedBid is the only path that turns a sealed bid into a plaintext. every
// caller hands it a client built from THIS auction's verified beacon (publishedClient BLS-checks it at
// construction, and that is where a bad beacon throws), so everything about the ciphertext is the
// ciphertext's fault. It reads the beacon round from the CLIENT itself, never from the ciphertext; returns
// the plaintext as hex, or null when the shape rule fails (a wrong round included), when ANY exception comes
// out of the tlock/age/IBE layers (either MAC failure, `invalid G2 point`, `rP check failed`, parse errors),
// or when the plaintext is not exactly 128 bytes (tlock-js happily returns an EMPTY plaintext for a payload
// cut short, where Go tle reported a MAC failure). It THROWS only when the client itself is unusable — it
// serves no beacon round — checked before the shape rule, so no ciphertext can cause it. One junk-body bid
// or one wrong-round memo can no longer stop `open`, `verify`, the plan or every host's derivation.
import { appendFileSync } from "node:fs";
import { bls12_381 } from "@noble/curves/bls12-381";
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
  // A 128-byte body can still be junk. Its first 96 bytes are the IBE point U — a
  // compressed BLS12-381 G2 point that any real sealer writes — so they must decode as one. A griefing body
  // is refused HERE, at admission, where the bidder sees the reason, instead of reaching the frozen set and
  // the IBE decoder (where it used to THROW `invalid G2 point` and stop the open for everyone). The other 32
  // bytes (V, W) cannot be checked before R; a forgery there opens as `undecryptable` (the opener below).
  try {
    bls12_381.G2.ProjectivePoint.fromHex(stanza.body.subarray(0, 96));
  } catch (e) {
    return fail(`stanza body is not a valid G2 point: ${(e as Error).message}`);
  }
  if (parsed.header.mac.length !== 32) return fail(`header mac is ${parsed.header.mac.length} bytes, not 32`);
  if (parsed.body.length !== PAYLOAD_BYTES) return fail(`payload is ${parsed.body.length} bytes, not ${PAYLOAD_BYTES}`);
  return { ok: true };
}

// The exact failure contract the sealed-RESERVE path maps: a null
// return is an AUTHENTICATED-CIPHERTEXT failure — the header MAC ("The MAC did not validate for the fileKey and
// payload!") or a payload-chunk MAC ("Error during decryption!") — and every other failure throws. tlock-js
// 0.9.0 raises exactly those two messages at exactly its two MAC checks (age-encrypt-decrypt.js header MAC;
// stream-cipher.js ChaCha20Poly1305.open), so the split is exact, and an unknown failure message can only fail
// closed (it throws). This raw decrypt is the SEALED-RESERVE path only (a reserve is a sealed price bound, not
// a sealed bid, so the shape and 128-byte rules do not apply to it); every sealed bid goes through
// openSealedBid below. For the reserve a manifest's own `sealed_reserve` failing to open is an OPERATOR fault
// (nobody but the operator can put one in the signed manifest), so it may still stop the open — deliberately.
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

// The one opener. See the module header for the exact null/throw contract (it never throws on a
// leaf or a memo). Every path that turns a sealed bid into a plaintext calls this: auction `open`, verify's
// re-derivation, the hosts' deriveRows and memo openings, authenticatedMemoEnvelope, the settlement plan, sign
// delivery and xchain. No product path spawns Go `tle` any more.
export async function openSealedBid(ciphertextHex: string, client: ChainClient): Promise<string | null> {
  // (proof hook): with BNZ_OPENINGS_TRACE set to a file path, every call to the one opener is recorded
  // there (one JSON line per call), so a test can count calls and prove the host cache
  // re-decrypts nothing on a second batch. Unset in every product run, this is inert.
  if (process.env.BNZ_OPENINGS_TRACE) appendFileSync(process.env.BNZ_OPENINGS_TRACE, JSON.stringify({ pid: process.pid, at: Date.now() }) + "\n");
  // rule 1: the beacon round comes from the CLIENT (the one round it serves), never from the ciphertext.
  // Only this check can throw: a client that serves no beacon round is unusable, and no ciphertext can cause
  // that. A ciphertext naming another round is the ciphertext's fault and falls to the shape rule below.
  const beacon = await client.latest().catch(() => null);
  const round = beacon && Number.isSafeInteger(beacon.round) && beacon.round > 0 ? beacon.round : 0;
  requireThat(round > 0, "opener: the beacon client serves no round");
  // rule 2: the shape rule runs against the BEACON's round, so a wrong-round ciphertext is the leaf's (or
  // the stray memo's) fault and returns null here instead of throwing out of client.get.
  if (!sealedBidShape(ciphertextHex, round).ok) return null;
  // rule 3: every exception the tlock/age/IBE layers raise on THIS ciphertext (either MAC failure, an
  // invalid G2 point, an rP check failure, a parse error) is the ciphertext's fault — null. The plaintext must
  // still be exactly one 128-byte bid.
  const text = Buffer.from(ciphertextHex, "hex").toString("binary");
  // Pinned tlock-js prints each public beacon. Keep CLI output bounded while awaiting its decrypt call.
  const log = console.log;
  console.log = () => {};
  try {
    const plaintext = await timelockDecrypt(text, client);
    return plaintext.length === BID_BYTES ? plaintext.toString("hex") : null;
  } catch {
    return null;
  } finally { console.log = log; }
}
