// B45 (docs/design/phase7-b45-classify.md) item 4, the envelope-open half: splitting the payload-shape parse
// from the destination rule (envelope/index.ts envelopeRefund + openEnvelopeRefundUnchecked) must leave EVERY
// open verdict byte-identical to the base commit's. This runs the base commit's envelope/index bundle and this
// tree's side by side on every plaintext shape — v1 plain UA, v2 {refund}, v2 {refund, deliver}, a hostile
// t-addr refund, a `{`-leading non-JSON plaintext, a bad-shape v2 doc and a hostile envelope for a key that is
// not a recipient — and compares the returned payload or the thrown message, byte for byte. The prefetch-only
// openEnvelopeRefundUnchecked is checked too: it yields exactly the refund string the verdict path sees (or
// null where the open would throw), and nothing consumes it for a verdict.
//
// Build+run:
//   npx esbuild tools/repro/b45-envelope-parity.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b45-envelope-parity.mjs
//   (base bundle from the pristine base commit: git archive cd19905 | tar -x -C tmp/b45/base-tree — then
//    npx esbuild envelope/index.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/b45/base/envelope-index.mjs
//    run from tmp/b45/base-tree)
//   node tmp/b45-envelope-parity.mjs
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sodium from "libsodium-wrappers";
import { getAddress } from "ethers";
import * as now from "../../envelope";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BASE = path.join(ROOT, "tmp", "b45", "base", "envelope-index.mjs");
if (!existsSync(BASE)) throw new Error(`${BASE} missing — build the base-commit envelope bundle first (see the header)`);
const before = await import(pathToFileURL(BASE).href);

let failed = 0;
const line = (id: string, ok: boolean, detail: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`); };
await sodium.ready;

// The sealPadded frame (envelope/index.ts) with no checks — what a hostile sealer can produce.
const MAGIC = Buffer.from("benzo-envelope-v2"), PT = 512;
const kc = (k: Uint8Array) => { const l = Buffer.from("benzo-envelope-v2-kc"); return Buffer.from(sodium.crypto_generichash(32, k, Buffer.concat([l, Buffer.alloc(32 - l.length)]))); };
const hostileSeal = (text: string, pubs: string[]): string => {
  const pt = Buffer.alloc(PT), payload = Buffer.from(text, "utf8"); pt.writeUInt16BE(payload.length, 0); payload.copy(pt, 2);
  const key = sodium.randombytes_buf(32), nonce = sodium.randombytes_buf(12);
  const stanzas = Buffer.concat(pubs.map((h) => { const pk = Buffer.from(h, "hex"); return Buffer.concat([pk, sodium.crypto_box_seal(key, pk)]); }));
  const header = Buffer.concat([MAGIC, Buffer.from([pubs.length]), stanzas, kc(key)]);
  return Buffer.concat([header, nonce, Buffer.from(sodium.crypto_aead_chacha20poly1305_ietf_encrypt(pt, header, null, nonce, key))]).toString("hex");
};

const keys = [now.generateEnvelopeKey(), now.generateEnvelopeKey(), now.generateEnvelopeKey()];
const pubs = keys.map((k) => k.public_hex);
const UA = "utest1redacted";
const TADDR = "tmredacted"; // fixture: zcash-address-cases.json
const deliver = { chain: "evm", kind: "address", to: getAddress("0x" + "11".repeat(20)) };

const cases: [string, string, string | null][] = [
  ["v1-plain-ua", before.sealEnvelope(UA, pubs, "test"), UA],
  ["v2-refund", before.sealEnvelopePayload({ refund: UA }, pubs, "test"), UA],
  ["v2-refund-deliver", before.sealEnvelopePayload({ refund: UA, deliver: deliver as any }, pubs, "test"), UA],
  // the t-addr's throw is the DESTINATION RULE, which the prefetch deliberately skips — its string feeds
  // classification, and the verdict path refuses it per row exactly as before
  ["hostile-taddr-refund", hostileSeal(JSON.stringify({ v: 2, refund: TADDR }), pubs), TADDR],
  ["hostile-junk-deliver", hostileSeal(JSON.stringify({ v: 2, refund: UA, deliver: { chain: "nope" } }), pubs), UA],
  ["hostile-json-garbage", hostileSeal("{not json", pubs), null],
  ["hostile-v2-bad-shape", hostileSeal(JSON.stringify({ v: 3, refund: UA }), pubs), null],
  ["hostile-not-our-key", now.sealEnvelope(UA, [now.generateEnvelopeKey().public_hex], "test"), null],
];
const attempt = (fn: () => unknown): string => { try { return "OK " + JSON.stringify(fn()); } catch (e) { return "THROW " + (e as Error).message; } };

for (const [name, ct] of cases) {
  const old1 = attempt(() => before.openEnvelopePayload(ct, keys[0].private_hex, "test"));
  const new1 = attempt(() => now.openEnvelopePayload(ct, keys[0].private_hex, "test"));
  line(`open-${name}-identical`, old1 === new1, `base ${old1.slice(0, 90)} | this tree ${new1.slice(0, 90)}`);
  const old2 = attempt(() => before.openEnvelope(ct, keys[1].private_hex, "test"));
  const new2 = attempt(() => now.openEnvelope(ct, keys[1].private_hex, "test"));
  line(`open-envelope-${name}-identical`, old2 === new2, `base ${old2.slice(0, 90)} | this tree ${new2.slice(0, 90)}`);
}
// The prefetch-only opener: the refund string the parse produced (whatever the verdict path will later say
// about it), or null exactly when the key/shape layer of the open would throw.
for (const [name, ct, refund] of cases) {
  const prefetched = now.openEnvelopeRefundUnchecked(ct, keys[0].private_hex);
  line(`prefetch-${name}`, prefetched === refund, `openEnvelopeRefundUnchecked -> ${JSON.stringify(prefetched)?.slice(0, 60)}, expected ${JSON.stringify(refund)?.slice(0, 60)}`);
}
console.log(failed ? `RESULT FAIL (${failed})` : "RESULT PASS");
process.exitCode = failed ? 1 : 0;
