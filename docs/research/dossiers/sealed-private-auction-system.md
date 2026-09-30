# Sealed Private Auction System — design dossier

## 1. Facts / reality

Repo https://github.com/tactfulcipher101/Sealed-private-auction-system; snapshot **4fbd3bf223933b2305cf5c2c532c5f0241e0b3bb**; checkout `/tmp/zecathon-code/auc-doss-timelock/sealed-private-auction-system`. Candidate source GitHub; placement TXE-tested prototype, no independently verified prize. Chain Aztec/Noir. Real source: auction contract, private commitment notes, authwit-gated test token and extensive TXE test scenarios. Only static reading performed; tests/deployments not run or independently confirmed.

Frontend is **simulated**: React state holds `SimulatedBid` (`frontend/src/ui/modules/demo/AuctionDemo.tsx:14-23`); `BidCommitForm.tsx:14-50` replaces proof/encrypt/escrow steps with timers and passes plaintext amount into state. Wallet addresses and commitment hashes are truncated Math.random strings (`frontend/src/lib/demoCrypto.ts:3-16`). Protocol README explicitly separates demo UI and says only test token compatibility was checked (`protocol/README.md:5,39-52`). Its token faucet mints without a supply constraint (`private_token/src/main.nr:18-25`). No physical-asset verification proof or delivery contract: create accepts a caller-supplied `verified_proof: bool` (`protocol/src/main.nr:138-155`).

## 2. Lifecycle / exact flow

Public status 1 Open → 2 RevealWindow → 3 Settled (`protocol/src/main.nr:32-34`). Listing metadata fixes close and later reveal deadline. Bidder private anchor timestamp and queued public timestamp both must be before close (`:199-228,591-608`). Anyone can close at timestamp >= close (`:233-241`); no seller cooperation needed.

1. Seller creates unique listing id, token, positive reserve, close/reveal times, category and optional real-estate stake/closing duration. No lot escrow.
2. Bidder grants one-time token authwit. Private `commit_bid(listing, amount, salt, token_authwit_nonce)` requires amount>=reserve, computes stake=amount*stake_bps/10000 and locks amount+stake from bidder to auction.
3. Contract computes Poseidon2(amount,salt,bidder), initializes bidder-owned BidCommitmentNote under Poseidon2(bidder,listing), and queues only listing/hash into public record (`:216-228`). This private/public linkage is a real solvency-and-lock mechanism, distinct from a public boolean declaration.
4. After someone closes, bidder privately reveals amount/salt, checks note/hash/locked amount, changes note.revealed and queues public hash/amount (`:246-268`). Or anyone knowing amount/salt/bidder can `reveal_bid_for`; this does not consume bidder note (`:278-286`).
5. Anyone finalizes at timestamp **>= reveal_deadline**, or earlier when count>0 and every commitment revealed (`:291-347`). Normal reveal allows timestamp **<= reveal_deadline** (`:619`). Both are legal at equality, making ordering relevant at that boundary.
6. Winner claim or permissionless `settle_winning_bid` pays seller/treasury. Losers claim full bid+stake. Unrevealed bidders after strict deadline can reclaim minus20% penalty. Real-estate seller confirms legal closing, then winner returns stake; otherwise a third party can slash after legal deadline if bid was already paid out.

No encryption/time release is implemented; this is economically incentivized voluntary reveal. Third-party reveal requires preimage delivery in advance, which makes that helper learn the bid before close. The README's “forced reveal” label is therefore stronger than the implemented mechanism.

## 3. Structures and clearing

ListingInfo: seller/token/reserve/close/reveal, verified bool, category, stake_bps and legal_closing_window (`main.nr:49-65`). Public CommitmentRecord: hash, amount(0 before reveal), revealed/claimed/is_winner (`:68-75`). SettlementRecord: winner_hash, winning_amount, has_winner (`:78-82`). Private note: listing/hash/locked bid/stake/revealed/bid_settled/stake_resolved (`bid_note.nr:14-28`). Private note mutations and public claim flags jointly protect payout when relayer reveal leaves private note state stale.

Commitment Poseidon2(amount,salt,bidder) omits listing/chain/contract domain (`bid_note.nr:8-9`); storage slots do include listing (`:4-5`). Reuse of salt across listings could create identical hashes; include domain in our format.

```text
scan indexed commitments 0..count-1 (cap32)
ignore unrevealed or amount<reserve
replace winner iff first valid bid or amount>best
mark only winning index; save hash/amount/has_winner; status=Settled
```

`main.nr:306-347`: first committed wins equal-price tie. One indivisible lot, first price, no second price, quantity or pro-rata. Fees use integer division; 3% SETTLEMENT_FEE_BPS and20% non-reveal penalty are explicitly placeholders (`:35-38`). Winner pays own full bid; no clearing-price surplus, because there is no uniform-price mode.

## 4. Escrow / claims / delivery / griefing

