# Zerith encrypted auction suite

Owner: `auc-doss-fhe`. Static read-only review, 2026-09-30. Repository https://github.com/Ritik200238/zerith, commit `256bab25ddffedfc6e5cb8b6323662e2c92e7553`. Paths/lines relative to `/tmp/zecathon-code/auc-doss-fhe/Ritik200238--zerith/`. No repository execution or runtime verification.

## Facts and reality

Saved research: Fhenix Privacy-by-Design buildathon, wave-5 $350 grant; chain Ethereum Sepolia. CoFHE Solidity, Next.js UI, deploy/verification scripts and stored screenshots exist. Award/deployed correctness not independently exercised. Core auction code is real FHE, but funding and clearing-to-settlement enforcement have serious source gaps. Four modes below are distinct contracts; do not infer one mode's safeguards from another.

Paths abbreviated SA=`contracts/features/SealedAuction.sol`, VA=`VickreyAuction.sol`, BA=`BatchAuction.sol`, DA=`DutchAuction.sol`, SV=`contracts/core/SettlementVault.sol`.

## Lifecycle and exact flow by mode

**First-price / Blind Floor.** Seller creates public item token/amount/payment token/deadline (minimum 300s) with encrypted reserve optionally (`SA:103-204`). No item transfer happens here. Bidder locally encrypts uint128, calls bid once/address, cannot use seller address, no funds transferred or reserved (`210-249`). Running encrypted max/winner, own-bid ACL. Any late bid in last 60s can reset deadline to now+extension; default 120s. Seller alone closes after end if bidCount>0 (`256-278`). Winner/bid become public; reserve is compared homomorphically and only boolean published. Anyone submits exact-handle threshold signatures (`285-342`). Anyone settles: fail reserve -> RESERVE_NOT_MET or transfer item/payment/fee via vault -> SETTLED (`347-406`). Cancellation only zero bids (`410-417`).

**Vickrey.** Same one bid/address and extension; tracks encrypted top two and winner (`VA:128-187`). Seller-only close releases highest **and** second **and** winner (`193-205`), then verified reveal (`224-244`). If second==0, contract replaces it with highest (`235-236`), so single positive bidder pays own bid, not a reserve. Settlement charges second plus 2% split, updates vault and claim NFT (`249-292`).

**Batch.** Admin creates timed round; buy/sell submit encrypted limits with **public quantity**, total max 5 orders; no escrow (`BA:92-165`). Admin after deadline supplies three candidate prices, computes encrypted clearing (`172-223`), anyone publishes verified price (`228-240`), admin settles (`244-285`). CLOSED enum not used in flow. Ladder is supplied **after orders**, not committed at creation, and ascending order is only a comment, not validated.

**Dutch.** Public starting/end price, inventory, duration >=300s; seller lists without funding (`DA:90-118`). Public linear price decline (`78-86`). Buyer submits encrypted quantity clipped against current unclaimed inventory; stores purchase and price, no transfer/reservation (`125-149`). Buyer may immediately request disclosure and finalize own claim—neither requires auction ended/SETTLED (`165-185`). Finalization reveals quantity, caps at then-remaining inventory, updates vault/payment/fee and filledAmount (`187-227`). Hence claim order, not purchase order, decides inventory exhaustion. Anyone marks SETTLED at expiry/full fill; this does not gate claims (`153-159`). No pro-rata.

## Structures and clearing pseudocode

SA Auction: public parties/assets/lot/deadline/count/status, encrypted uint128 max/address/reserve and encrypted uint64 reserve bit, plaintext revealed result (`28-48`). VA adds secondBid. DA Purchase stores public buyer/price, encrypted quantity and claimed flag (`36-40`). BA BuyOrder/SellOrder stores public participant and amount, encrypted price (`16-25`).

```text
SA: if b>top: winner=sender; top=max(b,top)
reserveOK=(top>=reserve)
VA: second=select(b>top,top,select(b>second,b,second))
     winner/top update iff b>top
     public settlement price = (second==0 ? top : second)
BA: for supplied candidate c in array order:
    D=sum(publicQ_i where encryptedMax_i>=c)
    S=sum(publicQ_j where encryptedMin_j<=c)
    if D>=S: selected=c
```

