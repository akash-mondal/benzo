# CrossDesk — sealed call-auction claim, unavailable implementation, successor specs

## 1. Facts, source, placement and inspection limits

Checked 2026-09-30. Original [HackCanton submission](https://hackathon.appsfactory.cc/projects/331f224f-daf2-44ad-9f62-1aac27b39767), retrieved from the [organizer submission API](https://api.appsfactory.cc/api/hackathons/159676be-7089-4bf0-8533-30b2933276d0/projects), calls CrossDesk a private sealed auction producing tokenized assets' official opening and closing price. Submission created July 12, updated July 23, 2026. It names Canton/Daml, Ledger API/gRPC, Java/Spring Boot, React/TypeScript/Vite, Docker/Kubernetes/Helm and cBTC/cETH. Snapshot: `sources-auc-doss-batch/crossdesk-submission.json` (relative to this dossier directory).

Archived research reports Financial Applications track winner and $1,000 track (`research/sources/canton.jsonl:49`, `research/sources/code-deep-markets.jsonl:10`). Current first-party site self-reports Best Financial Application, HackCanton Season 2, Grand Final August 5, 2026 (`sources-auc-doss-batch/crossdesk-home.html:69`, `:346`). Award amount was not independently reverified against an organizer prize announcement.

Advertised repo: [superbigroach/canton-dvp-settlement-desk](https://github.com/superbigroach/canton-dvp-settlement-desk). Shallow clone into `/tmp/zecathon-code/auc-doss-batch/` failed, repository not found. Owner public-repository inventory and GitHub CrossDesk/Canton search found no replacement. **No commit can be pinned, no original auction implementation read, no tests run.** Availability evidence is appended in `evidence-auc-doss-batch.jsonl`; prior research also recorded the repository unavailable. Private, removed and renamed are unresolved alternatives.

The [old demo](https://crossdesk-devnet-app.web.app/) now serves **ETP Foundry**, canonical `etpfoundry.com`. Its footer says formerly CrossDesk, same team/code/new name; this is a first-party claim, not a source-code comparison (`crossdesk-home.html:29`, `:346`). Current scope is price fixing and tokenized fund infrastructure; it is not evidence of the original sealed auction's mechanics. Home labels it a DevNet tier-0 indicative pilot (`:7`, `:266`). [Documents](https://crossdesk-devnet-app.web.app/documents) are draft, explicitly distinguish governing Methodology v1.0 from subordinate Rulebook v0.2, and retain prior versions (`crossdesk-documents.html:50–78`). Inspected HTML and downloadable public specs are saved in this dossier's source directory. No downloaded executable was run.

## 2. Lifecycle and exact bid flow

**Original auction: not established.** The submission establishes the intended opening/closing use case, not states, transitions, cutoff clock, extension rules, commit/reveal windows, cancellation policy or reveal eligibility. It does not establish whether sealed means ciphertext inaccessible to the auctioneer or selective disclosure from outsiders. Consequently an exact bidder transaction sequence cannot honestly be reconstructed.

**Current successor workflow, described by its public site, not verified code:** venues submit prior-window volume/VWAP/range/halt inputs; desk determines price, other seats validate risk/reserve/reconciliation gates, and enough signatures plus passed gates authorize publication. Published records identify inputs, signers and rules version; current pages distinguish tier-0 pilot values from attestations (`crossdesk-how-it-works.html:164–202`). The site states crypto official strike 16:00 London, adopted September 28; off-hours 00/08/16 UTC fixings are specified but unbuilt (`:205–216`). These are valuation schedules, **not verified auction bid deadlines**.

The current [governing spec](https://crossdesk-devnet-app.web.app/documents/methodology-v1.0.md) describes `Propose → Submit → Determine → optional Withdraw/re-propose → Validate → Finalize`, with a submission-first successor only proposed (`crossdesk-methodology-v1.0.md:571–591`). This sequence must not be relabeled as original auction commit/reveal.

**Our reference Zcash design, not CrossDesk behavior:** publish immutable lot/auction terms → accept funded client-sealed bids until cutoff → freeze accepted roster after declared confirmations → release key → validate/open → deterministic clear → pay/refund or declared abort. Each deadline needs one interpretation across client, operator, keypers and signers. A public opening/closing price is useful only if it comes from an immutable executable roster, not editable operator submissions.

## 3. Data structures and clearing

**Original bid, commitment, escrow and allocation result schemas are unavailable.** Unknown: buy/sell side support, limit/quantity precision, reserve, minimum fill, multi-unit allocation, marginal tie order, pro rata, imbalance rule, fee rounding and last-price/reference tie-breaks. No uniform-price or second-price claim is verified. Do not infer an algorithm from the word sealed or from the hackathon prize.

**Current successor spec, not an auction:** contributor fields include window endpoints, tradeCount, volume, vwap, low/high, haltSeconds, bid/ask TWAP and self-trade exclusion (`crossdesk-methodology-v1.0.md:407–426`). Its valuation rule can be represented as:

```text
eligible venue summaries → simple-median outlier screen
→ remove below-share-floor venues → cap weights when applicable
→ sort by VWAP → weighted median
exact half: adjacent weight-proportional interpolation, half-even rounding
two venues: require value within both reported ranges
```

Spec defaults include 300bp outliers, 10% volume floor and 50% cap; source `:593–638`. This computes a valuation from aggregates; it does not rank funded bidders or allocate units. No claim of executed implementation follows from reading the spec.

**Our fixed-inventory auction recommendation:** publish integer quantity/price units, reserve and exact ranking/rounding policy before funding. At close, reject invalid/unfunded/domain-mismatched entries, sort qualifying bids by price, allocate up to inventory, and determine declared marginal-price rule. Choose a marginal tie policy explicitly; pro rata requires a deterministic residual-unit rule, while receipt-order priority creates latency/censorship incentives. A double-sided opening/closing auction adds price-selection/imbalance tie policies and is larger scope. None of this pseudocode is attributed to CrossDesk.

## 4. Escrow, refunds, change, delivery and anti-griefing

Original contract authorization and custody cannot be checked. There is no inspected evidence of bid-time asset locking, worst-case payment coverage, winner funding, atomic DvP, item custody, collateral release, unfilled change, cancellation refunds, expiry recovery, bidder bonds, non-reveal penalties, Sybil/spam cost or auctioneer default remedy. Canton/Daml can express these choices but a named chain does not establish they were implemented.

Current homepage describes fund creation/redemption settled in one transaction; that product claim does not prove the old auction's escrow (`crossdesk-home.html:7`). Current rulebook says no benchmark has been adopted/published commercially (`crossdesk-rulebook-v0.2.md:9–13`). No tokens' backing, ledger settlement receipts or deployed package was independently checked.

**Design judgment:** steal the ambition to turn an auction result into a usable signed market record, but require funding and item custody before admission. A price without executable settlement invites spoofing. Use one funded receipt per admitted bid, a declared admission cost and an independent abort/refund deadline. ZEC input change and losing-bid refunds are separate accounting entries; all require committed destinations. CrossDesk supplies no verified implementation to copy for any of these.

## 5. Privacy: who sees what and evidence gaps

| Question | Original auction evidence |
|---|---|
| Auctioneer can read price before close? | Unknown; no contract observer/signatory list or encryption code |
| Other bidders see identities, funding, bids or order count? | Unknown |
| Hosting participant/server sees plaintext? | Unknown project topology |
| Opening key, threshold shares or bidder reveal required? | Unknown |
| After-close public loser prices or only clearing price? | Unknown |
| API authentication, logs, analytics and browser request bodies? | Not inspectable without app/repo source |

**Concrete successor boundary:** public methodology states REST submissions and full records live in an off-ledger log; administrator can read every submission; committee/auditor access is application policy, not ledger secrecy (`crossdesk-methodology-v1.0.md:991–999`). This does not prove an early leak in the removed original auction. It does establish that the current successor is not an operator-blind submission system.

The site also labels hosted checkers operator-run/tier 0 even with a seat's own key, reports no third-party member has run them, and says own-key L2 signing is switched off pending ledger API access (`crossdesk-how-it-works.html:229–241`). **Inference:** multiple nominal seats operated by one service do not establish independent custody or observation. Signing a result supplies authorization, not confidentiality of its inputs.

No original code `file:line` leak can be supplied because no original code was accessible. All `crossdesk-*.html/.md:line` citations here are exact local snapshots of public site/spec text, **not repository files**. This limit matters for judging: sealed/operator-blind cannot be credited on the available evidence. It is absence of proof, not proof of a vulnerability.

## 6. UI screens and UX

Submission provides a [demo video](https://www.youtube.com/watch?v=NXmlOw8CSDY); its old auction UI was not verified here. The live demo currently offers an ETP Foundry homepage, explanatory workflow, documents, status and desk link (`crossdesk-home.html:68`, `crossdesk-how-it-works.html:164–202`, `crossdesk-documents.html:50–78`). Public HTML was read; authenticated desk screens/transactions were not exercised. Bid form, seller setup, commit confirmation, reveal timer, allocations and refunds remain unknown.

**Stealable UX judgment:** publish the method and its version before accepting funds; give each result a signed provenance record; label unverified/degraded results visibly. The current product's distinction between indicative and attested values is useful. In our auction, analogous labels should be precise: sealed/funded/accepted/frozen/opened/cleared/settled/refunded, each backed by a receipt, root or transaction. Never show a simulation as settlement or a candidate valuation as an auction-clearing price.

## 7. Judgment and Zcash mapping

**Steal:** opening/closing call-auction positioning as a usable price-discovery service; public versioned methodology; signed result provenance; explicit unavailable/degraded publication status; separation between computing a result and independently authorizing it. These are design ideas, not verified CrossDesk auction code.

**Avoid:** claiming operator blindness from Canton selective visibility; treating inaccessible source as audited; equating an evolved benchmark with the original auction; treating a committee whose inputs are read/operated centrally as independent; extending the MVP into a full fund/benchmark business.

**Zcash mapping (our recommendation):** freeze published method hash and accepted ciphertext root, seal locally inside a shielded memo or committed external envelope, and obtain confirmed deposits independent of price validity. Threshold opening/tlock handles delayed readability. FROST signers independently recompute allocations and approve a PCZT payout/refund/change manifest; FROST alone hides no bids and enforces no auction math on-chain. Publish signed clearing price, inventory filled and method/root provenance without identifying bidder addresses. NEAR Intents may convert funding before cutoff; provider observations remain a separate privacy boundary. Deliver tokenized/external items through a separate custody/registry protocol, since the brief supplies no Zcash custom-asset/Daml execution equivalent.

**Selection judgment:** CrossDesk is a positioning and transparency reference with an implementation evidence gap. Use Shutter's inspected seal, Penumbra's receipt/claim UX and inspected bounded-settlement patterns as implementation references. Do not put CrossDesk's original privacy/clearing guarantees into the ZECATHON pitch until source and transaction-level evidence become available.
