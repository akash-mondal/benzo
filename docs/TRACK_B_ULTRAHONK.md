# Track B — Noir → UltraHonk, verified on Stellar testnet

Benzo proves shielded statements two independent ways. **Track A** is Groth16
over BN254 using Protocol-25 native host functions (`bn254_multi_pairing_check`),
already wired into the `pool` + `verifier_groth16` contracts and exercised
against live testnet. **Track B**, recorded here, is a transparent
**Noir → UltraHonk** proof verified by a Soroban contract — no per-circuit
trusted setup, which de-risks the Track-A ceremony for the long term.

This is not a stub. A real proof was generated and **verified on-chain on
Stellar testnet**, and a tampered proof was **rejected on-chain**.

## What was proven

The `identity` circuit proves knowledge of a Poseidon2 preimage — *exactly*
Benzo's commitment primitive (`commitment = Poseidon2(amount, recipient_pk,
blinding, asset_id)`):

```noir
use dep::poseidon::poseidon2::Poseidon2;
fn main(preimage: Field, hash: pub Field) {
    let computed_hash = Poseidon2::hash([preimage], 1);
    assert(computed_hash == hash);   // public: hash, private: preimage
}
```

## Toolchain (pinned — byte formats are version-specific)

| Tool  | Version          | Why pinned |
|-------|------------------|------------|
| nargo | `1.0.0-beta.9`   | ACIR/witness format the verifier crate expects |
| bb    | `v0.87.0`        | UltraHonk proof + VK serialization the verifier parses |

bb after v0.87.0 changes the proof/VK layout; newer binaries produce proofs the
on-chain verifier cannot parse. Install exactly these.

## Proving commands (UltraHonk, keccak oracle)

```bash
nargo compile && nargo execute
bb prove    --scheme ultra_honk --oracle_hash keccak \
            --bytecode_path target/identity.json --witness_path target/identity.gz \
            --output_path target --output_format bytes_and_fields
bb write_vk --scheme ultra_honk --oracle_hash keccak \
            --bytecode_path target/identity.json \
            --output_path target --output_format bytes_and_fields
```

Artifact sizes: proof **14,592 B**, VK **1,760 B**, public_inputs **32 B**.

## On-chain result (Stellar testnet)

| Item | Value |
|------|-------|
| Verifier contract | `CBNKNOC45EEDNTBS2OWKXAVRKQRAKU4K3X6XTIMZ5BI5WISN7GDBZBBE` |
| Source account | `GBP3U325BQASMHDZVFJISCGR3G45IBJOIE7XGXLFQVD5JRL4ZA7MUGLD` |
| Deploy | VK embedded at construction (`--vk_bytes-file-path target/vk`) |
| **Valid proof** | `prove_identity` → success, tx `52959d1d86f9561d79fd4af339ac6e78241edbf1c58bc77d35245a5df5c447ad` |
| **Tampered proof** | one flipped byte → **rejected**, `HostError: Error(Contract, #4)` — fail-closed |

The valid/tampered split is the property that matters: the verifier accepts only
a genuine proof and rejects everything else, on-chain.

## Reproduce

The full harness lives in `reference/code/rs-soroban-ultrahonk` (gitignored
vendor copy). With nargo `1.0.0-beta.9` + bb `v0.87.0` on PATH:

```bash
cd reference/code/rs-soroban-ultrahonk
NARGO=~/.nargo/bin/nargo BB=~/.bb087/bb just identity-e2e testnet
```

## Why Benzo keeps both tracks

- **Track A (Groth16)** — smallest proofs / cheapest verify today via native
  BN254 host functions; the production path for the join-split circuit.
- **Track B (UltraHonk)** — transparent (no trusted setup), so new circuits
  ship without a ceremony. Held as the migration path and a hedge against any
  Track-A setup concern. Both are now demonstrated on testnet.
