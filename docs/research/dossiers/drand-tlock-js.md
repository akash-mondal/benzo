# drand/tlock-js — browser timelock primitive dossier

## 1. Facts and implementation boundary

Source: [drand/tlock-js](https://github.com/drand/tlock-js/tree/17d817ee259e79381111dd75009b0f022c39ace3), commit `17d817ee259e79381111dd75009b0f022c39ace3`. Clone: `/tmp/zecathon-code/auc-doss-timelock/drand-tlock-js/`. The manifest names version 0.9.0 and depends on `drand-client` 1.2.5 (`package.json`). This is real TypeScript encryption/decryption code using noble curves/hashes and ChaCha20Poly1305, with age-format and crypto tests, not an auction contract. No placement claimed. The README points to Timevault as a browser demo (`README.md:22–25`); no live-page or deployment verification was performed.

The `drand-client` dependency was also cloned read-only at tag `v1.2.5`, commit `84c2f1cd305318c23fed6dfddea61a60331f2d5b` ([source](https://github.com/drand/drand-client/tree/84c2f1cd305318c23fed6dfddea61a60331f2d5b)), under `/tmp/zecathon-code/auc-doss-timelock/drand-client/`. No repository code or tests were executed.

## 2. Lifecycle and exact bid-sealing primitive

1. A caller supplies a round, plaintext Buffer, and `ChainClient`; unlike an old README default-client description, current exported functions require that client (`src/index.ts:25–46`; `README.md:31`).
2. `timelockEncrypt` builds a tlock encrypter, age-encrypts the plaintext, then returns ASCII armor (`src/index.ts:25–32`).
3. Encrypter reads the network public key and scheme, hashes the big-endian 8-byte round, and IBE-encrypts the random age file key; stanza arguments are R and returned chain hash (`src/drand/timelock-encrypter.ts:8–46`). Its round guard is only `round < 1`, not an auction future-round check.
4. Age uses a random 16-byte file key and 16-byte payload nonce, a keyed header MAC, HKDF, and authenticated stream encryption (`src/age/age-encrypt-decrypt.ts:25–53`).
5. After R, decrypt parses armor and the first tlock stanza, checks local scheduled time, fetches a beacon through `drand-client`, runs IBE consistency checking, verifies the age header MAC, and decrypts the stream (`src/index.ts:35–46`; `src/drand/timelock-decrypter.ts:9–52`; `src/age/age-encrypt-decrypt.ts:59–83`).

Local time is a convenience gate; the beacon signature supplies the real decryption capability. Encryption must occur entirely in the bidder's browser. A server endpoint that receives plaintext before calling this library defeats the auction's operator-blind goal.

## 3. Structures and algorithm

`Stanza` contains type, string arguments, and byte body (`src/age/age-encrypt-decrypt.ts:16–20`). IBE ciphertext is `{U,V,W}` (`src/crypto/ibe.ts:8–12`), serialized as a compressed point and two masks. Its randomized FO construction derives sigma, r, U, V, and W; decryption checks reconstructed `rP == U` (`src/crypto/ibe.ts:17–47`, `90–142`). The age payload cipher chunks at 64 KiB (`src/age/stream-cipher.ts:22–54`). Legacy G2-DST and RFC9380 G1-DST encryption functions are deliberately distinct (`src/crypto/ibe.ts:49–55`).

```text
plaintext canonical bid -> random age filekey
wrapped_key = IBE(public_key, SHA256(be8(R)), filekey)
C = armor(age(header[tlock,R,hash,U||V||W], encrypted_bid))
when authentic signature_R exists:
    filekey = IBE_open(signature_R, wrapped_key), checking rP
    check age header MAC; decrypt bid; check canonical schema/commitment
```

There is no auction clearing, reserve, tie-breaking, unit supply, commitment object, or deposit/result record. An auction should hash the canonical domain-separated plaintext, not ambiguous JSON or just price-plus-salt.

## 4. Escrow, refunds, and input abuse

No escrow, change, refunds, asset delivery, reveal penalties, or spam control is implemented. A caller can encrypt arbitrary content; a contract or Zcash operator cannot infer validity from a successful upload.

Static findings:

- `src/crypto/ibe.ts:18–19`, `60–61` uses `(msg.length >> 8) > 1` as the “256 bits” guard. It admits lengths beyond 32 bytes, while hash masks are at most 32 bytes (`144–150`). The public age wrapping path uses a 16-byte file key, so this is a low-level API robustness defect rather than evidence age-encrypted bid bytes are exposed.
- Ciphertext parser splits everything after the point into halves without a strict expected body size (`src/drand/timelock-decrypter.ts:66–77`). Reject malformed sizes before invoking group/IBE parsing.
- Generic `encryptAge` defaults to a no-op wrapping function (`src/age/age-encrypt-decrypt.ts:31–33`). Applications must use `timelockEncrypt` or explicitly supply the correct recipient; a generic helper default is not a timelock guarantee.

Application limits should bound ciphertext length, bidding count, integer fields, and processing time. Fixed collateral/bonds and a declared malformed-opening policy are separate design work.

## 5. Privacy and leaks

Before R, holders learn release round/hash, ciphertext size, participation, and transport metadata. After R, ciphertext holders can read all payload contents. A compromised bidder browser or served bundle can transmit plaintext at input time; the cryptographic primitive cannot prevent that.

The decrypter explicitly leaves chain-hash validation as a TODO (`src/drand/timelock-decrypter.ts:26–28`): the stanza's advertised hash is not compared to the supplied client's chain. Wrong underlying keys normally fail IBE/MAC checks, but that is not an application policy check of the intended auction network. Strictly compare the header to the auction's pinned hash and R before accepting/opening.

Round parsing uses `Number.parseInt` and only rejects NaN (`src/drand/timelock-decrypter.ts:54–64`); it does not require canonical positive decimal safe integers. Beacon fetching is delegated to `drand-client` (`33`). The inspected dependency defaults to verification enabled (`drand-client/lib/index.ts:35–38`); `fetchBeacon` calls `validatedBeacon`, which invokes signature verification unless explicitly disabled (`69–79`, `119–129`). Verification checks the requested round, randomness hash, and scheme-specific BLS signature (`drand-client/lib/beacon-verification.ts:20–46`). Its HTTP chain compares returned hash/public key to configured parameters (`drand-client/lib/http-caching-chain.ts:11–22`). Thus the standard pinned helper does verify beacons; the chain-hash TODO is a separate missing comparison to the ciphertext header, not evidence the standard path accepts unverified signatures. A caller-supplied client can disable verification. `mainnetClient` embeds Quicknet hash and public key (`src/index.ts:65–75`).

The library logs the public beacon object (`src/drand/timelock-decrypter.ts:34`), not bid plaintext at that site. Do not mislabel that as a bid leak. Local secret memory handling and downstream logging require their own audit.

## 6. UI and UX

This repository supplies a browser-compatible API rather than bidder/seller screens. Timevault is the referenced encryption demo, not an escrow auction (`README.md:22–25`). For Zcash, build a single bidder flow: enter bid locally → show fixed collateral independently → seal → wallet payment → confirmation → accepted receipt. Keep “payment broadcast,” “payment confirmed,” and “accepted before cutoff” separate. After R, show public beacon validation and independent result verification; bidder presence must not be needed to open a valid published ciphertext.

## 7. Judgment and Zcash mapping

**Steal:** client-side sealing already used by Sub-Rosa/Tacet, compatible age envelope, explicit pinned-mainnet client helper, and interoperability fixtures as the basis for integration validation.

**Avoid:** passing price to a sealing server, relying on README API defaults, permissive round/header parsing, exposing raw low-level IBE to large bid payloads, and treating a decryption attempt that throws “too early” as a complete privacy proof.

**Recommended mapping:** use this in an inspectable bidder bundle with strict external validation of R/hash/schema and exact integer amounts in zatoshis. Measure binary and armored sizes against the 512-byte memo budget; if the full canonical envelope does not fit, use a memo hash/pointer plus independently replicated ciphertext and a signed inclusion receipt. Fixed deposit values are necessary because the recipient viewing key reads note amounts. Separate post-close identity/refund encryption from publicly opened price data. Independent FROST signers recompute the entire accepted set and approve PCZT payouts; NEAR Intents may fund collateral but its quote/amount/route metadata must not carry the bid price.
