# Zama dapps BlindAuction and ConfidentialDutchAuction

Owner: `auc-doss-fhe`. Static read-only review, 2026-09-30. Repository https://github.com/zama-ai/dapps, commit `1980034d500b12e0a03d172853c51401a4853701`. Paths/lines relative to `/tmp/zecathon-code/auc-doss-fhe/zama-ai--dapps/`. No untrusted code or tests executed.

## Facts and implementation reality

Official examples, EVM/fhEVM with ERC-7984, no hackathon placement. Solidity and Hardhat tests exist under `packages/hardhat`; source imports real FHE APIs. README_blind describes an older random-ticket contract (`packages/hardhat/contracts/auctions/README_blind.md:8-15`, `31-60`) that **does not match** current address-winner source. Treat executable source as authoritative. Root is a monorepo of dapps; deployed behavior/UI was not exercised.

`BA` = `packages/hardhat/contracts/auctions/BlindAuction.sol`; `DA` = adjacent `ConfidentialDutchAuction.sol`.

## Blind auction lifecycle and flow

Seller constructor transfers NFT and validates ordered start/end (`BA:93-110`). Bidder grants payment token operator and submits encrypted uint64 proof. During interval contract measures actual balance delta, adds incremental funding to bidder total, updates encrypted strict max and winner, grants own-bid ACL (`112-148`). After deadline requestDecryptWinningAddress publishes winner handle (`151-156`); resolveAuction takes handle list/cleartext/proof and stores winner (`198-204`). Winner claim resets balance, pays encrypted highest and sends NFT (`161-176`); losers withdraw via permissionless address-specific function that resets before confidential refund (`181-195`). No reserve, inventory quantity, multi-unit or pro-rata.

Data are beneficiary, token addresses, public times/winner/claimed flag and private encrypted max/address/bid map (`14-39`). Pseudocode: cumulativeDeposit += actualTransfer; replace leader iff cumulativeDeposit > max; decrypt address only; first-price transfer. Earliest tied leader persists; first initialized zero bid wins if no positive bid follows (`139-145`).

### Static correctness defects

Constructor never assigns `_tokenId` to `tokenId` (`BA:93-110`), while claim uses stored tokenId (`176`); nonzero-item auctions would attempt delivery of NFT 0. Test fixture uses 0 exclusively (`packages/hardhat/test/blindAuction/BlindAuction.fixture.ts:35-45`), masking that case.

`resolveAuction` verifies **arbitrary caller-supplied handlesList**, not the stored `winningAddress`, with no one-time or requested guard (`BA:198-204`). A valid decryption proof for some other handle is not proof of this auction's winner. Re-resolution is possible. This is a concrete application-binding defect, not a demonstrated exploit or a failure of FHE signatures. The newer fhevm docs tutorial constructs the correct handle internally and guards resolution; prefer it.

## Dutch lifecycle and exact buy/refund flow

Deployment starts the public price clock and stores public total inventory/floor; private tokensLeft initialized, owner gets its ACL (`DA:93-121`). Owner initialize tries inventory transfer and makes encrypted sufficient-inventory boolean public (`126-136`). finalizeInit verifies caller handle list and decodes bool (`148-154`)—same missing expected-handle binding. Once started, bids allowed before expiresAt and not manuallyStopped (`301-304`).

```text
P(t)=max(reserve, startingPrice-floor(discountRate*elapsed/86400))
q=min(encryptedRequested,tokensLeft)
requestedPay=P*q
actualPay=payment balance delta
qDelivered=select(actualPay==requestedPay,q,0)
transfer auction tokens immediately; accumulate qDelivered/actualPay
tokensLeft -= qDelivered
at end refund=paidTotal - P(finalTime)*qTotal
seller proceeds=P(finalTime)*(initialInventory-tokensLeft)
```

`DA:159-167`, `180-238`, `242-267`. It is a descending-price immediate-delivery sale with retroactive final-price refunds, not sealed price discovery. Multiple buyers, arrival-time inventory consumption, no tie/pro-rata. Sender knows purchased quantity/payment; public clock price and timestamp reveal acceptance point.

## Escrow and failure cases

BA locks inventory/deposits but requires winner cooperation for seller payout, no recovery for empty auction or failed KMS. DA pays sale tokens immediately, keeps payments for final-price rebates; user refunds delete bid ledger (`242-251`), seller claims remaining inventory/payment (`256-267`). Owner can stop if configured (`172-174`), changing timing; final getPrice still follows current/end clock, so stopped auctions do not freeze their price. Seller claim has no one-time claim flag and zeros tokensLeft; a repeat calculates sold quantity as full initial inventory (`261-265`), a static accounting/liveness concern. cancelAuction returns tokensLeft but changes no cancel status/inventory ledger (`295-297`), leaving bidding nominally open despite inventory removal. Bidder balance-delta check protects payment side but `_handleTokenTransfer` ignores actual inventory-transfer return (`214-216`). No spam bond or non-reveal penalty.

## Privacy and leaks

BA intended operator blind before close; public sender/time/item affiliation remains. Winning price stays encrypted, seller can view payment. DA is **not operator blind**: owner can decrypt tokensLeft on each update (`237`) and can publish it during sale (`271-272`); successive differences reveal purchases. Public event contains bidder and price (`195`). finalizeTokensLeftReveal also accepts unbound handle list (`284-290`). Final refund/proceeds confidentiality relies on token ACL/wrapper paths. Neither example gates disclosure on confirmed close finality.

## UI / UX

Contracts and tests are directly inspectable. Fixture/Hardhat flows show seller NFT preapproval, token mint/approval, encrypted bid, close/decrypt/resolve, winner claim and withdrawal. No verified auction browser screens or live deployment were established; do not count monorepo presence as UI execution. Dutch requires initialization/decryption before buying, then separate refund and seller claim; asynchronous states need explicit UI.

## Judgment and Zcash mapping

**STEAL:** funded balance-delta accounting; separate price/quantity design vocabulary; own-bid ACL; explicit asynchronous computation stages.

**AVOID:** this BA result binding and token-id bug, README/source mismatch, DA running inventory ACL, owner stop, missing cancel/one-time settlement guards. Use the repaired doc version as reference, not this contract verbatim.

On Zcash deadlines, exact input-set binding and one-time result acceptance belong to the off-chain coordinator plus FROST signer policy. Use encrypted memo price/quantity with independent collateral, privately addressed winner notice, and PCZT accounting that pays each deposit exactly once. Do not give operator an aggregate decrypt capability before close. tlock can enforce delayed publication under its beacon assumptions; it cannot privately reveal only an outcome. External token delivery needs separate chain/custody, potentially funded through NEAR Intents.
