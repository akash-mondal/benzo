# auc-doss-timelock — design synthesis and dossier navigation

Completed static source review, 2026-09-30. Scope: 13 dossiers covering all named implementations/specs and four additional tlock/commit-reveal auction implementations. Each dossier contains facts, lifecycle, structures/clearing, escrow/recovery, privacy, UI, and separately labelled judgment/Zcash mapping. Source commits and file/line evidence are pinned in the dossiers. No cloned repository code, builds, tests, scripts, or demo transactions were executed. Prize/deployment claims are attributed where not independently verified. Zcash capabilities in the supplied brief are treated as design constraints, not newly researched network claims.

The recommended architecture is **local tlock sealing + fixed shielded collateral + a frozen accepted-bid manifest + independently verified FROST/PCZT settlement**. Sub-Rosa/Starlock supply the closest admission/opening pattern; Canton supplies stronger complete-set, accounting and recovery rules. None of these applications can be ported wholesale to shielded Zcash because their smart-contract settlement guarantees are absent there.

## Dossiers

| Project / scope | Dossier | Main design lesson |
|---|---|---|
| shieldbid | [shieldbid.md](shieldbid.md) | Already uses Zcash, but recipient sees bid-valued deposits; generic CLI and demo refund behavior differ. |
| Sub-Rosa | [sub-rosa.md](sub-rosa.md) | Fixed partner escrow, canonical envelopes, keepers, real lot custody; arbitrary ciphertext still lacks validity proof. |
| Sealed Private Auction System | [sealed-private-auction-system.md](sealed-private-auction-system.md) | Real private funding/claims; voluntary reveal and simulated frontend are material limits. |
| datum | [datum.md](datum.md) | Useful call-auction/netting code; live plaintext status API defeats sealing. |
| OpenZeppelin Canton confidential auction | [openzeppelin-canton-confidential-auction.md](openzeppelin-canton-confidential-auction.md) | Strong immutable accepted-set/recovery spec; operator and relevant hosts see plaintext. |
| drand/tlock | [drand-tlock.md](drand-tlock.md) | Age hybrid timelock, strict chain mode, explicit verified beacon; no auction custody. |
| drand/tlock-js | [drand-tlock-js.md](drand-tlock-js.md) | Browser-local sealing; default dependency verifies BLS, while header-policy checks need tightening. |
| thibmeu/tlock-rs | [tlock-rs.md](tlock-rs.md) | Rust age adapter has error/short-read/panic issues; independent verification needs caller beacon checks. |
| OpenZeppelin canton-specs allocation experiment and related architectures | [openzeppelin-canton-allocation-specs.md](openzeppelin-canton-allocation-specs.md) | Exact authorization and change; bounded experimental fixture, not production TSv2. |
| Tacet | [tacet.md](tacet.md) | Real UI publishes bid through equal public escrow; first-bid probe and deadline margin also matter. |
| randa-mu/sealed-bid-auction-demo | [sealed-bid-auction-demo.md](sealed-bid-auction-demo.md) | Fixed bond/local sealing; wallet-global refunds and voluntary winner top-up break funded execution. |
| Stelvin | [stelvin.md](stelvin.md) | Integer conservation is useful; permissionless unproven plaintext/incomplete settlement is unsafe. |
| Starlock | [starlock.md](starlock.md) | Reusable auction templates and observable queue; watch persistence is not durable payout idempotency. |

Machine-readable deliverables: [one summary per dossier](index-auc-doss-timelock.jsonl), [incremental provenance and material findings](evidence-auc-doss-timelock.jsonl). Facts and recommendations occupy different fields/sections. The evidence file includes the additionally inspected drand-client v1.2.5 dependency commit.

## Findings that should decide the design

