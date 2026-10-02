// R12 item 2 / R10 item 1 repro — the envelope key-commitment red/green checks (kc-*).
// Proves the R10 item 1 format rules against the shipped `envelope/` and `settle/envelopes.ts` modules:
// a key commitment that binds each unwrapped content key to the header (ChaCha20-Poly1305 is not
// key-committing), and product validation that accepts exactly the manifest's `envelope_keys` in order.
// The hand-built envelopes below compute key_commit under the specified derivation —
// crypto_generichash(32, content_key, key = "benzo-envelope-v2-kc" zero-padded to libsodium's
// crypto_generichash_KEYBYTES) — so they also prove the production derivation matches it (kc-key-32-interop).
// Checks (each prints one PASS/ERROR <id> line; exit 0 only if all PASS):
//   kc-api-exports                   envelopeRecipients + the fixed n = 3 byte length are exported
//   kc-key-32-interop                an honestly built envelope under the specified 32-byte KC key opens with
//                                    production openEnvelope (red while the label is padded past KEYBYTES)
//   kc-recipients-order              envelopeRecipients returns the stanza keys in order
//   kc-split-key-recipient1-opens    control: a hand-built split-key envelope opens for recipient 1
//   kc-split-key-recipient2-commitment recipient 2 is refused with `envelope key commitment`
//   kc-3of3-accepted                 control: validEnvelope accepts the 3-of-3 record
//   kc-1of3-refused                  a record sealed to 1 of the 3 pinned keys is refused
//   kc-2of3-refused                  a record sealed to 2 of the 3 pinned keys is refused
//   kc-reorder-refused               the 3 keys out of manifest order are refused
//   kc-wrongset-refused              a third key the manifest does not pin is refused
//
// Usage: node tools/repro/kc-key-commitment-repro.mjs
// Needs: npm ci. No network: module-level checks only.
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sodium from "libsodium-wrappers";
await sodium.ready;

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

// Provenance lines come from git and the clock at run time; this output is committed unedited.
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
console.log(`commit ${sha}${dirty ? " (working tree not clean at run time)" : ""}`);
console.log(`utc ${new Date().toISOString()}`);
console.log(`command node tools/repro/kc-key-commitment-repro.mjs`);
for (const l of dirty.split("\n").filter(Boolean)) console.log(`tree ${l}`);

// Build the modules under test from this working tree.
writeFileSync(path.join(ROOT, "tmp/repro-kc-entry.mjs"), [
  'export * as schema from "../manifest/schema";',
  'export * as env from "../envelope/index";',
  'export * as settle from "../settle/envelopes";',
  "",
].join("\n"));
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), ["tmp/repro-kc-entry.mjs", "--bundle", "--platform=node", "--format=esm", "--outfile=tmp/repro-kc-lib.mjs", "--log-level=warning"], { cwd: ROOT });
const { schema, env, settle } = await import(pathToFileURL(path.join(ROOT, "tmp/repro-kc-lib.mjs")).href);

let failures = 0;
const pass = (id) => console.log(`PASS ${id}`);
const fail = (id, e) => { failures++; console.log(`ERROR ${id} ${e instanceof Error ? e.message : String(e)}`); };
const refused = (fn, want) => {
  try { fn(); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes(want)) return;
    throw new Error(`got "${m}", want "${want}"`);
  }
  throw new Error(`accepted, want refusal "${want}"`);
};
const need = (ok, why) => { if (!ok) throw new Error(why); };
const rndHex = (n) => randomBytes(n).toString("hex");
const UA = "utest1redacted";

