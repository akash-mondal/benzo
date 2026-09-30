# Dark Pools — Canton selective disclosure and atomic bounded fills

## 1. Facts and real versus mock paths

Static inspection 2026-09-30; no source/tests executed. [BootNodeDev/cn-hackathon-darkpools](https://github.com/BootNodeDev/cn-hackathon-darkpools), commit `91391905c80dac4b5e301c30f74e4713e69c9aee`, clone `/tmp/zecathon-code/auc-doss-batch/cn-hackathon-darkpools`. Relative citations pinned there. [ETHGlobal New York 2026 showcase](https://ethglobal.com/showcase/dark-pools-pgah9) confirms **Canton Foundation: Private DeFi & Capital Markets winner**. Chain/language: Canton/Daml, generic token-standard interfaces; frontend React/TypeScript with wallet execution, backend Express/ledger projection/scheduler.

Real Daml bounded-fill and allocation/transfer logic exists; tests cover math, settlement, privacy and adversarial venue cases. But the app has intentional simulation paths: frontend defaults to MockDarkPoolClient with simEngine unless VITE_DARK_POOL_API is set (`frontend/src/darkpool/DarkPoolProvider.tsx:9–24`); backend selects in-memory mock when DARK_POOL_MOCK=1 (`backend/src/config.ts:55`, `backend/src/wiring.ts:22–25`). Therefore seeing a working UI alone would not establish ledger settlement. Showcase reports DevNet deployment; deployment/transactions were not independently verified. This is continuous bilateral dark-pool matching, not time-sealed batch bidding.

## 2. Lifecycle and exact flow

Pool is venue-signed stable contract. Archiving it pauses matching while orders remain; recreating anchor resumes matching (`contracts/daml/dark-pool/daml/DarkPool.daml:44–71`). Resting order is consumed on fill/cancel/reject and recreated for a fillable remainder.

1. Trader chooses Buy/Sell, quantity, limit, minimum fill, optional expiry and funding holdings. `DarkPool_PlaceOrder` is trader-controlled, nonconsuming; it derives pair/venue from pool, verifies holdings belong to trader, match funding instrument, are unlocked and cover worst-case notional (`DarkPool.daml:72–100`). **It validates, but does not lock, inventory at placement.**
2. Create Order, signed by trader and observed by venue. Venue projection reads full order. Funding set is trader-bound and later consumed whole (`:179–206`).
3. Scheduler/backend considers live crossing buy/sell orders; venue may also preview match plans and submit via wallet. Backend chooses pair, Daml computes/validates numbers.
4. `DarkPool_Match` fetches both orders, checks same pool/instruments, opposite sides, no self-match, minimum fills, limits cross and requestedAt ≤ now < allocateBefore ≤ settleBefore (`:129–148`).
5. Two sibling `Order_Fill` exercises allocate quote/base legs using each order's declared holdings. Registry must return Completed allocation synchronously, else fail (`:235–269`). Create change-funded remainder if quantity left ≥ minFill (`:270–282`).
6. Create transient FillAuthority for each leg, signed by trader+venue; chain the two authorities to obtain both traders+venue only for settlement, validate mirrored counterparties and one shared settlement, then execute both allocation transfers (`:284–351`). Everything is one transaction; failure rolls back both fills/allocations.
7. Record authoritative MatchResult, refresh projection; on error refresh and report rejection rather than blind retry (`backend/src/settlement.ts:35–68`). Trader cancels own Order; venue may reject expired/unfundable orders (`DarkPool.daml:211–219`).

No close/opening deadline, secret release or seller reserve. Order expiry is checked strictly `now < expiresAt` inside fill (`:237`), not automatically archived by passage of time. Backend's 5-minute allocation and 1-hour settlement windows (`settlement.ts:10–11`, `:47–49`) are allocation context, not an auction bidding period.

## 3. Data and actual clearing algorithm

Order: trader, venue, pool ID, base/quote InstrumentId, side, remaining quantity, limitPrice, minFill, optional expiresAt and holdingCids (`DarkPool.daml:179–203`). FundingArgs contains allocation factory CID and registry context. FillResult returns allocation, authority and optional remainder CID. MatchResult returns price/quantity, two leg results and remainder IDs (`:20–42`). No hidden cryptographic bid commitment: the order itself is plaintext to authorized stakeholders.

```text
backend: live buys sorted descending limit, then oldest ledger creation offset
         live sells sorted ascending limit, then oldest creation offset
for each buy:
    sell = FIRST unused crossing sell with different trader
    if none: skip
    qty = min(buy.qty,sell.qty)
    if either minimum-fill/floor fails: skip buy
    else emit one plan; mark sell used for this pass
ledger: require valid matching context and limits cross
        price = floor_10dp((buy.limit+sell.limit)/2)
        qty = min(remaining sizes)
        quote_transfer = floor_10dp(qty*price)
        atomic allocate/execute both legs
        recreate remainder only if remainder >= order.minFill
```

Backend exact selection: `backend/src/matcher.ts:14–39`, `:48–77`. Daml exact math: `contracts/daml/dark-pool/daml/DarkPool/Math.daml:15–57`. It is not a uniform auction; every chosen pair may have a different midpoint. Limit prices protect buyer/seller individually. No multi-unit pro rata; partial fills consume smaller quantity, tail below minFill is dropped from order without confiscating funds. Ties use creation offset in backend, but **price-time fairness is not a ledger constraint**: venue chooses which orders to pair (`DarkPool.daml:102–105`). Matcher chooses first crossing sell before checking fill compatibility, so a small/minFill-incompatible first sell can block a later compatible candidate for that pass (`matcher.ts:51–57`). This is a source-derived missed-fill condition, not an executed test failure.

## 4. Custody, refunds, change and griefing

Venue does not hold funds. Trader declares existing holdings; at fill allocation factory consumes whole set, locks only needed amount and returns change. Remaining order points to change holdings (`DarkPool.daml:259–280`). Atomic execution delivers generic base/quote tokens. If trader moves declared holdings in the meantime, fill fails closed; source explicitly accepts staleness and requires cancel/re-place (`:198–203`). Capital can back multiple resting declarations unless held/allocated, so “funded at birth” is a balance snapshot rather than escrow.

No separate winner/loser refund cycle or non-reveal penalty. Cancellation removes order, not a deposit. Recoverable allocations can be withdrawn by trader if a venue constructs a bounded allocation without completing match (`:221–226`); normal Match completes allocation and transfer together. MinFill/floor and no self-match reduce dust/obvious probes. Venue can censor/select matches/reject an order, but cannot make arbitrary prices exceed signed limits in reviewed paths. Item is Canton token; physical/legal delivery not solved.

## 5. Privacy, leaks and frontend/API bypasses

**Native ledger boundary:** Order signatory trader / observer venue (`DarkPool.daml:205–206`) means trader and venue see plaintext quantity and limit from creation. Other traders do not see private resting Order or sibling fill subtrees. Transfer execution subtree is shared to both traders+venue (`:289–294`), so counterparties may know counterparties/fill legs while remaining order details stay private. Participant hosts serving these stakeholders also handle plaintext; this is access-controlled ledger disclosure, not operator-blind encryption.

**Additional application leak found:** `backend/src/http.ts:245–266` returns all pools' complete books/trades from `/venue`. `/trade` uses an arbitrary caller query parameter party (`:269–285`) to return that party's orders, fills and balances. `createApp` registers both routes after only CORS/JSON middleware (`:450–465`); entrypoint listens directly (`backend/src/server.ts:12`). No incoming caller authentication/venue authorization was found in those paths. Outbound ledger API tokens in auth.ts do not authenticate HTTP customers. A publicly reachable backend without an external access-control proxy can therefore defeat the Daml-level privacy; CORS is not authentication. Deployment edge protection was not inspected, so this is a source exposure finding with a stated deployment condition, not a claim about a live leak.

Trader requests and backend projection are plaintext; public/operator venue UI is intentionally the full book. Hashing trade IDs or restricting browser screens would not repair this API boundary.

## 6. UI and UX

Trader view includes pair selector, side/order entry, balance context, MyOpenOrders and MyFills (`frontend/src/features/trade/{OrderEntry,MyOpenOrders,MyFills}.tsx`). Venue view shows full book, trades, matching controls/schedule (`frontend/src/features/venue/VenueView.tsx`, `/routes/venue.tsx`). Connection/wallet signing uses frontend wallet execution/ledger command planning. HTTP client polls every 3 seconds (`frontend/src/darkpool/client/HttpDarkPoolClient.ts:15`); mock client defaults noted above. Sources were read, UI not rendered. No seller listing/close/reveal UX.

## 7. Judgment and Zcash mapping

**STEAL:** trader-bound destinations/instrument/funding; transient scoped settlement authority; atomic whole-set settlement/change; mandatory fail-closed arithmetic; minimum-fill floor; match preview distinct from signed execution; authoritatively parse settlement result. **AVOID:** venue-readable bids; calling declared holdings escrow; unauthenticated venue read endpoints; simulation chosen silently; assuming fairness from contract limit checks; first incompatible candidate stopping search.

Zcash has no Daml choices, custom token-standard allocations or native two-asset swap. PCZT can scope participant contributions/outputs and FROST can require multiple signatures, but neither recreates Daml smart-contract price enforcement. A committee must validate manifest, frozen bid set, clear result and payout plan. Client-side tlock/threshold sealed bids protect auctioneer until close; **encrypt before HTTP submission** and avoid sending full quote through wallet-plan endpoints. Fixed cap deposits prevent viewing-key amount inference; memos bind deposit/receipt to seal hash. Shielded payouts can include all refunds/change and seller proceeds in one reviewed ZEC transaction, while external asset/item delivery needs custody/registry/NEAR Intents policy. Native viewing-key scoping/selective receipt disclosure replaces some Canton views, with authenticated APIs required throughout.

**Design priority:** best authority/atomicity reference; its privacy model and default UI simulation cannot satisfy the project's headline without a new seal and authenticated API.
