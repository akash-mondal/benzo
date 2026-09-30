# auc-doss-batch — design comparison and Zcash recommendation

Completed 2026-09-30. Nine dossiers, ten shallow source clones, static reading only. No untrusted repository code/tests executed. [Machine-readable index](index-auc-doss-batch.jsonl); [clone/availability evidence](evidence-auc-doss-batch.jsonl). Detailed source paths/lines and fact/opinion separation are in each dossier. CrossDesk's advertised repository was unavailable; its dossier documents that limit and reads the public successor specs without attributing them to the original auction.

## Facts established by inspection

| Reference | Actual mechanism inspected | Pre-close operator blindness established? | Main reusable piece |
|---|---|---|---|
| [Penumbra ZSwap](penumbra-zswap.md) | Public-input per-block swaps, shielded claims; flow encryption is planned | No for current swap inputs | Prepaid completion, committed destination, pro-rata unfilled refunds |
| [Renegade](renegade.md) | Private state/proofs, legacy cross-relayer MPC; own relayer knows local orders | No against own relayer | Proof before result opening, consume-once settlement and queue discipline |
| [PrivBatch](privbatch.md) | Commit/reveal hook and net AMM execution | Public reveal phase; aggregate-only claim does not match inspected reveal path | Explicit batch phases; use accounting failures as counterexamples |
| [Waiola](waiola.md) | Private quote-proof RFQ authorization around an AMM hook | Full quote appears in hook calldata | Quote validity schema, expiry, discovery; repair binding/realized-output issues |
| [Nyxbid](nyxbid.md) | Commit/reveal full-size RFQ, winner then funds | Full-price reveals visible | Three-window UX, declared ties and first-price winner |
| [Pyron Finance](pyron-finance.md) | Encrypted dealer RFQ/Offer File and public bond state | Claimed sealed RFQ has signature guessing/binding concerns | Pre-funded dealer bond and explicit default state |
| [Dark Pools](dark-pools.md) | Canton plaintext-to-venue matching with bounded atomic Daml fills | No against venue | Scoped settlement authority, fail-closed bilateral fill |
| [CrossDesk](crossdesk.md) | Original auction inaccessible; current successor valuation specs | Original unknown; successor administrator reads submissions | Opening/closing positioning and versioned result provenance |
| [Shutter Network](shutter-network.md) | Client threshold encryption and time/event key release | Yes against operator without threshold control, under noncollusion assumption | Automatic opening and verifiable shares/key |

None is a verified complete operator-blind Zcash auction. The source findings above are specific to pinned snapshots, not reproduced exploit reports or claims about every deployed release.

## Design recommendation — opinion

Build one funded, fixed-inventory auction with uniform-price policy published before admission. Use an inspected threshold seal as the implementation reference. Choose explicit inventory/reserve, integer price/quantity precision, marginal allocation/tie rule, fee/rounding rule and cutoff confirmation policy. Avoid importing a dark-pool matching engine or a double-sided benchmark business into the MVP.

1. **Seal locally.** Bid bytes bind network, auction ID, immutable method/key configuration, price/quantity, randomness, funding receipt and refund commitment. Encrypt in the browser/wallet; no plaintext helper API. A native shielded memo is readable to the recipient, so it needs an inner seal. Shutter raw serialization suggests a compact envelope fits; exact wallet memo-format/SDK interoperability still needs validation.
2. **Fund without spelling out the bid.** Verify deposit confirmation before admission. Operator viewing keys reveal escrow values; price-equal deposits defeat operator blindness. Use one fixed collateral amount or disclosed tiers and state what those tiers reveal. Reject post-opening bids exceeding their collateral under a predeclared policy. Reserve room for fees/refunds. Avoid public outside signatures that enable guesses of low-entropy bid terms.
3. **Freeze before opening.** Return signed admission receipts, bind ciphertext digest to funding, publish accepted-roster root under declared confirmations, and prohibit post-freeze admission/replacement. This detects some roster manipulation; it does not make censorship or omitted receipts impossible without an independent publication/admission mechanism.
4. **Open automatically.** Independent keypers release only after the frozen cutoff. Verify shares/key, reject malformed/domain-mismatched entries and clear from the immutable roster. Publish reproducible method/root/allocation evidence under the intended after-close disclosure policy. Public opening keys allow anyone with ciphertexts to read losing bids; do not promise lasting loser privacy.
5. **Settle from an independently checked manifest.** PCZT builds shielded proceeds/refund/change outputs. FROST signers recompute accounting, consume each accepted receipt once and verify committed recipients before signing. No native Zcash contract enforces these checks; committee custody remains a trust boundary. Item delivery needs separate custody or an external protocol.
6. **Complete without bidder return.** Borrow Penumbra's one-action progress and prepaid completion lesson. Show funded/accepted/frozen/opening-delayed/cleared/paid/refunded distinctly. Declare failure/refund paths for unavailable opening, invalid bids and delivery default in advance; an encryption failure must not grant the operator discretionary new rounds.

## Claims to make precise

“Operator cannot read bids before close” must name the encryption threshold and independence assumption. Enough colluding keypers can generate opening shares early; FROST signing does not fix that. A deterministic result does not guarantee delivery, and a private transport does not hide note amounts from the recipient viewing key. NEAR Intents conversion is an observable external leg; admit its confirmed ZEC output under the same cutoff and keep bid terms out of conversion requests.

Strongest pitch supported by this research: funded bids sealed on the client, an immutable cutoff roster, automatic threshold opening, independently checked clearing and shielded settlement receipts. The implementation still needs end-to-end validation before these are product guarantees. This research supplies source-backed design choices and failure cases, not a deployed auction.
