# Shutter Network — threshold bid sealing and scheduled opening

## 1. Facts and real versus planned

Static source inspection on 2026-09-30; no cloned code or tests executed. Shutter is a threshold-encryption service/MEV-protection protocol, not a hackathon auction submission; placement is not applicable. Read two shallow clones:

- [shutter-network/shutter](https://github.com/shutter-network/shutter), commit `9843a061b3f7243dc5d3f59ad212fc5222cedfb8`, `/tmp/zecathon-code/auc-doss-batch/shutter` (citations prefixed S).
- [shutter-network/rolling-shutter](https://github.com/shutter-network/rolling-shutter), commit `d143fffcf51f85b30375134d2d29756417f333b9`, `/tmp/zecathon-code/auc-doss-batch/rolling-shutter` (citations prefixed R).

Real source includes pairing-based encryption, distributed key generation, share validation/reconstruction, persistent keyper messages, Ethereum time/event registration processing and browser WASM bindings. R `rolling-shutter/go.mod:39` depends on shlib v0.1.19; the separately inspected S HEAD is not asserted to be that exact dependency revision. No interoperability, running keyper deployment, service availability, live threshold or auction integration was verified.

The [first-party event-decryption preview](https://blog.shutter.network/preview-event-based-decryption-for-shutter-api/) dated 2025-10-23 describes scheduled and event-based opening, and labels events not yet live at publication. Current inspected code contains event processing; that establishes implementation, not present deployment. The [encrypted-mempool roadmap](https://docs.shutter.network/docs/shutter/research/the_road_towards_an_encrypted_mempool_on_ethereum) separates shipped/aspirational rollout steps, including an initial centralized encryption proxy. Do not equate every roadmap step with deployed decentralization. Chain integrations in these paths use Ethereum/Gnosis infrastructure; the core ciphertext is chain-independent.

## 2. Lifecycle and exact bid-seal flow

There are two independent state machines. DKG runs `Off → Dealing → Accusing → Apologizing → Finalized`; result computation requires finalization and enough participating dealers (S `shlib/puredkg/puredkg.go:20–36`, `:133–210`, `:243–295`). Its result is an eon public key plus private shares held separately by keypers. For each registered identity: `registered → eligible trigger → shares collected → opening key reconstructed/published`. Neither is an auction escrow state machine.

The actual primitive/service flow, with auction adaptation explicitly identified:

1. Select successful active eon/public key and a unique identity whose registered release policy is known. An eon covers a keyper configuration; an identity selects one opening key within it. **Auction adapter requirement:** bind identity, eon/configuration, auction ID, cutoff and manifest policy before bids arrive.
2. Bidder locally constructs bytes and samples 32 random sigma bytes. Encrypt with eon public key and hashed identity; ciphertext has C1/C2/C3 (S `shlib/shcrypto/encryption.go:14–19`, `:36–75`). Browser wrappers expose encrypt/decrypt/verifyDecryptionKey after WASM initialization (R `js/shutter-crypto/README.md:14–38`). **Application requirement:** include price, quantity, auction domain, nonce, receipt/funding binding and refund destination in authenticated bid bytes; the library has no bid schema.
3. Application transports/stores ciphertext. Native Shutter does not confirm a Zcash deposit or freeze an auction roster. **Adapter requirement:** return a signed receipt over ciphertext digest and verified shielded funding reference; freeze receipt root before opening.
4. Time-service keyper sees registered identity, active successful DKG/eon and a block whose timestamp is strictly greater than registration timestamp (R `rolling-shutter/keyperimpl/shutterservice/newblock.go:55–124`). Equality does not release in this path. Event mode queries Ethereum logs, matches configured predicates/expiration and persists fired triggers (`triggerprocessor.go:43–127`). Gnosis slot-trigger mode is a different policy, with slot/database/proposer checks (`keyperimpl/gnosis/newslot.go:29–126`); do not reuse next-slot opening for a week-long auction.
5. Each keyper computes its identity secret-key share from its existing eon secret share. Handler checks group membership, successful DKG, bounded identity count and already-generated shares, then persists outgoing message (R `keyper/epochkghandler/sendkeyshare.go:50–135`). Deadline is upstream software policy; the cryptographic share function takes no clock (S `shlib/shcrypto/keys.go:139–152`).
6. Receiving keypers check instance/eon, bounds, DKG and each share's pairing relation (R `keyper/epochkghandler/keyshare.go:39–107`). Once enough distinct valid shares exist, reconstruct by Lagrange interpolation and broadcast/store `DecryptionKeys {instanceId,eon,keys[]}` (`:159–201`; S `shlib/shcrypto/keys.go:172–198`).
7. Anyone possessing ciphertext and opening key decrypts; unpadding and C1 consistency check reject invalid ciphertext (S `shlib/shcrypto/encryption.go:131–146`). **Auction adapter:** decode/funding-check against frozen roster, clear deterministically, prepare payments, settle or execute declared refund policy.

There is no bidder reveal transaction needed for a valid seal. Missing bidders cannot withhold the opening key. Missing keypers can delay it indefinitely; corruption/nonparticipation has to be handled outside these primitive functions.

## 3. Data and algorithm

Ciphertext: C1 compressed G2 point, C2 32-byte masked sigma, C3 vector of encrypted 32-byte blocks. DKG Result: eon, participant count, threshold, own index, secret share, public key, public-key shares (S `puredkg.go:29–36`). IdentityPreimage is arbitrary bytes, not an inherently authenticated auction identifier (R `rolling-shutter/medley/identitypreimage/identitypreimage.go:10–27`). Share messages carry eon/configuration, keyper index, identity preimages and serialized shares; reconstructed key message binds instance/eon and identity/key pairs. No bid, deposit, result, reserve, tie policy, ranking, multi-unit allocation or pro rata is defined.

```text
seal(m, PK_eon, id, sigma):
    padded = PKCS7(m, 32)
    r = Hash3(sigma || m)
    C1 = r * G2
    C2 = sigma XOR Hash2(pairing(Hash1(id), PK_eon)^r)
    C3[i] = padded[i] XOR Hash4(sigma || encode(i))
    return (C1,C2,C3)
open_identity(id, verified_distinct_shares):
    require at least threshold shares; select threshold
    SK_id = sum(LagrangeCoefficient(j) * share[j])
    publish SK_id
open_ciphertext(C, SK_id):
    recover sigma using pairing(C1,SK_id)
    recover/unpad m; reject unless C1 == Hash3(sigma || m)*G2
    return m
```

Source: S `encryption.go:49–109`, `:126–183`, `keys.go:161–198`; share-level epoch handler deduplicates senders and verifies shares (S `shuttermint/keyper/epochkg/epochkg.go:72–117`). Threshold is cryptographic reconstruction, not an auction quorum deciding prices.

**Memo-size inference:** serialization is version byte + 96-byte compressed G2 + 32-byte C2 + padded blocks (S `encoding.go:21–35`; PKCS7 `encryption.go:169–183`). For plaintext length L, raw size is `129 + 32*(floor(L/32)+1)`. A 256-byte bid becomes 417 bytes, leaving 95 bytes of a 512-byte memo for application metadata before memo-format overhead; a 352-byte bid becomes 513 and cannot fit. Hex/base64 worsens fit. Test a compact versioned binary envelope separately; move large terms/addresses off-chain and commit their digest, with replicated availability. This calculation is not an executed SDK test.

## 4. Escrow, refunds, change, delivery and griefing

None are supplied by the encryption library or inspected keyper release handlers. Keyper shares are not ZEC signing shares; an opening key cannot authorize a payout. No auction item custody, reserve enforcement, collateral coverage, default bond, non-reveal fine or bidder spam fee exists in these modules. Registration/service transactions may have chain fees, but that is not a demonstrated auction economic policy.

Useful anti-griefing mechanics are bounded key/share counts, participant checks, deduplication and invalid-share rejection. They protect protocol processing rather than guarantee a funded bid. A structurally parseable ciphertext can decrypt to invalid application data; checking size/group membership before close does not establish valid price/quantity/funding. Our adapter needs confirmed deposits, explicit invalid-bid treatment and bounded admission. Refunds for release failure require a separately precommitted timeout and custody policy; withholding the key must not let the operator rewrite winners or refund addresses. A Zcash committee still has custody discretion unless stronger externally enforced settlement is designed.

## 5. Privacy boundary and observed leak surfaces

| Observer | Before honest release | After published identity key |
|---|---|---|
| Bidder | Own plaintext/nonce/funding | All ciphertexts they can obtain become readable |
| Auction operator without threshold shares | Ciphertexts, timing, identities, byte lengths; own Zcash viewing key also sees escrow note amounts/senders' memo data | Can open every ciphertext under published identity |
| Fewer than threshold independent keypers | Own share and observed registrations/metadata; cannot reconstruct valid identity key alone under intended crypto assumptions | Public opening key |
| Threshold colluding keypers | Can derive identity shares early and reconstruct the opening key | Same capability |
| Public/chain observers | Public registration/trigger metadata and any publicly transported ciphertext | Plaintext for accessible ciphertexts |

**Concrete boundaries/leaks:**

- Early threshold collusion is not cryptographically prevented: share generation is scalar multiplication with no deadline input (S `keys.go:139–147`). Time check is keyper policy in R `newblock.go:121–124`. The claim must be operator-blind under a specified noncollusion assumption, not nobody-can-ever-open-early.
- Opening is public once `DecryptionKeys` is broadcast (R `keyshare.go:186–201`). It supplies delayed disclosure, not permanently hidden losing bids. Keeping ciphertext delivery private changes availability/privacy assumptions; merely publishing a hash does not prevent the storing operator from learning bids after close.
- Unpadded ciphertext size is visible through C3 block count (S `encoding.go:31–33`); equal fixed-length bid envelopes reduce size inference.
- Fired events persist sender, identity, identityPrefix, block hash/height, transaction/log index (R `triggerprocessor.go:118–140`). Registration on another chain can link wallet/timing to bid participation. Avoid bidder Ethereum registrations; use one auction registration where possible.
- Event rollback removes DB rows (R `triggerprocessor.go:146–151`) but cannot retract already published secrets. **Inference:** a reorg after premature trigger can leak irrevocably; finalize cutoff/frozen roster before release.
- The roadmap's initial encryption proxy sees plaintext before encrypting. A bidder UI must use local encryption and must not send plaintext to an RPC/helper/operator. The native encrypted Zcash memo is readable to recipient viewing keys; an inner threshold ciphertext is essential.

Threats also include compromised browser delivery, network/IP timing and deposit amount correlating to hidden price. Neither Shutter nor shielded transport by itself fixes these. Equal escrow tiers/overcollateralization can reduce amount leakage to the operator; they introduce refund and capital-efficiency tradeoffs.

## 6. UI and UX

Inspected SDK is a developer API, not a complete bidder/seller auction. It requires WASM init, key/config fetch, local encrypt and later key verification/decrypt. No seller listing, bidding screen, reserve picker, deposit screen or payout receipt is established from the inspected paths. Do not treat an encrypted-mempool integration as auction UX.

**Recommended Zcash UI:** seller publishes immutable terms/cutoff/keyper configuration and item-delivery commitment. Bidder sees price/quantity, deposit tier, refund destination and earliest opening boundary; browser seals locally, wallet funds ZIP-321 request, then displays both confirmed funding and signed ciphertext receipt. Distinguish draft, payment pending, accepted, frozen, opening delayed, cleared, paid/refunded. After close show frozen-root inclusion, verified opening key, deterministic allocation and settlement transaction. Avoid requiring the bidder online to reveal. Show committee failure as a distinct refund/abort condition, never a silent extension enabling new bids.

## 7. Judgment and Zcash mapping

**Steal:** actual client encryption, one public key across an auction, per-auction opening identity, verifiable shares/key, automatic opening without bidders, persisted receipt/share workflow, bounded message processing. This is the best directly reusable sealing primitive among the inspected implementations; its trust assumption is explicit and implementable.

**Avoid:** operator-side plaintext encryption, marketing that erases threshold collusion, opening before roster finality, assuming public opening preserves losing-bid privacy, importing Gnosis slot scheduling as auction deadlines, and claiming encryption supplies settlement fairness.

**Zcash mapping (design opinion):** use diversified shielded deposit addresses and an operator-readable inner ciphertext memo or digest/receipt envelope. Bind network, auction, eon/key digest, policy, note/funding reference and refund commitment. Freeze accepted-bid root after declared confirmation rule; independently operated keypers release only afterward. FROST governs custody/signing, not encryption; PCZT builds shielded winner/refund/change outputs from a deterministic manifest independently checked by signers. These participants can share a UI but should not collapse into one compromised operator. tlock is an alternative timed-opening service/assumption, not an interchangeable serialization or a new native Zcash opcode. NEAR Intents converts external funding before admission and observes that leg; do not include sensitive bid terms there. External item delivery requires its own enforceable custody/protocol. None of this makes Zcash execute an auction contract.
