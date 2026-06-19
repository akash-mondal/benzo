# Live testnet proving suite

These tests move **real testnet USDC** through the wallet UI and verify proofs
**on-chain**. They are separate from the deterministic UI suite
(`playwright.config.ts`, demo-mode) because they need live infrastructure and are
slow (real Groth16 + Soroban + the enclave round-trip).

## Run

```bash
# .env must hold SOROBAN_RPC_URL + DEPLOYER_SECRET; the BFF auto-loads it.
pnpm exec playwright test -c playwright.live.config.ts
```

## What's verified live

| Path | How | Status |
| --- | --- | --- |
| **Shield (add money)** | settles a real public→shielded transfer on testnet; shielded balance increases | ✅ `proving.spec.ts` |
| **Unshield (cash out)** | settles a real shielded→public withdrawal; shielded balance decreases | ✅ `proving.spec.ts` |
| **Transfer (send / joinsplit)** | settles a real private transfer to a registered `@handle` | ✅ `proving.spec.ts` |
| **LOCAL proving (on-device)** | the ops above generate real Groth16 proofs with `NodeProver`/`WasmProver`, verified on-chain | ✅ `proving.spec.ts` + `packages/core` `wasm.test.ts` |
| **TEE proving (attested enclave)** | `node tests/e2e/tee-onchain.mjs` proves `funds_attestation` + `kyc_credential` INSIDE the attested Phala TDX enclave; both `verify_proof => true` on-chain; wrong measurement withholds the witness | ✅ `tee-onchain.mjs` |
| **Device-aware routing** | desktop → on-device WASM, mobile/weak → attested TEE | ✅ `packages/core` `browser-prover.test.ts` |

The send test targets `@benzowallet` — register it once on the live handle registry
(`BenzoClient.registerHandle({ handle: "benzowallet" })`) for the account the BFF uses.

```bash
# the live TEE → on-chain proof (standard-size circuits)
set -a; . ./.env; set +a
export BENZO_PROVER_ENDPOINT="$(node -p "require('./deployments/testnet.json').tee.endpoint")"
node tests/e2e/tee-onchain.mjs
```

## Operational notes

- **Pool-tree completeness (RPC retention).** Transfer/unshield build a note's
  Merkle membership proof from the off-chain pool-tree mirror, which must match the
  on-chain tree. The merkle contract keeps only the right-frontier + a 128-root
  ring + a leaf-presence index (no ordered leaf set), so the ordered leaves come
  from `new_commitment_event`s, which age out of the RPC event window (~7 days).
  The BFF's **durable store** (`~/.benzo/state.json`) retains them beyond that
  window — but only if it has tracked the tree continuously from the deployment's
  genesis. If that store is ever lost/incomplete *after* events age out, transfer
  /unshield can't be rebuilt from RPC; the fix is a persistent indexer
  (`packages/indexer`) or a **fresh deployment** (`scripts/deploy-testnet.sh`),
  whose tree the durable store then keeps complete. (Shield is always fine — it
  only inserts a new commitment.)
- **TEE + large circuits**: the enclave reliably proves the standard-size circuits
  (`funds_attestation`, `kyc_credential`); the depth-32 transfer circuits are
  enclave resource-flaky, so the standard-size circuits are the on-chain TEE
  evidence (the wallet's TEE picker routes those reliably).
