# Confidential Buybacks

Research owner: `auc-doss-fhe`. Read-only source review, 2026-09-30. Repository: https://github.com/bleu/confidential-buybacks; pinned commit `32d14ae18eb80209220953eebbfa8ef334728b8c`. All `path:line` references below are relative to that checkout, available under `/tmp/zecathon-code/auc-doss-fhe/bleu--confidential-buybacks/`. No repository code, build, tests or deployments were executed. Static findings are distinguished from runtime confirmation.

## Facts and implementation reality

Organizer page independently read: Zama Mainnet Season 3 Builder Track, third place, 1,250 cUSDT ([organizer source](https://www.zama.org/post/announcing-the-developer-program-mainnet-season-3-winners)). Sepolia PoC, real ERC-7984/FHE operations; demo payment/governance tokens have faucets and oracle is owner-set mock (`README.md:80-93`, `contracts/contracts/MockPriceOracle.sol:11-26`). Hardhat mock tests present, not run. A treasury dark pool with rolling windows, **not a bid-price clearing auction**.

## Lifecycle and exact offer flow

`contracts/contracts/BuybackVault.sol` is BV. Owner opens first epoch with encrypted token-unit budget, clamped <=1e15 (`107-133`); it does not deposit payment funds. Budget and remaining can be topped up while pool open (`139-152`). Window duration 60 seconds–30 days. Seller grants token operator, encrypts offer amount and minimum price, submits once per address/window (`182-200`). Actual transferred governance-token amount is offer; reserve fill immediately against encrypted remaining (`202-207`). Seller may privately decrypt own provisional fill **during window** (`209-214`). At expiry anyone rolls, snapshots oracle public price (cap 100.00), carries unspent remaining into next epoch; owner may roll early (`158-172`). Expired-window offer auto-rolls. Seller claims after close, floor checked only then (`226-254`). Anyone may request/publish aggregate disclosure after five minutes (`268-298`). No offer cancel or bond/reveal round.

## Structures and algorithm

Epoch holds encrypted budget/remaining/totalFilled; public timestamps, settlementPrice and disclosed flags/result (`59-70`). Position encrypted escrowed offer/fill/minPrice, submitted/claimed flags (`72-78`). Price is 2-decimal cUSDT per token; token amounts are six-decimal demo units.

```text
on offer: f = min(actualEscrow,remaining); remaining -= f; total += f
on close: P = min(oracle.price,10000); next.budget = remaining
on claim:
    effective = select(minPrice <= P,f,0)
    payout = floor(effective * P / 100)
    refundTokens = offer - effective
    total -= f-effective
```

Order is first-come-first-served, not best floor or pro-rata. Floor failure does not recycle allocation inside the window or next carryover, which was fixed before claims (`172`, `235-245`). Product explicitly documents this (`31-39`). No reserve beyond private seller floors; owner can change mock oracle and close time.

## Escrow, refunds and solvency

Governance tokens are actually escrowed; payment token solvency is **not checked**. Claim sets claimed then ignores actual payout return (`233`, `249-252`). If insufficient cUSDT, ERC-7984 may return encrypted zero without reverting: seller's fill remains consumed and cannot retry; token refund excludes effective fill. Buyer/treasury keeps acquired tokens in vault, with no treasury withdrawal function visible in BV. No delivery other than token escrow. No bid reveal or non-reveal penalty; one-address/window restriction is Sybil-weak. Static risk is explicitly acknowledged in BV `31-37`; supplied README deployment addresses are not runtime verification.

## Privacy and leaks

Amounts/floors protected from public observers, but addresses and timing public (`87-93`, `220`, `254`). **Treasury receives remaining and totalFilled ACL every submission** (`215-218`) and can decrypt successive aggregates to infer individual fills/offer sizes, particularly when remaining covers offer. This fails strict operator blindness. Own provisional fill is a demand oracle enabling probing via multiple addresses (`211-212`). Floors normally stay secret but repeated minPrice probes against a public price reveal success bands to their submitter. After disclosure a singleton window reveals an individual fill; updates after request can invalidate the proof handle or make published totals stale (`245-247`, `275`, `291`). Five-minute disclosure is not anonymity protection. Owner early-roll option leaks/permits discretionary market timing (`161`).

## UI and UX

One Next.js screen with Sell/Treasury/Transparency tabs (`frontend/src/app/page.tsx:11-48`). SellPanel supports faucet -> operator approval -> encrypt offer/floor -> decrypt own position -> claim. TreasuryPanel manages mock oracle, encrypted remaining/total, budget and roll. TransparencyPanel requests publicDecrypt then signed on-chain publication. `README.md:127-131` describes these exact paths and SDKs; not exercised. The UI footer accurately says PoC, not audited (`page.tsx:51-60`).

## Judgment and Zcash mapping

**STEAL:** repeating windows independent of demand, encrypted price floors, encrypted no-op rather than condition-dependent failure, actual-funded input, capped arithmetic, outcome disclosure as a separate explicit policy.

**AVOID:** owner aggregate access during intake, early close, unbacked budget, provisional fill demand oracle, delayed mutable totals, singleton disclosure. This is a strong cautionary example: confidential ciphertexts do not imply the operator cannot infer orders.

A Zcash treasury buying an external item can receive fixed-tier collateral and encrypted offer/floor memos. Use immutable deadlines and close-time batch computation; do not send running aggregate decryptions to treasury. Prove/bind treasury ZEC funding before accepting offers, and FROST signers enforce balance conservation in PCZT outputs. Publish only stable aggregate receipts after a declared privacy threshold if aggregate disclosure is required. tlock gives time-hidden inputs but reveals all after close; MPC/FHE with restricted output is needed for permanent floor privacy. External governance token escrow needs its own chain/custodian; NEAR Intents funding does not provide confidential asset delivery on Zcash.
