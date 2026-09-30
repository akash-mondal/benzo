# Arcium official sealed-bid example

Owner: `auc-doss-fhe`. Static read-only review, 2026-09-30. Repository https://github.com/arcium-hq/examples, commit `fe15384c239ca90fbbcd8259b60b332275641e57`. Paths/lines relative to `/tmp/zecathon-code/auc-doss-fhe/arcium-hq--examples/`. No repository execution or runtime verification.

## Facts and implementation reality

Official Solana/Arcium tutorial example, no award claim. Complete Anchor program, Arcis circuits, Arcium configuration and TypeScript tests under `sealed_bid_auction/`. Implements private maximum/second-maximum computation and public result callback; **no asset escrow or settlement**. README explicitly discloses limits (`sealed_bid_auction/README.md:42-49`). Node privacy relies on Arcium MPC assumptions; source comments do not independently verify operational node distribution.

`P`=`sealed_bid_auction/programs/sealed_bid_auction/src/lib.rs`; `C`=`sealed_bid_auction/encrypted-ixs/src/lib.rs`.

## Lifecycle and exact bid flow

Register four computation definitions, then authority creates auction PDA seeded by authority, sets type/min_bid/end=clock+duration, status Open and queues encrypted zero state (`P:48-112`). Verified initialization callback writes five ciphertexts and nonce (`117-145`). Client encrypts bidder pubkey lo/hi plus amount using ephemeral x25519/MXE shared secret; submits 3 ciphertexts, key and nonce (`153-188`). Program requires Open and now<end; queues computation reading encrypted state from account bytes at offset77/length160. Verified callback persists newly encrypted state/nonce and increments public bid_count (`210-237`).

At end authority closes Open->Closed (`243-258`, authority constraint `587-592`). Authority invokes appropriate first-price/Vickrey winner circuit, requiring type, Closed and bid_count>0 (`264-277`, `354-367`). Verified output callback emits public winner/payment, sets Resolved (`310-348`, `400-440`). No reveal phase per bidder. Result is event output rather than stored payable escrow entitlement.

## Structures and algorithm

C Bid = SerializedSolanaPublicKey + uint64 amount; state = highest, bidder, second and uint16 count; result = winner/payment (`C:12-27`). P stores public authority/type/status/min/end/count/nonce plus five 32-byte ciphertexts (`P:446-455`); struct raw offset is explicit (`6-12`, `26-27`).

```text
if amount>highest: second=highest; highest=amount; winner=bidder
else if amount>second: second=amount
count += 1
first-price output=(winner,highest)
Vickrey output=(winner,second)
```

`C:44-86`. Strict comparisons keep incumbent on top ties, but equal top populates second, yielding tied top price. A single bid pays zero in Vickrey; no reserve despite public min_bid. **min_bid never reaches circuit or comparison** (README `44`, P `78-86`). All-zero bids leave all-zero pubkey winner. No multi-unit/pro-rata.

## Escrow, refund, griefing and correctness limits

No deposit, NFT/item, transfer, refund, change, bond or non-reveal penalty. Anyone can submit repeated bids; count is submissions, not bidders. A bidder's own second bid changes Vickrey clearing price. Encrypted bidder identity is not bound to tx signer (`P:156-181`; account signer in PlaceBid); arbitrary recipient/identity input possible. One auction per authority due PDA seed (`468`). No initialization-pending/bid-in-flight lock: nonce fixed when queueing, account ciphertext read later, callback overwrites accumulator. Overlapping computations may mismatch versions or lose updates; README requires bids finalize sequentially (`48`). Close/output can likewise race pending bids; program callbacks do not prove an immutable final input root. No duration positivity check at create (`88`). These gaps make it a computation demonstration rather than Monday-ready auction.

## Privacy

Ordinary authority/operator sees ciphertext state and public metadata, not bid prices; signed callbacks enforce output authenticity through verify_output (`P:215-220`, `315-330`). After close first-price reveals winning amount/address. Vickrey reveals winner and **second-highest losing bid**, keeping winning maximum encrypted (`C:76-86`). Say “non-clearing losing bids remain hidden,” not “all losing bids stay secret.” Public transaction accounts expose submitters; count/time/auction association visible. MPC threshold collusion and external client/prover handling are separate assumptions, not resolved by this app.

## UI / UX

No browser auction UI. TypeScript test and README walkthrough cover key split/encryption, queued instruction, callback wait, close and public event (`README:9-14`, `32-40`). Users must wait for each callback before next bid; tests should not be represented as interactive multi-bidder scale. A useful port UI needs accepted/included receipt distinct from merely submitted transaction, pending close computation, final result and escrow status.

## Judgment and Zcash mapping

**STEAL:** output policy separate from state accumulator; Vickrey keeps winner maximum confidential; signed result verification; explicit nonce/version persistence; candid limitations.

**AVOID:** signer/identity mismatch, same-party repeated Vickrey bids, unused minimum, unversioned overlapping accumulator, authority-only close, no escrow.

Zcash application can use auction-specific pseudonymous refund/result keys in client-encrypted memos, never user wallet addresses as public winner. Bind ciphertext to collateral receipt and one effective bid per pseudonym; use a frozen batch root rather than running mutable state. MPC service returns auction/root/rule-version/winner/payable-price attestation; FROST signers validate and construct PCZT payout/refunds/change from confirmed shielded collateral. Fixed common collateral hides price from viewing-key holders. No native Arcium circuit execution on Zcash: using Solana/Arcium is an external compute trust/dependency, not a Zcash contract. tlock is simpler only if all bids may reveal after close; NEAR Intents can supply funding independently.
