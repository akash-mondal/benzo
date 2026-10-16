// Ruling R73 item 3 (Reviewer R P2-3 on R70/R72): the OPEN-time destination rule, offline. A hostile sealer skips
// sealEnvelope's check and wraps a t-addr refund in a well-formed v2 envelope for the real recipients; the host's
// open (openEnvelope -> parseEnvelopePayload -> requireShieldedDestination, envelope/index.ts) must refuse it, and the
// settlement path's openDestination must resolve it to null (the exception queue), never to the t-addr.
// Build+run: npx esbuild tools/repro/r73-open-taddr.ts --bundle --platform=node --format=esm --outfile=tmp/r73/open.mjs && node tmp/r73/open.mjs
import sodium from "libsodium-wrappers";
import * as env from "../../envelope";
import { openDestination } from "../../settle/envelopes";

await sodium.ready;
const MAGIC = Buffer.from("benzo-envelope-v2"), PT = 512;
const kc = (k: Uint8Array) => { const l = Buffer.from("benzo-envelope-v2-kc"); return Buffer.from(sodium.crypto_generichash(32, k, Buffer.concat([l, Buffer.alloc(32 - l.length)]))); };
// The format of sealPadded (envelope/index.ts), with no destination check: what a hostile sealer can produce.
function hostileSeal(text: string, pubs: string[]): string {
  const pt = Buffer.alloc(PT), payload = Buffer.from(text, "utf8"); pt.writeUInt16BE(payload.length, 0); payload.copy(pt, 2);
  const key = sodium.randombytes_buf(32), nonce = sodium.randombytes_buf(12);
  const stanzas = Buffer.concat(pubs.map((h) => { const pk = Buffer.from(h, "hex"); return Buffer.concat([pk, sodium.crypto_box_seal(key, pk)]); }));
  const header = Buffer.concat([MAGIC, Buffer.from([pubs.length]), stanzas, kc(key)]);
  return Buffer.concat([header, nonce, Buffer.from(sodium.crypto_aead_chacha20poly1305_ietf_encrypt(pt, header, null, nonce, key))]).toString("hex");
}
const keys = [env.generateEnvelopeKey(), env.generateEnvelopeKey(), env.generateEnvelopeKey()];
const pubs = keys.map((k) => k.public_hex);
const TADDR = "tmredacted"; // a testnet P2PKH t-addr
let failed = 0;
const line = (id: string, ok: boolean, detail: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`); };
for (const [label, text] of [["v2", JSON.stringify({ v: 2, refund: TADDR })], ["v1", TADDR]] as const) {
  const ct = hostileSeal(text, pubs);
  line(`${label}-format-valid`, ct.length / 2 === env.ENVELOPE_CT_BYTES_N3, `hostile envelope is ${ct.length / 2} bytes (n=3 is ${env.ENVELOPE_CT_BYTES_N3})`);
  let opened: string;
  try { opened = `accepted ${env.openEnvelope(ct, keys[0].private_hex, "test").slice(0, 8)}…`; } catch (e) { opened = (e as Error).message; }
  line(`${label}-open-refuses-taddr`, /transparent address \(t-addr\)/.test(opened), `openEnvelope -> ${opened}`);
  const dest = openDestination({ ciphertext_hash: "00".repeat(32), envelope_ct: ct, owner_sig: "" } as any, keys[1].private_hex, "test");
  line(`${label}-settle-exception`, dest === null, `openDestination -> ${dest === null ? "null (exception queue)" : "a destination"}`);
}
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
