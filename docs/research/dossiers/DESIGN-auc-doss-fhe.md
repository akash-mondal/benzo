# Operator-blind Zcash auction — FHE/MPC dossier synthesis

Owner `auc-doss-fhe`; reviewed 2026-09-30. **Facts are static code observations at pinned commits. Recommendations below are design judgments.** Nothing from the cloned projects was built or executed. [JSONL index](index-auc-doss-fhe.jsonl) has one row per dossier; [checkout manifest](sources-auc-doss-fhe.jsonl) pins 15 repositories. Twelve implementation/spec dossiers plus one README-only negative dossier cover the requested families. Noctis name collision is documented in its Midnight auction dossier; OpenZeppelin's current library contains no auction and is reviewed as the actual ERC-7984 payment primitive. Zama hardhat-template contains a counter, with auction code instead in fhevm docs and dapps.

## Code findings that should drive design

| Source | Best concrete pattern | Limitation found in reviewed code | Dossier |
|---|---|---|---|
| Zama official tutorial | Winner-only output; proof bound to stored handle; actual-funded bid totals | Mock-only example tests; no empty/decryption-timeout recovery; winner must claim | [Zama tutorial](zama-fhevm-official-sealed-bid.md) |
| Zama dapps | NFT custody and confidential cumulative deposits | Unbound decryption handle list; blind tokenId omission; Dutch seller repeat withdrawal | [Zama dapps](zama-dapps-blind-dutch.md) |
| OpenZeppelin ERC-7984 | Actual transfer return; exact disclosure signature; operator expiry | Insufficient transfer returns zero; public wrapping and endpoints; hooks can prevent refunds | [OZ primitive](openzeppelin-confidential-erc7984.md) |
| Fhenix official PoC | Funded one-shot bid, close/result/settle/refund lifecycle; output-handle binding | Winner/price public; no decrypt outage refund path; all-zero bids | [Fhenix PoC](fhenix-official-sealed-bid-auction.md) |
| BlindDeal | Explicit buyer max/seller floor and dispute UX | Midpoint reconstructs counterparty input; server plaintext escrow amount; amount-price mismatch | [BlindDeal](blinddeal.md) |
| SealPad | Inventory prefunding, immutable caps, close-finality delay, deterministic allocation | Public deposits/prices; **all quantities decrypted after close**; 50-slot spam; no timeout | [SealPad](sealpad.md) |
| Confidential Buybacks | Rolling epochs; local price floor; delayed aggregate reporting UX | Owner decrypts remaining budget; unfunded payment cap; claim ignores actual payment transfer | [Buybacks](confidential-buybacks.md) |
| Zerith | Reusable format/UI vocabulary; confidential top-two | Unreserved vault; batch settlement ignores eligibility/residuals; Dutch claim exposes quantity | [Zerith](zerith.md) |
| Official Arcium | Encrypted streaming top-two; Vickrey omits winning maximum | No custody; min bid unenforced; identity plaintext not bound to signer; sequential callback races | [Arcium official](arcium-official-sealed-bid-example.md) |
| Protocol 01 extract | Conditional pay/refund commitments; pseudonymous winning receipt | Missing parent code; bid-collateral/seller binding absent; host proof stubs | [Arcium extract](arcium-sealed-bid-auction.md) |
| Named Arcium candidate | No implemented feature | Only two README lines | [README-only](arcium-sealed-bid-auction-readme-only.md) |
| Obscura | Wallet receipts/attestations; explicit reveal notice | Split version/state mismatch; early/unbound settlement; public escrow deltas; reserve dictionary | [Obscura](obscura-auction-aleo.md) |
| Noctis batch DEX | Domain separation; constrained floor division; staged UX | Individual orders disclosed; unbacked notes; cancellation/rollover strands claims | [Noctis](noctis-midnight-batch-auction.md) |

Award status is provenance, not evidence of funded escrow, operator blindness, runtime reliability or correct settlement. Inspect each dossier's facts section for independently checked versus saved-source award claims.

## Recommendation: one funded single-lot first-price auction first

Borrow **the Fhenix lifecycle, Zama's exact result binding, official Arcium's minimal-output encrypted accumulator, SealPad's finality guard and Protocol 01's conditional entitlement concept**. Do not port their chain-specific custody machinery literally. Begin with one indivisible external item/service, ZEC payment, fixed close and deterministic receipt-order tie rule. First-price avoids second-price edge cases and exposes only the winner's settlement amount to required recipients. Vickrey can be added once ties, reserve and one-bid policies are explicit; it necessarily discloses a losing bid's value when that second price is published.

The auction terms should commit to seller payout address, item/delivery commitment, common collateral amount, bid cap, public or salted reserve, deadline, finality rule, admission policy, clearing circuit/rules hash, output policy and refund timeout **before acceptance**. An encrypted comparison network is an additional component with its own threshold/collusion/liveness assumptions. These dossiers establish code patterns, not an audited Zcash-compatible network or computation-proof implementation.

### Concrete lifecycle to implement

```text
DRAFT -> ITEM/CUSTODY READY -> OPEN -> CLOSED SNAPSHOT
       -> PRIVATE RESULT PENDING -> SETTLEMENT READY -> PAID/DELIVERED
                                   -> FULL REFUNDS on failure/timeout
```

A state is established by an immutable receipt/transcript or confirmed transaction, not a UI timer. No automatic phase advance may discard old refund or delivery obligations.

