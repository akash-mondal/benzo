# Audits

No external audit has been performed yet (testnet prototype). This directory is
the home for third-party audit reports prior to any mainnet deployment.

## Self-verification performed
- Adversarial verifier soundness: valid proof → `true`; tampered public input,
  off-curve point, swapped points, and wrong-VK all rejected on the live testnet
  verifier (no accept-all). Commands in `docs/THREAT_MODEL.md`.
- Circuit constraints reviewed for value conservation, nullifier derivation,
  Merkle membership, and 64-bit range checks (inputs + outputs).
- Poseidon2 byte-identity asserted across circuit / SDK / CAP-0075 host fn (fuzzed).

## Required before mainnet
- [ ] Independent circuit audit (Groth16 circuits + Poseidon2 parameterization)
- [ ] Independent Soroban contract audit (pool, verifier, nullifier, ASP, registry)
- [ ] Multi-party trusted-setup ceremony with published transcript (`ceremony/`)
- [ ] Bug bounty
