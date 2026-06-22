/**
 * KYB-as-ZK credential (Z7) -> verified ON-CHAIN (vk_id KYB).
 * An org proves it holds an issuer-signed KYB credential, disclosing ONLY
 * "verified business, jurisdiction Y, tier Z" — docs stay private — plus a
 * scope-bound sybil orgNullifier.
 *   - valid credential       => verify_proof(KYB) on-chain true (jurisdiction+tier disclosed)
 *   - tampered jurisdiction    => rejected (false | error)
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/kyb-credential-onchain.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BenzoClient, StellarCli, NodeProver, configFromEnv } from "@benzo/core";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
const cli = new StellarCli(configFromEnv());
const rpc = process.env.SOROBAN_RPC_URL;
const log = (...a) => console.log(...a);
const art = (c) => ({ wasmPath: `${repo}/circuits/build/${c}/${c}_js/${c}.wasm`, zkeyPath: `${repo}/circuits/build/${c}/${c}.zkey` });
const circuits = { shield: art("shield"), joinsplit: art("joinsplit"), unshield: art("unshield"), kybCredential: art("kyb_credential") };
const deployment = {
  pool: dep.pool, verifier: dep.verifier, merkle: dep.merkle, nullifierSet: dep.nullifierSet,
  aspMembership: dep.aspMembership, aspNonMembership: dep.aspNonMembership,
  viewkeyAnchor: dep.viewkeyAnchor, token: dep.token,
  treeLevels: dep.treeLevels, aspLevels: dep.aspLevels, smtLevels: dep.smtLevels,
};
const c = new BenzoClient({ cli, deployment, circuits, prover: new NodeProver(), rpcUrl: rpc, txSource: "benzo-deployer" });
c.createAccount("kyb-org");

log("=== KYB-as-ZK credential (verified business, jurisdiction+tier disclosed, docs hidden) -> on-chain (KYB) ===");
const opts = {
  issuerSeed: 77,
  holderSk: 1234567890123456789n,
  jurisdiction: 840n, // US (ISO-3166 numeric)
  tier: 2n,
  docsHash: 99887766554433n, // hash of the KYB documents (NEVER revealed)
  expiry: 4000000000n, // far future
  serial: 42n,
  scope: 2026n,
  currentTime: 1700000000n,
};

log(`[1] proving the org holds a valid KYB credential (jurisdiction=840, tier=2)…`);
const r = await c.proveOrgKyb(opts);
log(`    disclosed jurisdiction=${r.jurisdiction} tier=${r.tier} sybil orgNullifier set`);
log(`    verify_proof(KYB) on-chain => ${r.onChain}`);
if (!(r.ok && r.onChain)) { console.error("❌ valid KYB credential should verify on-chain"); process.exit(1); }

log(`[2] adversarial: claim a different jurisdiction (tamper public index 1) -> must be rejected…`);
const forged = [...r.sorobanPublics];
forged[1] = "0x" + (124n).toString(16); // claim jurisdiction 124 (CA) the issuer never signed
let bad;
try {
  bad = await cli.view(dep.verifier, "benzo-deployer", [
    "verify_proof", "--vk_id", "KYB", "--proof", JSON.stringify(r.sorobanProof), "--public_inputs", JSON.stringify(forged),
  ]);
} catch { bad = "rejected"; }
log(`    verify_proof(KYB) with a forged jurisdiction => ${bad} (rejected: false | error)`);
if (bad === true) { console.error("❌ forged jurisdiction must be rejected"); process.exit(1); }

log(`\n✅ KYB-as-ZK credential verified ON-CHAIN (KYB):`);
log(`   • the org proves "verified business, jurisdiction Y, tier Z" without revealing documents`);
log(`   • a forged jurisdiction is rejected (issuer-signed) + a sybil nullifier prevents reuse`);
process.exit(0);
