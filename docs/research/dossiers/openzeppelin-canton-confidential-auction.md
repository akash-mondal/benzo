# OpenZeppelin Canton confidential auction — design dossier

## 1. Facts and source scope

Repo https://github.com/OpenZeppelin/canton-specs; snapshot **fcbe972fe98c6ea8f6d0d98f9b3376682f1e048c**. Checkout `/tmp/zecathon-code/auc-doss-timelock/canton-specs`. Primary source `docs/reference-architectures/confidential-auction.md` (1223 lines); references below abbreviated **A:line**. Placement: reference architecture, not hackathon product/prize. Chain Canton with Token Standard V2 allocations. Complete application contracts/backend/wallet are **specified, not implemented** (`A:10-13,1220-1223`). Experimental components demonstrate narrow mechanisms, not end-to-end auction conformance. No source code or tests were run.

This is a single-round primary distribution of existing fungible inventory: uniform unit price, multi-unit demand, reserve/tick/lot/rounding, institutional eligibility and complete accepted-set validation. **Private from competitors, not operator/issuer** (`A:17-27`). No drand, timed encryption, bidder reveal or ZK clearing proof.

## 2. Lifecycle and exact bid flow

Preparation (abandonable) → completed proposal → Open → Closed → Cleared, or Cancelled/Expired → per-lock Recovery (`A:266-280,293-367`). Issuer and payment locks are committed self-return sender-only allocations, with validation party `av` as sole executor (`A:31-51`). This avoids pre-authorizing arbitrary final recipients before price/fill is known.

1. Issuer and av fix terms, assets/accounts/policies and rule revision. Issuer locks offered inventory and account parties approve final delivery/payment receipt. Opening consumes one proposal, validates exact supply lock/lineage and creates stable round identity/terms with empty private list (`A:495-545`).
2. Bidder wallet authenticates terms, chooses quantity and maximum unit price and payment/delivery accounts. Maximum lock = published rounded(quantity*max price), bound to unique preparation id. Complete preparation creates account-signed prepared bid (`A:548-561`). **Funded does not mean accepted.**
3. Independent inputs prepare concurrently; operator queues sequential acceptance. Successful transaction before bidding deadline consumes current round and prepared bid, assigns contiguous acceptance number n, appends accepted id and creates round successor (`A:563-615`). Failed commands reserve no number; abandoned preparation recovers separately.
4. Close at/after bidding deadline consumes Open and fixes unchanged accepted list; no early close at capacity (`A:617-628`).
5. Operator computes off-ledger from the complete list and authenticated current status, gets optional exact settlement approval. Clear before settlement deadline independently recomputes all fills/price/payments, consumes all accepted records and supply authority, cancels winners' self-return locks, creates exact payment and delivery allocations, settles every required factory batch atomically, and creates each bid's private outcome (`A:630-814`).
6. Zero-fill locks recover separately after clear, cancel, expiry or abandonment. Deadline withdrawal is account-authorized independently of operator bookkeeping (`A:816-874`). A failed clear changes nothing; retry retains complete accepted set. If it cannot complete by deadline, terminate without sale (`A:99-111,922-952`).

Authority split: operator ao has fixed delegated workflow choices; av has sole executor rights. Worked deployment has **three independent 2-of-3 controls**: transaction confirmation hosts, topology governance and external administrative signing (`A:217-253`). These are not one interchangeable threshold.

## 3. Structures and exact allocation / pricing

Published terms: instruments/admins/accounts, positive supply/reserve/tick/lot, quantum/rounding, bid capacity, bid+settlement times, eligibility/exclusion, per-bid tie policy. Round state: stable identity, terms, sale-authority ref, next number, bounded list of accepted cid/order. Bid binds quantity/price/accounts/max-payment lock root/credential identity. Outcome: round/bid/order/root, fill, price, rounded payment, exclusion reason and whether lock remains (`A:61-76,266-280,788-814`).

```text
require exact closed-list membership/order, no duplicate/substitute/extra bids
retain every accepted bid; authenticated exclusions receive fill0
eligible = nonexcluded valid bids, descending maximum-price bands
for each price band:
  if demand<=remaining supply: fill all
  else:
    each fillLots = floor(remainingLots * bidLots / totalBandLots)
    distribute remaining lots one per still-unsatisfied bid in acceptance order
    stop after this marginal band
price = reserve if total eligible demand<=supply else marginal band price
payment[i] = published_round(fill[i] * price)
validate per-bid demand/collateral caps and total supply/payment arithmetic
```

Specified `A:71-111`. Pro-rata occurs only within oversubscribed marginal price band, then whole-lot rounding remainder by **ledger acceptance order**. Multiple bids can advantage remainder allocation; related-account/splitting policy must be disclosed (`A:91-97`). Worked example supply100/reserve8/lot10: A50@12, B80@10, C40@10 → fills50/40/10, common price10 (`A:113-126`). Empty demand reports reserve with zero sales; no empty factory call. Undersubscribed demand pays reserve, unlike shieldbid's min winning bid.

