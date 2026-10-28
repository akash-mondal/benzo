// The shipped verifier (dist/benzo-verify.mjs) against two recorded testnet rounds, and the tampering it must catch.
// Run: npm test. Offline: every check uses the published record and the beacon inside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const VERIFY = path.join(ROOT, "dist/benzo-verify.mjs");
const EXAMPLE = path.join(ROOT, "docs/evidence/verify-example/public");
const LAUNCH = path.join(ROOT, "docs/evidence/launch-round");
const signerOf = (dir) => JSON.parse(readFileSync(path.join(dir, "auction.json"), "utf8")).signer;

const verify = (dir, signer = signerOf(dir)) => {
  const r = spawnSync(process.execPath, [VERIFY, "--dir", dir, "--signer", signer], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

// A scratch copy of a round with one change made to its published auction.json.
const tampered = (dir, change) => {
  const copy = mkdtempSync(path.join(tmpdir(), "benzo-test-"));
  cpSync(dir, copy, { recursive: true });
  const file = path.join(copy, "auction.json"), doc = JSON.parse(readFileSync(file, "utf8"));
  change(doc);
  writeFileSync(file, JSON.stringify(doc));
  return copy;
};
const flip = (hex) => hex.slice(0, 10) + (hex[10] === "0" ? "1" : "0") + hex.slice(11);

test("a recorded uniform-price round verifies: every check passes", () => {
  const { code, out } = verify(EXAMPLE);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /^ERROR/m);
  assert.ok(out.split("\n").filter((l) => l.startsWith("OK")).length >= 19, out);
});

test("a recorded token launch verifies, delivery list included", () => {
  const { code, out } = verify(LAUNCH);
  assert.equal(code, 0, out);
  assert.match(out, /^OK delivery-list$/m);
});

test("an opening changed by one digit is refused: openings are re-derived from the sealed bids", () => {
  const dir = tampered(EXAMPLE, (d) => { d.opened[0].plaintext_hex = flip(d.opened[0].plaintext_hex); });
  try { const { code, out } = verify(dir); assert.equal(code, 1); assert.match(out, /opening 0 published differs from re-derived/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a forged drand signature is refused before anything is decrypted", () => {
  const dir = tampered(EXAMPLE, (d) => { d.beacon.signature = flip(d.beacon.signature); });
  try {
    const b = JSON.parse(readFileSync(path.join(dir, "beacon.json"), "utf8")); b.signature = flip(b.signature);
    writeFileSync(path.join(dir, "beacon.json"), JSON.stringify(b));
    const { code, out } = verify(dir); assert.equal(code, 1); assert.match(out, /beacon BLS signature invalid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a different trust anchor is refused", () => {
  const other = signerOf(EXAMPLE).replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  const { code, out } = verify(EXAMPLE, other);
  assert.equal(code, 1, out);
});

test("an address anywhere in the public record fails no-destinations", () => {
  const ua = "utest1" + "qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(4);
  const dir = tampered(EXAMPLE, (d) => { d.settlement.rows[0].note = ua; });
  try { const { code, out } = verify(dir); assert.equal(code, 1); assert.match(out, /^ERROR no-destinations/m); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a frozen bid without its admission receipt is refused", () => {
  const dir = tampered(EXAMPLE, (d) => { d.receipts = d.receipts.slice(1); });
  try { const { code, out } = verify(dir); assert.equal(code, 1); assert.match(out, /has no admission receipt/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a changed clearing price is refused: the result is re-cleared from the openings", () => {
  const dir = tampered(EXAMPLE, (d) => { d.result.clearing_price_zats = String(Number(d.result.clearing_price_zats) + 10); });
  try { const { code, out } = verify(dir); assert.equal(code, 1, out); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
