# datum — design dossier

## 1. Facts / placement / reality

Repo https://github.com/lezhouma/eth-global-project; snapshot **3230cb147639c5ccfb4c8dd2f18473b11c147de5**; checkout `/tmp/zecathon-code/auc-doss-timelock/datum`. Candidate attribution: ETHGlobal New York 2026, Canton Foundation Private DeFi & Capital Markets winner; placement is prior research provenance, not independently reverified here. Chain: Canton DevNet plus off-ledger Python/Flask call auction. Source was read, never executed.

Real: price/quantity matching engine, Canton Ledger API integration and Daml delegated debit/credit settlement, privacy-tier explorer. Mock/limited: `wETH` is a holding instrument label, not a bridge or wrapped ETH (`liquidation-auction/main/daml/Holding.daml:3-7`); `front-end/README.md` is empty and no bidder-facing front-end implementation exists there. Integration failure becomes an explicitly labelled placeholder result (`matching_engine/settlement.py:87-105`). The explorer has real API-backed ledger projections but is a local multi-role demonstration, not authenticated production user access.

## 2. Lifecycle and exact flow

Server singleton starts Idle → Open → Closed/matching → Result; settlement submission happens after matching, not a distinct durable state. Auction has in-memory orders, end_time, bool is_open, optional result and lock/timer (`matching_engine/engine.py:36-57`). No persistence/restart recovery, auction manifest or commit/reveal phase.

1. Client POSTs `/auction/start` duration; server resets orders/result, assigns wall-clock end_time and starts daemon timer (`engine.py:234-259`). Caller is not authenticated.
2. Bidder POSTs `/orders` with buy/sell, float price/quantity, user_id and wallet_address. API checks positive numbers, wallet string and open/end-time (`:262-298`), but no signature, solvency or reservation. It stores full plaintext.
3. `/auction/status` returns **every live plaintext order** sorted by price (`:301-322`), including identity and wallet fields via `_order_dict` (`:179-188`). It is not sealed from competitors.
4. Timer snapshots orders and closes under lock, computes clearing, then builds net legs and submits to Canton (`:195-222`). Result is exposed without per-user filtering (`:325-332`).
5. Canton integration resolves user labels to configured parties, looks up delegated authorities and a sufficient single holding for each giver, attaches explicitly disclosed contracts and calls one create-and-exercise SettlementRequest.Execute (`integration/settle.py:58-114`). On failure the Python bridge reports placeholder, not funded settlement.

**Race inference from code:** close sets is_open=False before external settlement completes. A new `/auction/start` can reset the singleton while old uncross is still running, and old callback later overwrites auction.result (`engine.py:195-222,241-253`). Need per-round durable state.

## 3. Structures and clearing algorithm

Order: uuid, side, float price/quantity, user_id/wallet_address and server timestamp. Result: price, matched_quantity, bilateral trade list, unmatched list, closed_at, auction_id, settlement instructions/response. Contract MatchResult uses Decimal legs with party/instrument/delta, clearingPrice and totalVolume (`Types.daml:9-23`); there is no bid commitment/deposit object.

```text
prices = sorted(unique submitted prices)
for p in prices:
  demand[p] = sum buy quantity where limit>=p
  supply[p] = sum sell quantity where limit<=p
  volume[p] = min(demand[p], supply[p])
choose prices achieving maximum positive volume
lo,hi = min/max such prices
if demand(lo)>supply(lo): p=hi
elif supply(lo)>demand(lo): p=lo
else: p=(lo+hi)/2
sort eligible buys by (-limit, timestamp), sells by (limit, timestamp)
pair sequentially, filling min(remaining buy, remaining sell, remaining volume)
```

Actual `engine.py:64-176`. If either side missing or no crossing, return no trades and all orders unmatched. Multi-unit/fractional quantities supported; partial marginal order filled by price/time priority, **not pro-rata**. Equal-price/time ties retain input order. No external reserve; seller limit is minimum acceptable price.

**Price-policy qualification:** tie breaking uses imbalance only at the lowest maximum-volume candidate, then chooses the high/low endpoint or midpoint (`engine.py:104-113`). It does not optimize minimum imbalance over all candidates. That is an explicit implementation rule, not a claim of a universal call-auction standard; reuse only with specified fixtures and user-visible economics.

**Concrete reporting defect:** `_fill_at_price` returns unmatched only from eligible orders (`:164-176`), omitting non-crossing orders whenever some trade occurs. Those orders still require refund/collateral release in a funded port. `float` and exact-zero remainder checks (`:159-162`) can introduce precision/residual errors; use integer zatoshis and lot units.