Settlement legs: bidder→issuer rounded payment and issuer→bidder fill. Four authorization sides/winner; deterministic IDs e.g. bid7-payment/delivery. Shared SettlementInfo must match **executors,id,cid,meta**, with sole av executor and stable round cid; external approval must bind all those fields plus exact legs (`A:714-780`). The referenced external D1 experiment checks id/executors/legs but lacks cid/meta binding, explicitly called out in spec (`A:776-780`). This is a target requirement, not a fix present in this repo's auction.

## 4. Escrow, surplus, refunds, delivery, anti-griefing

Bid locks bound maximal payment and issuer locks supply before bidding. During clear winners' locks are cancelled and actual rounded payment allocated from returned holdings; unused payment stays bidder, unused inventory stays issuer (`A:749-758`). Commodity token delivery and payment happen atomically on one synchronizer. Zero-fill locks are not automatically refunded by result creation; recovery is separately tracked (`A:799-809,818-854`). This distinction avoids false “refunded” labels.

Cancelled/expired round retains accepted membership for independent cleanup, so one unavailable party need not stop other recovery (`A:842-848`). Missing allocation root or successor needs authenticated lineage and terminal-event reconciliation, never balance guessing (`A:652-671,850-854`). Marked payment gets zero fill; marked inventory blocks round; swept lock with no continuation prevents complete clear (`A:466-473`). Eligibility-provider outage is **not** evidence of revocation. Authenticated current expiry/revocation can change price/fills on retries under fixed policy; timeout cannot justify dropping a bid (`A:441-456,913-919`).

No bidder reveal withholding or non-reveal fine. Anti-griefing: strict capacity/arithmetic, admission consent, pre-funded locks, authenticated eligibility, immutable accepted list and governance replacement. Governance pause consumes new preparation/admission/opening grants while close/clear/cancel/recovery remain active (`A:475-488`), better than pausing all transitions. A malicious operator can censor requests before acceptance or fail to settle; signers/governance can change authority/code (`A:975-1000`). No mechanism forces progress.

## 5. Privacy / leaks / trust

Issuer, operator, av and **every av hosting organization** get every prepared/accepted bid and result (`A:240-244,375-384`). Threshold confirmations do not hide bids from any host (`A:994-996`). Account providers signing bids see them; instrument admins see allocations; attesters see exact movements. Auditor hosting av sees full projection before close with consent.

Maximum-payment locks expose quantity*price cap even to parties without bid contract (`A:391-394`); public Canton Coin legs can leak amount/account economics. Acceptance numbers reveal earlier admitted count and timing (`A:396-399`). Revoking operator delegation cannot retract existing observer access or copied plaintext (`A:481-485`). Each bidder's child branch avoids the entire accepted-list disclosure; shared batches must stay outside account branches (`A:760-766`). Full-result recomputation requires full private set; own receipt does not prove global correctness.

As an operator-blind Zcash template, the source's trust model is insufficient. Its strongest contribution is precise state, completeness, scoped authority and failure accounting.

## 6. UI / UX specified, not delivered

No complete UI code. Required wallet view includes signed terms, requested qty/max price, rounded max payment, assets/accounts/providers, deadlines, exclusions/seizure/recovery, issuer/operator/validation/auditor disclosures. It authenticates configuration and shows actual ledger acceptance separately from funding (`A:1073-1080`). Backend should show preparation/admission queue, accepted receipt, closed manifest, pending approvals, clear result and per-lock recovery. Monitor uncertain commands and reconcile before reporting outcomes (`A:898-911,1082-1087`).

## 7. Judgment / Zcash mapping

**STEAL:** complete-set receipt manifest; fixed rule revision and signed terms; reserve pricing under undersubscription; deterministic marginal pro-rata and whole-lot rounding; account-bound payouts; separate admission/funding/clear/refund state; per-bid recovery; prevent direct subordinate payout bypass; pause only new obligations; independently governed spend/config/update controls; uncertainty reconciliation.

**AVOID:** issuer/operator plaintext bids; cap=quantity*bid readable by receiving wallet; threshold confirmation described as threshold secrecy; arbitrary timeout exclusion; a refund label before funds confirm; copying full institutional/seizure complexity for the hackathon; assuming source target contracts are shipped.

**Zcash proposal:** publish signed immutable auction configuration with supply, reserve, units/ticks, tie/rounding and confirmation margin; bid locally tlock-sealed to R, with fixed collateral tier independent of private max price/quantity economics. Confirm funds and replicated ciphertext before accepting a signed opaque receipt. Freeze ordered accepted digest manifest before R. After R, multiple keepers open/recompute every accepted bid; malformed or missing openings must be handled by an explicit policy, not silent omission. FROST quorum signs only conserved PCZT payouts from that manifest and immutable rules. Unlike Daml, FROST does not constrain a colluding spend quorum or implement deadline exit. Ledger note locks/refunds are off-chain custody policy, and Zcash cannot deliver a custom fungible lot atomically. Use explicit external asset custody/delivery or NEAR Intents with separate finality/trust boundaries. A modest single-lot or small multi-unit auction best fits execution; pro-rata is optional complexity after core operator-blind custody works.
