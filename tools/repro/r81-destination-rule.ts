// Ruling R81 (Reviewer R R-2 on R80): settlement pays Orchard/Ironwood only, so the destination rule admits only a UA
// with an Orchard receiver — at seal (bidder) and at open (host: refused destinations become claimable exceptions).
// Adapted from R73's open-time probe (same hostile sealer). Ruling R73 item 3 (Reviewer R P2-3 on R70/R72): the OPEN-time destination rule, offline. A hostile sealer skips
// sealEnvelope's check and wraps a t-addr refund in a well-formed v2 envelope for the real recipients; the host's
// open (openEnvelope -> parseEnvelopePayload -> requireShieldedDestination, envelope/index.ts) must refuse it, and the
// settlement path's openDestination must resolve it to null (the exception queue), never to the t-addr.
// Build+run: npx esbuild tools/repro/r81-destination-rule.ts --bundle --platform=node --format=esm --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' --outfile=tmp/r81.mjs && node tmp/r81.mjs
// (B43: the createRequire banner is needed since settle/envelopes pulls the pinned tlock-js graph — the same
// banner build:core uses for clear/dist/auction.mjs; without it the bundle dies on dynamic require of node:crypto.)
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
let failed = 0;
const line = (id: string, ok: boolean, detail: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`); };
const SAPLING = "ztestsapling1redacted"; // fixture: zcash-address-cases.json
const UA_SAPLING_ONLY = "utest1redacted"; // receivers [Sapling]
const UA_ORCHARD = "utest1redacted"; // receivers [Sapling, Orchard]
const RULE = /settlement pays Orchard\/Ironwood only/;
const seal = (d: string) => { try { env.sealEnvelope(d, pubs, "test"); return "sealed"; } catch (e) { return (e as Error).message; } };
line("seal-sapling-refused", RULE.test(seal(SAPLING)), `sealEnvelope(Sapling) -> ${seal(SAPLING)}`);
line("seal-ua-sapling-only-refused", RULE.test(seal(UA_SAPLING_ONLY)), `sealEnvelope(UA [Sapling]) -> ${seal(UA_SAPLING_ONLY)}`);
line("seal-ua-orchard-accepted", seal(UA_ORCHARD) === "sealed", `sealEnvelope(UA [Sapling, Orchard]) -> ${seal(UA_ORCHARD)}`);
for (const [label, d] of [["sapling", SAPLING], ["ua-sapling-only", UA_SAPLING_ONLY]] as const) {
  const ct = hostileSeal(JSON.stringify({ v: 2, refund: d }), pubs);
  let opened: string; try { opened = `accepted`; env.openEnvelope(ct, keys[0].private_hex, "test"); } catch (e) { opened = (e as Error).message; }
  line(`open-${label}-refused`, RULE.test(opened), `openEnvelope(hostile ${label}) -> ${opened}`);
  const dest = openDestination({ ciphertext_hash: "00".repeat(32), envelope_ct: ct, owner_sig: "" } as any, keys[1].private_hex, "test");
  line(`open-${label}-exception`, dest === null, `openDestination -> ${dest === null ? "null (exception queue, claimable)" : "a destination"}`);
}
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
