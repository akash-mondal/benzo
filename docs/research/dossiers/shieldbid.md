# shieldbid — design dossier

## 1. Facts and evidence boundary

Repository: https://github.com/Jacksoxx/shieldbid; snapshot **1c37ab0f769637c90be5f128d030c9e4cd972b99**. Read-only checkout: `/tmp/zecathon-code/auc-doss-timelock/shieldbid`. Source/placement: candidate record describes a GitHub product, with no independently verified prize. Chain: Zcash; the inspected demo uses Orchard and a local zkool GraphQL wallet. Static inspection only: no repository code, builds, tests, wallet RPCs or transfers executed. Mainnet transactions and receipts are repository evidence, not independently verified here.

Two implementations coexist. `tools/shieldbid.py` implements older memo-parsed v0.1; `docs/SPEC.md:1-35` defines v0.2 escrow-as-bid, and `tools/demo_01_run.py` is a hard-coded multi-wallet demonstration of that model. The spec's statement that the generic CLI performs v0.2 verification (`docs/SPEC.md:116`) does not match its memo-hash implementation. Actual GraphQL payment construction exists (`tools/engine.py:186-207,287-305`); a general auction service, enforceable custody, item transfer and bidder-address discovery do not.

## 2. Lifecycle and bid flow

**v0.1:** initialize local `lot.json` → ingest decrypted notes → publish set commitment → reveal/rank → export refund plan → manually send payments. There is no enforced state transition or deadline clock: reveal can run without a commitment (`tools/shieldbid.py:238-243`), and ingest's height filter is conditional on both configured cutoff and known note height (`:195-209`). Initialize sets deadline height to null (`:170-181`); commit can set it after ingest without filtering that existing inbox (`:221-235`). No opening-height filter.

**v0.2 spec:** publish item/reserve/UA/time → accept mined shielded payments in opening/closing height interval → freeze receipt-leg set → publish commitment → rank → seller refunds losers and winner surplus → off-chain item delivery. Cutoff is inclusive in spec (`docs/SPEC.md:29-31`).

Bidder flow: choose lot and fund a shielded wallet; send ZEC to published UA, with amount equal to bid; retain txid and separately communicate a shielded refund address; wait for seller close; inspect receipt; receive refund/change. Zcash does not disclose a generic return-to-sender shielded address to the recipient. The spec's return-address assertion (`docs/SPEC.md:99-101`) is not a implemented recovery mechanism. Demo destinations are account 2 or a private address file chosen by bidder label (`tools/demo_01_run.py:115-125,257-276`).

The demo's `close` sorts `led['bids']`, rather than deriving authenticated bids from all wallet notes. It reads wallet total but does not validate each ledger bid against a note (`tools/demo_01_run.py:188-205`). It requires at least `slots` bids and aborts if kth bid is below reserve. Generic CLI instead sells up to available eligible slots.

## 3. Data structures and clearing

Lot: schema, lot/item/seller/address, reserve, UTC deadline, optional deadline height, winners count and deterministic seed (`tools/shieldbid.py:167-181`). Inbox bid: txid, height, memo SHA256, decimal amount, optional nonce (`:195-211`). Receipt/result: amount, status, height, commitment, clearing, refunds (`:256-287`). Decimal strings avoid floating-point money.

Generic commitment = SHA256(newline-joined sorted SHA256(memo)), `:73-81`; v0.2 commitment = hash of sorted digests of `shieldbid/receipt/1|txid|output_index`, `docs/SPEC.md:54-67`. Neither commitment alone proves amount, receipt ownership or completeness. Generic verifier never recomputes memo hash from a disclosed preimage, so amount fields are not cryptographically linked to those hashes (`tools/shieldbid.py:303-342`). Demo bid commitment is SHA256(bidder label|amount|salt), saved after payment (`tools/demo_01_run.py:110-112,171-181`); it is a different construction again.

```text
eligible = bids whose declared amount >= reserve
stable sort eligible by amount descending
winners = eligible[0:slots]
clearing = min(winner amounts), or no sale if empty
loser refund = full bid; winner surplus = bid - clearing
```

Generic implementation: `tools/shieldbid.py:244-254`; demo: `tools/demo_01_run.py:199-223`. Equal prices retain input order through Python's stable sort; no normative tie policy or randomized seed use. Each bid gets one unit; no quantity field or pro-rata. Single slot means first price, not second price. Lowest accepted winning bid sets multi-unit price, not highest losing bid.

