# drand/tlock — Go timelock primitive dossier

## 1. Facts and implementation boundary

Source: [drand/tlock](https://github.com/drand/tlock/tree/3ea7fbb59e85d00b0d9b6b2554e9652d5766811b), commit `3ea7fbb59e85d00b0d9b6b2554e9652d5766811b`. Local read-only clone: `/tmp/zecathon-code/auc-doss-timelock/drand-tlock/`. This is an implemented Go library and `tle` file-encryption CLI, not an auction or hackathon placement. It uses drand unchained threshold BLS networks, IBE to wrap an age file key, and age for payload encryption (`README.md:3–6`; `tlock.go:67–108`). No auction escrow, clearing, seller UI, or settlement exists here. Tests and compatibility fixtures exist; none were executed during this static review.

The README reports a Kudelski review and links a report (`README.md:269`); that statement is source attribution, not a claim this exact HEAD or downstream auction has been audited. Mainnet/testnet endpoint and security statements are pinned-repository claims, not fresh uptime measurements (`README.md:8–29`, `253–269`).

## 2. Lifecycle and exact sealing flow

Library lifecycle: plaintext → age payload with timelocked file key → ciphertext retained/distributed → beacon signature for round R becomes available → verified signature unwraps file key → age decrypts plaintext. There is no mutable “close” flag and no bidder-controlled reveal secret required after sealing.

1. Application selects immutable network hash, public key, scheme, and future round R. HTTP initialization checks returned chain info against the requested hash and rejects the chained default scheme (`networks/http/http.go:59–106`).
2. `Encrypt` asks age for a random file key and wraps it with a `Recipient`, then streams the full input and closes the age writer (`tlock.go:67–84`; `tlock_age.go:46–64`).
3. `TimeLock` derives the identity from the round beacon digest, rejects the identity public key, and selects the scheme-specific IBE implementation (`tlock.go:139–171`). Supported cases include legacy/non-RFC and RFC G1 signature schemes, unchained G2 signatures, and BN254; do not mix their parameters.
4. Store the complete output. The CLI can armor it, use a round or a duration, and normally refuses a round strictly older than the current round (`cmd/tle/commands/encrypt.go:22–60`). Equality with the current round is permitted; this is insufficient for an auction requiring future secrecy.
5. `Decrypt` detects armor, parses age recipients, retrieves R's signature, explicitly verifies it against the network public key, unwraps the file key, and streams authenticated age data (`tlock.go:89–108`, `176–220`; `tlock_age.go:109–166`). R is a beacon schedule, not a Zcash block height.

Release occurs when the threshold signature is available, subject to beacon delay or threshold compromise. Merely delaying an operator's “open” button does not postpone anyone else's decryption.

## 3. Structures and algorithm

`Network` exposes chain hash, current round, public key, scheme, signature retrieval, and chain switching (`tlock.go:32–39`). The age recipient stanza is `tlock`, arguments `[decimal R, chain hash]`, body serialized `U || V || W` (`tlock_age.go:46–64`). For BLS schemes the body is a compressed group point plus two 16-byte fields wrapping the 16-byte age key; the parser checks the exact expected body length (`tlock.go:225–281`). The age format adds its own header authentication and encrypted payload overhead.

```text
seal(M, pinned_network, R):
    filekey = age.random_key()
    identity = network.scheme.digest_beacon(R)
    wrapped_key = IBE_CCA(network.public_key, identity, filekey)
    return age(wrapped_key stanza, authenticated_encryption(M, filekey))
open(C, pinned_network):
    parse stanza; require permitted chain hash and expected R
    signature = fetch(R)
    require verify_beacon(R, signature, public_key)
    filekey = IBE_CCA_decrypt(signature, wrapped_key)
    return authenticated_age_decrypt(C, filekey)
```

No bid commitment, deposit, result, reserve, tie policy, multi-unit allocation, or pro-rata exists. Those must be separate, deterministic application structures. This format does not prove before R that a submitted ciphertext contains a valid bid or matches an advertised commitment.

## 4. Escrow, delivery, and griefing boundary

There are no balances, refunds, change, item delivery, penalties, or spam limits. A bidder can submit arbitrary bytes or encrypt to an earlier/different round unless the receiving auction validates the allowed format and header. Even a valid-looking header is not a proof of a valid future opening. A funded auction needs separate admission rules, canonical schema, resource limits, and a predefined invalid-opening policy.

Static reliability finding: the named error return in `Encrypt` is unconditionally assigned `w.Close()` inside the deferred closure (`tlock.go:73–80`). If `io.Copy` fails but closing succeeds, the returned copy error can be overwritten with nil. This is a code-level inference, not a reproduced exploit. Treat successful function return alone as insufficient evidence of a complete canonical ciphertext when input/output streams can fail; record length and hash, and regression-test error propagation in an integration.

Signature retrieval errors are all mapped to `ErrTooEarly` (`tlock_age.go:147–154`), obscuring outage vs actual pre-release status. Keeper UX should distinguish “beacon delayed/unreachable” from “not yet released.”

## 5. Privacy and trust

Before R, payload confidentiality depends on the threshold network not producing the decryption signature early and on local encryption handling. The publisher, operator, and ordinary public reader get ciphertext, network/R metadata, approximate payload size, and transport metadata, not an operator decryption key. A threshold coalition can release early. After R, anyone possessing the ciphertext can decrypt; there is no inherent winner-only disclosure (`README.md:255–267`).

Default `New` trusts a ciphertext's chain hash and can switch networks. `Strict` disables that behavior (`tlock.go:49–63`; `tlock_age.go:129–140`). For an auction, use the pinned network with strict identity behavior: accepting a bidder-selected network substitutes that network's trust assumptions. Pin the round independently as well; strict chain checking alone does not establish the scheduled auction round. Header/body parsers are not a proof that the entire encrypted bid is admissible.

The file key is protected by tlock; funds are not. A Zcash recipient viewing key still reads the note value. An exact bid-valued payment therefore reveals the price to the operator even with a perfectly sealed memo.

## 6. UI and UX

The real user surface here is CLI file encryption/decryption, including explicit network/hash/round/duration/armor flags (`README.md:78–115`). It has no auction screens. Useful auction translation: show the pinned beacon round and estimated release time, provide a downloadable ciphertext/receipt, keep a visible “encrypted / funded / accepted / beacon available / verified / paid” progression, and allow independent opening without the seller's server. Do not present local clock expiry as proof the decryption signature arrived.

## 7. Judgment and Zcash mapping

**Steal:** the age hybrid construction, exact-body parser, explicit beacon verification, strict network mode, and independently runnable opening path. Prefer this as an independent verification implementation against browser-generated payloads.

**Avoid:** accepting bidder-selected chain/round, current-round encryption, equating tlock with valid-bid proofs or escrow, conflating network failure with early time, or publishing identity/refund details inside a payload intended for universal post-close opening.

**Recommended mapping:** browser-local sealing to an auction-pinned drand mainnet network; a canonical small bid envelope domain-bound to auction ID, terms hash, amount/quantity, nonce, and deposit receipt; identical fixed collateral per admission class in shielded notes. Freeze and sign the complete accepted set before R. Keep full ciphertext available independently, hash-bind it to the memo/receipt, and measure the exact serialized envelope against the 512-byte memo limit rather than assuming armored age output fits. Opening/clearing runs off-chain, with policy-verifying FROST participants approving PCZT outputs. Neither RedPallas FROST nor PCZT adds an on-chain auction covenant or hides bid-valued deposits from viewing-key holders. Asset custody/delivery remains an explicit separate agreement.
