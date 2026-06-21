/**
 * In-circuit M-of-N org spend-auth → ON-CHAIN verify.
 * Builds a real 2-of-3 member-signed authorization proof (org_spend_auth) and
 * verifies it on the live verifier (ORGAUTH VK) — proving the dual-control proof
 * is on-chain-verifiable, the same way BALANCE/SUM/FUNDS are. Run:
 *   set -a; . ./.env; set +a; node tests/e2e/org-auth-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import { StellarCli, configFromEnv, prove, toWitnessInput, MerkleTreeMirror } from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const art = {
  wasmPath: `${repo}/circuits/build/org_spend_auth/org_spend_auth_js/org_spend_auth.wasm`,
  zkeyPath: `${repo}/circuits/build/org_spend_auth/org_spend_auth.zkey`,
};
const eddsa = await buildEddsa();
const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (xs) => F.toObject(poseidon(xs));
const log = (...a) => console.log(...a);

function member(seed) {
  const prv = Buffer.alloc(32, seed);
  const pub = eddsa.prv2pub(prv);
  const Ax = F.toObject(pub[0]), Ay = F.toObject(pub[1]);
  return { prv, Ax, Ay, keyId: H([Ax, Ay]) };
}

const SPEND = 123_456_789n;
const slots = [{ m: member(11), e: 1 }, { m: member(12), e: 1 }, { m: member(13), e: 0 }];
const tree = new MerkleTreeMirror(16);
const idx = slots.map((s) => tree.insert(s.m.keyId));
const root = tree.root();
const msgEl = F.e(SPEND);

const input = { orgMemberRoot: root, threshold: 2n, spendMessage: SPEND, authTag: H([SPEND, root]),
  enabled: [], Ax: [], Ay: [], S: [], R8x: [], R8y: [], pathElements: [], pathIndices: [] };
for (let i = 0; i < 3; i++) {
  const sig = eddsa.signPoseidon(slots[i].m.prv, msgEl);
  const p = tree.path(idx[i]);
  input.enabled.push(BigInt(slots[i].e));
  input.Ax.push(slots[i].m.Ax); input.Ay.push(slots[i].m.Ay);
  input.S.push(sig.S); input.R8x.push(F.toObject(sig.R8[0])); input.R8y.push(F.toObject(sig.R8[1]));
  input.pathElements.push(p.pathElements); input.pathIndices.push(BigInt(p.pathIndices));
}

log("=== in-circuit M-of-N → on-chain verify ===");
log("[1] proving 2-of-3 org spend authorization on-device…");
const res = await prove(art, toWitnessInput(input));
log(`    proof generated (${res.sorobanPublics.length} public inputs)`);

log("[2] verifier.verify_proof(ORGAUTH) on-chain…");
const ok = await cli.view(dep.verifier, "benzo-deployer", [
  "verify_proof", "--vk_id", "ORGAUTH",
  "--proof", JSON.stringify(res.sorobanProof),
  "--public_inputs", JSON.stringify(res.sorobanPublics),
]);
log(`    verify_proof ORGAUTH => ${ok}`);
if (ok !== true) { console.error("❌ M-of-N auth proof did NOT verify on-chain"); process.exit(1); }
log("✅ in-circuit M-of-N dual-control proof VERIFIED ON-CHAIN");