**A sealed memo does not hide its note value from the receiving operator.** Shieldbid reads decrypted note values at ingestion (`shieldbid/tools/engine.py:55–60`, in its pinned checkout; see [dossier](shieldbid.md)). Tacet's real UI seals and publicly locks the same amount (`apps/web/src/hooks/useRoundSession.ts:471,484–489,514`; [dossier](tacet.md)). Fixed collateral is a privacy requirement, not an optional UX refinement. Multiple public collateral tiers still reveal which cap a bidder selected; one common cap gives the cleanest demo claim.

**Secrecy, opening validity, clearing completeness, custody, and delivery are separate guarantees.** Tlock prevents early opening under the selected beacon's threshold assumption. It does not prove that an arbitrary submitted ciphertext contains a valid bid for the right auction/R. Sub-Rosa/Starlock check canonical opening hashes after release, but clear only recorded valid openings. Stelvin lacks even ciphertext-to-plaintext enforcement and allows an incomplete reveal list (`contracts/batch-gate/src/lib.rs:637–664,789–850`; [dossier](stelvin.md)). A correct algorithm over caller-selected fabricated inputs is still an incorrect auction.

**Publish acceptance before the decryption key exists.** Copy Canton's separate funded-prepared/accepted states and immutable complete set, not its plaintext-host privacy model (`docs/reference-architectures/confidential-auction.md:548–628,975–1000`; [dossier](openzeppelin-canton-confidential-auction.md)). Payment received, payment confirmed, and bid accepted are different events. A bidder must receive an inclusion receipt whose hash appears in the final accepted manifest. Publicly mirrored ciphertext is necessary for independent opening; inclusion receipts alone do not prevent censorship or fund theft.

**Settlement recovery needs its own data model.** Blocklock's wallet-global return map can consume another auction's collateral and even permits withdrawal through a nonexistent auction ID (`lib/SealedBidAuction.sol:39–42,176–195`; [dossier](sealed-bid-auction-demo.md)). Starlock's persistent watched queue coexists with an in-memory settlement guard (`services/keeper/src/store.ts:89–99`; `services/keeper/src/settlement-guard.ts:77–82`; [dossier](starlock.md)). On Zcash, confirmed notes/nullifiers/transaction state and signer policy must replace smart-contract duplicate protection.

**Tlock releases publicly at R, independent of an operator's UI gate.** Owner-trigger opening does not extend cryptographic privacy in Sub-Rosa. All ciphertext holders can read all payload bytes after R. Keep identities, refund addresses and delivery instructions separately encrypted if they should stay private after close. FROST signing shares are not automatically a threshold-decryption scheme.

## Recommended Zcash lifecycle (design judgment)

```text
Draft terms + custody commitment
  -> Published immutable terms (network, R, cutoff, reserve, caps, fees, tie rule)
  -> Locally sealed bid + fixed shielded collateral
  -> Confirmed funding and signed admission receipt
  -> Frozen complete accepted manifest, strictly before R
  -> Verified public beacon + independent complete opening
  -> Deterministic result and refund obligations
  -> FROST-reviewed PCZT proposal
  -> Broadcast / uncertain / confirmed payout reconciliation
  -> External delivery receipt or declared delivery-dispute outcome
```