// The specified key-commitment derivation (R10 item 1): the ASCII label zero-padded to exactly
// libsodium's crypto_generichash_KEYBYTES. The production module must use these same 32 bytes.
const KC_LABEL = Buffer.from("benzo-envelope-v2-kc");
const KC_KEY = Buffer.concat([KC_LABEL, Buffer.alloc(sodium.crypto_generichash_KEYBYTES - KC_LABEL.length)]);
const MAGIC = Buffer.from("benzo-envelope-v2");
const keyCommit = (contentKey) => Buffer.from(sodium.crypto_generichash(32, contentKey, KC_KEY));
const padPlaintext = (payload) => {
  const pt = Buffer.alloc(512);
  pt.writeUInt16BE(payload.length, 0);
  payload.copy(pt, 2);
  return pt;
};
// Hand-built v2 envelope: magic(17) || n(1) || n*(pk32||sealed80) || key_commit(32) || nonce(12) || body(528+16),
// the whole header being the AEAD associated data, with key_commit under a caller-chosen content key mapping.
const buildEnvelope = (destination, recipients, wrapKeys) => {
  const pks = recipients.map((h) => Buffer.from(h, "hex"));
  const stanzas = Buffer.concat(pks.map((pk, i) => Buffer.concat([pk, sodium.crypto_box_seal(wrapKeys[i], pk)])));
  const header = Buffer.concat([MAGIC, Buffer.from([pks.length]), stanzas, keyCommit(wrapKeys[0])]);
  const nonce = sodium.randombytes_buf(12);
  const body = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(padPlaintext(Buffer.from(destination, "utf8")), header, null, nonce, wrapKeys[0]);
  return Buffer.concat([header, nonce, body]).toString("hex");
};

const keys = [env.generateEnvelopeKey(), env.generateEnvelopeKey(), env.generateEnvelopeKey()];
const recipients = keys.map((k) => k.public_hex);

// ---- kc-api-exports: the R10 item 1 module API exists ----
try {
  need(typeof env.envelopeRecipients === "function", "envelopeRecipients not exported");
  need(env.ENVELOPE_CT_BYTES_N3 === 926, `ENVELOPE_CT_BYTES_N3 = ${env.ENVELOPE_CT_BYTES_N3}, want 926 (17+1+3*112+32+12+528+16)`);
  pass("kc-api-exports");
} catch (e) { fail("kc-api-exports", e); }

// ---- kc-key-32-interop: the production key_commit derivation is the specified 32-byte key ----
try {
  need(KC_KEY.length === sodium.crypto_generichash_KEYBYTES, `spec KC key is ${KC_KEY.length} bytes, want ${sodium.crypto_generichash_KEYBYTES}`);
  const contentKey = sodium.randombytes_buf(32);
  const honest = buildEnvelope(UA, recipients, [contentKey, contentKey, contentKey]);
  const got = keys.map((k) => env.openEnvelope(honest, k.private_hex));
  need(got.every((g) => g === UA), `opens ${JSON.stringify(got)} != destination`);
  pass("kc-key-32-interop");
} catch (e) { fail("kc-key-32-interop", e); }

// ---- kc-recipients-order: envelopeRecipients reads the stanzas in order ----
let env3 = "";
try {
  env3 = env.sealEnvelope(UA, recipients);
  const got = env.envelopeRecipients(env3);
  need(JSON.stringify(got) === JSON.stringify(recipients), `got ${JSON.stringify(got)}`);
  pass("kc-recipients-order");
} catch (e) { fail("kc-recipients-order", e); }

// ---- kc-split-key-*: stanza 2 wraps a different content key under stanza 1's commitment ----
let splitHex = "";
try {
  const bodyKey = sodium.randombytes_buf(32); // stanza 1's key: the one the header commits to
  const splitKey = sodium.randombytes_buf(32); // stanza 2 wraps a DIFFERENT key (the hostile sealer)
  splitHex = buildEnvelope(UA, recipients, [bodyKey, splitKey, bodyKey]);
  const got = env.openEnvelope(splitHex, keys[0].private_hex);
  need(got === UA, `recipient 1 opened ${JSON.stringify(got)}`);
  pass("kc-split-key-recipient1-opens");
} catch (e) { fail("kc-split-key-recipient1-opens", e); }
try {
  refused(() => env.openEnvelope(splitHex, keys[1].private_hex), "refused: envelope key commitment");
  pass("kc-split-key-recipient2-commitment");
} catch (e) { fail("kc-split-key-recipient2-commitment", e); }

