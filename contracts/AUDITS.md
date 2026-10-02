# Cross-chain dependencies: pins and audit status

Phase 5 part 3 (`docs/design/crosschain.md`) — "audited code wherever possible", every dependency
pinned exactly, audit status per dependency. Changing a pin needs a Ruling. This file is updated as
each step lands; tool versions are those of the run logs in `contracts/logs/`.

## contracts/evm (step 1)

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `@openzeppelin/contracts` | `5.6.0` (npm, `contracts/evm/package-lock.json`) | `ECDSA`, `MessageHashUtils` (EIP-712 digest), `MerkleProof`/`Hashes` (sorted-pair proof), `IERC20`, `SafeERC20` | **Audited.** OpenZeppelin audit Feb 2026, commit `68e4095`, scope "v5.5 & v5.6 Changes" incl. SafeERC20, ECDSA, SignatureChecker (contracts.openzeppelin.com security center / `audits/` in the OZ repo); `MerkleProof`/`Hashes` unmodified in 5.5/5.6 and covered by the standing v5.x library audit history (e.g. 2023-10 v5.0 report) |
| `forge-std` | `1.9.7` (vendored `contracts/evm/lib/forge-std/src` from `foundry-rs/forge-std@77041d2ce690e692d6e03cc812b57d1ddaa4d505`) | Foundry test harness (`Test`, `Vm` cheatcodes) | **Unaudited — test-only**, never deployed or shipped |
| solc | `0.8.30` (pinned in `contracts/evm/foundry.toml`) | Compiler | Compiler tooling, not a runtime dependency |
| Foundry (`forge`, `anvil`, `cast`) | `1.5.1-stable` (commit `b0a9dd9c`) | Build/test toolchain, local EVM | Tooling, not a runtime dependency |

`BenzoEscrow.sol` itself is **not audited**. It uses no custom cryptography: ECDSA recovery and
EIP-712 digesting come from OpenZeppelin (`ECDSA` rejects high-`s` malleable signatures).

## contracts/solana (step 2)

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `solana-program` | `=2.3.0` (`contracts/solana/Cargo.lock`) | Program framework, checked instructions sysvar, Ed25519 program ID, system-program CPI | Agave/Solana runtime crates carry audit history (Neodyme 2021, Halborn 2022 program-library reviews); the BPF loader and Ed25519 verify program are runtime built-ins. No public audit found for this exact crate revision — recorded honestly here |
| `solana-keccak-hasher` | `=2.2.1` (`contracts/solana/Cargo.lock`) | keccak256 leaves/roots (same hash as the EVM side) | Same runtime-crate note as above |
| serialization | none — hand-rolled fixed-length layout | Instruction + attestation encoding | n/a (design §1 "fixed byte layout"); offsets parsed with explicit bounds checks |
| Ed25519 signature verification | native `Ed25519SigVerify1111111111111111111111111` program + instructions sysvar | 2-of-3 attestation checks | Native runtime program (not third-party code); offset semantics read from `anza-xyz/agave@v4.3.0:precompiles/src/ed25519.rs` |
| solana-cli / `cargo-build-sbf` / `solana-test-validator` | `4.3.0` / `4.4.0` (platform-tools v1.57) | Build and local chain tooling | Tooling, not a runtime dependency |

## crosschain/ + cli (step 3)

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `@noble/hashes` | `1.8.0` (existing root lock) | keccak256 leaves/roots | Audited (Noble, third-party review of the noble line; widely deployed) |
| `@noble/curves` | `1.9.7` (existing root lock) | ed25519 attestation signing | Audited (as above) |
| `ethers` | `6.17.0` (root `package.json`, exact) | EIP-712 typed-data signing, anvil RPC | Unaudited client tooling (not deployed) |
| `@solana/web3.js` | `1.99.0` (root `package.json`, exact) | test-validator RPC, tx building | Unaudited client tooling (not deployed) |

## Later steps (not yet landed)

Railgun (`@railgun-community/engine` for shield-request building) and Token-2022 confidential
transfer come in steps 4–5 with their own pins and audit notes (Railgun: Zokyo 2022-12-21 covers
the deployed v2 `shield()`; see `zcash/research/benzo-ideas/UMBRA-RAILGUN-VERIFY.md` §B3).
