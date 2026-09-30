# Operator-blind sealed-bid auctions on Zcash: feasibility dossier

Snapshot: **2026-09-30**. Project slug: `auc-zcash-feasibility`. Deadline considered: **2026-10-28**. Companion: [37 machine-readable building blocks](zcash-feasibility.jsonl).

This is a static, code-verified dossier. Repositories were shallow-cloned into `/tmp/zecathon-code/auc-zcash-feasibility/` and inspected without executing their code. Public drand chain-info and 1Click token-list GETs were also checked. No funded swap, wallet build, cryptographic interoperability test, node deployment, performance benchmark, or mainnet FROST transaction was performed. `works` in the JSONL means the capability is present in inspected code; `partial` means integration, trust or compatibility gaps remain; `missing` means the specific requested path was not found or explicitly lacks support. It does not certify a released binary.

## Facts and source-derived findings

### 1. Privacy boundary: a shielded payment is not an operator-blind bid

The auction's viewing-key scanner decrypts its received notes, including values and memos. Thus **depositing the bid amount directly into the auction address reveals that amount to the operator**, even when the spend key is split with FROST. FROST separates spending authority; it does not blind a viewing-key holder. Timelock encryption can separately protect the bid plaintext inside the memo. [zcash/librustzcash `zcash_client_backend/src/data_api/wallet.rs:248-269; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L248) [drand/tlock-js `src/drand/timelock-encrypter.ts:13-38; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/drand/timelock-encrypter.ts#L13)

With fixed collateral `C`, every bidder can deposit the same amount while encrypting a bid satisfying `price × quantity ≤ C`. That is an architectural inference from those primitives, not an existing auction protocol in these repositories. The operator still learns participation, the received collateral, note timing, address/diversifier associations and any metadata supplied through its frontend. Variable collateral, variable-size ciphertext, plaintext refund details or bid-dependent API requests can leak information before close.

