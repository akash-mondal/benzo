# Benzo: dependency pins, audit status, and custom security-relevant code

Rule (AGENTS.md, user 2026-10-02): audited first, audit hard when custom. This file lists every
dependency with its pinned version and audit status, and every custom security-relevant file with
the reason no audited option fits. Changing a pin needs a Ruling. Tool versions are those of the
run logs in `contracts/logs/`.

## Assets allowlist (escrow contracts)

`BenzoEscrow.sol` and the Solana escrow accept **plain ERC-20/ERC-721 (and native ETH/SOL) only —
no fee-on-transfer tokens, no rebasing tokens, no tokens with transfer hooks or callbacks beyond
the ERC-20 interface.** `lock()` measures the escrow's `balanceOf` before and after
`safeTransferFrom` and reverts (`BadParameters`) unless the delta equals `amount`
(reviewer finding F5), so a token that delivers less than the nominal amount can never fund an
auction. The signed manifest pins the exact asset; the deployer/crank must list only plain assets.
Solana delivery uses native SOL, plain SPL (Token program) or Token-2022 accounts Benzo itself
configures — no third-party fee semantics.

## Dependencies

### contracts/evm

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `@openzeppelin/contracts` | `5.6.0` (npm, `contracts/evm/package-lock.json`) | `ECDSA`, `MessageHashUtils` (EIP-712 digest), `MerkleProof`/`Hashes` (sorted-pair proof), `IERC20`, `SafeERC20`, `ReentrancyGuard` | **Audited.** OpenZeppelin audit Feb 2026, commit `68e4095`, scope "v5.5 & v5.6 Changes" incl. SafeERC20, ECDSA, SignatureChecker (contracts.openzeppelin.com security center / `audits/` in the OZ repo); `MerkleProof`/`Hashes` unmodified in 5.5/5.6 and covered by the standing v5.x library audit history (e.g. 2023-10 v5.0 report) |
| `forge-std` | `1.9.7` (vendored `contracts/evm/lib/forge-std/src` from `foundry-rs/forge-std@77041d2ce690e692d6e03cc812b57d1ddaa4d505`) | Foundry test harness (`Test`, `Vm` cheatcodes) | **Unaudited — test-only**, never deployed or shipped |
| solc | `0.8.30` (pinned in `contracts/evm/foundry.toml`) | Compiler | Compiler tooling, not a runtime dependency |
| Foundry (`forge`, `anvil`, `cast`) | `1.5.1-stable` (commit `b0a9dd9c`) | Build/test toolchain, local EVM | Tooling, not a runtime dependency |

### contracts/solana

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `solana-program` | `=2.3.0` (`contracts/solana/Cargo.lock`) | Program framework, checked instructions sysvar, Ed25519 program ID, system-program CPI | Agave/Solana runtime crates carry audit history (Neodyme 2021, Halborn 2022 program-library reviews); the BPF loader and Ed25519 verify program are runtime built-ins. No public audit found for this exact crate revision — recorded honestly here |
| `solana-keccak-hasher` | `=2.2.1` (`contracts/solana/Cargo.lock`) | keccak256 leaves/roots (same hash as the EVM side) | Same runtime-crate note as above |
| serialization | none — hand-rolled fixed-length layout | Instruction + attestation encoding | n/a (design §1 "fixed byte layout"); offsets parsed with explicit bounds checks |
| Ed25519 signature verification | native `Ed25519SigVerify1111111111111111111111111` program + instructions sysvar | 2-of-3 attestation checks | Native runtime program (not third-party code); offset semantics read from `anza-xyz/agave@v4.3.0:precompiles/src/ed25519.rs` |
| solana-cli / `cargo-build-sbf` / `solana-test-validator` | `4.3.0` / `4.4.0` (platform-tools v1.57) | Build and local chain tooling | Tooling, not a runtime dependency |

### crosschain/ + cli (client)

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `@noble/hashes` | `1.8.0` (root lock) | keccak256 leaves/roots | Audited (Noble, third-party review of the noble line; widely deployed) |
| `@noble/curves` | `1.9.7` (root lock) | ed25519 attestation signing | Audited (as above) |
| `ethers` | `6.17.0` (root `package.json`, exact) | EIP-712 typed-data signing, RPC | Unaudited client tooling (not deployed) |
| `@solana/web3.js` | `1.99.0` (root `package.json`, exact) | RPC, tx building | Unaudited client tooling (not deployed) |

## Custom security-relevant code

Each file below is hand-written because no audited option implements Benzo's protocol; the
audited building blocks it composes are named above. Hard review by Reviewer R is required before
merge with no open confirmed P0/P1: P0 (re-entrant double payment) fixed at `7e3ac29` and
head-verified (21/21 forge tests incl. the reviewer's repro); P1/F5 (fee-on-transfer drain) fixed
with the lock balance-delta check and proven by the reviewer's own `FeeTokenDrain.t.sol`
(fails on the old code, passes after).

| File | What it does | Why no audited option fits |
|---|---|---|
| `contracts/evm/src/BenzoEscrow.sol` | Escrow custody: lock, 2-of-3 EIP-712 release, per-recipient paid flags, refund | No audited escrow releases on 2-of-3 attestations of an external clearing result with per-leaf Merkle payouts; all cryptography (ECDSA, EIP-712 digest, MerkleProof) and SafeERC20/ReentrancyGuard come from audited OpenZeppelin, unmodified |
| `contracts/solana/src/lib.rs` | Solana escrow program: lock, release (2-of-3 Ed25519 via the checked instructions sysvar), refund | No audited program verifies 2-of-3 signers over a fixed 200-byte attestation through the native Ed25519 program; the signature check itself is the audited native runtime program, not custom crypto |
| `crosschain/leaf.ts` | Canonical leaf/root/tree encoding (design §3) | Protocol-specific encoding; no library defines it. Uses audited `@noble/hashes` keccak |
| `crosschain/attestation.ts` | Domain-separated attestation bytes (EIP-712 fields; Solana 200-byte layout) | Protocol-specific message format (design §1); no library provides it |
| `crosschain/evm.ts`, `crosschain/solana.ts` | Chain clients for `benzo xchain lock|attest|release|refund|status` | Thin drivers over ethers/@solana/web3.js and the contracts above; no custody logic beyond what the contracts enforce |
| `cli/commands/xchain.ts` | CLI wiring for the above | As above |
| `contracts/evm/test/TestToken.sol` | **Test-only fixture**: plain ERC-20 (OpenZeppelin audited `ERC20` base, open `mint`) deployed on Ethereum Sepolia for the design §7 step-5 testnet run | A mintable demo token is the run's asset; no audited option is needed because it holds no custody and obeys the assets allowlist (no fee, no rebase, no hooks) |

## Later steps (not yet landed)

Railgun (`@railgun-community/engine` for shield-request building) and Token-2022 confidential
transfer come in design §7 steps 4 with their own pins and audit notes (Railgun: Zokyo 2022-12-21
covers the deployed v2 `shield()`; see `zcash/research/benzo-ideas/UMBRA-RAILGUN-VERIFY.md` §B3).