// ---- validEnvelope: exact recipient set, in order (R10 item 1 product validation) ----
const signerKeyPair = generateKeyPairSync("ed25519");
const signerPem = signerKeyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const auction_id = rndHex(32);
const manifestObj = {
  version: 1, network: "test", auction_id, escrow_ua: "utest1" + rndHex(35),
  frost_group_key: rndHex(32), lot: "kc proof lot", supply: 5,
  reserve_zats: "0", tick_zats: "1000", B_max_zats: "50000", q_max: 10,
  C_zats: "500000", fee_zats: "0", deposit_addresses: ["utest1" + rndHex(35), "utest1" + rndHex(35), "utest1" + rndHex(35)],
  drand: { ...schema.QUICKNET, R: 32760000 }, T_submit: 1790000000, T_freeze: 1790000800, confirmations: 10,
  clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 },
  refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1",
  envelope_keys: recipients,
};
const packet = schema.signRecord(manifestObj, signerPem);
function docFor(envelopeCt) {
  const owner = env.generateOwnerKey(), nonce = randomBytes(16).toString("hex");
  const commitment = env.settlementCommitment(nonce, envelopeCt);
  const ciphertext_hash = createHash("sha256").update("kc-proof-ciphertext").digest("hex");
  const owner_sig = env.signEnvelope(owner, auction_id, ciphertext_hash, envelopeCt);
  const pt = Buffer.alloc(128); // PHASE-1 §6 layout: nonce@45, owner@61, commitment@93
  Buffer.from(nonce, "hex").copy(pt, 45);
  Buffer.from(owner.public_hex, "hex").copy(pt, 61);
  Buffer.from(commitment, "hex").copy(pt, 93);
  return {
    manifest: packet,
    frozen: { leaves: [{ leaf_index: 0, ciphertext_hash, deposit: { txid: rndHex(32), pool: "ironwood", address: "utest1" + rndHex(35), diversifier_index: "0" } }] },
    opened: [{ leaf_index: 0, plaintext_hex: pt.toString("hex") }],
    envelopes: [{ ciphertext_hash, envelope_ct: envelopeCt, owner_sig }],
  };
}
// control: the product shape (sealed to exactly the manifest's 3 keys, in order) is accepted
try {
  const got = settle.validEnvelope(docFor(env3), 0);
  need(got && got.envelope_ct === env3, `validEnvelope returned ${got === null ? "null" : "a record without the envelope"}`);
  pass("kc-3of3-accepted");
} catch (e) { fail("kc-3of3-accepted", e); }
// sealed to 1 of the 3 pinned keys -> refused
try {
  const got = settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[0]])), 0);
  need(got === null, "validEnvelope accepted a 1-of-3 envelope");
  pass("kc-1of3-refused");
} catch (e) { fail("kc-1of3-refused", e); }
// sealed to 2 of the 3 pinned keys -> refused
try {
  const got = settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[0], recipients[1]])), 0);
  need(got === null, "validEnvelope accepted a 2-of-3 envelope");
  pass("kc-2of3-refused");
} catch (e) { fail("kc-2of3-refused", e); }
// the 3 pinned keys out of order -> refused ("exactly ... in order")
try {
  const got = settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[1], recipients[0], recipients[2]])), 0);
  need(got === null, "validEnvelope accepted reordered recipient keys");
  pass("kc-reorder-refused");
} catch (e) { fail("kc-reorder-refused", e); }
// a third key the manifest does not pin -> refused
try {
  const got = settle.validEnvelope(docFor(env.sealEnvelope(UA, [recipients[0], recipients[1], env.generateEnvelopeKey().public_hex])), 0);
  need(got === null, "validEnvelope accepted an unpinned third key");
  pass("kc-wrongset-refused");
} catch (e) { fail("kc-wrongset-refused", e); }

console.log(failures === 0 ? "RESULT PASS all envelope key-commitment assertions" : `RESULT FAIL ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
