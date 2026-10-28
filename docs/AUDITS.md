# Dependencies, audit status and custom security-relevant code

Audited code first. This file lists every security-relevant dependency with its pinned version and audit status, and
every hand-written security-relevant file with the reason no audited option fits.

## Assets the escrow contracts accept

`BenzoEscrow.sol` and the Solana escrow accept plain ERC-20/ERC-721 and native ETH/SOL only: no fee-on-transfer
tokens, no rebasing tokens, no tokens with transfer hooks. Two mechanisms enforce it:

1. `lock()` measures the escrow's `balanceOf` before and after `safeTransferFrom` and reverts unless the difference
   equals `amount`, so a token that delivers less than it claims can never fund an auction
   (`contracts/evm/test/FeeTokenDrain.t.sol`).
2. A token that delivers in full at lock and loses value later can't be caught that way, so the signed manifest pins
   the exact asset and only plain assets are listed.

Solana delivery uses native SOL, plain SPL or Token-2022 accounts Benzo configures itself.

## Deployed escrows (testnet)

A version that changes storage or account layout deploys fresh, never as an in-place upgrade over live auctions.

| Chain | Program | Notes |
|---|---|---|
| Solana devnet | `2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu` | layout v2; sha256 `84fd87b726baa0ea007774cb9588f81f9ec077c58809323ce70b3072094e8bc6` |
| Ethereum Sepolia | `0x1dc207D5B04C8CFB043d4420054a2219a544dD85` | deploy tx `0x85129a3e…c65c2f8`; the live stealth delivery in [`docs/evidence/crosschain`](evidence/crosschain/) |

## Dependencies

### contracts/evm

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `@openzeppelin/contracts` | `5.6.0` | `ECDSA`, `MessageHashUtils` (EIP-712), `MerkleProof`, `SafeERC20`, `ReentrancyGuard` | Audited (OpenZeppelin, Feb 2026, v5.5 and v5.6 changes; `MerkleProof` unchanged since the v5.0 audit) |
| `forge-std` | `1.9.7` (vendored) | Foundry test harness | Unaudited, test-only, never deployed |
| solc / Foundry | `0.8.30` / `1.5.1-stable` | Compiler and toolchain | Tooling |

### contracts/solana

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `solana-program` | `=2.3.0` | Program framework, instructions sysvar, system-program CPI | Runtime crates with audit history (Neodyme 2021, Halborn 2022); no public audit of this exact revision |
| `solana-keccak-hasher` | `=2.2.1` | keccak256 leaves and roots (same hash as the EVM side) | As above |
| Ed25519 verification | native `Ed25519SigVerify111…` program | 2-of-3 attestation checks | Runtime built-in, not third-party code |

### Client code (crosschain/, cli/, envelope/)

| Dependency | Pin | Use | Audit status |
|---|---|---|---|
| `@noble/hashes`, `@noble/curves` | `1.8.0`, `1.9.7` | keccak256, ed25519 attestation signing | Audited |
| `libsodium-wrappers` | `0.8.4` | Settlement envelopes: X25519 keys, sealed boxes, ChaCha20-Poly1305, BLAKE2b key commitment | The libsodium C library compiled to WASM. Its public audit (Matthew Green, 2017) covered libsodium 1.0.12 and 1.0.13; this pin bundles 1.0.22, so the audit doesn't cover the exact release. Only standard, unchanged primitives are used |
| `@scure/base` | `1.2.6` | base58 and bech32m decoding in `envelope/deliver.ts` | Audited |
| `zcash_address` | `0.13.0` (librustzcash) | Zcash address classification, through `benzo-pczt classify-address` | librustzcash carries Least Authority audit history |
| `@scopelift/stealth-address-sdk` | `1.0.0-beta.5` | ERC-5564 stealth delivery | Unaudited beta. It builds and submits transactions only; escrow custody never depends on it, and every address it derives is checked with `checkStealthAddress` before use. Its `getAnnouncements` filter matches nothing on viem 2.57.1, so `crosschain/stealth.ts` fetches the announcement logs itself and keeps every cryptographic step in the SDK |
| `ethers`, `@solana/web3.js`, `viem` | `6.17.0`, `1.99.0`, `2.57.1` | RPC and transaction building | Unaudited client tooling, not deployed |

## Custom security-relevant code