1. **Client seals the bid.** Encode auction/rules ID, integer bid, nonce, refund address, bidder result key and receipt binding. Encrypt locally to the independent private-computation system; produce an admission proof binding ciphertext to permitted amount range and funded receipt, if that system supports it. Do not send plaintext bid to an operator API, log, analytics provider or outsourced prover whose witness boundary has not been established.
2. **Fund one common collateral amount.** Real shielded ZEC arrives in per-auction FROST-governed custody. Operator viewing keys reveal received amounts and memos, so ordinary memo encryption alone cannot hide exact-sized bid deposits. A **common amount for every admitted bid** reveals the common cap, not individual bid size. Optional tiers disclose each bidder's upper-bound class and therefore are a weaker privacy policy, not the default for a “no leaks” entry. Fresh diversified receiving addresses and bidder return/result keys reduce application linkage; browsing/network/funding services remain separate metadata boundaries.
3. **Issue funded acceptance receipt.** Receipt binds confirmed note/funding reference, encrypted bid hash, auction/rules hash, unique nonce and refund entitlement. Memo is a versioned compact 512-byte envelope; if ciphertext/proof is too large, store it off-chain with authenticated content hash and redundancy. A plaintext operator receipt is not a funded note. Deduplicate against immutable receipt ID; invalid/out-of-range bid must have a refund path.
4. **Freeze the accepted set.** Close fixes an ordered root and the chain/finality evidence. Ordering decides ties and prevents operator reordering after learning any result. Accepted bidders need inclusion evidence. Publishing a root proves neither completeness nor funded acceptance unless receipt issuance/inclusion policy makes omission detectable and recoverable.
5. **Compute limited output.** Independent FHE/MPC evaluates the frozen, funded set and immutable reserve/tie rule. Preferred public output is an auction-bound commitment plus completion/no-sale status; winner and clearing amount can be delivered privately to relevant parties. Verify exact output context: auction, rule version, accepted-set root and close snapshot. A signed committee result provides authenticity under committee trust; it is not automatically a proof of correct computation. State the chosen verification model accurately.
6. **Settle conserved ZEC.** FROST signers validate result authorization and one-time payout, then construct PCZT seller payment, winner change and loser refunds. Winner collateral C splits into payment P + change C-P; loser gets C, net of explicitly precommitted fee policy. Reject impossible amounts, underfunding and mismatched recipients before marking claims consumed. FROST shares spend authority; it does not hide notes from viewing-key holders or force signers to follow policy on chain.
7. **Complete delivery and refunds.** Inventory/custody ready must correspond to an actual deliverable, not a minted entitlement hash. Use a narrow external item and explicit custodian/delivery assumptions; Zcash has no custom shielded asset/NFT transfer to make that leg automatically atomic. If compute, funding or delivery fails, timeout policy authorizes full refunds and retains historical entitlement state. A committee refund policy is not an autonomous shielded covenant.

NEAR Intents is optional ingress, not required for the first working demo. Its route and addresses/amounts form a separate privacy boundary. Receipt UI must distinguish routing pending, ZEC confirmed, bid accepted and refunded. Do not accept an external bridge success flag as funded ZEC.

### Two feasible disclosure choices, with different promises

| Choice | Before fixed close | After close | What it fails to provide |
|---|---|---|---|
| Client tlock envelopes + independent custody | Content unavailable until specified release under beacon assumptions | Everyone holding ciphertext can decrypt every bid | Permanent losing-bid secrecy; output-only clearing; automatic custody release |
| Independent FHE/MPC + independent custody | Contents hidden from operator under specified cryptographic/committee assumptions | Only circuit-authorized outputs disclosed | A trust-free native Zcash contract; availability without a refund policy |

If tlock is chosen to satisfy “nobody can read bids before close,” target a fixed release round and freeze/finalize acceptance **before** that release. A network delay cannot justify extending acceptance after release. Abort late closure rather than expose bids during an open auction. If permanent loser privacy is part of the judging story, use output-only private computation instead; ordinary threshold decrypt-all at close changes who sees bids and when, not what ultimately becomes public.

## UI to steal and where accuracy matters

Use six bidder steps: terms → fund → encrypted bid accepted → close/result pending → private outcome → refund/change delivered. Show actual funded collateral and bid total separately. Offer a durable receipt/export or wallet-linked recovery path; in-memory orders/localStorage alone can lose refund capability. Expose confirmation uncertainty and exact receipt inclusion rather than another participant's changing auction count. Seller sees inventory-ready, frozen terms, bidding deadline, result pending and delivery/payout progress. Before-close dashboards show no running maximum, remaining budget or per-tick depth; even encrypted outputs granted to the operator can betray each incremental input.

## Static verification and remaining design gates

Checked repositories were cloned depth 1 and read only. Dossiers distinguish source from deployment claims, crypto execution from mock tests, token transfer from accounting notes and code findings from recommendations. No exploit execution, wallet interaction or end-to-end success is claimed.

Before implementation chooses a private-computation stack, resolve: ciphertext-to-funded-note binding and range proof; exact threshold/key ownership; private proving path; auction inclusion/censorship policy; close-finality/release sequencing; result verification; durable refunds under committee outage; deliverable custody; and minimal output/metadata disclosure. These are necessary mechanisms for the proposed auction, not generic warnings. The code references in the linked dossiers show why each affects the privacy or solvency promise.