`commit_bid` calls token private transfer of amount+stake (`:209-227`). Winner pays seller97% and treasury3% (`:425-446`); loser receives full locked bid+stake (`:450-468`). Unrevealed claims transfer80% back,20% treasury (`:479-506`), including stake in penalty base. Public `_mark_late_claim` rejects bids already relayer-revealed, closing a stale-note loophole (`:664-696`). Claim flags prevent duplicate claims (`:778-804`). Permissions for arbitrary winner payout verify settled amount and shared winner flag (`:559-565,700-708`).

Real-estate stake remains locked after bid payment. Seller alone confirms external closing (`:512-529`), then paid-out winner can release stake (`:535-552,712-733`). Default slashing requires already paid bid, strict legal deadline passage, no confirmation or prior stake resolution (`:738-773`);100% of slashed stake goes seller by configured constant. This gives seller a strong off-chain confirmation trust role: seller withholding confirmation can make bidder lose stake without a neutral delivery adjudication path.

Three immutable guardian addresses and threshold votes toggle pause. Queued commits/reveals, finalize, confirm and slash require unpaused; payout/refund/stake-return gates omit pause. **Important qualification:** already-revealed normal loser refunds still require status Settled (`:778-781`); guardians pausing before finalize can indirectly prevent that refund entitlement even though claim itself is not pause-guarded. Non-revealed late refund is available after deadline without finalization (`:664-696`). Code tests include paused payout/refund/stake paths (`protocol_test/src/lib.nr:1861-1976`) and late recovery (`:1980-2045`); not run here.

Cap32 bounds scans but funded pseudonymous participants can fill it. No timelock recovery of missing salts; losing wallet/salt can prevent late claim. No item transfer, bonded seller, shipping escrow, cancellation or emergency “refund all even before settled” identified. Asset verification is a boolean, not authenticated external evidence.

## 5. Privacy / visibility

Before close public rows expose listing membership/count and salted hash, not amount or bidder field (`:591-608`). Bidder's PXE sees plaintext and receives commitment note; token balances credited to auction are private notes (`private_token/src/main.nr:31-38`). A private contract balance is not an ordinary Zcash receiving wallet; do not assume its application privacy automatically ports to any holder of a Zcash viewing key. Exact runtime key/log visibility and production token compatibility were not established by this static read.

After reveal all public amount/hash pairs and winning price are visible (`main.nr:612-647,339-347`). The private function qualifier does not hide the enqueued public amount. A keeper receiving preimages early sees bids before close; contract has no tlock protection. Low-entropy/reused salts risk price/address guessing. Seller/regulated intermediary obtains real identity for external closing per contract commentary (`:1-7`), so no comprehensive anonymity promise.

Demo browser retains all simulated prices, and fake commitment doesn't bind amount (`BidCommitForm.tsx:41-49`; `demoCrypto.ts:15-16`). Its UI assertion “never shown to seller ... until close” (`BidCommitForm.tsx:64-68`) is a UX story, not proof of operator-blind cryptography.

## 6. UI

Screens: simulated wallet connect → catalogue or list asset → listing detail → bid form → timed proof/lock animation → live room → settlement reveal (`AuctionDemo.tsx:64-154`). Seller sees own listing/live/result; bidder sees reserve and commit steps. This is useful interaction design, but no actual authwit, PXE or contract transport traced from this UI. Real protocol requires wallet-generated authwit/proof, explicit close/reveal, then independent claim transactions. UX must explain two deadlines and salt backup if retained.

## 7. Judgment / Zcash mapping

**STEAL:** reserve checks; solvency linked to actual locked funds; independent permissionless finalize; per-bid claim/idempotency records; separate money, late-recovery and delivery stake obligations; refund-oriented emergency policy; hard cohort limit.

**AVOID:** harsh20% placeholder penalty as a shipped policy; requiring users to return online; helper preimages before close; seller-only physical delivery attestation; marketing boolean verification as proof; pause that indirectly strands settled eligibility; demo animation labelled as actual proof; omitting domain from commitment.

**Zcash proposal:** use tlock to remove voluntary reveal from honest bid flow. Fixed shielded collateral protects operator-blind price even when escrow viewing key reads note value; opening enforces amount<=collateral. Hash canonical envelope with auction/network/round/bid nonce/refund address and ciphertext digest in memo/receipt. FROST custody committee applies admission, reserve, deterministic tie policy, payout and refund policy; PCZT assists transaction review/construction. Neither replaces Aztec contract enforcement or proves committee honesty. Penalties should target demonstrably malformed commitments and funding abuse, not drand outage/keeper failure. Keep physical delivery trust explicit; a neutral escrow agent or external-chain asset transfer is a separate product component. NEAR Intents is optional funding/delivery integration with source-chain visibility, not confidential solvency. For the hackathon, avoid real-estate legal closing complexity.