1. **Begin with a small fully collateralized cohort.** One common deposit cap covers every allowed bid and disclosed fees. A separate small published processing bond can deter malformed submissions; its loss/refund conditions must be deterministic and agreed in advance. Do not use an arbitrary 20% non-reveal placeholder as policy. Timelock makes ordinary bidder return unnecessary, but malformed ciphertext still needs an explicit outcome.
2. **Seal in an inspectable bidder application.** Pin drand chain hash/public key/scheme/genesis/period and select R with a meaningful margin after the funding/acceptance cutoff. Use canonical round-time calculation, not `genesis+period*R` assumptions. Show a downloadable seal and terms hash; keep price out of HTTP telemetry, logs, wallet labels, public funding quotes and public deposits. A malicious served bundle can exfiltrate input; an independently downloadable/self-hosted bidder bundle improves the operator-blind claim.
3. **Bind the complete bid.** Canonical binary envelope includes protocol/version, auction ID, terms hash, price in integer zatoshis, quantity if needed, nonce, receipt identity and any separately encrypted refund/delivery blob digest. Hash every byte. Replacements explicitly supersede an earlier receipt; only the final accepted version is eligible. Ciphertext header R/hash must match the immutable terms. Header checking is not a proof of pre-release well-formed contents.
4. **Treat the 512-byte memo limit as a measured constraint.** Existing implementations use armored age ciphertext up to4096 bytes; that is not evidence the same envelope fits a Zcash memo. Measure the exact chosen bytes. If using a hash/pointer memo, make ciphertext independently available and signed/hash-bound before accepting funds as a valid bid; an unavailable URL is not a force-open mechanism. Minimize identifying metadata in the outer memo and receipt.
5. **Freeze funding and membership before R.** Record the confirmed note receipt and exact ciphertext digest, then sign/replicate the accepted manifest. Define chain cutoff/confirmations/reorg policy relative to beacon time and publish late-payment refund rules. Do not accept late deposits after learning the opened book. Keep funding receipt IDs opaque in public artifacts.
6. **Specify auction economics before intake.** For a bounded initial demo, single-lot highest valid bid is simplest. For uniform-price multi-unit sales, Canton's reserve/whole-lot/marginal pro-rata rules are a useful specification: underfilled book uses reserve, oversubscribed book uses the prescribed marginal winning level, floor marginal shares and assign remainder by immutable acceptance order. Explicitly state this pricing rule and its tie/Sybil tradeoffs; do not market it as universally strategyproof. Every losing, below-reserve, malformed, non-crossing and surplus amount must appear in the obligation ledger.
7. **Each signer verifies, not merely witnesses.** Before approving a PCZT, independently fetch the frozen manifest and authentic beacon, open every accepted seal, verify hashes/domains/limits, recompute allocation, and check every input/output/fee against the same result. Require deposit conservation: seller proceeds + bidder refunds/surplus + declared fees/bonds + retained custody change equals accounted inputs. FROST reduces unilateral spending authority but relies on participant policy; PCZT is transaction construction, not an on-chain auction covenant.
8. **Make uncertainty explicit and resumable.** Journal payout obligations, proposal identity, signer approvals, tx IDs, broadcast status and confirmations. Reconcile uncertain transactions before constructing replacements; guard against duplicate payment obligations and changed output destinations. Pause admission if necessary without erasing refund/recovery obligations. Restarts must not reset financial truth to an empty JSON queue.
9. **Use NEAR Intents only as an explicit funding/delivery rail.** A fixed-collateral quote can avoid encoding price, but origin chain/account, amount, timing and route may still leak participation. Bind returned funding to a receipt; handle pending/failed routes separately. It does not create native atomic Zcash delivery of an NFT, tokenized lot or physical asset.
10. **Choose an honest post-close disclosure model.** Publishing all ciphertext permits universal post-R bid disclosure. Public aggregate result plus privately encrypted bidder receipts improves UI privacy but cannot erase the publicly decryptable sealed book. If permanent losing-bid secrecy is required, tlock alone is the wrong mechanism; that requires additional confidential computation/disclosure design.

## What the working demo should establish

Demonstrate three independent bidder clients, including a bidder offline at close; identical shielded collateral with different private prices; operator access to receiving viewing data that reveals only fixed values and sealed payloads; an immutable pre-R receipt manifest; independent opening and clearing from replicated artifacts; confirmed seller/loser/surplus payouts; and restart-safe reconciliation. Include malformed/wrong-round bid rejection or declared recovery, delayed beacon handling, late funding refunds and actual external-delivery status. Show actual transaction confirmations separately from historical traces and calculated results.

Meaningful integration checks remain future implementation work: cross-language tlock vectors, malformed/encryption-error handling, canonical time boundary, exact memo sizing, exhaustive refund conservation, duplicate/uncertain payout recovery, and UI/log/network plaintext checks. The dossiers identify these requirements; the present review is static evidence, not a completed runtime privacy audit.
