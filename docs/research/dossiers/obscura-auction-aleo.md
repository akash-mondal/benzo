# Obscura Auction — Aleo commit/reveal auction infrastructure

## 1. Facts, provenance and version boundary

Source: [repository](https://github.com/Ritik200238/obscura-auction), commit `e860acf38c64e06ed58eb5361760e9b2beec0358`; [AKINDO product](https://app.akindo.io/products/vj9AOZlDqUogpKN3). Saved candidates report Aleo Privacy Buildathon Waves 3/4 and 225 USDT total awards; payment/placement not independently reverified. Chain: Aleo testnet. README:133–142 claims four immutable deployed programs, with explorer/deployment transaction links; this review did not compare live program bytecode with the checkout or execute any transition.

Read-only checkout `/tmp/zecathon-code/auc-doss-fhe/Ritik200238--obscura-auction/`. Line references are relative to that directory. Thorough static reading covered the monolith and split core, ALEO settlement, stable settlement and marketplace sources, plus bidder/reveal/claim/settlement UI and transaction plumbing.

**Version matrix matters:**

| Component | Checked source | Claimed/current frontend target | Consequence |
|---|---|---|---|
| Core (**C**) | `contracts/obscura_core_v4/src/main.leo`:28 | `obscura_core_v4.aleo` | Matches declared name. |
| ALEO settle (**S**) | `contracts/obscura_settle_v6/src/main.leo`:23–26 | `obscura_settle_v6.aleo` | Imports **core_v3** records, not frontend core_v4. |
| Stable settle (**T**) | `contracts/obscura_settle_stable/src/main.leo`:20–24 | `obscura_settle_stable_v4.aleo` | Source declares **v3**, imports core_v3; frontend types:4 also says pending deploy despite README deployment claim. |
| Market (**M**) | `contracts/obscura_market/src/main.leo`:33 | `obscura_market_v2.aleo` | Source declares **v1**. |
| Legacy (**L**) | `contracts/obscura_auction/src/main.leo` | Not the frontend's split target | Kept as a separate historical implementation, not evidence about deployed v6. |

Targets: `frontend/src/types/index.ts`:2–5; `sdk/src/constants.ts`:3–5. Checked code has real native credit/token transfer calls, record consumption, commitment hashing and public mappings. It is not merely a visual mock. However, record-type mismatch and independent mapping state prevent calling the checked split system an established working end-to-end auction. Compiled artifacts/tests exist, but were not executed or used as proof of completeness. Seller inventory is never locked as an NFT/asset; certificates attest an item hash, not delivery.

## 2. Lifecycle and exact bid flow

C:38–45 declares ACTIVE, CLOSED, REVEALING, SETTLED, CANCELLED, FAILED, DISPUTED, EXPIRED. The ordinary sealed path is ACTIVE → REVEALING → SETTLED/FAILED; empty close becomes EXPIRED; seller can cancel only ACTIVE with zero commitments (C:604–628). CLOSED/DISPUTED are not ordinary sealed-path intermediates.

Timing is block-height based: minimum duration >240 blocks; reveal window 2880 blocks; minimum bid 1000 micro-units (C:71–76). Commit accepts height <= deadline; close accepts height >= deadline, leaving same-height ordering relevant. Reveal deadline is **close transaction height +2880**, not the precommitted bidding deadline +2880 (C:651–678).

1. Seller creates auction with item hash, private reserve, mode 1 first-price/2 Vickrey/4 English, payment token, nonce and public deadline. C:340–352 derives auction ID from creator/item/deadline/nonce; seller pseudonym is hash(address, public auction ID). Public `AuctionData` stores the reserve hash and metadata. No seller item transfer occurs.
2. Bidder enters amount locally and obtains a random nonce. UI calls `place_bid` with auction ID, amount, nonce and token (`frontend/src/components/auction/BidPanel.tsx`:67–88). C:692–765 creates a private `SealedBid` and salted public commitment, checks mode/token/status/deadline/pause, unique commitment and nonce hash. No money moves. Fresh nonce permits another bid from the same owner; this is replay protection, not one-bid-per-person.
3. Anyone closes after deadline. No commitments → EXPIRED; otherwise REVEALING. Seller does not control close, but late close delays the reveal window.
4. Intended UI reveal consumes the wallet bid record plus a sufficiently funded credits record for ALEO, or uses a stablecoin public balance (`RevealPanel.tsx`:82–129). S:213–286 accepts a **core_v3** SealedBid, transfers its full bid amount from private credits to public program escrow, returns change, private EscrowReceipt and participation proof; it updates **S-local** public totals/top-two/winner. Unlike L, S does **not** validate core status, reveal deadline or auction mode. A core-v3 bid can therefore be revealed while that auction is still active, absent another constraint outside this source. A frontend-created core-v4 record is not the declared input type.
5. Intended seller finalize re-enters reserve after reveal deadline. C:1006–1183 checks seller/status/time/reserve hash and reads **C-local** highest/second/winner mappings. S's reveals never update those C mappings. There is no cross-program state read or callback bridging them in checked source; the seller UI's `finalize_auction` call cannot itself reconcile that state.
6. Independently, S:293–405 first-price claim accepts a receipt, caller-supplied seller address and item hash. It checks **S-local** winner, reveal presence and unsettled flag, pays seller net of 1% fee and issues private certificate/receipt/completion proof. It does **not** check C's settlement status, reserve, deadline, committed seller or item hash. The current running leader can claim before bidding closes according to this source-level logic.
7. S Vickrey claim requires positive matching local second price and `winningBid > second` (S:425–426,493–505), returns winner change and seller payment. Equal highest bids produce second=highest and fail this strict inequality; UI instead selects first-price claim on equal prices (`ClaimPanel.tsx`:126–151), but the contract itself does not restrict which mode uses which claim path.
8. S refund requires only that the receipt's hash is not the **current** winner (S:545–584). No core terminal-state/time check. A nonwinning revealed bidder can withdraw before final clearing while their amount still contributes to the second price. The highest receipt has no failure/refund exception.

These are checked-source integration failures, not demonstrated transactions on the claimed live deployment. The legacy monolith has shared state and explicit reveal/settlement phase checks (L:543–588,897–955), so do not merge its better timing checks with S's newer privacy claims.

## 3. Structures and actual clearing

C records: SealedBid owner/auction/amount/nonce/token (93–99), BundleBid (101–107), MultiUnitBid quantity/price (109–116), SubsetBid item mask (118–125). Bid hash is `BHP256(bidder,auction,amount,nonce)` (187–192,713–718); multi-unit commitment encodes only quantity*unitPrice as amount (933–940), not the decomposition. Public auction data includes seller hash, item hash, mode/token, status, both deadlines, count and reserve hash (159–172).

S EscrowReceipt stores private owner/auction/escrowed amount/nonce/token (64–70). WinnerCertificate and SellerReceipt hold private entitlement/payment information (72–88). Settlement v6 stores `{winnerBidHash,priceCommit,settledAt}` (131–143), with salted price/fee commitment. Its public mappings still include highest, second-highest, auction escrow and program balance (186–203).

Streaming top-two at each S reveal (273–284):

```text
if bid > highest:
    second = highest; highest = bid; winner = bidHash
else if bid > second:
    second = bid
```

Highest ties keep earliest **reveal** as winner; a tied later bid updates second to the same highest price. There is no commitment-order tiebreak or public randomness.

Intended C clearing: first-price succeeds if highest>0 and highest>=reserve; Vickrey fails with second=0, otherwise succeeds if highest>=reserve (C:1025–1047,1139–1162). Vickrey payment is second, **not max(reserve,second)**: highest=100, second=10, reserve=90 passes intended core gate yet would pay 10. A single revealed bidder fails Vickrey instead of paying reserve. This matters even if the split mapping bridge is repaired.

Advertised ten modes do not imply ten complete clearing engines. Multi-unit creation records capacity/min unit price (C:537–597), but common finalize selects one highest total; there is no ranked capacity allocation, marginal uniform price or pro-rata distribution in checked core/S path. S reveal accepts only SealedBid, not MultiUnitBid/SubsetBid. Bundle subset settlement accepts up to three seller-chosen disjoint masks (C:2077–2196): it checks commitment/reveal **existence**, but not supplied amounts against revealed mapping values nor masks/auction membership against each commitment. It is not a proven revenue-maximizing combinatorial solver. Candle settlement explicitly describes randomness as a social layer and selects ordinary highest revealed bid (C:1459–1462); no enforced random historical cutoff. Blind Dutch publicly stores curve endpoints (C:1808–1811) and clears highest bid over floor, so the advertised concealed current price is calculable from public inputs.

## 4. Fund custody, refunds, delivery and anti-griefing

ALEO reveal transfers actual credits into public program custody and returns source-record change (S:232–245). First-price spends full receipt principal into seller payout plus treasury accounting; Vickrey pays seller second less fee and refunds difference (S:435–452). Losers obtain private refund credits, but their public escrow decrease reveals refunded size. Item delivery is a newly minted WinnerCertificate, with **no inventory possession or item release**. A physical item or external NFT remains a seller promise.

Critical economic findings in checked S:

- Caller-provided payout address and item hash are unbound to committed seller/item (S:295–296,318–320,358–404). Winner can choose where payment goes and what hash certificate names.
- Claim has no reserve/mode/time authorization. Separate C status is not a safety gate.
- Refund has no terminal-state guard; second-price remains based on potentially withdrawn funds (S:573–583).
- Top receipt cannot refund when reserve fails or another path stalls; unconditional nonwinner requirement also exists in legacy failed-auction refunds (L:1380–1389).
- `withdraw_fees` computes admin hash but never compares it against an authorized admin (S:871–891). Anyone reaching the circuit can request treasury-sized payout to self according to source. `resolve_dispute` also computes admin hash without enforcing it (S:815–864); caller chooses whether dispute is valid. This is not an independently enforced admin dispute policy.
- No collateral/bond at commit; withholding reveal costs only network fees. Marketplace `forfeit_unrevealed_bid` merely sets a flag using a caller-supplied deadline (M:1065–1086), without money or linkage to sealed clearing. Dispute bond is a later separate payment: v6 uses a flat 1 ALEO minimum and 100-block post-payment window (S:51–54,757–808), not README's general 10%-of-price guarantee.

C has a useful stale reveal escape: anyone can force FAILED after revealDeadline+100 using action 1 (C:1263–1291); only the pause branch checks admin. But S never consults that failure flag for winner refunds. Core bidder nullifier is nonce-only, global across auctions (C:720–749); use of another nonce is not a bond or Sybil limit. Ordinary sealed C place_bid has no anti-sniping extension; extensions appear in timed escalation (C:2032–2045), and L's older bid path. UI phase restrictions cannot substitute for missing contract checks.

## 5. Privacy and leaks

| Phase/boundary | Visibility established by code |
|---|---|
| Create | Public item/category/mode/token/timing/count and seller pseudonym; reserve hash. Seller pseudonym's salt is public auction ID, so observers with candidate addresses can test them; it is not anonymous against a known-address dictionary. |
| Commit | Private record amount/nonce; salted hash conceals amount. Auction ID/count update and transaction metadata reveal participation timing, even if address is not an explicit core ledger field. |
| Reveal | Full bid becomes public through native private-to-public transfer and escrow/program-balance increments (S:232–238,267–284). Differencing reveals **every** deposit amount even though `revealed_bids` is now bool. Highest/second are directly public. |
| Payment/refund | Public treasury/escrow/balance deltas expose fee/principal; private output records hide recipients from ordinary record readers but do not hide spent program-balance changes. |
| After | `remove(highest/second)` at S:402–403,535–536 erases present mapping entries, not blockchain history. Price commitment is a useful attestation format, not retroactive secrecy. |

Concrete additional leaks/inconsistencies:

- **Unsalted small-domain reserve hash:** C:348–349. Try plausible microcredit prices to recover reserve before close. Hashing alone is not hiding for a low-entropy value.
- **Cosmetic result timelock:** C:2235–2270 delays copying highest into another mapping, while highest is already public at C:264/S:187. This is not time-lock encryption.
- **Stable source v3 explicitly persists all reveal amounts and prices:** T:121–124,181,334–338; public signer funding T:162–165 and public seller payment T:295–298 also link address/amount. Do not attribute this source to uninspected advertised stable v4.
- **Server seller identities:** create UI sends plaintext seller address (`frontend/src/pages/CreateAuction.tsx`:197); backend stores it (`backend/src/routes/auctions.ts`:160,202). Backend bid registration accepts/stores bidder address + bid hash + transaction ID (:231,272). Existence of this route is an operator privacy boundary; ordinary BidPanel shown here does not call it, so universal bidder registration is not established.
- **Remote proving boundary unresolved:** wallet inputs contain plaintext bids and nonces (`useTransaction.ts`:206–219); the Shield recommendation discusses delegated proving (`ShieldWalletBanner.tsx`:8; `useTransaction.ts`:200). This review did not verify provider-side witness hiding. Public fee is default (`useTransaction.ts`:211), adding a potential address linkage surface.

The UI does honestly warn that bid amounts become visible at reveal (`BidPanel.tsx`:185–193; `RevealPanel.tsx`:159). Broad privacy claims about zero participation leakage, forever-private amounts or post-settle deletion should be evaluated against the above data flows.

## 6. UI and UX

Pages include landing/onboarding, browse/search, create, auction detail, wallet-backed My Bids/My Auctions, disputes, docs, fixed sales, RFQs/procurement and token sales. Bid panel shows time remaining, existing private bid amount, minimum, fee/progress/explorer state and QR share link. Wallet automatically stores bid record; reveal panel lists wallet records and checks funding needs. Seller finalize asks for original reserve. Winner claim shows price, fee, seller payout and change; user **manually enters seller address** despite an unimplemented promise that the contract rejects a wrong address (`ClaimPanel.tsx`:57–62,73–75). “Item Claimed” means certificate issuance (:165–168).

Transaction hook polls wallet and explorer with a five-minute uncertain-state fallback. Its application verifiers can give false confirmation: bid verifies only global count increase (`BidPanel.tsx`:73–78); reveal checks only nonzero auction escrow (`RevealPanel.tsx`:77–79); claim checks only nonzero payment proof (`ClaimPanel.tsx`:120–123). Another user's earlier/current transaction can satisfy these. `execute` defaults every function to **core** unless `program` supplied (`useTransaction.ts`:197). Read reveal/claim calls omit `program`; they therefore target core for functions declared in settlement. This compounds source/record mismatches. Receipt fallback requests core records (`ClaimPanel.tsx`:88–90), though EscrowReceipt belongs to S/T. Such integrations need repair before this is a Monday-ready reference.

## 7. Judgment and Zcash mapping

**STEAL:** wallet-owned sealed receipt/change/result records as separate concepts; seller and bidder portable private attestations; explicit reveal privacy notice; uncertain/pending transaction state and recovery guidance; a salted settlement commitment that parties can selectively open; a permissionless stale-auction terminal path, paired with working refunds.

**AVOID:** bidder-funded reveal instead of funded acceptance, public balance differences, unsalted reserve hashes, deleting history as privacy, manual unbound seller payout, relying on frontend phase gating, disconnected lifecycle/settlement state, claiming ten modes without complete allocators, accepting a certificate as delivered inventory, global count-based confirmation.

**Zcash mapping:** a shielded memo can carry a compact auction-bound encrypted bid/receipt reference and a separate portable attestation hash; actual asset is ZEC notes, not minted application records. Bind encrypted refund/payout instructions, seller's delivery commitment, rules hash and receipt set into the auction transcript. Operator scanning escrow sees amounts, so use predetermined collateral tiers independent of exact bids. Off-chain FHE/MPC should preserve losing amounts without public reveals and publish only allowed output commitments. FROST spend signers must enforce the same frozen lifecycle and clearing transcript; PCZT construction is not an on-chain covenant or a proof that item delivery occurred. If using tlock, freeze close before any release and explicitly choose all-bids-after-close disclosure; ordinary result-copying is no cryptographic timelock. NEAR Intents stablecoin ingress settles into ZEC or an external custody leg with explicit refunds; custom stable assets/Leo records do not exist on Zcash. Reserve, delivery and failed-auction recovery must be bound before the first bid is accepted.
