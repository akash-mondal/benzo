# Pyron Finance — design dossier

## 1. Facts and implementation status

Static inspection 2026-09-30; no repository code executed. [anindhabiswas25/PyronFinance](https://github.com/anindhabiswas25/PyronFinance), commit `d00417cc75bf5ce32293f19f2fb0afed398cb040`, clone `/tmp/zecathon-code/auc-doss-batch/PyronFinance`. Relative citations below refer to this snapshot. Saved source record identifies Midnight AKINDO Buildathon Wave 1, August–September 2026, **submission, API-reported grant 0.0 USDT**; no rank inferred. [Submission](https://app.akindo.io/products/vjmqDanzpFNZRen6).

Compact OTC bond contract, custom Schnorr module, TypeScript SDK, relay/dealer nodes, wallet-backed Zswap offer construction, and browser UI exist. `deployments/{preprod,preview}.json` and README report network evidence; no transaction independently replayed. Browser default data provider selects real chain/relay/wallet adapters; tests can inject fixture ports (`client/src/data/DataProvider.tsx:10–19`). Mock/fixture presence does not make the core contract imaginary. This uses **Midnight Zswap**, distinct from Penumbra ZSwap and Zcash.

## 2. Lifecycle and bid/quote flow

Dealer lifecycle: unbonded → active bond → withdrawing/inactive → withdrawn; slash sets amount zero/inactive. Quote lifecycle: live → resolved, where resolved conflates settlement attestation, grace-expiry release and fraud slash.

1. Dealer creates identity commitment from secret and posts positive **unshielded** bond plus quote public key (`contracts/src/OTCProtocol.compact:107–135`). Top up possible. No flat minimum.
2. Taker publishes RFQ `(pair,side,size,expiry,ephemeral X25519 pubkey,reply relays)` to ≥2 relays (`client/src/features/trade/engine.ts:107–127`). This market request is public to relay participants; quote price is withheld.
3. Dealer prepares a proved, bound partial Zswap transaction: offered inputs and requested outputs, with fee payment deferred to the taker (`packages/sdk/src/offers.ts:335–386`). It must outlive quote validity plus settlement margin (`:325–332`).
4. `sealQuote` uses `persistentCommit(encode(pair,side,price,size), random32)` and stores opening locally (`packages/sdk/src/quotes.ts:35–46`). Dealer posts RFQ ID, commitment, expiry and public notional. Contract requires active bond, `notional > 0`, notional ≤20× bond, future expiry ≤900 seconds away, unique quote ID; increments liveQuotes (`OTCProtocol.compact:183–221`). This is **per quote**, not aggregate collateral reservation.
5. Dealer signs plaintext four-term encoding and sends encrypted direct reveal with salt and Offer File to one taker; X25519 → HKDF-SHA256 → ChaCha20-Poly1305 (`packages/sdk/src/reveal-channel.ts:1–11`, `:47–54`, `:135–167`; `quotes.ts:65–78`). Taker can open immediately: no operator-blind shared closing time enforced by this key exchange.
6. Taker verifies signature, commitment, disclosed notional, expiration and offer semantics; compares candidates locally (`quotes.ts:84–112`; `client/src/features/trade/engine.ts:4–11`). It balances the dealer half, signs its complementary inputs, checks token balance vector nets to zero, submits, waits for confirmation (`offers.ts:546–584`).
7. Dealer calls `recordSettlement`: **dealer attestation**, not verification of a Zswap receipt, resolves quote and increments counter (`OTCProtocol.compact:224–241`). Anyone can release an unresolved quote at expiry +3600 seconds (`:256–264`), or prove signed commitment mismatch and slash before resolution (`:281–304`).
8. Withdrawal request disables new quotes, bounds caller time within 300 seconds of block time; withdrawal requires 86400 seconds and zero liveQuotes (`:145–172`). Constants: max quote validity 900, proof grace 3600, withdrawal delay 86400 (`:28–39`).

## 3. Data and selection algorithm

Bond: amount, quote public key, withdraw timestamp, liveQuote count, active. Quote: dealer commitment, hidden-terms commitment, expiry, RFQ ID, public notional, resolved. Disclosure NoteRef: ciphertext hash, policy tag, recipient hint (`OTCProtocol.compact:53–74`). Reveal carries four terms, nonce, Schnorr signature, Offer File and expiration (`quotes.ts:55–62`). Result is actual settlement transaction plus local receipt (`engine.ts:36–53`), not a contract-computed auction winner.

```text
for each candidate reveal:
    decrypt to taker; check signature and commitment opening
    reject wrong notional, side, expiry or offer-term mismatch
    verify offer inputs still unspent / offer can settle
valid = quotes marked valid and validUntil > local now
choose best amount: maximize what taker receives / minimize what taker pays
tie: earlier firstSeen, then lexicographically smaller quoteId
taker may select and settle one full offer
```

Comparison/ties are explicit in `client/src/lib/compare.ts:62–81`. No sealed global ranking, common clearing price, seller reserve or pro rata. Full-offer balance vectors enforce complementary token conservation; partial transaction construction is not a multi-unit auction allocation. Contract never computes price. Declared notional checked against size is a client rule because commitment hides the terms (`quotes.ts:88–106`).

## 4. Bonds, settlement, refunds and griefing

Dealer bond is separate from trade inventory. Offer File spends chosen dealer inputs only if its complementary outputs are satisfied by the taker; wallet locally books inputs during construction and releases reservations on construction failure (`offers.ts:388–392`). Taker pays fees; successful balancing routes surplus as change (`:540–545`). Losing/no-trade quotes resolve after expiry+grace and release withdrawal liability; no automatic capital transfer for an unused offer.

Mismatch slash drains **the entire dealer bond**, floors 60% compensation and 10% prover bounty, retains the remainder as burn, sets bond inactive/zero (`OTCProtocol.compact:309–329`). Withdrawal delay exceeds max validity+grace. However per-quote 5% coverage does not reserve bond across all concurrent quotes. **Dealer silence/non-response challenge was removed**, and reusing/spending offer inputs elsewhere has no demonstrated slash (`:41–47`). Settlement counters can be self-attested. Honest timeout compensation is therefore not guaranteed.

**Important binding flaw, static inference:** dealer signs only four terms (`quotes.ts:69–70`); mismatch verifier authenticates those terms but recomputes a commitment using caller-supplied `revealedNonce` (`OTCProtocol.compact:296–300`). Nonce, quoteId, RFQId and commitment are not covered by that signature. A holder of a genuine signed terms reveal can substitute a random nonce and satisfy mismatch, slashing an honest dealer while quote remains unresolved. Need a signature over the complete opening transcript. Not executed as an exploit.

A separate escape: `recordSettlement` can resolve without settlement evidence, then mismatch proof rejects resolved quotes. Thus the bond does not justify claiming guaranteed honest settlement. The code itself acknowledges this attestation boundary.

## 5. Privacy and leakage

Dealer and taker know bilateral quotes; taker sees all collected prices while competitors and relays receive commitments/opaque reveal transport. Fresh RFQ encryption key limits key reuse linkage (`reveal-channel.ts:47–54`), but public RFQ exposes pair/side/size/expiry (`engine.ts:114–126`); public quote ledger exposes RFQ/dealer linkage, expiry and notional (`OTCProtocol.compact:213–218`). Public unshielded bond size/payouts are observable (`:125–128`, `:324–326`).

Reveal signature is sent outside ciphertext (`reveal-channel.ts:8–11`). Since it authenticates a low-entropy four-term vector and excludes the hidden salt, an observer with signature/public key and known RFQ fields has an offline candidate-price test via `schnorrVerify`. This is a dictionary-leak inference; feasibility depends on price range/encoding. AEAD encryption alone cannot undo a public verifiable tag over guessable plaintext. Encrypt the signature or sign salted/context-bound transcript.

Disclosure attachment checks `resolved`, which also means expiry/slash, not completed trade, and no attaching-party ownership check appears (`OTCProtocol.compact:337–354`). Hash-bound disclosure does not prove true content or delivered trade; early third-party attachment may occupy the one-note slot. UI/local receipt and policyTag are not settlement proofs. Actual swap privacy depends on shielded versus unshielded legs chosen in `offers.ts:340–347`.

## 6. UI screens and UX

Browser feature files implement Request → Sealed → Compare → Settle → Receipt; dealer desk has Overview, Quotes, ManualQuote, Bond and Keys; separate Dealer profiles, Portfolio, Activity and Verify/OpenNote screens (`client/src/features`). Trade engine explains/implements each real wallet step; transaction tray labels unspent-input check, balance, validation limit, submit and confirmation (`engine.ts:28–34`). Local quote validity/bond ratios and tie stability are useful. Read source only, no visual or wallet interaction verified.

## 7. Judgment and Zcash mapping

**STEAL:** local comparison; opaque relays with per-request ephemeral keys; preserving opening before publishing commitment; withdrawal grace strictly longer than quote/challenge windows; evidence download; staged settlement tray; complementary-transaction concept. **AVOID:** unhashed/unsigned context around fraud evidence; exposed signatures on guessable terms; self-attested settlement reputation; per-quote collateral without aggregate exposure; confusing resolved with settled; timeout slashes unsupported by objective evidence.

PCZT resembles collaborative construction, but Zcash has only ZEC and cannot enforce this Compact bond/slash contract or general two-asset Zswap offer. Use shielded ZEC custody plus signed objective receipts, FROST signers applying bond/refund policy, and PCZT prepared after clearing. A point-to-point encrypted reveal to the auctioneer **fails operator blindness**: replace it with deadline tlock or a non-colluding threshold release policy; encrypt signatures inside the seal. Memo binds manifest/receipt/ciphertext hash, with larger offers stored off-chain. Fixed cap deposits prevent note amount leaking hidden bid to custody viewers. Use NEAR Intents only for externally sourced ZEC/asset leg, explicitly separate conversion provider visibility from auction privacy. For hackathon scope, avoid inventing an unaudited fraud/slashing circuit.

**Design priority:** excellent reveal transport and settlement UX ideas, unsafe to copy the fraud transcript or claim bond-backed delivery as currently implemented.
