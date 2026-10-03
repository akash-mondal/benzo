# Benzo: dependency pins, audit status, and custom security-relevant code

Rule (AGENTS.md, user 2026-10-02): audited first, audit hard when custom. This file lists every
dependency with its pinned version and audit status, and every custom security-relevant file with
the reason no audited option fits. Changing a pin needs a Ruling. Tool versions are those of the
run logs in `contracts/logs/`.

## Assets allowlist (escrow contracts)

`BenzoEscrow.sol` and the Solana escrow accept **plain ERC-20/ERC-721 (and native ETH/SOL) only —
no fee-on-transfer tokens, no rebasing tokens, no tokens with transfer hooks or callbacks beyond
the ERC-20 interface.** Two separate mechanisms enforce that, and neither covers the other's
blind spot:

1. `lock()` measures the escrow's `balanceOf` before and after `safeTransferFrom` and reverts
   (`BadParameters`) unless the delta equals `amount` (reviewer finding F5). This stops
   fee-on-transfer and deflationary-on-transfer tokens **at lock**: a token that delivers less
   than the nominal amount can never fund an auction.
2. What the delta check **cannot** stop is a token that delivers `amount` at lock and deflates or
   takes fees later (rebase-down, fee-on-out, transfer hooks beyond the ERC-20 interface).
   Excluding those is the job of the **manifest asset allowlist**: the signed manifest pins the
   exact asset, and the deployer/crank must list only plain assets.

Solana delivery uses native SOL, plain SPL (Token program) or Token-2022 accounts Benzo itself
configures — no third-party fee semantics.

## Deployed escrow programs (testnet)

A program version that changes an account layout or marker deploys under a **new program ID**,
never as an in-place upgrade over live auctions (R9 item 1). The Solana state records its
account-layout version and every instruction checks it; EVM escrows are redeployed per change.

