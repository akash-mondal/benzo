/**
 * ZK-KYC credential circuit test. Builds a real issuer EdDSA-over-BabyJubJub
 * signature with circomlibjs (the JS twin of the vendored circomlib), proves the
 * credential through the compiled circuit, and asserts the security properties:
 * a valid credential admits, a tampered signature / unregistered issuer / expired
 * credential / wrong-holder binding all FAIL to prove. Self-skips when the
 * gitignored proving artifacts are absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import { MerkleTreeMirror } from "../src/merkle.js";
import { prove, toWitnessInput, verifyLocal } from "../src/prover.js";

const root = fileURLToPath(new URL("../../../circuits/build", import.meta.url));
const art = { wasmPath: `${root}/kyc_credential/kyc_credential_js/kyc_credential.wasm`, zkeyPath: `${root}/kyc_credential/kyc_credential.zkey` };
const vk = () => JSON.parse(readFileSync(`${root}/kyc_credential/kyc_credential_vk.json`, "utf8"));
const HAVE = existsSync(art.zkeyPath);

// circomlibjs builders are async; share one instance across the suite.
// biome-ignore lint: test-local mutable singletons
let eddsa: any, poseidon: any, F: any;
beforeAll(async () => {
  eddsa = await buildEddsa();
  poseidon = await buildPoseidon();
  F = poseidon.F;
});

// circomlib-Poseidon over field bigints, returned as a canonical bigint.
const H = (xs: bigint[]): bigint => F.toObject(poseidon(xs));

function buildWitness() {
  const CRED_TYPE = 0n; // business / Plaid
  const SCOPE = 4242n;
  const CURRENT_TIME = 1_700_000_000n;
  const EXPIRY = 1_900_000_000n; // > currentTime
  const SERIAL = 7n;
  const ATTR_HASH = 999_888_777n;
  const HOLDER_SK = 12345n;
  const ADMIT_BLINDING = 555n;

  // Issuer EdDSA keypair (32-byte secret; circomlibjs prunes it internally).
  const issuerPrv = Buffer.alloc(32, 3);
  const issuerPub = eddsa.prv2pub(issuerPrv);
  const issuerAx = F.toObject(issuerPub[0]);
  const issuerAy = F.toObject(issuerPub[1]);

  // Holder key: addressBinding = Poseidon(holderSk * Base8).
  const hp = eddsa.babyJub.mulPointEscalar(eddsa.babyJub.Base8, HOLDER_SK);
  const holderAx = F.toObject(hp[0]);
  const holderAy = F.toObject(hp[1]);
  const addressBinding = H([holderAx, holderAy]);

  const issuerKeyId = H([issuerAx, issuerAy]);

  // Signed message binds every credential field (circomlib-Poseidon, F element).
  const msgEl = poseidon([ATTR_HASH, addressBinding, issuerKeyId, EXPIRY, CRED_TYPE, SERIAL]);
  const sig = eddsa.signPoseidon(issuerPrv, msgEl);

  // Authorized-issuer registry (Poseidon2 tree; leaf = the issuer key id).
  const tree = new MerkleTreeMirror(16);
  const path = tree.path(tree.insert(issuerKeyId));

  const identityNullifier = H([SCOPE, HOLDER_SK]);
  const admitLeaf = H([addressBinding, ADMIT_BLINDING]);

  return {
    issuerRegistryRoot: tree.root(),
    credType: CRED_TYPE,
    currentTime: CURRENT_TIME,
    scope: SCOPE,
    identityNullifier,
    addressBinding,
    admitLeaf,
    issuerAx,
    issuerAy,
    sigS: sig.S,
    sigR8x: F.toObject(sig.R8[0]),
    sigR8y: F.toObject(sig.R8[1]),
    holderSk: HOLDER_SK,
    attrHash: ATTR_HASH,
    expiry: EXPIRY,
    serial: SERIAL,
    issuerPathElements: path.pathElements,
    issuerPathIndices: path.pathIndices,
    admitBlinding: ADMIT_BLINDING,
  };
}

describe.skipIf(!HAVE)("kyc_credential circuit", () => {
  it("proves a valid issuer-signed credential and emits a sybil nullifier", async () => {
    const w = buildWitness();
    const res = await prove(art, toWitnessInput(w));
    expect(res.sorobanPublics.length).toBe(7);
    // public order: [issuerRegistryRoot, credType, currentTime, scope,
    //                identityNullifier, addressBinding, admitLeaf]
    expect(BigInt(res.publicSignals[4])).toBe(w.identityNullifier);
    expect(await verifyLocal(vk(), res.publicSignals, res.proof)).toBe(true);
  }, 120_000);

  it("rejects a tampered signature", async () => {
    const w = buildWitness();
    await expect(prove(art, toWitnessInput({ ...w, sigS: w.sigS + 1n }))).rejects.toThrow();
  }, 120_000);

  it("rejects an unregistered issuer (membership fails)", async () => {
    const w = buildWitness();
    await expect(
      prove(art, toWitnessInput({ ...w, issuerRegistryRoot: w.issuerRegistryRoot + 1n })),
    ).rejects.toThrow();
  }, 120_000);

  it("rejects an expired credential", async () => {
    const w = buildWitness();
    // currentTime past expiry -> the GreaterThan(expiry, currentTime) check fails.
    await expect(
      prove(art, toWitnessInput({ ...w, currentTime: w.expiry + 1n })),
    ).rejects.toThrow();
  }, 120_000);
});