## 4. Custody, refunds, delivery and griefing

Seller wallet owns deposited notes and can spend before close; no threshold key or escrow covenant. `engine.py:287-305` sends real wallet payments if invoked. Generic refund plan only iterates losers and below-reserve bids; the expression computing winner surplus inside the loser loop is unused and cannot produce winner change (`shieldbid.py:268-277`). Demo does compute surplus (`demo_01_run.py:209-223`). Re-running demo refund has no per-leg already-paid guard (`:265-277`). Invalid memo refunds have unknown amount in generic output (`shieldbid.py:276-277`). Fees, dust, retry/idempotency and full liabilities need a separate accounting model.

No bidder reveal step; thus no non-reveal griefing, but no seller bond, spam bond or refund guarantee. Funds already spent can vanish from the wallet's unspent-note view (`shieldbid.py:115-119`), so receipt history must be persisted before payout. Item delivery is explicitly outside protocol (`docs/SPEC.md:137-144`).

## 5. Privacy and leaks

**Before close:** receiving seller/wallet operator sees every note value and, when available, memo immediately. `engine.py:55-60,91-121` queries and prints decrypted note value/memo. Demo explicitly prints all seller-readable note values (`demo_01_run.py:129-143`). This fails an operator-blind bid requirement even if memos are additionally timelocked: if deposit equals bid, its received note value still reveals the price.

**After close:** generic reveal publishes every bid amount and txid (`shieldbid.py:264-287`). Demo settlement file includes bidder labels, amounts, salts, full count and refunds (`demo_01_run.py:209-247`) despite its `privacy_note` claiming losers and counts are not published (`:241-243`). Publishing those artifacts links public transaction identifiers to bid economics. Public shielded data alone does not expose these fields, but network, wallet and application telemetry remain outside this implementation's guarantees.

**Integrity:** set commitment prevents later changes only if honestly published and actually binding the relevant receipt set; it does not prevent pre-commit censorship, self-bids, false bid amounts or diversion of funds. Generic verifier checks selected-winner minimum but not that all winners outrank all losers (`shieldbid.py:314-327`); several failed boolean checks are printed without populating `problems`, and exit status depends only on `problems` (`:331-343`).

## 6. UI and UX

`web/index.html` is a static console: proof/receipts, bidder instructions, copy memo and seller UA, results and refund links, wallet/privacy guidance. Copy actions are browser clipboard only (`web/index.html:279-298,341,384-392`); no wallet-backed auction submission there. Bidder sends from an external wallet. Seller operates CLI and publishes JSON/assets. A credible UX element is a clear receipt trail, but the view should separate confirmed deposit, accepted ciphertext, close, cleared, payout broadcast and payout confirmed.

## 7. Judgment — recommendations, not existing behavior

**STEAL:** simple shielded wallet payment and receipt UX; integer/decimal money; per-lot receiving-address separation; explicit seller-custody threat model; winner surplus and loser refund accounting from demo.

**AVOID:** bid = seller-readable deposit; inference that encrypted memos hide note values from their recipient; unauthenticated ledger bids; auto-refund to an assumed sender address; publishing full settlement artifacts while claiming losing-bid privacy; arbitrary late freeze; verifier that checks only internal arithmetic.

**Zcash mapping:** locally tlock-encrypt a canonical bid envelope containing auction/version/network/round, bid zatoshis, salt, receipt nonce and shielded refund/delivery instructions. The note memo carries a hash/reference and authenticated receipt binding. Use a public fixed collateral tier independent of chosen bid, enforce bid <= collateral at opening, and return collateral minus clearing charge; distinguish this from a genuinely hidden deposit requiring viewing-key isolation. The operator must not hold a viewing key to an exact bid-valued deposit. FROST custody reduces unilateral spending but does not hide plaintext from viewing-key holders or bind signers to auction policy. PCZT helps construct/check payouts; committee policy enforces accounting off-chain. Timelock ciphertext generally needs off-chain replicated storage and a compact memo digest; do not assume a 512-byte memo fits armored tlock plus refund metadata. NEAR Intents can offer a separate funding route, with source-chain identity/value visibility documented. Asset/NFT delivery remains external custody or another chain. These are design proposals under the user's Zcash constraints, not features of this repo.
