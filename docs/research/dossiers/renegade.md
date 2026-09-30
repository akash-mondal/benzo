# Renegade — MPC dark pool and relayer trust boundary

## 1. Facts, sources and versions

Static inspection 2026-09-30, no untrusted code executed. Core [renegade-fi/renegade](https://github.com/renegade-fi/renegade), commit `744b3abd8e8814acd20e4520740d6f124a9c8c71`; contract [renegade-fi/renegade-contracts](https://github.com/renegade-fi/renegade-contracts), commit `84efa7110332ab4f3e001c2d19c8782271b5800e`. Clones at `/tmp/zecathon-code/auc-doss-batch/{renegade,renegade-contracts}`. Prefix `core/` below means the former; `contracts/` the latter. Protocol/product, no hackathon placement. EVM dark pool; reviewed design spec discusses Arbitrum/Base deployments, which are repository-reported context, not independently verified live network status.

Real MPC arithmetic, proof circuits, validity/settlement bundles, relayer task scheduling, HTTP APIs, Solidity verification/commitment rotation and ERC20 transfer paths exist. `core/crates/circuits/circuits-core/src/mpc_circuits/v1/match.rs:51–88` uses mock MPC **inside test scope**; it does not imply production arithmetic is mocked. The current core has v2 intent/privacy-ring APIs and a local matching engine in addition to legacy v1 MPC code. Do not assume v1 2-party MPC runs on every current v2 match. Contract and core snapshots are independent commits, not a verified compatible release pair.

Design sources read: `core/README.md:34–66`, v1 match module's design comments, and `core/docs/superpowers/specs/2026-06-07-relayer-match-settlement-rethink.md:56–105`. Public docs and whitepaper URLs returned 502/unavailable during this review; no unseen whitepaper detail is attributed here.

## 2. Lifecycle and exact order flow

This is continuous matching, not a closed auction. API states: Created → Matching → SettlingMatch → Filled, or Cancelled (`core/crates/api/external-api/src/types/order.rs:274–288`); partial fills can return an order to matching with remaining amount.

1. User creates/synchronizes account, sending master view seed and authentication key to their relayer (`core/crates/api/external-api/src/http/account.rs:41–55`, `:69–80`). Relayer knows its users' plaintext orders by design (`core/README.md:41–45`).
2. User deposits assets into proof-governed dark pool or uses the selected native/public settlement ring. V1 wallet update proves valid shares, spends old nullifier, inserts new commitment, verifies root-key authorization and executes nonzero external transfer (`contracts/src/darkpool/v1/contracts/Darkpool.sol:352–388`). V2 exposes separate deposit/withdraw proof bundles (`contracts/src/darkpool/v2/contracts/DarkpoolV2.sol:230–255`).
3. User submits order core: tokens, owner, minimum price, amount, minimum fill, privacy order type, external-match permission (`core/crates/api/external-api/src/types/order.rs:27–84`). HTTP handler uses `req.order.intent` directly (`core/crates/workers/api-server/src/http/order.rs:173–174`).
4. Legacy cross-relayer design gossips encrypted/shared state, performs authenticated 2-party MPC, collaboratively verifies VALID MATCH MPC before opening valid result (`core/README.md:47–55`; `core/crates/circuits/circuits-core/src/mpc_circuits/v1/match.rs:14–23`). Each originating relayer still knows its side.
5. Current local matching engine loads plaintext local order and funded matchable amount, selects a counterparty and chooses private/public settlement task by privacy rings (`core/crates/workers/matching-engine/matching-engine-worker/src/manager/matching/internal_engine.rs:64–91`, `:129–164`). This is an actual implementation path, distinct from claims about universal cross-relayer MPC.
6. Private task progresses Pending → SubmittingTx → UpdatingState → UpdatingValidityProofs → Completed (`core/crates/workers/task-driver/src/tasks/settlement/settle_private_match.rs:44–54`, `:214–227`). Both account queues must be locked/preempted atomically; old state/nullifier cannot be consumed twice. On chain, v1 processMatchSettle verifies linked proofs, consistent indices and fee, rotates both wallets (`contracts/src/darkpool/v1/contracts/Darkpool.sol:398–451`).
7. Remainders stay in updated private state; user may cancel/rebalance/withdraw under authorization. No commit deadline, delayed decryption date, non-reveal phase or auction refund cycle exists. External quotes and concurrent fill freshness are separate task constraints, not an auction close.

## 3. Structures and matching/clearing

V1 order includes pair, side, amount/price; balances bound fill capital. MatchResult includes base/quote token, base/quote amounts, direction and limiting-order index (`core/crates/util/src/matching_engine.rs:127–134`). Wallet state is secret/public shares with Merkle commitment/nullifier. V2 `ApiIntent` is plaintext tokens, owner, min_price and amount_in; `ApiOrderShare` encodes the corresponding scalar shares, and `ApiOrder` includes recovery/share streams and fill history (`core/crates/api/external-api/src/types/order.rs:27–43`, `:125–187`).

Legacy source-derived matching (`core/crates/util/src/matching_engine.rs:96–151` and MPC `match.rs:24–48`):

```text
price = supplied fixed-point reference/midpoint execution price
require same pair, opposite sides, both limits accept price
maxSell = min(order.amount, base_balance)
maxBuy  = min(order.amount, floor(quote_balance / price))
base = min(max0,max1)
quote = floor(base*price)
require positive/nonzero orders and min base/quote fill
prove valid funded match before opening result
apply fill+fees to both state shares; rotate both commitments/nullifiers
```

MPC min/fixed-point calculation itself does not validate overlapping limits or capitalization; VALID MATCH MPC must do it before opening (`match.rs:14–23`). That separation is an important security invariant. Price argument is not computed by sorting sealed limit bids in this module.

Current v2 book indexes **matchable amount descending, order ID ascending on equal amount** (`core/crates/workers/matching-engine/matching-engine-core/src/book.rs:35–41`). Candidate constraints include min-price, fill-range intersection, privacy ring and external flag; first eligible book candidate gets min of matchable amounts (`:220–232`). This is not price-time auction priority. No seller reserve or batch pro rata; partial bilateral fills remain. The two versions should not be blended into one invented uniform-price algorithm.

## 4. Custody, refunds/change and griefing

Proof-governed EVM contract holds dark-pool assets; account/root authorization controls withdrawals/state changes. Internal fills rotate private balances without public user-to-user token transfers; external deposits/withdrawals invoke transfer executor. V2 deposit/withdraw route through StateUpdatesLib. No NFT/item delivery. No auction losers to refund; remaining balance/order capacity persists, fees accrue, withdrawals are separately authorized.

Atomic nullifier consumption stops double settlement. Capital-bound advertised volume stops committing nonexistent fill liquidity; min-fill parameters limit dust probes. Owner controls pause/verifier/transfer executor/fee configuration (`contracts/src/darkpool/v1/contracts/Darkpool.sol:248–310`), a governance boundary independent of relayer confidentiality. No bid bond/non-reveal slash in reviewed paths.

A deep execution lesson in the June design review: per-wallet serial nullifier chains, two-wallet all-or-nothing queue preemption, one-wallet external fills, shared signer nonces and stale signed-bundle rejection (`core/docs/superpowers/specs/2026-06-07-relayer-match-settlement-rethink.md:73–105`). It reports historical external-flow starvation of internal fills; those are authors' measurements, not reproduced benchmarks or proof that the current code still fails. For us, a correct matcher can still fail to deliver if shared custody signing/coin-selection queues starve refunds.

## 5. Privacy and exact trust boundaries

| Actor | Visibility |
|---|---|
| User's own relayer/replicated cluster | Plaintext orders, view seed/account state; API carries owner, amount, min price (`account.rs:47–52`; `types/order.rs:27–43`; `README.md:41–45`). |
| Other relayer in v1 MPC | Its own inputs; encrypted/shared other-side state; valid matched result per opening policy. Invalid results should never open. |
| Public observers | Commitment/nullifier changes, deposits/withdrawals and external legs; fill visibility depends on selected v2 ring. |
| Public/native/external counterparties | Explicitly permitted disclosures; Ring0 public versus Ring2 public-fill versus Ring3 private-fill is not one privacy promise (`types/order.rs:241–258`). |

**For our brief, own-relayer plaintext access is disqualifying if the auction house is that relayer.** Self-hosting a relayer could protect a bidder from a third-party operator, but not from its own operator and is poor Monday UX. On-chain privacy and counterparty privacy do not imply operator blindness. Book holds min_price and matchable amount in ordinary memory (`book.rs:58–75`). Current private match task contains both party IDs, execution price and plaintext MatchResult (`settle_private_match.rs:150–162`). Network/API telemetry remains a linkage boundary even when ERC20 balance state is cryptographically hidden.

## 6. UI and UX evidence

No bidder/seller browser frontend in the two inspected repositories. API provides account create/sync, order create/list/status/cancel and fills; state enum and task IDs support progress UI. README is relayer development documentation, not a turnkey bidder app. Deposit → authorize order → wait for partial fills → cancel/withdraw is the code-derived user journey. For an auction seller there is no item listing, reserve, close countdown or winner screen. These would need separate implementation.

## 7. Judgment and Zcash mapping

**STEAL:** explicitly scoped relayer trust; prove funded/valid computation before opening; minimum fill; continuous remainder accounting; consume-once state; queue fairness/freshness discipline. **AVOID:** claiming MPC hides bids from a relayer that received plaintext; mixing privacy rings in the headline; rebuilding a two-party MPC proof/contract stack for a one-month Zcash demo; assuming local/private matching creates fair batch inclusion.

Operator-blind Zcash bids must be sealed **client-side before API submission**, and note amounts must not encode bid to operator viewing keys. Use fixed/cap shielded deposit and independent tlock/threshold decryption. FROST is signing, not MPC matching or encryption. PCZT + FROST can settle ZEC outputs but cannot verify Renegade's arbitrary EVM wallet/update proofs on Zcash. An off-chain MPC auction could preserve losing bids after close, but requires independent compute nodes, authenticated input/funding binding, deterministic allocation, proof/output policy and liveness; this is substantially beyond the inspected bilateral matcher. For deadline-sealed hackathon delivery, open after the frozen close and deterministic off-chain clear/refund, with committee custody trust named. NEAR Intents adds an external asset/conversion observer; no Zcash native two-token pool.

**Design priority:** use as a trust-boundary and settlement-engine reference; reject its own-relayer visibility model for the auction operator.