## 4. Settlement / funding / griefing

No bid escrow, refund loop, bonds, non-reveal penalty or spam prevention. Orders can exceed available funds; sufficient holdings are checked only at settlement. The API does not authenticate submitted wallet/user labels, and netting uses wallet identity for API deltas but user_id for Canton legs (`settlement.py:24-48,55-84`), so inconsistent identities can diverge.

Daml Execute validates per-instrument net sum0, finds matching authorities, debits givers, credits receivers and emits result/record atomically (`Settlement.daml:20-26,72-133`). Debit archives input holding and creates positive remainder (`Delegation.daml:36-54`). Failure rolls whole transaction back; label assets have no physical/item delivery or external bridge.

**Authority issue:** nonconsuming `CreditHolding` directly creates a Holding using caller-supplied issuer; it does not require the upstream conservation check itself (`Delegation.daml:59-66`). The exchange observes the grant and controls that choice; direct exercise can mint ledger-labelled holdings within per-call maxAmount, repeatedly. Debit too is directly callable and checks only per-call ceiling, not lifetime spent budget (`:36-46`). This is a bounded test delegation design, not a hardened sole-settlement path. Conservation in Settlement.Execute does not restrict every grant choice.

SettlementRecord contains the entire net batch and lists every party as observer (`Settlement.daml:44-52,120-132`). Therefore each matched participant sees all legs in that record, not exclusively their bilateral trade. Issuer observes its holders; exchange transiently sees disclosed giver holdings. `integration/settle.py:70-91` searches as owner through shared client before disclosure, so backend credentials are an additional plaintext access boundary.

## 5. Privacy leaks

Pre-close: operator receives plaintext immediately; unauthenticated public status route returns side/price/quantity/user_id/wallet/timestamp (`engine.py:179-188,301-322`). Thus no pre-close operator or rival blindness, regardless of Canton projection privacy. Post-close: unfiltered result publishes trades, buyer/seller wallets and IDs, plus unmatched and settlement data (`:143-154,325-332`). Placeholder log prints per-wallet deltas (`settlement.py:100-105`).

Canton publicParty receives aggregate price/volume; regulator + every participating party receive full batch; owner+issuer receive holdings (`Settlement.daml:30-52`; `Holding.daml:18-27`). Hosting organizations for those parties see plaintext; projection privacy is not encryption from their own backend.

Explorer `/api/tx?party=role` lets any client select a configured role using a shared server client, without auth (`integration/explorer/server.py:32-34,63-76`); its settlement route also accepts arbitrary JSON MatchResult (`:82-97`). It binds loopback by default (`:113-118`), so this is a demo disclosure risk if exposed, not evidence the public internet currently reads it.

## 6. UI / UX

Bidder submits REST/CLI orders; `front-end/` lacks implemented screens. Explorer UI offers Public, Regulator, OwnerA and OwnerB tabs (`integration/explorer/static/app.js:3-8`), transaction detail, legs/holdings and “Run settlement” POST (`:118,146`). Useful demo teaching device for who sees what, but production role switching requires server-side authorization. Result readiness differs from settled funds: placeholder mode must be visibly labelled.

## 7. Judgment / Zcash mapping

**STEAL:** two-sided max-volume call-auction computation as a future market direction; price/time priority explicitly specified; per-party net legs; conservation checks; atomic internal settlement; role-scoped result UX; honest placeholder status.

**AVOID:** open plaintext order book; unauthed identity labels/role toggles; float money; resetting live singleton; using a missing-order result as full refund plan; direct debit/mint delegated choices; equating a token label with bridged collateral.

**Zcash proposal:** use tlock ciphertext instead of plaintext POST; persist acceptance receipts and freeze complete set before R. Start with one seller/one lot rather than two-sided market complexity. If later porting call auctions, decrypt only after cutoff, use integer ticks/lots/zatoshis, deterministic order receipts and return every unused collateral amount including non-crossing orders. Fixed-tier collateral avoids revealing limit price to receiving wallet. FROST signers validate net conservation and exact authorized outputs before PCZT signing; there is no Daml atomic cross-asset settlement on Zcash. External asset custody and NEAR Intents require a separate delivery/funding trust model. Prefer public aggregate clearing result and individually encrypted bidder receipts over a full-batch disclosure record; using a shared viewing key for all parties would widen visibility.