Drand's security statement assumes its threshold is not compromised before the selected round and that enough nodes remain available to release the beacon. Threshold compromise permits early decryption; failure to produce a round can delay settlement. Quicknet's launch announcement described **12 of 22 nodes across 18 organizations in October 2023**. That is historical membership, **not a verified September 2026 threshold roster**. The checked `/info` response gives chain parameters, not membership. [drand timelock security](https://docs.drand.love/docs/timelock-encryption/) · [quicknet launch, 2023-10-16](https://docs.drand.love/blog/2023/10/16/quicknet-is-live/) · [2026-09-30](https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info)

After release, anyone holding the ciphertext and the beacon signature can decrypt it. Drand does not itself publish the auction ciphertext. Keeping ciphertext inside a shielded memo restricts its initial distribution to parties who can decrypt that memo; publishing it off-chain makes its post-release plaintext public. Timelock encryption therefore provides **pre-close secrecy**, not permanent secrecy for losing bids.

### 2. Drand libraries, chain selection and verification

| Library | Inspected version / latest cloned commit | Observed maintenance and scope |
|---|---|---|
| Official Go `drand/tlock` | `3ea7fbb59e85`, 2026-09-23 | Recent changes; age-wrapped encryption and verified-beacon decryption. |
| `drand/tlock-js` | package **0.9.0**, `17d817ee259e`, 2024-03-18 | Browser-capable implementation, substantially older HEAD. This alone does not prove abandonment. Public encrypt API returns armor. |
| `thibmeu/tlock-rs` | `tlock` / `tlock_age` **0.0.10**, `717a5d1d91c7`, 2026-07-13 | Recent Rust source; RFC9380 enabled by default. Low-level API and verification caveats below. |
| `drand/drand-client` | `d8e700b5b678`, 2026-09-22 | Recent TypeScript client with chain pinning and beacon verification. Compatibility with the older tlock-js dependency cohort was not executed. |

Evidence: [drand/tlock `tlock.go:65-82;139-177; 3ea7fbb59e85, 2026-09-23](https://github.com/drand/tlock/blob/3ea7fbb59e85d00b0d9b6b2554e9652d5766811b/tlock.go#L65) [drand/tlock-js `package.json:1-4; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/package.json#L1) [drand/tlock-js `src/index.ts:25-32;65-75; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/index.ts#L25) [thibmeu/tlock-rs `tlock/Cargo.toml:1-4;39-41; 717a5d1d91c7, 2026-07-13](https://github.com/thibmeu/tlock-rs/blob/717a5d1d91c7182a5e32f291e65583ab8729edbc/tlock/Cargo.toml#L1) [drand/drand-client `lib/beacon-verification.ts:22-49;104-120; d8e700b5b678, 2026-09-22](https://github.com/drand/drand-client/blob/d8e700b5b678de662bc18cfc07aa7b2e28a39688/lib/beacon-verification.ts#L22)

The raw Rust tlock API encrypts a **16-byte file key**, not an arbitrary bid. Its decrypt implementation truncates trailing zero bytes. The age wrapper restores the file key to 16 bytes, compensating for that truncation; this is not itself evidence that age decryption fails. The wrapper checks the header chain hash but accepts a caller-provided signature without independently verifying its requested round/key. Verify the beacon externally and cross-test interoperability before treating Rust as interchangeable with the official Go implementation. [thibmeu/tlock-rs `tlock/src/lib.rs:48-62;114-120; 717a5d1d91c7, 2026-07-13](https://github.com/thibmeu/tlock-rs/blob/717a5d1d91c7182a5e32f291e65583ab8729edbc/tlock/src/lib.rs#L48) [thibmeu/tlock-rs `tlock_age/src/internal.rs:21-52; 717a5d1d91c7, 2026-07-13](https://github.com/thibmeu/tlock-rs/blob/717a5d1d91c7182a5e32f291e65583ab8729edbc/tlock_age/src/internal.rs#L21)

| Chain | Parameters in inspected drand-client | Timelock applicability |
|---|---|---|
| Default chain | 30 seconds, chained; hash `8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce` | Not the unchained future-round scheme used by tlock. |
| Quicknet | **3 seconds**, unchained, `bls-unchained-g1-rfc9380`; genesis **1692803367** | Supported by tlock-js's pinned mainnet client. |
| Fastnet | Historical alternative | Retired; not a deployment target. |

Quicknet chain hash:

```text
52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971
```

Quicknet public key (hex, 96 bytes):

```text
83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a
```

These parameters matched the live quicknet `/info` GET on 2026-09-30. [drand/drand-client `lib/defaults.ts:5-29; d8e700b5b678, 2026-09-22](https://github.com/drand/drand-client/blob/d8e700b5b678de662bc18cfc07aa7b2e28a39688/lib/defaults.ts#L5) [2026-09-30](https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info) [Fastnet retirement documentation](https://docs.drand.love/blog/fastnet-to-be-sunset/)

**Round verification procedure derived from the client implementation:**

1. Pin the chain hash, public key, genesis, period and scheme; validate fetched chain info against those pins.
2. Fetch the requested quicknet round, e.g. `https://api.drand.sh/<chain-hash>/public/<round>`; reject a response whose `round` differs from the requested integer.
3. Check that `randomness = SHA256(signature)`.
4. Verify the BLS signature against `SHA256(uint64_be(round))`, using the quicknet public key and the RFC9380 G1 ciphersuite/domain implemented by the verifier.
5. Supply the **verified signature**, not the randomness field, to timelock decryption. Keep verification enabled.

[drand/drand-client `lib/beacon-verification.ts:22-49;104-120; d8e700b5b678, 2026-09-22](https://github.com/drand/drand-client/blob/d8e700b5b678de662bc18cfc07aa7b2e28a39688/lib/beacon-verification.ts#L22) [drand-client lib/http-caching-chain.ts:14-22](https://github.com/drand/drand-client/blob/d8e700b5b678de662bc18cfc07aa7b2e28a39688/lib/http-caching-chain.ts#L14) [drand HTTP API documentation, accessed 2026-09-30](https://docs.drand.love/developer/API-v2/drand-http-api/)

The round starts at `genesis + (r − 1) × 3` seconds. For release time `T` in UTC seconds, the first round at or after it is `r = 1 + ceil((T − genesis)/3)`. This is derived from the client's formula; blindly using `roundAt(T)` floors and may release up to three seconds early. [drand-client lib/util.ts:16-31](https://github.com/drand/drand-client/blob/d8e700b5b678de662bc18cfc07aa7b2e28a39688/lib/util.ts#L16)

The tlock-js decryptor contains a TODO to check the ciphertext's chain hash. Its current-clock early-decryption check is not the security guarantee. Auction admission needs its own exact chain/round check, and a bound on stanza count and byte length. [drand/tlock-js `src/drand/timelock-decrypter.ts:18-34; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/drand/timelock-decrypter.ts#L18)

### 3. Exact memo budget: compact ciphertext fits; armor does not

Zcash `MemoBytes` is at most **512 bytes**. `0xFF` is the arbitrary-binary marker, leaving **511 application bytes**. `0xF6` denotes an empty memo; it is not a binary prefix. `as_slice()` trims trailing zero padding, so an application ciphertext needs an explicit length and zero-pad reconstruction where necessary. [zcash/librustzcash `components/zcash_protocol/src/memo.rs:94-134;217-224; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/components/zcash_protocol/src/memo.rs#L94)

For **quicknet**, tlock-js's IBE body wrapping a 16-byte age file key is `U[96] || V[16] || W[16]`, totaling 128 bytes before its age-header base64 encoding. The age file also has the stanza, MAC, 16-byte payload nonce and a 16-byte authentication tag per nonempty chunk. [drand/tlock-js `src/crypto/ibe.ts:54-86; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/crypto/ibe.ts#L54) [drand/tlock-js `src/age/age-reader-writer.ts:30-58; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/age/age-reader-writer.ts#L30) [tlock-js src/age/age-encrypt-decrypt.ts:22-27,49-53](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/age/age-encrypt-decrypt.ts#L22) [tlock-js src/age/stream-cipher.ts:10-12](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/age/stream-cipher.ts#L10)

**Derived size, not a generated ciphertext measurement:** with one tlock stanza, a round of `d` decimal digits and nonempty plaintext `P < 64 KiB`, this inspected serializer yields raw age ciphertext length `351 + d + P`. For an eight-digit round, that is **359 + P**. Other schemes, extra stanzas, header formats or implementations must be measured independently. The JavaScript empty-payload path is different; this formula intentionally excludes it.

| Plaintext bytes `P` | Raw age bytes | Armored bytes, derived | Memo bytes with only `0xFF` |
|---:|---:|---:|---:|
| 1 | 360 | 554 | 361 |
| 64 | 423 | 639 | 424 |
| 128 | **487** | **729** | **488** |
| 152 | 511 | 761 | **512** |
| 256 | 615 | 899 | 616; exceeds limit |

Armor adds base64 line wrapping and BEGIN/END delimiters. Even a one-byte plaintext exceeds the memo when armored. Decode armor to the original binary age file rather than inserting armor or base64 text into the memo. A binary JavaScript string must be converted with the library's binary/Latin-1 convention, not UTF-8. [drand/tlock-js `src/age/armor.ts:4-17; 17d817ee259e, 2024-03-18](https://github.com/drand/tlock-js/blob/17d817ee259e79381111dd75009b0f022c39ace3/src/age/armor.ts#L4)

### 4. FROST custody and PCZT: source support exists for Ironwood now

**Current source implements the needed signing path**, including Ironwood inputs. `zcash-sign` handles v5/v6 sighashes, obtains per-spend randomizers from both Orchard and Ironwood PCZT bundles, applies RedPallas signatures and checks them against the randomized validating key. Cyze enumerates real Ironwood spends and implements proof/finalization/extraction/broadcast. [ZcashFoundation/frost-tools `zcash-sign/src/sign.rs:63-158; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/zcash-sign/src/sign.rs#L63) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:1791-1840;2071-2113; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L1791)

The frost-tools fixture cites testnet transaction `a5533fe75575b09d8986a05005d2c0528cf45a1a7e4cc71b304ae76a9e14487d`. It is an **Orchard-input → Ironwood-output migration fixture**. It does not independently demonstrate spending an already-received Ironwood note, and the transaction was not independently fetched in this research. [ZcashFoundation/frost-tools `zcash-sign/src/sign.rs:270-279; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/zcash-sign/src/sign.rs#L270)

This requires **RedPallas rerandomized FROST**, not generic Pallas FROST. The pinned historical `reddsa` implementation uses the Orchard SpendAuth basepoint and challenge; DKG normalizes the group key to the required even-Y representation. The signature must use the transaction's actual spend randomizer `alpha`. [ZcashFoundation/reddsa `src/frost/redpallas.rs:103-104;136-155; ed49e9ca0699, 2024-08-15](https://github.com/ZcashFoundation/reddsa/blob/ed49e9ca0699a6450f6d4a9fe62ff168f5ea1ead/src/frost/redpallas.rs#L103) [ZcashFoundation/frost-tools `frost-client/src/dkg/cli.rs:19-45; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/frost-client/src/dkg/cli.rs#L19)

**Version compatibility is material:** current ZF `frost` source is 3.0.0, whereas inspected `frost-tools` depends on frost-core 2.2.0, a historical reddsa revision and a patched Orchard fork. Cyze uses another pinned frost-client revision and a newer Ironwood/PCZT cohort. Mixing latest crates independently is not a verified build recipe. [ZcashFoundation/frost-tools `Cargo.toml:24-41;74-79; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/Cargo.toml#L24) [Cyze src-tauri/Cargo.toml:46-50](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/Cargo.toml#L46)

A FROST DKG yields the group spend-validating key `ak`; a usable FVK also needs `nk` and `rivk`:

- ZF `zcash-sign generate` constructs the remaining FVK material from a random spending key and substitutes the threshold `ak`. Its experimental Orchard constructor explicitly warns that future conformance requirements may cause wallets to reject these keys or funds to become inaccessible. Future recoverable key derivation remains unresolved. [ZcashFoundation/frost-tools `zcash-sign/src/generate.rs:10-25; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/zcash-sign/src/generate.rs#L10) [conradoplg/orchard `src/keys.rs:360-387; 42015f15733b, 2026-08-12](https://github.com/conradoplg/orchard/blob/42015f15733b95e179189628d6fa34d92b5b3b8b/src/keys.rs#L360)
- Cyze instead derives `nk` and `rivk` deterministically from `ak`. Anyone given that group public key can reconstruct the FVK. It is not the same address/FVK as the randomized construction for the same `ak`. Its source states that the privacy boundary relies on keeping `ak` within the group; on-chain spends reveal randomized `rk`. [JustShieldMe/Cyze `src-tauri/core/src/zcash.rs:49-78; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/zcash.rs#L49)

These are experimental custody constructions, not a standardized, future-compatible multisignature account type. FROST can authorize a consensus-valid shielded spend without a shielded script, but cannot enforce auction clearing, mandatory refunds, a timelock policy or delivery of an external asset.

`frostd` is a JSON/HTTP session relay, not a wallet or custodian. Its login verifies an XEdDSA-signed challenge; the client uses per-peer `Noise_K_25519_ChaChaPoly_BLAKE2s` encryption. Sessions can signal multiple messages with `message_count`. The server cannot enforce that callers encrypted their payloads; it observes session participants and timing and can withhold messages. [frost-tools frostd/src/functions.rs:37-80, 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/frostd/src/functions.rs#L37) [frost-client/src/cipher.rs:152-196](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/frost-client/src/cipher.rs#L152) [ZF server API docs, accessed 2026-09-30](https://frost.zfnd.org/zcash/server.html)

#### Tool and wallet support

| Tool | Verified source capability | Remaining gap |
|---|---|---|
| **ZF frost-client + frostd + zcash-sign** | RedPallas DKG/signing; relay/coordinator tooling; Orchard and Ironwood signature integration. | PCZT construction and application policy remain separate; storage/nonce hardening and release compatibility require work. |
| **CYZE / Cyze** | Current Ironwood PCZT creation, signature injection, proving and sending. | Existing single-payment UI and text memo/history interfaces are not an auction batch/raw-memo API. Deterministic-FVK privacy caveat. |
| **Zkool / zkool2** | Per-spend alpha from both pools; Ironwood warp scanner. | Source signing flow uses on-chain memo transport, adding block/transaction round trips. Not the same transport as frostd; shipping release not verified. |
| **`zcash-frost-tool`** | Exact singular-name project unresolved. Closest found: BlockchainCommons/**zcash-frost-tools**. | That inspected 2025 fork uses Orchard 0.10.1; no verified Ironwood support. Use the canonical current ZF repository instead. |
| **Vultisig frost-zm** | Sapling **RedJubjub** threshold work and Sapling transaction construction. | Inspected builder writes zero Orchard actions. It does not establish Orchard/Ironwood RedPallas support. |
| **zcash-devtool** | Useful wallet/PCZT tooling. | Generic `pczt update-with-signature` explicitly returns TODO for shielded pools; use zcash-sign or the PCZT low-level signer. |

Evidence: [ZcashFoundation/frost-tools `Cargo.toml:24-41;74-79; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/Cargo.toml#L24) [JustShieldMe/Cyze `src-tauri/core/Cargo.toml:41-68; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/Cargo.toml#L41) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:1677-1729;1925-1985; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L1677) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:2492-2513; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L2492) [hhanh00/zkool2 `rust/src/frost/sign.rs:450-489; ec53c72b459a, 2026-09-30](https://github.com/hhanh00/zkool2/blob/ec53c72b459a7fe16566a76c8714c7e8dce27a72/rust/src/frost/sign.rs#L450) [hhanh00/zkool2 `rust/src/warp/sync/shielded/ironwood.rs:20-87; ec53c72b459a, 2026-09-30](https://github.com/hhanh00/zkool2/blob/ec53c72b459a7fe16566a76c8714c7e8dce27a72/rust/src/warp/sync/shielded/ironwood.rs#L20) [Zkool rust/src/frost/sign.rs:599-626](https://github.com/hhanh00/zkool2/blob/ec53c72b459a7fe16566a76c8714c7e8dce27a72/rust/src/frost/sign.rs#L599) [BlockchainCommons/zcash-frost-tools `Cargo.toml:24-41;73-75; 360ba49604c4, 2025-07-17](https://github.com/BlockchainCommons/zcash-frost-tools/blob/360ba49604c4516562df5001af338b03c93b26c4/Cargo.toml#L24) [vultisig/frost-zm `crates/frozt-lib/src/keygen.rs:1-10; bc5bb58891fa, 2026-04-03](https://github.com/vultisig/frost-zm/blob/bc5bb58891fa752c5801aae2138a9f1e457913a9/crates/frozt-lib/src/keygen.rs#L1) [vultisig/frost-zm `crates/frozt-lib/src/tx.rs:7-16;730; bc5bb58891fa, 2026-04-03](https://github.com/vultisig/frost-zm/blob/bc5bb58891fa752c5801aae2138a9f1e457913a9/crates/frozt-lib/src/tx.rs#L7) [zcash/zcash-devtool `src/commands/pczt/update_with_signature.rs:43-51; 5a26ee854e63, 2026-08-28](https://github.com/zcash/zcash-devtool/blob/5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8/src/commands/pczt/update_with_signature.rs#L43)

#### Required integration steps

1. Run a RedPallas DKG (`frost-client dkg` with explicit `-C redpallas` and threshold `-t 2` for a configured three-member group) on independently controlled participant machines; exchange authenticated participant identities. Normalize and retain the group public-key package and individual shares.
2. Choose **one** FVK construction before funding, persist the exact FVK and derivation metadata, and generate network-correct UAs. Never regenerate a funded vault with a different constructor.
3. Import that UFVK with a recent wallet birthday. The custody backend needs imported spending-account purpose with no HD derivation; a separate observer can be view-only. Sync note commitments/nullifiers before selecting inputs.
4. Build the height-appropriate v6 PCZT, with Ironwood outputs, correct consensus branch, expiry, fees and change. Preserve the full coordinator PCZT; make a deliberate signer view.
5. Calculate the transaction sighash and enumerate **every real spend** needing a signature, retaining pool, action index and `alpha`. Zero-valued real spends still need signing; IO-finalizer dummies are already signed.
6. For each real spend, run FROST with that exact sighash and `alpha`; use fresh nonces. The CLI accepts message/randomizer vectors. Omitting randomizers generates new random ones that will not match the PCZT's randomized key.
7. Apply each 64-byte signature through the matching Orchard/Ironwood signer path. Prove, finalize, combine roles where necessary, extract with verification keys, store the transaction durably and broadcast.
8. Confirm inclusion and wallet state before releasing the next dependent batch.

These steps are reconstructed from code and the ZF tutorial; they were not run. The tutorial's old birthday must be replaced with a current one. [ZF FROST book/src/zcash/devtool-demo.md:167-329](https://github.com/ZcashFoundation/frost/blob/0966bd1529aa062ad3b621af99e277f976b1c0f0/book/src/zcash/devtool-demo.md#L167) [zcash/librustzcash `zcash_client_sqlite/src/lib.rs:2274-2295; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_sqlite/src/lib.rs#L2274) [frost-tools zcash-sign/src/sign.rs:164-188](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/zcash-sign/src/sign.rs#L164) [frost-tools frost-client/src/coordinator/args.rs:24-58](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/frost-client/src/coordinator/args.rs#L24) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:1791-1840;1925-1985;2051-2113; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L1791) [librustzcash zcash_client_backend/src/data_api/wallet.rs:3585 onward](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L3585)

The Rust API spine is `TransactionRequest::new(Vec<Payment>) → propose_transfer → create_pczt_from_proposal → PCZT signer/prover roles → extract_and_store_transaction_from_pczt`. The external FROST adapter sits between creation and signature application: it supplies one transaction sighash plus the corresponding `alpha` for each real input, then applies the signature with `sign_ironwood_with` or `sign_orchard_with`. The devtool's generic signature-update command is not a substitute. Function signatures differ across the pinned cohorts; this describes the inspected current API, not a tested copy-paste program.

The CLI warns that secrets are stored in plaintext. Core FROST explicitly forbids nonce reuse. A relay can facilitate sessions but cannot make transaction policy trustworthy; quorum participants still need to approve outputs, fees and the clearing manifest. A restart/backup restore must not roll nonce-consumption state back. [ZcashFoundation/frost-tools `frost-client/src/cli/init.rs:25-35; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/frost-client/src/cli/init.rs#L25) [ZcashFoundation/frost `frost-core/src/round1.rs:250-256; 0966bd1529aa, 2026-07-21](https://github.com/ZcashFoundation/frost/blob/0966bd1529aa062ad3b621af99e277f976b1c0f0/frost-core/src/round1.rs#L250)

### 5. Receiving notes, memos, diversified addresses and wallet handoff

The current Rust stack has UFVK import, compact-block scanning and full-transaction decryption/storage. SQLite exposes `get_memo`. Incoming viewing keys suffice for trial-decrypting received notes; a full viewing key is the practical choice for nullifier/spent tracking and a PCZT custody wallet. [zcash/librustzcash `zcash_client_sqlite/src/lib.rs:2274-2295; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_sqlite/src/lib.rs#L2274) [zcash/librustzcash `zcash_client_backend/src/data_api/chain.rs:621-665; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/chain.rs#L621) [zcash/librustzcash `zcash_client_backend/src/data_api/wallet.rs:248-269; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L248) [zcash/librustzcash `zcash_client_sqlite/src/lib.rs:1453-1458; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_sqlite/src/lib.rs#L1453)

**Compact blocks do not contain the full memo:** the compact action ciphertext is only the first 52 bytes. The scanner detects a matching note, then needs the full transaction through `GetTransaction` and enhancement/decryption to read its memo. The current compact proto includes Ironwood actions in field 9. [zcash/lightwalletd `walletrpc/compact_formats.proto:130-135; d16d48124e9a, 2026-09-28](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/walletrpc/compact_formats.proto#L130) [zcash/lightwalletd `walletrpc/service.proto:275-276; d16d48124e9a, 2026-09-28](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/walletrpc/service.proto#L275) [zcash/lightwalletd `walletrpc/compact_formats.proto:74;130-135; d16d48124e9a, 2026-09-28](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/walletrpc/compact_formats.proto#L74)

One UFVK can derive many diversified addresses. `address_at` and diversifier-index recovery provide a per-registration deposit address without a separate account/key for every bid. The scanner uses its account key across those receivers; issuing N receivers does not require N independent wallet scans. The registration-to-diversifier mapping is application metadata and remains private to whoever stores it. [Orchard src/keys.rs:735-758](https://github.com/zcash/orchard/blob/e000e9f8e236edc0c4f25c1be475e69039fa5551/src/keys.rs#L735) [zingolabs/zingolib `zingolib/src/wallet/keys.rs:433-448; 271af68ed6da, 2026-09-29](https://github.com/zingolabs/zingolib/blob/271af68ed6da0beb1c4e7729de7f09db9fb8b592/zingolib/src/wallet/keys.rs#L433)

ZIP-321 encodes memo bytes using **base64url without padding** and accepts binary `MemoBytes`. A shielded payment URI can therefore be:

```text
zcash:<unified-address>?amount=<fixed-C-as-decimal-ZEC>&memo=<base64url-of-complete-memo>
```

A transparent destination cannot carry a memo. Use a UA whose shielded receiver is selected; a wallet that falls back to transparent payment cannot submit this bid format. The ZIP-321 Rust library supports multiple `Payment` entries, but wallet handling of any particular URI is a separate integration question. [librustzcash components/zip321/src/lib.rs:142-156,183-206](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/components/zip321/src/lib.rs#L142) [zcash/librustzcash `components/zip321/src/lib.rs:279-314; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/components/zip321/src/lib.rs#L279)

| Integration | Code finding | Consequence |
|---|---|---|
| WebZjs | Imports view-only UFVK; public transaction history emits only `Memo::Text`. Needs gRPC-web proxy and WASM workers/threads/sync. | Binary auction memos need a raw-byte API. Embedded-wallet work is additional scope; source capability is not proof the chosen deployment works end to end. |
| Zingo / zingolib | FVK receiver matching exists; inspected string-to-memo helper directly encodes UTF-8. | Do not assume a `0x…` string is hex-decoded. Verify the released wallet's raw-byte/ZIP-321 path. |
| Cyze | History reads text; sending parses a string memo and substitutes empty memo on parse error. | Add raw `MemoBytes` and fail-closed decode behavior for an auction adapter. |
| Zkool warp sync | Explicit Ironwood scanner/nullifier code. | A candidate alternative; verify full memo retrieval and the shipping binary before using it. |

Evidence: [ZcashCommunityGrants/WebZjs `crates/webzjs-wallet/src/bindgen/wallet.rs:247-260; bdbc6f2f9e8c, 2026-09-11](https://github.com/ZcashCommunityGrants/WebZjs/blob/bdbc6f2f9e8c60f722c73ca7c83b48b861428f70/crates/webzjs-wallet/src/bindgen/wallet.rs#L247) [ZcashCommunityGrants/WebZjs `crates/webzjs-wallet/src/bindgen/transaction_history.rs:196-200; bdbc6f2f9e8c, 2026-09-11](https://github.com/ZcashCommunityGrants/WebZjs/blob/bdbc6f2f9e8c60f722c73ca7c83b48b861428f70/crates/webzjs-wallet/src/bindgen/transaction_history.rs#L196) [ZcashCommunityGrants/WebZjs `README.md:33-54; bdbc6f2f9e8c, 2026-09-11](https://github.com/ZcashCommunityGrants/WebZjs/blob/bdbc6f2f9e8c60f722c73ca7c83b48b861428f70/README.md#L33) [zingolabs/zingolib `zingolib/src/wallet/utils.rs:59-63; 271af68ed6da, 2026-09-29](https://github.com/zingolabs/zingolib/blob/271af68ed6da0beb1c4e7729de7f09db9fb8b592/zingolib/src/wallet/utils.rs#L59) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:2492-2513; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L2492) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:1664-1673; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L1664) [hhanh00/zkool2 `rust/src/warp/sync/shielded/ironwood.rs:20-87; ec53c72b459a, 2026-09-30](https://github.com/hhanh00/zkool2/blob/ec53c72b459a7fe16566a76c8714c7e8dce27a72/rust/src/warp/sync/shielded/ironwood.rs#L20)

#### Servers and latency

Lightwalletd exposes full transactions and raw mempool streaming; Zaino implements both. A Zaino test comment identifies an Ironwood activation-boundary serving issue. Its current external issue status was not independently established, so this is a test target, not proof that today's deployment is broken. [zcash/lightwalletd `walletrpc/service.proto:275-276;294-310; d16d48124e9a, 2026-09-28](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/walletrpc/service.proto#L275) [zingolabs/zaino `packages/zaino-state/src/indexer/node_backed_indexer.rs:1509-1518;1856-1869; 797bc2f4c76b, 2026-09-29](https://github.com/zingolabs/zaino/blob/797bc2f4c76b54903ed31a08fa63b5256303105e/packages/zaino-state/src/indexer/node_backed_indexer.rs#L1509) [zingolabs/zaino `live-tests/e2e/tests/compact_block_wire.rs:1-7; 797bc2f4c76b, 2026-09-29](https://github.com/zingolabs/zaino/blob/797bc2f4c76b54903ed31a08fa63b5256303105e/live-tests/e2e/tests/compact_block_wire.rs#L1)

Before NU7 the block target is **75 seconds**. Current backend default confirmation policy is 3 trusted / 10 untrusted; its minimum policy is 1/1. Ten target intervals are **12.5 minutes**, not a guaranteed receipt latency. Mempool decryption can show a pending receipt before mining, but it is not finality. Full-transaction fetching, reorg handling, indexing lag and proof time add unmeasured delay. [ZcashFoundation/zebra `zebra-chain/src/parameters/network_upgrade.rs:255-256; dba13b30583a, 2026-09-29](https://github.com/ZcashFoundation/zebra/blob/dba13b30583a62d2edfd73368ee53e92c7056fd9/zebra-chain/src/parameters/network_upgrade.rs#L255) [zcash/librustzcash `zcash_client_backend/src/data_api/wallet.rs:451-470; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L451) [zcash/lightwalletd `walletrpc/service.proto:308-310; d16d48124e9a, 2026-09-28](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/walletrpc/service.proto#L308)

A remote indexer learns which full transaction IDs a client fetches after matching notes. Running the auction scanner against its own Zebra/lightwalletd removes that specific third-party query disclosure; it does not remove network timing or frontend metadata. Backend throughput and recovery-from-birthday time remain unbenchmarked.

### 6. Many refunds in a transaction: supported, with practical bounds

`propose_transfer` takes a multi-payment `TransactionRequest`. The current PCZT constructor accepts a **single-step** proposal and checks size; it does not automatically support arbitrary multi-step shielding/migration proposals in one PCZT. Refund batches therefore need explicit transaction planning. [zcash/librustzcash `components/zip321/src/lib.rs:279-314; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/components/zip321/src/lib.rs#L279) [zcash/librustzcash `zcash_client_backend/src/data_api/wallet.rs:779-789;2961-2991; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L779)

For a normal Ironwood bundle with cross-address transfers enabled, requested action count is `max(real inputs, outputs)`, subject to padding/minimum actions. Include change as an output. A restricted old Orchard bundle instead counts spends plus outputs. Each **real input**, rather than each refund output, requires a threshold spend signature. More deposited notes can therefore increase FROST work even when all refunds fit in one batch. [zcash/orchard `src/builder.rs:120-144; e000e9f8e236, 2026-09-29](https://github.com/zcash/orchard/blob/e000e9f8e236edc0c4f25c1be475e69039fa5551/src/builder.rs#L120) [frost-tools zcash-sign/src/sign.rs:164-188](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/zcash-sign/src/sign.rs#L164)

**Fee mismatch verified at this snapshot:**

| Implementation | Inspected conventional marginal fee | Minimum with two grace actions |
|---|---:|---:|
| librustzcash standard ZIP-317 wallet rule | **5,000 zats / logical action** | **10,000 zats** |
| Current Zebra unmined/mining policy | **1,000 zats / logical action** | **2,000 zats**, plus applicable relay policy |

The wallet sums transparent contributions, Sapling maxima, Orchard actions and Ironwood actions, then applies the grace minimum. Zebra has separate relay/mining policy; this is not a consensus requirement that every transaction pay one fixed fee. [zcash/librustzcash `zcash_primitives/src/transaction/fees/zip317.rs:19-24;204-212; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_primitives/src/transaction/fees/zip317.rs#L19) [ZcashFoundation/zebra `zebra-chain/src/transaction/unmined/zip317.rs:20-26;50-67; dba13b30583a, 2026-09-29](https://github.com/ZcashFoundation/zebra/blob/dba13b30583a62d2edfd73368ee53e92c7056fd9/zebra-chain/src/transaction/unmined/zip317.rs#L20) [ZF Zebra 6.4 release discussion, September 2026](https://forum.zcashcommunity.com/t/zebra-6-4-0-and-6-4-1-security-fixes-light-client-serving-and-nu7-preparation/57789)

For example, **100 refunds + one change output**, no other pool/transparent actions, and at most 101 Ironwood inputs gives 101 actions: **505,000 zats = 0.00505 ZEC** under the wallet rule, or 101,000 zats = 0.00101 ZEC under the lower Zebra action convention before other policies. This is fee arithmetic, not a broadcast experiment. Cross-pool migration can add actions and cost; fee allocation must be published so fixed collateral is sufficient for all promised refunds.

The relevant size constraint is a **2 MB block**, with header/coinbase space also required. The backend's proposal guard calls this necessary but not sufficient. Inspected Orchard-protocol proof size is `2720 + 2272 × actions`; action descriptions and spend signatures add further bytes. Neither ZIP-321's 9,999 payment-index limit nor a historical 400 KB intuition is a valid current refund-action cap. A 16,971-bid auction necessarily needs many settlement transactions. No proving benchmark or exact maximum safe action count was established here. [zcash/librustzcash `zcash_client_backend/src/proposal.rs:142-156;1397-1457; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/proposal.rs#L142) [zcash/orchard `src/lib.rs:148-162; e000e9f8e236, 2026-09-29](https://github.com/zcash/orchard/blob/e000e9f8e236edc0c4f25c1be475e69039fa5551/src/lib.rs#L148)

PCZT refund flow: generate the multi-output proposal, fix expiry before IO finalization, preserve the coordinator PCZT, review signer views, sign actual input alphas, apply signatures, prove/finalize/extract, store then broadcast. Changing expiry after dummy signatures are finalized can invalidate them. Crash-safe input locks, a per-refund output ledger and idempotent rebroadcast are application work. [zcash/librustzcash `zcash_client_backend/src/data_api/wallet.rs:2932-2955; f7b1cfb0b5bb, 2026-09-29](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L2932) [JustShieldMe/Cyze `src-tauri/core/src/wallet.rs:1791-1840;1925-1985;2051-2113; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/src/wallet.rs#L1791) [librustzcash zcash_client_backend/src/data_api/wallet.rs:3585 onward](https://github.com/zcash/librustzcash/blob/f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1/zcash_client_backend/src/data_api/wallet.rs#L3585)

### 7. NEAR Intents 1Click: useful funding rail, insufficient direct private bid rail

The inspected SDK provides:

- `GET /v0/tokens` for supported asset IDs and decimals.
- `POST /v0/quote` with `EXACT_INPUT` / `EXACT_OUTPUT`, integer-base-unit amounts, recipient, source refund address and deadline.
- Status lookup keyed by `depositAddress` and, where applicable, `depositMemo`; optional `POST /v0/deposit/submit` for the observed source transaction.

[defuse-protocol/one-click-sdk-typescript `src/services/OneClickService.ts:28-32;47-85;134-141; ae8b24e06478, 2026-09-22](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/ae8b24e064785c8cba8081263e03e52fed4de089/src/services/OneClickService.ts#L28) [defuse-protocol/one-click-sdk-typescript `src/models/QuoteRequest.ts:25-36;67-123; ae8b24e06478, 2026-09-22](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/ae8b24e064785c8cba8081263e03e52fed4de089/src/models/QuoteRequest.ts#L25)

The live token GET on 2026-09-30 includes native Zcash **`nep141:zec.omft.near`**, `decimals: 8`, `blockchain: zec`. Do not select another chain's wrapped ZEC merely by ticker. No quote was funded and no native-ZEC route execution was independently observed. Current API documentation recommends partner API-key handling; older SDK README authentication instructions should not be treated as universally current. [2026-09-30](https://1click.chaindefuser.com/v0/tokens) [1Click quote reference, accessed 2026-09-30](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)

For exact output, source deposits must cover the quoted input; underfunding and expiry can lead to source-chain refunds. Excess handling uses the quote's `refundTo`. Status distinguishes known/pending/incomplete deposits, processing, success, refunded and failed. **A successful swap is not an accepted auction bid**: the auction must independently scan the fixed-collateral Zcash note and its bid reference. Swap refunds and losing-bid refunds are separate ledgers. [defuse-protocol/one-click-sdk-typescript `src/models/QuoteRequest.ts:25-36;71-83;116-119; ae8b24e06478, 2026-09-22](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/ae8b24e064785c8cba8081263e03e52fed4de089/src/models/QuoteRequest.ts#L25) [defuse-protocol/one-click-sdk-typescript `src/models/GetExecutionStatusResponse.ts:27-34; ae8b24e06478, 2026-09-22](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/ae8b24e064785c8cba8081263e03e52fed4de089/src/models/GetExecutionStatusResponse.ts#L27)

There is no generic Zcash output-memo parameter in the inspected quote schema. `depositMemo` concerns the **source deposit's routing**; `customRecipientMsg` is for NEAR `ft_transfer_call`. Neither is a way to inject the auction's encrypted Zcash memo. [defuse-protocol/one-click-sdk-typescript `src/models/QuoteRequest.ts:17-23;102-123; ae8b24e06478, 2026-09-22](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/ae8b24e064785c8cba8081263e03e52fed4de089/src/models/QuoteRequest.ts#L17)

**Bridge privacy caveat found in real code:** Near-One's Zcash withdrawal policy parses Ironwood v6 but specifies a public all-zero outgoing viewing key, one action, recoverable recipient/value and a matching negative value balance. Anyone using that known OVK can perform output recovery under this policy. The recovery call also returns the memo, which the policy discards; that does not make the memo private from an observer using the same key. A shielded-looking bridge output therefore does not imply recipient/value/memo anonymity. This proves the policy's capability, not that every live 1Click ZEC route necessarily uses this implementation. [Near-One/btc-bridge `contracts/satoshi-bridge/src/zcash_utils/orchard_policy.rs:11-15;43-64;94-116; 7740fae0ed8d, 2026-08-27](https://github.com/Near-One/btc-bridge/blob/7740fae0ed8dc56571adfe2aaf36bd4edee0d441/contracts/satoshi-bridge/src/zcash_utils/orchard_policy.rs#L11)

The quote API receives amounts, source/refund/recipient details; public source-chain transactions expose their own transfers. Basic confidentiality defaults to public in current quote docs; more confidential modes do not hide information already sent to the API or written to an origin chain. The SDK describes confidentiality availability as invite-only. Keep **bid price out of quote amounts and metadata**. [defuse-protocol/one-click-sdk-typescript `src/models/QuoteRequest.ts:25-36;67-123; ae8b24e06478, 2026-09-22](https://github.com/defuse-protocol/one-click-sdk-typescript/blob/ae8b24e064785c8cba8081263e03e52fed4de089/src/models/QuoteRequest.ts#L25) [Current quote/confidentiality reference](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)

### 8. NU6.3 / Ironwood and NU7

Current Zebra parameters fix NU6.3 at **testnet height 4,134,000** and **mainnet height 3,428,143**. Official Zcash documentation records testnet activation on July 4 and mainnet around July 28, 2026, and states that zcashd is not NU6.3 compatible. Thus an Ironwood testnet demonstration is available **now**, without waiting for NU7. [ZcashFoundation/zebra `zebra-chain/src/parameters/constants.rs:69-71;98-99; dba13b30583a, 2026-09-29](https://github.com/ZcashFoundation/zebra/blob/dba13b30583a62d2edfd73368ee53e92c7056fd9/zebra-chain/src/parameters/constants.rs#L69) [Official zcashd end-of-life / NU6.3 documentation](https://zcash.github.io/zcash/user/end-of-life.html)

The inspected ZIP text restricts new deposits and cross-address movement in old Orchard, and specifies Ironwood with the existing Orchard-protocol receiver format. Addresses can look familiar while transactions, note domains, commitments and scan trees belong to a different pool. These ZIP documents can still carry Draft metadata; implemented support is independently evidenced by Zebra, the current backend and wallet code. [zcash/zips `zips/zip-0258.md:89-104; 3a0ffc3c47f8, 2026-09-29](https://github.com/zcash/zips/blob/3a0ffc3c47f88649efa4823516dd38777a715ee5/zips/zip-0258.md#L89) [zcash/zips `zips/zip-0326.md:306-315; 3a0ffc3c47f8, 2026-09-29](https://github.com/zcash/zips/blob/3a0ffc3c47f88649efa4823516dd38777a715ee5/zips/zip-0326.md#L306)

The September 17 NU7 timeline targets **October 6 testnet** and **November 5 mainnet**, with the final activation decision on October 20. These are targets, not activation observations. It includes 25-second block spacing, disabling v4, and no new transaction format. Mainnet activation is after the October 28 submission deadline. Current Zebra distinguishes NU6.3 and NU7 branch IDs, so signatures must bind the correct branch even when transaction format is unchanged. [2026-09-17](https://forum.zcashcommunity.com/t/nu7-timeline/57655) [ZcashFoundation/zebra `zebra-chain/src/parameters/network_upgrade.rs:240-246; dba13b30583a, 2026-09-29](https://github.com/ZcashFoundation/zebra/blob/dba13b30583a62d2edfd73368ee53e92c7056fd9/zebra-chain/src/parameters/network_upgrade.rs#L240)

| Building block | Ironwood / NU6.3 consequence | NU7 consequence and demonstration implication |
|---|---|---|
| Drand / tlock | Independent UTC release schedule; no Zcash change required. | No change to round period or ciphertext. Do not derive the release round from a guessed block height. |
| FROST | Use RedPallas and the Ironwood PCZT bundle for new deposits. Historical Orchard-only tooling is insufficient. | Use branch-aware sighash construction and upgraded libraries/nodes. Same group signature family does not make old transaction-building binaries compatible. |
| Receiving | Scan Ironwood actions, nullifiers and trees, then fetch full transactions for memos. Receiver encoding can remain Orchard-protocol UA. | Updated server/client compatibility needs testing; shorter spacing does not establish indexer throughput. |
| Refunds | Build v6 Ironwood transactions. Old Orchard migrations may require both bundles. | Expiry heights expire sooner in wall-clock time at 25 seconds; build after close with the actual target branch. No mainnet 25-second benefit before deadline. |
| Fees | Wallet and Zebra policy already differ at this snapshot. | Recheck emitted fees and node policy after upgrading; do not infer a new wallet fee formula from block spacing. |
| Cross-chain | Verify the native-ZEC route and output recovery policy; direct encrypted-memo support remains absent. | Bridge transaction parsing/branch allowlists need another probe; no automatic auction-contract or memo capability follows. |
| Test/demo | Current NU6.3 testnet supports the required Ironwood experiment. | Rehearse on upgraded NU7 testnet if it activates October 6; ship against existing NU6.3 mainnet by October 28. |

The pre-NU7 75-second target and backend confirmation policy come from code cited above. If the proposed 25-second target activates, ten target intervals become 250 seconds (4 minutes 10 seconds), still a stochastic expectation rather than an acceptance SLA. No smart-contract, shielded-script or custom-asset enforcement path was established by this inspection.

## Recommendations and feasibility judgment

### Decision: feasible as a bounded custody auction; several claims need narrowing

**A four-week MVP is plausible**, provided week one proves a real Ironwood-input FROST spend and end-to-end bid memo handling. The narrow claim is: *the operator cannot read bid values before the published drand release round, assuming the bidder runs the reviewed client and fewer than the drand threshold collude*. That follows from combining fixed collateral, client-local timelock encryption and shielded receipt scanning. It is a design judgment, not a demonstrated system.

FROST provides shared custody with an honest-quorum assumption. It does not provide trustless settlement, seller delivery, compulsory refunds, immunity to censorship, or permanent losing-bid confidentiality. A compromised operator-served browser application could transmit plaintext before encryption; split spend keys do not fix that. Publish a signed, reproducible, downloadable bidder client and its exact auction manifest, avoid analytics and bid-dependent network requests, and make the inspected client the supported privacy boundary.

Start with **one lot or a small fixed-supply uniform-price auction**, ZEC payments, fixed collateral `C`, a public bid cap and a fee reserve separate from seller proceeds. Defer bespoke NFT ownership enforcement, private multi-asset swaps and arbitrary variable collateral. The chosen item can be delivered by the seller outside Zcash; disclose that delivery trust in the product description.

### Proposed stack and coherent dependency strategy

| Component | Proposed choice | Reason / work needed |
|---|---|---|
| Bidder UI | TypeScript static client; pinned tlock-js 0.9.0 and a tested drand-client cohort | Encrypt locally with pinned quicknet. Keep payload fixed at 128 bytes. Verify interoperability with official Go before accepting money. |
| Bid transport | Compact binary memo + ZIP-321 into one explicitly validated Ironwood wallet | Ciphertext fits. Actual released wallet must preserve bytes. If it fails in week one, use replicated off-chain ciphertext and a text memo digest. |
| Scanner / auction ledger | Rust, zcash_client_backend + zcash_client_sqlite; separate application SQLite tables | Import group UFVK, scan/repair reorgs, enhance full txs, preserve raw memos and note identities. Backend database schemas should be managed by the library. |
| Chain service | Own current Zebra + Ironwood-capable lightwalletd | Avoid third-party matching-transaction queries and obsolete zcashd. Probe compact/tree/full-tx consistency; Zaino is an alternative after the same checks. |
| Custody / signer integration | Cyze's inspected Ironwood cohort as the initial PCZT implementation reference; 2-of-3 RedPallas participants | It already contains Ironwood-input enumeration and extraction. Add a Rust worker for multi-payment proposals, raw memos and durable batch state; do not pretend the GUI is a batch service. |
| FROST sessions | Pinned frost-client/frostd compatible with the chosen cohort | Independent participant machines, authenticated transport, encrypted shares, crash-safe nonce consumption, signer review of the clearing plan. |
| Release decryptor | Official Go tlock as the interoperability/reference path | Freshly maintained reference verifies the beacon. Rust is possible after addressing the inspected key-length and external-verification caveats. |
| Optional non-ZEC funding | 1Click TypeScript SDK / REST to **bidder's own Zcash wallet**, then a private fixed-C transfer | Keeps encrypted-bid memo construction under the bidder's control. Public bridge output and funding correlations remain visible; never quote the actual bid. |

**Pin a cohort, not independent latest crate versions.** Cyze's inspected package is 0.2.0-rc.3; its core pins backend **0.24.0-rc.7**, sqlite **0.22.0-rc.8**, PCZT **0.9.1** and Orchard **0.15.4** with experimental FROST. Its frost-client revision is `3d2985cfbc5df9314f3882a6d693bbe0d711051f`, with frost-core 2.2.0 and historical reddsa `ed49e9c…`. Use its source/lockfile as a starting cohort and verify before moving pins. Current librustzcash HEAD separately reports backend 0.24.0, sqlite 0.22.0 and PCZT 0.9.3; that newer set was inspected but not demonstrated interchangeable. [JustShieldMe/Cyze `src-tauri/core/Cargo.toml:41-68; 3a44e05796ca, 2026-09-17](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/core/Cargo.toml#L41) [Cyze src-tauri/Cargo.toml:46-50](https://github.com/JustShieldMe/Cyze/blob/3a44e05796caf3aae048831657da51db4b75385f/src-tauri/Cargo.toml#L46) [ZcashFoundation/frost-tools `Cargo.toml:24-41;74-79; 06c0dbdbb1ba, 2026-08-12](https://github.com/ZcashFoundation/frost-tools/blob/06c0dbdbb1bac9b99cd255e74ba2f387c295e660/Cargo.toml#L24)

For the simplest prototype, keep Cyze's default FVK construction and **do not publish `ak`** or participants' public-key packages. If public group-key publication is required, adapt a persisted randomized FVK construction before funding and test every import/signing path. Never mix Cyze-derived addresses with `zcash-sign generate` addresses for an already-funded group. Independently retain shares, exact FVK, birthdays, manifests and recovery procedures; keep vault lifetime bounded and empty it after settlement.

### Proposed bid format and transport fallback

A proposed application envelope is:

```text
0xFF || "AUC"[3] || format_version[1] || ciphertext_length_u16[2] || raw_age_ciphertext
```

This costs seven bytes including the binary marker. A 128-byte payload uses **494 memo bytes**, leaving 18 bytes spare for this eight-digit-round format; the maximum payload with this envelope is 146 bytes. A possible fixed 128-byte plaintext is `version[1] + auction_id[32] + price_zats[8] + quantity[4] + nonce[16] + refund_Orchard_receiver[43] + deposit_diversifier_index[11] + padding[13]`. This is a design proposal, not a standardized format. All integers need a declared byte order and overflow checks. Binding the auction and deposit destination prevents replay across auctions/registrations.

For a larger payload or incompatible wallet, store a fixed-size ciphertext off-chain and put a version, auction identifier, release round and **ciphertext SHA-256** in the memo. A text hex digest fits ordinary memo interfaces; a plaintext bid hash without a secret nonce would be guessable. The off-chain route adds availability and censorship assumptions. The compact memo route keeps the ciphertext in the shielded transaction, but still requires wallet byte-preservation work.

### Acceptance, close and settlement rules

Publish an immutable manifest containing network, auction ID, collateral, lot/supply, bid limits, clearing formula, tie-break, accepted memo format, quicknet chain/key/scheme, **one exact release round**, UTC receipt cutoff, confirmation policy, fee allocation and invalid/late-bid refund policy. Require exactly that round; accepting an earlier round destroys pre-close secrecy. Bound sizes and supported stanza/recipient count. Reject reused ciphertext hashes and validate the decrypted auction/destination binding.

Close submissions **before** the drand round. Publish the frozen accepted-receipt list/digest and block snapshot while bids are still sealed, with enough gap for the chosen confirmation policy and scanner lag. Ten target intervals already average 12.5 minutes pre-NU7; a 15-minute gap is only an engineering starting point and may need more margin. Specify what happens when confirmation is late, the chain reorgs, the scanner is unavailable or the beacon is delayed. A mempool preview is never the acceptance record.

Validate ciphertext format at entry; decryptability, integer ranges and collateral coverage can only be fully checked after release in this basic construction. Refund invalid bids by a predeclared rule. Stable tie-breaks must use a committed registration/receipt identifier, not an operator's discretionary post-close ordering. Signed receipts help expose omission but do not cryptographically force inclusion.

After release, compute a deterministic clearing/refund plan. Participants approve that plan and the corresponding PCZT outputs/fees before signing. Begin with **50 refund recipients per batch** as a conservative engineering starting point, then measure serialized size, proving time and per-input session cost. Use a durable ledger keyed by receipt note/outpoint and refund batch/output index; store the raw transaction before broadcast, retry the same transaction idempotently, and check chain/mempool state before rebuilding. Lock selected notes to prevent concurrent batches from spending them twice.

If using off-chain ciphertexts, require an availability receipt and at least two independent replicas before accepting the on-chain digest. Copies must be fixed-size ciphertexts, not plaintext or bid-derived names. Declare whether ciphertexts will be publicly released after close; doing so makes losing bids and embedded refund receivers readable by everyone.

For cross-chain users, present 1Click as **wallet funding**. The funding amount must cover fixed collateral plus Zcash sending fees, independent of bid price. Only the subsequent private Ironwood deposit with a correct encrypted memo/digest enters the auction. Losing-bid refunds remain shielded ZEC to the receiver encrypted in the bid; origin-chain swap refunds are handled separately. This path reduces direct bridge-to-auction linkage but does not promise to eliminate timing/amount correlation.

### Hard blockers and workarounds

| Blocker / limit | Consequence | Practical response |
|---|---|---|
| Bid-sized deposits | Viewing-key operator learns the bid. | Fixed `C` and fixed-size ciphertext; reject bid-dependent collateral and metadata. |
| No enforced shielded auction program | Quorum can mispay, censor or withhold; seller delivery is external. | Independent 2-of-3 custody, published deterministic settlement and signer checks. Describe the trust model accurately. |
| Experimental FROST FVK derivation | Long-lived/future-compatible custody is not established. | Pin the working cohort, archive exact keys, limit vault lifetime, empty after settlement; do not market as hardened general multisig. |
| Real Ironwood-input spend not runtime-verified here | Migration fixtures are insufficient proof of custody integration. | Make receiving then spending a real Ironwood testnet note the first release gate. |
| Wallet text interfaces / armored size | Binary memo can be discarded or oversized. | Raw MemoBytes adapter + mined byte equality test; off-chain ciphertext/text digest fallback. |
| Tlock chain/round validation gap | Wrong-round submissions can disclose early or never release correctly. | Manifest pins and strict admission parser; verified round signature at decryption. |
| Malicious client or drand threshold | Absolute “nobody can read” is untrue. | Reviewed downloadable client; state threshold/non-exfiltration assumptions explicitly. |
| Drand unavailable at release | Settlement can stall. | Publish a delay/cancellation policy; an available custody quorum can refund fixed deposits without decrypting bids, using the frozen deposit registry and a separately retained refund route if the bid-only refund receiver is unavailable. |
| Refund receiver exists only inside unreleased ciphertext | Cancellation before release lacks a destination. | Collect an authenticated separate cancellation receiver during registration or wait for drand; this metadata is visible to the registrar and must be accounted for in the privacy model. |
| Large refund set / many small inputs | Size, proving and signing work grows; one giant transaction is unsuitable. | Measured batches, input reservation, optional consolidation with its own fee/confirmation cost. |
| 1Click lacks generic Zcash memo; bridge output recovery | Direct route does not provide the required private bid semantics. | Fund bidder wallet first, then shielded fixed-C memo transfer; leave cross-chain funding optional. |
| NU7 mainnet after deadline | Cannot depend on 25-second mainnet blocks. | Build NU6.3 mainnet now and rehearse NU7 testnet compatibility when available. |

### Four-week execution gates

1. **Week 1:** pinned build cohort; two independent signer machines completing a real 2-of-3 Ironwood-input testnet spend; scanner recovers exact memo bytes; TypeScript ciphertext fails before release and decrypts after release through Go; fixed collateral prevents bid-value inference. Decide binary memo versus replicated ciphertext transport here.
2. **Week 2:** immutable manifest, receipt ledger, diversified destination binding, deterministic clearing, malformed/replayed/underfunded/late-bid rules, frozen pre-release receipt snapshot and reorg recovery. Verify cancellation-refund routing before taking deposits.
3. **Week 3:** multi-output PCZT refund worker, honest-participant policy checks, size/proving measurements, per-input signing, crash/rebroadcast/no-double-refund checks, quorum-loss and delayed-beacon drill. Optional 1Click funding only after the core flow passes.
4. **Week 4:** small bounded-value mainnet auction and complete refund/payout cycle, independent client/code review, presentation with precise privacy claims; NU7 testnet rehearsal if activated. Finish by October 28 without relying on November mainnet activation.

These are proposed release gates, not completed tests. If the first-week Ironwood-input integration or ciphertext interoperability fails, the four-week custody MVP is not established; narrow the demo to testnet rather than making unsupported mainnet guarantees.

## Source inventory and reproducibility

Every inline code citation is pinned to the inspected SHA, file and line; dates are commit dates, not claims of release dates. Docs/API dates are publication/access dates as identified. Versions below describe source manifests, not successful builds.

| Repository | Inspected SHA | Commit date | Version / relevance |
| [drand/tlock](https://github.com/drand/tlock) | `3ea7fbb59e85d00b0d9b6b2554e9652d5766811b` | 2026-09-23 | Go reference |
| [drand/tlock-js](https://github.com/drand/tlock-js) | `17d817ee259e79381111dd75009b0f022c39ace3` | 2024-03-18 | 0.9.0 |
| [thibmeu/tlock-rs](https://github.com/thibmeu/tlock-rs) | `717a5d1d91c7182a5e32f291e65583ab8729edbc` | 2026-07-13 | tlock/tlock_age 0.0.10 |
| [drand/drand-client](https://github.com/drand/drand-client) | `d8e700b5b678de662bc18cfc07aa7b2e28a39688` | 2026-09-22 | beacon verifier / quicknet pins |
| [ZcashFoundation/reddsa](https://github.com/ZcashFoundation/reddsa) | `ed49e9ca0699a6450f6d4a9fe62ff168f5ea1ead` | 2024-08-15 | historical revision pinned by tools |
| [ZcashFoundation/frost-tools](https://github.com/ZcashFoundation/frost-tools) | `06c0dbdbb1bac9b99cd255e74ba2f387c295e660` | 2026-08-12 | core 2.2.0; patched Orchard / PCZT cohort |
| [JustShieldMe/Cyze](https://github.com/JustShieldMe/Cyze) | `3a44e05796caf3aae048831657da51db4b75385f` | 2026-09-17 | 0.2.0-rc.3; backend 0.24.0-rc.7 / sqlite 0.22.0-rc.8 / PCZT 0.9.1 |
| [conradoplg/orchard](https://github.com/conradoplg/orchard) | `42015f15733b95e179189628d6fa34d92b5b3b8b` | 2026-08-12 | experimental FROST constructor pin |
| [hhanh00/zkool2](https://github.com/hhanh00/zkool2) | `ec53c72b459a7fe16566a76c8714c7e8dce27a72` | 2026-09-30 | Ironwood scanner / FROST source |
| [BlockchainCommons/zcash-frost-tools](https://github.com/BlockchainCommons/zcash-frost-tools) | `360ba49604c4516562df5001af338b03c93b26c4` | 2025-07-17 | old Orchard 0.10.1 cohort |
| [vultisig/frost-zm](https://github.com/vultisig/frost-zm) | `bc5bb58891fa752c5801aae2138a9f1e457913a9` | 2026-04-03 | Sapling / RedJubjub source |
| [zcash/zcash-devtool](https://github.com/zcash/zcash-devtool) | `5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8` | 2026-08-28 | generic shielded signature injection TODO |
| [zcash/librustzcash](https://github.com/zcash/librustzcash) | `f7b1cfb0b5bb1bdb10564079ac51b54aa18b07a1` | 2026-09-29 | backend 0.24.0 / sqlite 0.22.0 / PCZT 0.9.3 HEAD |
| [zcash/lightwalletd](https://github.com/zcash/lightwalletd) | `d16d48124e9ad4157ebc2324b5090c6ba201470c` | 2026-09-28 | Ironwood compact proto / full tx serving |
| [zcash/orchard](https://github.com/zcash/orchard) | `e000e9f8e236edc0c4f25c1be475e69039fa5551` | 2026-09-29 | current proof/action sizing |
| [ZcashCommunityGrants/WebZjs](https://github.com/ZcashCommunityGrants/WebZjs) | `bdbc6f2f9e8c60f722c73ca7c83b48b861428f70` | 2026-09-11 | browser wallet source |
| [zingolabs/zingolib](https://github.com/zingolabs/zingolib) | `271af68ed6da0beb1c4e7729de7f09db9fb8b592` | 2026-09-29 | current wallet source |
| [zingolabs/zaino](https://github.com/zingolabs/zaino) | `797bc2f4c76b54903ed31a08fa63b5256303105e` | 2026-09-29 | server and activation-boundary tests |
| [ZcashFoundation/zebra](https://github.com/ZcashFoundation/zebra) | `dba13b30583a62d2edfd73368ee53e92c7056fd9` | 2026-09-29 | current NU6.3/NU7 parameters and fee policy |
| [defuse-protocol/one-click-sdk-typescript](https://github.com/defuse-protocol/one-click-sdk-typescript) | `ae8b24e064785c8cba8081263e03e52fed4de089` | 2026-09-22 | 0.1.25 |
| [Near-One/btc-bridge](https://github.com/Near-One/btc-bridge) | `7740fae0ed8dc56571adfe2aaf36bd4edee0d441` | 2026-08-27 | Zcash public-OVK withdrawal policy |
| [zcash/zips](https://github.com/zcash/zips) | `3a0ffc3c47f88649efa4823516dd38777a715ee5` | 2026-09-29 | ZIP 258 / 326 inspected |
| [ZcashFoundation/frost](https://github.com/ZcashFoundation/frost) | `0966bd1529aa062ad3b621af99e277f976b1c0f0` | 2026-07-21 | workspace 3.0.0; book/core inspected |

The companion JSONL contains one row per capability with `block`, `status`, structured `evidence` (repo/SHA/date/file/lines/URL/fact where applicable) and `workaround`. It preserves specific gaps rather than collapsing all FROST, wallet or bridge support into a single yes/no claim.
