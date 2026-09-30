# Nyxbid — design dossier

## 1. Facts and implementation status

Static inspection 2026-09-30, no execution. [Nyxbid/Nyxbid](https://github.com/Nyxbid/Nyxbid), commit `e2eddfe84bbbc8edd24c4470a24a174b9e93fea5`, clone `/tmp/zecathon-code/auc-doss-batch/Nyxbid`. Paths below are relative to that clone. Discovery/placement: saved `research/ideas_unique.jsonl` and `research/auction/candidates.jsonl` identify a [Colosseum Frontier 2026 submission](https://colosseum.com/arena/projects/nyxbid); no win inferred. Solana Anchor/SPL token program, Rust HTTP transaction builder/indexer, Next.js UI, unit/smoke test source. Real escrow instructions and transfers are present. Deployment and successful end-to-end auction are not independently established; transaction simulation is an ordinary RPC operation, not by itself evidence that settlement is mocked.

Scope is a fixed-size taker RFQ, with makers posting sealed price quotes. Public taker intent and public reveals distinguish it from a fully private order book.

## 2. Lifecycle and exact flow

`Open → Resolved → Settled`, plus `Open → Cancelled/Expired` and `Resolved → Expired` (`chain/programs/nyxbid/src/state.rs:132–147`). Time phases happen while status stays Open; **Resolved means the winning maker has funded**, not just that reveal time ended.

1. Taker creates intent: side, base/quote mint, full size, limit price, reveal/resolve/settle deadlines, commitment root. Require ordered deadlines and at least five seconds before reveal starts (`instructions/create_intent.rs:101–118`). Buy locks `floor(size*limit/1e6)` quote tokens; sell locks size base tokens (`:80–87`). Program-owned escrow PDA controls taker vault.
2. Makers submit opaque commitment before `reveal_deadline`. Quote account PDA includes intent, maker and a **16-byte account nonce**, distinct from secret 32-byte hash salt (`submit_quote.rs:7–10`, `:25–30`). Maker pays account rent; no bid capital is locked (`:47–77`).
3. During `[reveal_deadline,resolve_deadline)`, maker signs reveal of `(price,size,nonce32)`. Program recomputes SHA256 of LE-u64 price || LE-u64 size || nonce32, requires full size and acceptable price, records reveal and updates current winner (`reveal_quote.rs:53–119`).
4. At/after resolve deadline, before settle deadline, only final winning quote's maker can fund the opposite leg; exact mint/amount is checked and transferred. Status now becomes Resolved (`fund_maker_escrow.rs:54–61`, `:111–178`).
5. Anyone can pay for settlement before settle deadline: move both token legs, refund buy overpayment, close vaults/rent, persist Receipt, increment settlement reputation (`settle.rs:145–240`, `state.rs:96–116`).
6. Taker can cancel only before reveal begins (`cancel.rs:62–63`). After settle deadline, separate no-maker/funded-maker expiry routes refund deposits; defaulting winner gets `failed_reveals` increment (`expire_no_maker.rs:118–146`; `expire_with_maker.rs:107–108`, `:167`). Non-revealing losing quotes have no monetary slash.

The supplied commitment root is stored (`create_intent.rs:143`); reveal validation uses the individual Quote account, not a demonstrated Merkle inclusion proof. Do not infer a frozen Merkle participant set from that field name.

## 3. Structures and clearing

Intent: taker, side, pair, size, limit, three deadlines, commitment root, status, cached winning quote/price, PDA bumps (`state.rs:25–55`). Quote: intent, maker, commitment, revealed price/size/salt, revealed/funded flags (`:60–69`). Escrow: both token amounts/mints, maker, settled flag and vault bumps (`:78–94`). Permanent Receipt discloses parties, pair, full size, winning price and settle time (`:107–116`). Reputation counters: submitted/won/settled/failed (`:123–129`).

```text
on valid reveal:
    require exact_size == intent.size
    require buy ? price <= limit : price >= limit
    if no winner OR (buy ? price < best : price > best): replace best
    else: keep current best
at funding:
    require maker owns canonical winning quote
    buy: maker deposits size base
    sell: maker deposits floor(size*winning_price/1e6) quote
at settlement:
    pay winning first-price terms; buyer receives price-improvement refund
```

Source: `reveal_quote.rs:79–109`, `fund_maker_escrow.rs:122–149`, `settle.rs:163–175`. Ties keep the **earliest valid reveal in ledger order**, not earliest commitment. Limit is a taker maximum for buys/minimum for sells. Single maker supplies the full lot; no partial fills, pro rata, second price, or uniform multi-unit auction. Zero/overflow notional handling matters because fixed-point division floors (`state.rs:159–164`). Winner's revealed price is called clearing_price in an event, but it is a single best RFQ price (`fund_maker_escrow.rs:183–187`).

## 4. Custody, refunds, item delivery and griefing

Program PDA custody rather than an off-chain operator. Taker locks worst-case payment; maker locks nothing until it has won. Buy settlement computes actual payment, checks it is ≤ locked amount, refunds difference; both token legs transfer atomically (`settle.rs:166–220`). Vault account rent returns to original payers; Receipt remains. SPL tokens are the item, not physical delivery.

Cancellation and expiry are explicit refund mechanisms. Missing reveal means the maker's quote is ignored. Winning-but-unfunded maker takes only a reputation penalty, so it has a free option over the price move between commitment and funding. Multiple makers/accounts can submit multiple rent-paying quotes; no hard collateral, per-intent quote cap or slash guarantees execution. No runner-up fallback after winner default was found in these instructions. The taker remains locked until expiry even if the market's chosen winner is insolvent. Transfer destination owner/mint and canonical winner constraints are important to preserve when borrowing the refund design (`settle.rs:73–100`, `fund_maker_escrow.rs:54–61`).

## 5. Privacy and concrete leak paths

Before reveal, quote price is sealed by a salted hash **if client keeps nonce32 secret**; operator/server cannot invert a fresh 256-bit salt simply from commitment. However, taker identity, side, mint pair, size, limit and deadlines are public ledger fields (`state.rs:25–43`) and emitted at intent creation (`create_intent.rs:166–168`). Quote identity/intent linkage is public (`submit_quote.rs:73–76`).

At reveal, everybody sees price/size/salt in transaction arguments and Quote account (`reveal_quote.rs:27–30`, `:93–118`). The server's reveal transaction builder receives plaintext price and size (`apps/server/src/tx.rs:379–405`), so operator visibility begins at API request, potentially before chain acceptance. After settlement, public Receipt permanently links both parties, price and size (`state.rs:96–116`). No encryption to a delayed committee exists.

Binding concern: commitment contains only price,size,salt, not intent ID, pair, side, maker or chain (`reveal_quote.rs:68–72`; matching client `apps/client/lib/commitment.ts:42–54`). Account ownership authenticates reveals locally, but another maker can copy a hash into another account then use the public opening after it appears. The original earliest reveal wins a same-price tie, limiting this within an intent, but domain separation would prevent cross-intent copying. This is a design inference, not an executed exploit.

## 6. UI and UX

Routes include dashboard, trade/create intent, intent list/detail, quotes, fills and maker/taker docs under `apps/client/app/(dashboard)` and `(marketing)/docs`. Detail page has one phase-appropriate action: cancel, submit quote, reveal, winning maker fund, settle, or terminal card (`apps/client/components/intent-detail.tsx:137–180`). It shows size/limit and reveal/resolve countdowns (`:231–247`). Browser hashing matches exact Rust encoding (`lib/commitment.ts:39–58`). Useful nuance: funding UI uses Open plus elapsed resolve deadline, matching actual ledger semantics (`intent-detail.tsx:152–169`). Browser screens were read, not rendered/tested; secret durability and multi-device recovery were not established.

## 7. Judgment and Zcash mapping

**STEAL:** three named windows; exact endpoint inequalities; state/time distinction; price-improvement refunds; explicit cancellation/expiry; phase-appropriate actions; immutable receipts with selectively shareable content. **AVOID:** winner-only funding; reputation as sole default deterrent; reveal-order tie advantage; publishing losing bids; commitment not bound to auction; treating PDA escrow as portable.

Use Zcash shielded prefunding to FROST custody (or separate custody committee), independently sealed bid terms via tlock/threshold encryption, a signed receipt for confirmed note/ciphertext acceptance, and a manifest-defined freeze height. Require adequate funds before a bid enters the frozen set; do not let the winner decide whether to pay. Amount-equals-bid leaks to escrow viewing-key holders, so fixed lot/cap deposits or an explicitly separate privacy/custody architecture are required. After opening, off-chain deterministic first/uniform-price computation generates winner payment, loser refund and excess refund outputs in PCZT; FROST policy replaces the program's enforcement. Fresh diversified refund UAs reduce linkage. Zcash cannot atomically deliver arbitrary SPL/custom assets: custody/item registry or NEAR Intents external leg adds its own trust/visibility.

**Design priority:** strongest lifecycle/refund template in this group, once prefunding, automatic delayed opening and tie rules are corrected.