Each file below is hand-written because no audited library implements Benzo's protocol. The cryptography inside each
comes from the audited dependencies above.

| File | What it does | Why it's custom |
|---|---|---|
| `contracts/evm/src/BenzoEscrow.sol` | Escrow: lock (non-reentrant, effects before token calls), 2-of-3 EIP-712 attestation stored once per batch, repeatable release that a partial failure never consumes, per-recipient paid flags, refund | No audited escrow releases on 2-of-3 attestations of an external clearing result with per-leaf Merkle payouts. ECDSA, EIP-712, MerkleProof, SafeERC20 and ReentrancyGuard are OpenZeppelin, unmodified |
| `contracts/solana/src/lib.rs` | Solana escrow: lock, release on 2-of-3 Ed25519, refund. Attestation submission refuses CPI calls and binds the verified message to the instruction's own attestation bytes | No audited program verifies 2-of-3 signers over a fixed 200-byte attestation. The signature check is the native runtime program |
| `crosschain/leaf.ts`, `crosschain/attestation.ts` | Leaf, root and tree encoding; domain-separated attestation bytes | Protocol-specific formats |
| `crosschain/evm.ts`, `crosschain/solana.ts`, `cli/commands/xchain.ts` | Chain clients and CLI for `benzo xchain` | Thin drivers; no custody logic beyond the contracts |
| `envelope/index.ts` | Settlement envelope framing: per-signer stanzas, key commitment, fixed 512-byte padded plaintext, owner Ed25519 binding | Protocol-specific framing; every primitive is a standard libsodium call |
| `envelope/destination.ts` | The shielded-only refund destination rule | Classification is `zcash_address`; only the rule is ours |
| `envelope/deliver.ts` | Cross-chain delivery payload: per-chain address formats, a secret 32-byte salt, `SHA-256(deliver)` over canonical JSON | Protocol-specific payload; all checksums come from `@scure/base` and ethers |
| `crosschain/stealth.ts` | The stealth ephemeral key: `SHA-256("benzo-stealth-eph-v2" ‖ salt ‖ SHA-256(deliver) ‖ auction_id ‖ batch_index ‖ leaf_index)` | Every signer must derive the same one-time address, and ERC-5564 normally uses a random key. The secret salt keeps the address unlinkable without the sealed envelope. All curve work stays in the SDK |
| `envelope/index.ts` `sealBlob`, `cli/host-derive.ts` `redactCandidate` | Under host custody the full payment candidate is sealed to one signer; the coordinator holds a redacted copy | Single libsodium `crypto_box_seal` calls and `zcash-devtool pczt redact`; the custom part is which fields are redacted and the approver's byte-equality check |
| `settle/sign.ts`, `settle/src/main.rs` | Parallel FROST signing sessions, one per spend | Composes the unpatched ZF frost-client/frostd and zcash-sign; adds orchestration and checks that each session's randomizer matches our own inspection |
| `tools/nu7/*.patch` | NU7 parameters for testnet on the pinned librustzcash crates | Removes the crates' own `nu7` feature gates, sets testnet activation (height 4,465,026, branch `0x77190AD9`) to match upstream's pre-releases. Mainnet is unchanged |

## How a signer attests a cross-chain result

The signers never take the result or the payouts from the operator. Before signing, each signer host:

1. Runs `benzo verify` on the round's public folder. It must print no `ERROR`; it re-clears the result from the frozen
   bids and their openings.
2. Runs `benzo xchain attest` with that folder's own `result.json`. The command hashes those bytes, re-derives every
   opening from the frozen ciphertexts and the published, BLS-checked beacon, and opens each winner's delivery
   address from the winner's sealed envelope. A leaf is attested only when two signers open the same address, and only
   if the target chain's escrow can pay that kind of address. Anything else goes to the exception queue, before any
   key is read.
3. After release, `benzo xchain status --result <dir>/result.json` checks the escrow's approved result hash against
   the published file.

## Token-2022 confidential transfers

`crosschain/ct.ts` and `crosschain/ct-delivery.mjs` show a Token-2022 confidential transfer on Solana devnet: a fresh
account configured from the bidder's sealed key, a transfer whose amount is hidden on chain, and the bidder applying
and withdrawing it ([`ct-live.out`](evidence/crosschain/ct-live.out)). The Solana escrow pays native SOL, so this is a
capability shown on its own, not an escrow delivery yet.
