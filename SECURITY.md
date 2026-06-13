# Security Policy — Benzo

> **Status: testnet prototype, unaudited. Do not use with mainnet funds.**

## Scope
Benzo is a shielded-USDC payments protocol on Stellar (Soroban): Groth16/BN254
verifier, Poseidon2 commitments, an incremental Merkle tree, nullifier set, ASP
membership/non-membership, viewing-key disclosure, and a gasless relayer.

## Trust model & assumptions
- **Soundness** rests on (a) the Groth16 verifier doing a real BN254 pairing
  check (no accept-all), (b) the circuits enforcing value conservation,
  correct nullifier derivation, and Merkle membership, and (c) **Poseidon2
  parameter byte-identity** across circuit / SDK / the CAP-0075 host function.
- **Nullifiers** live in *persistent* storage only; an archived persistent
  entry can never be re-created, so a lapsed TTL cannot re-enable a double-spend.
- **Trusted setup**: Groth16 uses a public Phase-1 (Hermez) + a Phase-2
  contribution. A production deployment requires a real multi-party ceremony;
  see `ceremony/` for the transcript of the contribution(s) used.
- **Relayer** is non-custodial: its address and fee are bound into the proof's
  `ext_data_hash`, so it cannot alter amounts or recipients.

## Known limitations (tracked)
- No external audit yet. No mainnet deployment. Fiat leg of the corridor is
  simulated. See `docs/THREAT_MODEL.md` for the full threat model.

## Reporting
This is a research prototype. File issues in the repo; do not place real funds
at risk. For a production deployment, route disclosures to a dedicated security
contact and run a bug bounty before mainnet.

## Verification you can run
- `cargo test --workspace` — contract + circuit-hash invariants.
- `pnpm -r test` — SDK crypto/circuit parity (Poseidon2 byte-identity, snarkjs↔Soroban encoding).
- The deployed verifier rejects tampered proofs — see `docs/THREAT_MODEL.md` for the live tamper-test commands.