Strict top comparison -> earlier top survives equal bids; equal top becomes second, so VA tie price equals winning bid. Zero SA bids keep zero winner. Batch selects last qualifying array candidate, includes `0>=0` as clearing even with no eligible sellers, and maximizes neither executed volume nor declared uniform-auction welfare. **Settlement ignores all price eligibility**, simply pairs arrays, trades min(pair quantities), increments both indices, discards larger side's remainder (`BA:251-282`). This is not correct multi-unit clearing or pro-rata allocation. DA price is first-come acceptance but claims reveal quantity and inventory consumption.

## Escrow, refunds, item delivery and anti-griefing

SA/VA/BA/DA intake does not reserve payment or inventory. Users may keep balances in shared SettlementVault and withdraw before settlement (`SV:101-130`). settleTrade silently zeroes an underfunded leg independently (`167-194`); calling item/payment legs sequentially does **not** ensure both succeeded. A funded seller leg can transfer while buyer payment becomes zero. Claims still mint entitlement NFTs; status still SETTLED. `SA:367-369`, `VA:261-263`, `BA:265-274` narrow public uint128/uint256 into uint64 without range guard. SettlementVault credits requested deposit amount rather than returned actual transfer (`SV:85-89`), potentially creating unbacked internal balance if FHERC20 returns zero. These are static accounting findings, not reproduced exploits.

No losing refunds because no auction-specific bid deposits; shared vault withdrawal is not a bid refund. No bidder non-reveal duty, but seller can withhold close. No failed-decryption escape. Spam has no auction bond; Sybil bids can extend indefinitely, and custom extension under 60s can even shorten deadline by assigning now+extension (`SA:244-246`). Blind reserve claim is bounded by output inference: revealed top and reserveOK constrain reserve even when handle never decrypts. Item delivery is confidential vault ledger movement plus ordinary claim NFT, not a physical-item delivery guarantee.

## Privacy and leaks

SA/VA own bids are ACL-gated; operator cannot read running max from application grants. Public sender, count and deadline changes (`SA:74-77`, `249`) remain. After close highest amount/winner public even if reserve fails (`264-274`, `332-341`). VA reveals highest unnecessarily for second-price payment and reveals a losing bid as clearing price (`200-202`). BA public quantity/events (`66-67`, `138`, `164`) disqualify fully private order-size claims. DA quantities can decrypt during auction (`165-170`) and finalize calldata/filledAmount disclose purchases (`185-189`, `222`). Suite UI's “Losing bids never decrypt — ever” and “100% encrypted bids” (`frontend/src/app/auctions-suite/page.tsx:204`, `280`) do not describe all modes accurately.

## UI / UX

Auction listing/detail/create/bid modals, Blind Floor toggle, own-bid unseal, four-step TxFlowDrawer are real in `frontend/src/app/auctions/page.tsx:237-277`, `377-400`, `425-451`, `465-506`. Bid flow encrypts then submits directly (`479-483`), matching lack of escrow. Seller close/reveal/settle actions use exact stored ciphertext handles and decryptForTx (`514-604`). Auction-suite page is mechanism navigation/marketing, not proof all variants complete. Stored verification media is author-supplied evidence, not this review's executed test.

## Judgment and Zcash mapping

**STEAL:** encrypted reserve predicate; strict top-two accumulator; mechanism explanations; close/reveal/settle progress and own-receipt unseal; field-bound signed decryption.

**AVOID:** unfunded bids, public quantity, uncommitted post-close ladder, batch settlement unrelated to eligibility, excessive highest-price disclosure in Vickrey, unbounded deadline extensions, uint64 truncation and independent zero-payment legs.

For Zcash require confirmed fixed collateral before including bid ciphertext in frozen input root; escrow an external lot/contractual delivery obligation before opening. Use immutable deadline and output-only off-chain FHE/MPC, clearing winner and payable price only. FROST signers enforce a single conservation-checked PCZT for payout/refund/change instead of independently best-effort legs. Encrypted reserve must be auction-bound, with claimed inference policy explicit. tlock reveals all submissions after close; choose it only for that privacy policy. NEAR Intents funds external asset legs but does not prove shielded swap/lot delivery atomicity.