| chain | program | status |
|---|---|---|
| Solana devnet | `2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu` (ProgramData `EYPDHi1uJU8ksJEWzt1SbJyEjpzYdBAkpWyemeeRNbsV`) | **current** — layout v2 + R14 item 1 fixes (`ViaCpi`, `MessageNotSelf`); 102,840 bytes, so sha256 `84fd87b726baa0ea007774cb9588f81f9ec077c58809323ce70b3072094e8bc6`; deploy tx `5KPMPtffZPCmUAmg5eJYSDrH73yjpw3BPFjWj5sECDibLYGR7pdSEKvdTJeKM1avMSLNLP4Q4LCaRAEtopdbfBQV`; upgrade authority `3EM3LMNYrs2iUfC9FkoutJcErmuPd8zUtRBMCkhLkpdu`; one live devnet cycle 2026-10-03 (STATUS-B R14 item 3) |
| Solana devnet | `AE1LQwTyvPmjoTNdX2b7krH2yBejUgjnBdmGYpB9yna4` (ProgramData `HxCEzNaJmjDn3oA9pMjshoctkr32iywgNAKdVMC1tFQm`) | **closed** (R14 head unblock; carried the R14 CPI-forgery P0) — close tx `5CiZmsXFgph3qG7FJUVFmye17tjFbtLyAPyLqLYeMtJWzdyPW7C1VMfjWjtqC4Giz7ySuFPhLCob6MFLDVoCXho`, 0.52033932 SOL reclaimed; was layout v2, 102,256 bytes, sha256 `48870cc9…c2673` |
| Solana devnet | `2Wh8X6dfqwYu45GAxYHW95VJEKjDxbhbANxTy9F7Lrt4` | **closed** (R14 head unblock) — close tx `4uckQB5BcZraQ8UGiDMSMGK2LW9spt8oaC1arV3KDuCSnBpcPdyxnVKvmTnTwX1f5LY4edmHQYnUMQVn7XSz92Nu`, 0.56540908 SOL reclaimed; was SUPERSEDED (pre-layout-version build) |
| Solana devnet | `58SsWZaW2eBq1z1bnH1xPNXXMGbnrXm9YMvGeRdJL14G` | **closed** (R14 head unblock) — close tx `5XUS9BkcprYAdL5FKSLs9iYNsM3u6DMi9iSEk7hgqxCpWsu3yPJoRJ2GkFh8KsPwyVSFYmYz2ArCuBfT5QkAyhBw`, 0.53265324 SOL reclaimed; was SUPERSEDED (earliest deployment) |
| Ethereum Sepolia | `0x1dc207D5B04C8CFB043d4420054a2219a544dD85` (deploy tx `0x85129a3e92dcbc3761de431bb27b750a15783270a108a0187bba42022c65c2f8`, block 11834134) | **current** — the recorded live stealth-delivery run (`docs/evidence/phase-5/repro/stealth-live.out`); fresh deploy, never an in-place upgrade (R9 item 1) |
| Ethereum Sepolia | `0x9BAaB3064C29927710AdaE5812F08D274C0f6431`, `0x42f122667d751fc72823D528758a602893870f3A` | **SUPERSEDED** — same-day earlier live attempts of the identical build (pre-log-chunking scan), left untouched on chain |
| Ethereum Sepolia | `0x8d085193Cf762dD4F946BE48f609AaA2405bbe65` (deploy tx `0xf48b8c79…5379b`) | **SUPERSEDED** (2026-10-03, declared default carried in STATUS-B Questions: R14 item 4 changed `BenzoEscrow.sol`'s storage layout, so per R9 item 1 there is no in-place upgrade and live work redeploys fresh) — was attest-once/release-many + `lock` nonReentrant (R9 items 3–4); `0x19887941cf9BbD967f3739034127924f937D48ad` and earlier **SUPERSEDED** |

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
| `libsodium-wrappers` | `0.8.4` (root `package.json`, exact, `package-lock.json`) | Settlement-envelope cryptography: X25519 keygen, `crypto_box_seal`/`crypto_box_seal_open` content-key wraps per stanza, `crypto_aead_chacha20poly1305_ietf` body, `crypto_generichash` (BLAKE2b) envelope key commitment | **Audited, but not this exact revision — read the versions plainly.** The wrapped code is the official libsodium C distribution compiled to JS/WASM. The one public assessment, "Libsodium v1.0.12 and v1.0.13 Security Assessment" (Dr. Matthew Green, Cryptography Engineering LLC, 2017, funded by Private Internet Access), covered **libsodium 1.0.12 and 1.0.13 only** (it reviewed the library's cryptographic design incl. Curve25519 sealed boxes). The libsodium C build bundled inside `libsodium-wrappers` 0.8.4 reports **libsodium 1.0.22** (`sodium_version_string()` at the pin), so the audit does **not** cover the bundled release itself — the primitives used are libsodium's standard, unchanged defaults and no post-1.0.13 assessment is public. The JS wrapper layer (input marshalling) is unaudited glue; it performs no cryptography |
| `@scure/base` | `1.2.6` (root `package.json`, exact) | `base58` (Solana deliver keys) and `bech32m` (Railgun `0zk` address checksum) in `envelope/deliver.ts`, `crosschain/leaf.ts` | Audited (paulmillr's scure series; the same `bech32m` implementation the Railgun engine itself uses for `0zk` addresses) |
| `@scopelift/stealth-address-sdk` | `1.0.0-beta.5` (root `package.json`, exact) | ERC-5564 scheme-1 stealth delivery: meta-address parsing, one-time address derivation, announcements, `checkStealthAddress`/`computeStealthKey`, and the **canonical Announcer/Registry**: `ERC5564_CONTRACT_ADDRESS` / `ERC6538_CONTRACT_ADDRESS` (the same addresses on every chain) and their canonical creation bytecode (`ERC5564_BYTECODE`/`ERC6538_BYTECODE`, used to deploy on local chains; on Ethereum Sepolia the canonical deployments are used as-is) | **This SDK is a beta and an unaudited client tool — say it plainly: `1.0.0-beta.5` has no public audit, and a beta client is the tool's biggest open risk.** It is not deployed code (it builds and submits transactions; the on-chain behaviour is the canonical ERC-5564/ERC-6538 contracts — **canonical deployments used as-is on Ethereum Sepolia: Announcer `0x55649E01B5Df198D18D95b5cc5051630cfD45564`, Registry `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`**, and their canonical creation bytecode deployed on local chains), and every address it derives is checked by the winner-side `checkStealthAddress` before use. Escrow custody never depends on it. **Known client defect on this pin (found and recorded by the local delivery run):** its `getAnnouncements` filters logs through viem's positional-array `args` form, which matches nothing on pinned viem 2.57.1 (the named-object form matches the very same events) — `crosschain/stealth.ts` `scanDeliveries` therefore fetches the Announcement logs itself with viem's named-args form and keeps every cryptographic step (`getAnnouncementsForUser`'s `checkStealthAddress` filter, `computeStealthKey`) in the pinned SDK |
| `viem` | `2.57.1` (root `package.json`, exact) | The public client the ScopeLift SDK's chain actions read through | Unaudited client tooling (not deployed) |

## Custom security-relevant code

Each file below is hand-written because no audited option implements Benzo's protocol; the
audited building blocks it composes are named above. Hard review by Reviewer R is required before
merge with no open confirmed P0/P1: P0 (re-entrant double payment) fixed at `7e3ac29` and
head-verified (21/21 forge tests incl. the reviewer's repro); P1/F5 (fee-on-transfer drain) fixed
with the lock balance-delta check and proven by `contracts/evm/test/FeeTokenDrain.t.sol`'s
two-auction pooled-drain test (the victim's recipient is paid in full after the fix; with the
check removed the attacker's underfunded lock and self-signed release consume the victim's
funding from the pooled balance — red/green runs in `contracts/logs/f5-*`).

| File | What it does | Why no audited option fits |
|---|---|---|
| `contracts/evm/src/BenzoEscrow.sol` | Escrow custody: lock (`nonReentrant`, effects written before the fee-token calls — R9 item 4), 2-of-3 EIP-712 attest-once (`submitAttestation` stores the approved root per (auction, batch)) + repeatable `releaseApproved` (R9 item 3: a partial or failed release never consumes the approval), per-recipient paid flags, refund | No audited escrow releases on 2-of-3 attestations of an external clearing result with per-leaf Merkle payouts; all cryptography (ECDSA, EIP-712 digest, MerkleProof) and SafeERC20/ReentrancyGuard come from audited OpenZeppelin, unmodified |
| `contracts/solana/src/lib.rs` | Solana escrow program: lock, release (2-of-3 Ed25519 via the checked instructions sysvar), refund. R14 item 1 (reviewer R F1, CPI-forgery P0): `submit_attestation` refuses any CPI (`ViaCpi`) and binds the verified message to its own parsed attestation bytes (`MessageNotSelf` — the instruction at `current` must be this program's own submit carrying `data[2..2+ATT_LEN] == att`) | No audited program verifies 2-of-3 signers over a fixed 200-byte attestation through the native Ed25519 program; the signature check itself is the audited native runtime program, not custom crypto |
| `crosschain/leaf.ts` | Canonical leaf/root/tree encoding (design §3) | Protocol-specific encoding; no library defines it. Uses audited `@noble/hashes` keccak |
| `crosschain/attestation.ts` | Domain-separated attestation bytes (EIP-712 fields; Solana 200-byte layout) | Protocol-specific message format (design §1); no library provides it |
| `crosschain/evm.ts`, `crosschain/solana.ts` | Chain clients for `benzo xchain lock|attest|release|refund|status` | Thin drivers over ethers/@solana/web3.js and the contracts above; no custody logic beyond what the contracts enforce |
| `cli/commands/xchain.ts` | CLI wiring for the above | As above |
| `contracts/evm/test/TestToken.sol` | **Test-only fixture**: plain ERC-20 (OpenZeppelin audited `ERC20` base, open `mint`) deployed on Ethereum Sepolia for the design §7 step-5 testnet run | A mintable demo token is the run's asset; no audited option is needed because it holds no custody and obeys the assets allowlist (no fee, no rebase, no hooks) |
| `envelope/index.ts` | Settlement-envelope framing: `benzo-envelope-v2` magic/count/stanza layout with the `crypto_generichash` key-commitment field, fixed 512-byte length-prefixed padded plaintext, owner Ed25519 binding, salted settlement commitment | Protocol-specific framing (design §4); no audited library defines it. All cryptography inside it is audited libsodium (above) — the wrap/seal/AEAD/keygen/hash calls are that library's standard functions, no hand-written key derivation |
| `envelope/destination.ts` | Zcash address classification (bech32/bech32m, ZIP-316 UA container under F4Jumble, Base58Check) and the shielded-only destination rule | No audited option existed at the time (zcash_address 0.13.0 pinned behaviour could not be consumed from Node); **known mainnet blocker (R8): replace with `zcash_address` (head replace list) before any mainnet use** |
| `envelope/deliver.ts` | R19 deliver payload validation and canonicalization: per-chain `to` formats (Solana base58 32-byte key, EIP-55 checksummed EVM address, Railgun `0zk` bech32m, ERC-5564 stealth meta-address) and `SHA-256(deliver)` over canonical JSON | Protocol-specific envelope payload (PHASE-5 R19); no library defines it. All encodings are decoded and checksum-verified by pinned audited libraries (`@scure/base`, `@noble/hashes` keccak for EIP-55) — no hand-written checksum code |
| `crosschain/stealth.ts` (`stealthEphemeralPrivateKey`) | **Custom construction:** the per-settlement stealth ephemeral private key is `SHA-256("benzo-stealth-eph-v1" ‖ SHA-256(deliver) ‖ auction_id ‖ batch_index ‖ leaf_index)`, fed to the pinned ScopeLift SDK's `generateStealthAddress` as its `ephemeralPrivateKey` | Every signer must derive the *same* one-time stealth address (the allocation root is signed by 2-of-3), while ERC-5564 addresses are normally derived from a random ephemeral key; no audited library provides a signer-reproducible derivation. Only the derivation of `r` is custom — all curve work and the ERC-5564 scheme-1 derivation itself stay in the pinned SDK. The seed never leaves the signer; a leaked seed would link a winner's deliveries (disclosure in README honest limits), never spend them |

## Signer procedure: `benzo xchain attest` (R17 item 4)

The signers never take the result hash or the allocation from operator input. On each signer host, before
signing any attestation:

1. **Validate the result yourself.** Take the auction's public directory and run
   `benzo verify --dir <dir> --signer <expected signer>`; it must report `OK envelope` and no ERROR. This
   recomputes the clearing from the frozen tree and openings (the same fresh-clearing check
   `settle/plan.ts` performs on the settlement path), so the `<dir>/result.json` it accepts is a result the
   signer has itself validated. Never attest a result that did not come through this check.
2. **Attest that result's bytes.** Run
   `benzo xchain attest --chain … --auction … --result <dir>/result.json --dir <dir> --envelope-key <this signer's envelope key file> … --signer-key <this signer's key file>`.
   The command recomputes `result_hash = SHA-256(result bytes)` from the exact bytes of `--result` (the
   product's published result hash) and derives the allocation leaves from that result — winner indexes and
   lot counts come only from `result.allocations[].fill` (or `winners[].lot_count` in a cross-chain result).
   **Destinations come from the winners' sealed envelopes (R19) and openings are derived by the command
   itself (R21) — never from operator input:** `--allocation` and `--envelopes` are removed and refused. For
   every winner leaf the command decrypts the frozen leaf's own ciphertext with the published, BLS-verified
   beacon (`cli/published-beacon`, the same derivation `benzo verify` uses), checks `SHA-256(ciphertext)`
   against the root-committed `ciphertext_hash`, verifies the published record's owner signature and
   settlement commitment against that opening (`settle/envelopes` `validEnvelope`), and only then opens
   `deliver` with the signers' `--envelope-key` opens — a leaf is attested only when at least 2 signers agree
   on `SHA-256(deliver)`; winners without an attestable deliver go to the bundle's exception queue for that
   chain. A `--result-hash` is optional and is refused unless it equals the recomputed hash. These refusals
   happen before any key file is read.
3. **Cross-check what was signed.** The printed `result_hash` must equal the result hash `benzo verify` /
   the read API report for the directory. After release, `benzo xchain status --result <dir>/result.json`
   compares the escrow's approved `resultHash` with the published file and exits 1 on mismatch.
4. Key files are read from the signer's own state and never printed. Signer keys sign nothing but the
   domain-separated attestation (design §1) over the values derived in step 2.

## Later steps (not yet landed)

Railgun (`@railgun-community/engine` for shield-request building) and Token-2022 confidential
transfer come in design §7 steps 4 with their own pins and audit notes (Railgun: Zokyo 2022-12-21
covers the deployed v2 `shield()`; see `zcash/research/benzo-ideas/UMBRA-RAILGUN-VERIFY.md` §B3).
