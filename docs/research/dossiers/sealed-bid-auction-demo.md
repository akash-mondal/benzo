# sealed-bid-auction-demo — Blocklock first-price auction dossier

## 1. Facts and implementation boundary

Source: [randa-mu/sealed-bid-auction-demo](https://github.com/randa-mu/sealed-bid-auction-demo/tree/3c03b2561688004ecc814871261232552e4ae033), commit `3c03b2561688004ecc814871261232552e4ae033`; clone `/tmp/zecathon-code/auc-doss-timelock/blocklock-auction/`. Candidate `gh-markets-018`: product/example, no independently verified event placement. Chain: Base Sepolia; README gives contract `0x605aEbc596552cc69ebb3164e0a7a1800d373b61` (`README.md:86–92`). Current deployment behavior was not queried.

Real Solidity request/decrypt/payment/refund calls and signed Next.js wallet paths exist. This uses Blocklock threshold-network callbacks for a future block condition, not the drand age/tlock library directly. External `AbstractBlocklockReceiver` supplies callback authentication/decryption behavior; dependency source is not vendored in this checkout, so its guarantees were not independently established here (`lib/SealedBidAuction.sol:4–10`). Item catalogue is static NFT metadata (`lib/items.ts:8–21`), not those assets in custody. No first-party contract tests were identified; no code executed.

Abbreviations: **C** = `lib/SealedBidAuction.sol`; **U** = `app/auction/[id]/page.tsx`.

## 2. Lifecycle and exact bid flow

Derived states: active while block<end; bidding closed awaiting callbacks; all bids unsealed; winner payment; separately `auctionEnded`. These are loosely coupled booleans/counters, not an enforced linear state machine (`C:15–25`, `57–75`, `185–203`).

1. Seller picks a static item ID and end block. Contract initializes owner/end with no future-end or real-item escrow validation (`C:79–91`). UI translates a date/time to blocks using a hardcoded 2 seconds/block approximation (`app/launch/page.tsx:37–52`).
2. Bidder connects Base Sepolia wallet, enters ETH amount, ABI-encodes uint256 wei locally, encrypts it to end block with Blocklock SDK (`U:156–186`).
3. UI estimates 700,000-gas callback fee, sends fee + fixed 0.001 ETH reserve to `placeSealedBid`, and waits one receipt (`U:188–209`). Contract requests Blocklock with condition `0x42 || abi(endBlock)` (`C:94–124`).
4. After the network supplies each key, callback decrypts uint256, updates highest amount, increments reveal count, and publishes bid (`C:141–174`). Bidders do not voluntarily reveal.
5. After block>end, losers can pull the reserve refund even before all callbacks. Once every bid opened, current winner must voluntarily pay `highestBid - reserve`; contract then transfers full price to seller (`C:176–197`).
6. Anyone can finalize after all callbacks; it does not require elapsed deadline or winner payment (`C:199–203`). There is no default/payment deadline, next-best reallocation, item delivery, or timeout callback recovery.

Exact end block is a gap: commits require `< end`, payment/refund require `> end` (`C:57–64`). UI considers `>= end` ended (`U:223`), so action enablement can disagree for that block.

## 3. Data structures and clearing

AuctionData = ID/end/highest value/counts/highest bidder/owner/paid/ended. Bid = auction ID/request ID/bidder/ciphertext/decryption key/unsealed amount/revealed (`C:15–37`). `userBids` is request-keyed, but `userBidID` and `pendingReturns` are keyed only by wallet across all auctions (`C:39–42`). Result has no committed full-bid manifest or proof.

```text
on authenticated callback(request, key):
    require this request has no previous key
    amount = ABI_uint256(decrypt(stored_ciphertext, key))
    increment auction.revealed_count
    if amount > auction.highest && amount > 0.001 ETH:
        highest = amount; highest_bidder = request.bidder
```

Equal bids keep the first callback winner, not earliest bid registration (`C:163–174`). Network/callback scheduling therefore affects ties. Reserve is exclusive (`bid > reserve`), not inclusive. Single-unit first price; no second price, multi-unit or pro-rata.

## 4. Escrow, refunds, change, delivery, and griefing

Fixed 0.001 ETH deposit is price-independent; remaining `msg.value` goes to Blocklock, with no refund of arbitrary excess by this contract (`C:129–138`). Contract's local fee check is `msg.value >= requestPrice`, despite forwarding `msg.value - reserve`; correct fee+reserve acceptance is partly delegated to the downstream call. UI supplies both (`U:197–203`).

Code findings and static implications:

- Each new bid **assigns** `pendingReturns[wallet] = reserve` rather than accumulating or auction-keying (`C:120–123`). Multiple bids/auctions overwrite refund entitlement while retaining native funds.
- `withdrawRefund(auctionId)` checks caller against that auction's current winner but consumes the wallet's global refund, without membership or all-reveal checks (`C:176–182`). A winner in auction A can use a different ended auction B where it is not the winner to withdraw the reserve. There is also no auction-existence check: an unused auction ID has default end block 0 and default zero winner, so an ordinary nonzero caller passes those gates after block 0. A future winner can also withdraw before its own callback identifies it. Fulfillment still subtracts the reserve and pays it out (`C:185–195`), creating an accounting shortfall/possible use of other deposits. These are source-level exploit paths, not reproduced transactions.
- Winner has not escrowed its full bid. It can decline the top-up forever; there is no slash or fallback winner (`C:185–197`). A tiny fixed deposit does not provide funded execution at arbitrary high bid values.
- All-revealed equality gates payment/finalization (`C:72–75`), but there is no timeout handling for malformed/undecryptable callback or network outage.
- `finalizeAuction` can mark an empty auction ended before its deadline. `auctionEnded` is not checked in commit, so a later valid bid can still be placed; “ended” is not a terminal settlement guarantee (`C:94–124`, `199–203`).
- Native `.transfer` is used for refund/seller payments (`C:181`, `195`); receivers that cannot accept that transfer can block their path. Item metadata does not transfer any NFT (`C:79–91`; `lib/items.ts:8–21`).

No non-reveal penalty, bidder count cap, custody of catalogue NFTs, or enforceable item delivery exists in inspected code. Callback fees deter repeated requests but are not a full spam/default policy.

## 5. Privacy and leak surfaces

Before callback, public chain readers see wallet, auction/request association, ciphertext, gas/fee/timing, and constant collateral, while price depends on correct client encryption and network release policy. Constant deposit is better for price secrecy than exact-price collateral. Ciphertext key and plaintext price become publicly queryable and events reveal price afterward (`C:49–55`, `231–250`).

The bidder UI explicitly logs plaintext wei and ABI-encoded plaintext **before encryption** (`U:177–181`). That exposes secrets to local console inspection or any configured console-capture tooling; no remote console collector was established in this review. Logging ciphertext itself (`U:187`) is not equivalent to a plaintext leak.

Winner top-up reveals its full price via native transfer after close. Escrow/refund bugs can link or mix a wallet's participation across auctions. Wallets are public throughout. Security of the underlying threshold-release/callback authentication is delegated to external Blocklock code and was not proven by this app's own modifiers.

## 6. UI and UX

Screens: launch catalogue/date-time picker, active/my/closed/ended lists, individual auction detail, sealed-bid input, refund, winner fulfillment, finalization, receipt popup (`README.md:68–84`; `app/launch/page.tsx:73–125`; `U:87–220`). The signed encryption/submission path is real, while displayed assets are catalogue examples.

Post-close UX flaw: fulfillment converts wei BigInt to JavaScript Number then subtracts reserve Number (`U:116–119`), risking lost precision or rejected exact payment above safe-integer range. Use integer amounts end-to-end. Detail reads wallet/global bid state rather than auction-scoped bid entitlement, reflecting the contract's indexing bug. Action failures mainly log to console. “Ended” and “paid” should be separate visible status fields backed by meaningful terminal rules.

## 7. Judgment and Zcash mapping

**Steal:** local encryption, fixed collateral separate from encrypted price, explicit decryption-fee presentation, bidder-offline release, confirmation popup, and pull-style refund entitlement concepts.

**Avoid:** shared wallet-only escrow maps, callback-order ties, speculative full bids against small bonds, every-callback liveness gating without recovery, plaintext console logs, float/Number money, and finalization labels unbound to payment/delivery.

**Recommended mapping:** publish each fixed shielded deposit as an auction-scoped opaque receipt; domain-bind price/ciphertext/refund authorization to that receipt. Use drand tlock and independent off-chain keepers instead of EVM callbacks; freeze accepted set before release and process invalid entries with declared recovery rules. Prefer collateral covering the maximum allowed price for a small hackathon auction, so no voluntary winner top-up is needed. Compute seller proceeds, surplus, loser refunds and fees exactly; policy-check all FROST/PCZT payouts. Zcash has no native receiver callback or NFT delivery for this catalogue; external custody must be represented honestly in the UX.
