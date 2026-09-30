# tlock-rs / tlock_age — Rust timelock primitive dossier

## 1. Facts and implementation boundary

Source: [thibmeu/tlock-rs](https://github.com/thibmeu/tlock-rs/tree/717a5d1d91c7182a5e32f291e65583ab8729edbc), commit `717a5d1d91c7182a5e32f291e65583ab8729edbc`. Clone: `/tmp/zecathon-code/auc-doss-timelock/tlock-rs/`. Implemented Rust low-level tlock plus age recipient/identity adapter; the README describes G1/G2 and wasm support, explicitly says no drand client is included, and explicitly says unaudited (`README.md:23–54`). No auction or placement. No untrusted code/tests were run. Current low-level crate manifest is 0.0.10, edition 2024 with RFC9380 enabled by default (`tlock/Cargo.toml`); this is a HEAD snapshot, not proof of a published package's exact contents.

## 2. Lifecycle and exact sealing flow

1. Caller obtains trusted chain hash/public key/round and handles beacon retrieval independently; the low-level library performs no network access (`README.md:44–46`; `tlock/src/lib.rs:1–9`).
2. Prefer the age adapter: construct a `Recipient`, call `age::Encryptor::with_recipients`, copy the full payload, and finish (`tlock_age/src/lib.rs:76–92`).
3. Recipient wraps age's 16-byte file key with low-level tlock and emits `tlock` stanza `[R, hash]` (`tlock_age/src/internal.rs:167–186`).
4. After release, caller passes expected hash and signature bytes to `tlock_age::decrypt`; age opens and streams the payload (`tlock_age/src/lib.rs:211–236`).
5. Low-level decrypt parses U/V/W, reconstructs sigma/message, checks `U == rG`, and returns bytes. The adapter resizes the returned key to 16 bytes (`tlock/src/lib.rs:84–123`; `tlock_age/src/internal.rs:33–59`).

The signature release, trusted network metadata, and BLS verification belong to the caller. “Offline” is useful for an independent verifier but does not remove the threshold beacon dependency.

## 3. Structures and algorithm

Low-level API targets a 16-byte key. Ciphertext stores a point U and byte vectors V/W (`tlock/src/ibe.rs:187–191`); compressed point sizes are G1=48 and G2=96 (`200–201`). IBE uses full 16-byte random sigma, round identity `SHA256(be8(R))`, pairing-derived V, sigma-derived W, and a consistency check on U (`tlock/src/lib.rs:125–138`; `tlock/src/ibe.rs:203–315`). RFC/legacy hash-to-curve domain constants differ (`tlock/src/ibe.rs:194–198`).

```text
C = age_encrypt(payload, Recipient(chain_hash, public_key, R))
header_hint = parse advertised R/hash       # not authenticated yet
signature = caller.fetch_and_verify_BLS(pinned_key, R)
payload = age_decrypt(C, Identity(expected_hash, signature))
validate canonical bid + receipt + commitment
```

There is no deposit, bid/result schema, auction state machine, reserve, tie-breaking, clearing, or multi-unit allocation. Header parsing for scheduling is distinct from authenticated message acceptance.

## 4. Escrow, refunds, and robustness findings

No escrow/refund/change/delivery or penalty code exists. Important static findings, all inferred from source and not reproduced:

- Low-level `encrypt` performs one `Read::read` into a zeroed 16-byte buffer and ignores the returned count (`tlock/src/lib.rs:48–65`). Short reads are padded; longer inputs are truncated. Never call it directly on a bid payload or assume any Reader yields a complete key in one read. The age adapter supplies a 16-byte slice, reducing that particular short-read exposure.
- Low-level decrypt trims trailing zero bytes; the code itself notes the ambiguity (`tlock/src/lib.rs:114–120`). Adapter resize restores a 16-byte age key (`tlock_age/src/internal.rs:52–59`); arbitrary low-level messages ending in zero are not faithfully length-preserved.
- Recipient silently discards `tlock::encrypt` errors with `let _ = ...` and still returns a stanza (`tlock_age/src/internal.rs:177–186`). Invalid key/configuration can generate unusable output reported as successful.
- IBE failures include assertions/panics, including `assert_eq!(c.u, r_g)` and XOR length mismatch (`tlock/src/ibe.rs:270–322`). A keeper must isolate untrusted ciphertext parsing so a malformed bid cannot crash whole-batch processing.
- `InMemoryWriter::flush` zeroizes an owned copy rather than the stored vector (`tlock_age/src/internal.rs:161–163`). This does not erase the original memory as the expression might suggest.

No proof checks pre-release ciphertext admissibility. Do not import this primitive's lack of application controls into an auction.

## 5. Privacy and trust

Before R, age/tlock protects payload contents under the specified beacon's threshold assumptions, while header R/hash and size are visible. After R, anyone with ciphertext/signature can decrypt. Rust integration can still leak plaintext through logging, wallet RPC parameters, or an operator API.

Identity enforces the expected hash but parses round into unused `_round` (`tlock_age/src/internal.rs:42–49`). Neither low-level decrypt nor this identity takes the trusted public key and round needed for a BLS identity check. The caller must independently verify that the supplied signature is authentic for the pinned network and advertised/expected R. FO ciphertext consistency is not the same as authenticating the scheduled beacon. A header extractor saves advertised metadata before a successful age decryption/MAC check (`tlock_age/src/internal.rs:97–116`; `tlock_age/src/lib.rs:148–178`); treat that output as an untrusted hint.

The README's unaudited statement is material to implementation selection (`README.md:48–54`). It is not evidence that Go/JS and Rust have equal reviewed assurance.

## 6. UI and UX

No bidder/seller UI exists. README directs CLI users to `dee` and `age-plugin-tlock` (`README.md:64–68`), external tools not auction workflows. The value for Zcash is an offline desktop or WASM verifier that accepts a signed auction manifest, ciphertext bundle, and verified public beacon, then reports precise malformed/invalid/opened statuses before generating any settlement proposal.

## 7. Judgment and Zcash mapping

**Steal:** a Rust-native age adapter compatible with a Rust Zcash backend, offline verification, explicit chain-hash equality, and cross-language test vectors.

**Avoid:** direct low-level encryption of bid records, swallowed wrap errors, relying on unused round parsing for policy, panics in a whole-batch keeper, or claiming secret erasure from the current flush implementation.

**Recommended mapping:** evaluate this as an independently checked verifier after fixing/covering the observed error paths, rather than assuming drop-in production readiness. Seal in the bidder browser using a compatible pinned library; verify the beacon and exact envelope independently in Rust; record fixed collateral receipts in shielded memos; deterministically compute refunds and seller proceeds; require FROST participants to check PCZT inputs/outputs/fees against that result. No Soroban/EVM balance or on-chain release gate exists in Zcash, and PCZT does not enforce future release or external item delivery. Domain-bind commitments and receipt IDs to the auction to prevent cross-auction replay.
