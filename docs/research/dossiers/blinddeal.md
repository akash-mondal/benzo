# BlindDeal

Research owner: `auc-doss-fhe`. Read-only source review, 2026-09-30. Repository: https://github.com/PhiBao/blind-deal; pinned commit `be77933bca3a5d5cd879ee6afae0c84d2ee0bbdb`. All `path:line` references below are relative to that checkout, available under `/tmp/zecathon-code/auc-doss-fhe/PhiBao--blind-deal/`. No repository code, build, tests or deployments were executed. Static findings are distinguished from runtime confirmation.

## Facts and implementation reality

Saved research records Fhenix Privacy-by-Design buildathon wave-5 grant $750; this review verifies code, not payout. Chain configuration is Arbitrum Sepolia (`frontend/api/escrow/create.ts:8-11`). This is bilateral encrypted reservation-price negotiation, not an auction. Real CoFHE contract, React frontend, native-ETH escrow and alternate Privara/Reineira server integration exist. Their privacy boundaries differ; do not merge them into one confidential escrow claim.

## Lifecycle and exact flow

`contracts/BlindDeal.sol` defines Open, Matched, NoMatch, Cancelled, Expired (`11-17`). Buyer creates direct deal with specified seller or open marketplace slot, public description <=280 bytes, duration 0 (no deadline) or <=365 days (`91-111`). First seller joins open slot (`117-127`); join itself does not check deadline. Each party submits one encrypted uint64 max/min; submission enforces role and `now <= deadline` (`133-169`). Second submission invokes encrypted comparison/midpoint, but state remains Open while resolving (`175-209`). Anyone can finalize when threshold result is ready (`214-222`), or parties propose and confirm the same **unproved plaintext match bit** (`228-255`). Proposal expires after one hour, or proposer withdraws earlier (`260-273`). Either party cancels before both inputs; anyone expires past deadline even while resolution awaits (`302-329`). This permits timeout racing with pending successful resolution.

## Data structures and algorithm

Deal contains two addresses, direct/open type, encrypted max/min/price/match, public submission flags, description and times (`24-38`). Client-consensus maps store proposer, boolean and time (`59-62`). No bid commitment/reveal phase, tie ordering, reserve, multi-unit or pro-rata.

```text
match = buyerMax >= sellerMin
midpoint = uint64_FHE_add(buyerMax,sellerMin) / 2
price = select(match,midpoint,0)
publicly decrypt match; if matched grant both parties price ACL
```

Equality matches; integer division rounds down (`179-190`). No overflow bounds/widening precede uint64 addition. Range constraints must be added before treating midpoint as mathematically exact over all inputs.

## Escrow, refunds and delivery

Native escrow `contracts/BlindDealEscrow.sol`: separate Created -> Funded -> ReleaseRequested -> Approved -> Redeemed; disputes can route to Redeemed/Refunded. Buyer can create before match (`125-144`), funds arbitrary positive ETH (`150-160`); funding is **not cryptographically bound to encrypted price**. Seller requests release only if deal state Matched (`166-178`); buyer approves or disputes (`183-205`). Seller force releases after 7 days of silence (`227-239`); arbiter resolves, with buyer-default refund after 14 days (`259-295`). Failed/cancelled/expired deals refund (`301-315`). Goods delivery is consensual/off-chain, not token escrow. No bid bond or non-reveal penalty.

Alternate Reineira resolver is just a Matched-state predicate (`contracts/BlindDealResolver.sol:43-45`). Anyone can first-link any escrow id to a deal without caller authorization (`34-38`): potential incorrect-link griefing. External Privara contract is not present here, so its balance enforcement is not established by this review.

## Privacy and concrete leaks

Operator lacks max/min ACL in the negotiation contract. Match result is globally decryptable (`BlindDeal.sol:193-198`) and terminal state publicly visible. On match each party decrypts midpoint (`284-289`), and **their own input plus the midpoint reconstructs the other party's reservation price to at most one integer unit**; this is an inherent output leak, despite encrypted original handles. NoMatch reveals the inequality, not nothing.

Native ETH escrow exposes amount via msg.value, public Escrow struct, events (`BlindDealEscrow.sol:32-46`, `65-70`, `150-160`). Alternate API accepts plaintext amount/owner/dealId and encrypts **on the server** (`frontend/api/escrow/create.ts:33-54`); operator sees settlement amount and linkage. Frontend also logs plaintext submitted price (`frontend/src/components/DealDetail.tsx:432-442`). Matched does not imply FHE correctness on client-consensus path: both parties can agree to any boolean, independently of decrypted result (`BlindDeal.sol:244-255`). This is mutual consent, not a proof-backed fallback.

## UI and UX

Landing, Dashboard, CreateDeal, DealDetail, MCPServer are actual React components. DealDetail role-gates price entry, encrypts with useCofheEncrypt (`401-465`), decrypts match with refreshed permits/retry status (`583-660`), prompts propose/confirm (`675-818`), and decrypts matched price (`971-994`). It presents native escrow plus alternate Reineira path (`999-1080`). Native funding contains a 0.001 ETH fallback rather than using the decrypted midpoint as verified funding (`1104-1113`), emphasizing demo integration limits. HTTP server-assisted escrow is not an operator-blind flow.

## Judgment and Zcash mapping

**STEAL:** explicit role/status UI, one submission per party, selective outcome release, visible async retries, escrow dispute and timeout states for physical-item auctions.

**AVOID:** midpoint-as-secret-preserving claim, plaintext HTTP encryption, boolean-consensus masquerading as verified compute, unbound payment price, unauthenticated resolver linkage. Keep off-chain delivery arbitration separate from auction correctness.

A Zcash bilateral variant can exchange client-encrypted max/min envelopes through shielded memos or authenticated off-chain messages, with MPC/committee releasing only match and an agreed public price. Result policy must acknowledge inference. FROST signers can implement buyer/seller/arbiter custody and PCZT refunds, but delays are signing policies rather than shielded script conditions. Deposits should not equal reservation price if their viewing key is available to operator. tlock would reveal inputs after time; it cannot preserve losing/no-match prices forever. NEAR Intents only supplies an external payment leg.
