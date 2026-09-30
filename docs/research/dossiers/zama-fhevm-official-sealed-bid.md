# Zama fhEVM official sealed-bid tutorial

Owner: `auc-doss-fhe`. Static read-only review, 2026-09-30. Repository https://github.com/zama-ai/fhevm, commit `fd282b15b9069d2b8568edc97c441a45f1f50c7b`. Paths/lines relative to `/tmp/zecathon-code/auc-doss-fhe/zama-ai--fhevm/`. No untrusted code or tests executed.

## Facts and scope

Official educational spec/code embedded in `docs/examples/sealed-bid-auction.md` (abbreviated D), with companion tutorial `sealed-bid-auction-tutorial.md`. EVM/Zama, no competition placement. It contains complete Solidity example plus Hardhat mock test/fixture snippets, not evidence of a deployed auction house. The current `zama-ai/fhevm-hardhat-template` at `ec84e1aa1b0a3ef61d9795ef8bf367115b79272f` contains FHECounter, not an auction (`README.md:73`, `contracts/FHECounter.sol`); it supplies tooling rather than a separate auction lifecycle. This tutorial differs materially from current `zama-ai/dapps` BlindAuction, reviewed separately.

## Lifecycle and exact flow

Scheduled -> bidding -> end -> DecryptionRequested -> winner resolved -> prize claimed; loser withdrawal separately. Time modifiers require `start <= now < end`, then close (`D:75-88`). Seller preapproves predicted deployment address, constructor receives NFT and records id (`108-125`). Bidder mints/wraps confidential token, grants auction operator, locally encrypts amount with contract/address-bound proof (`D:275-295`).

Bid verifies input, measures auction confidential balance delta across transfer and adds to prior bid (`137-155`). Each new submission is **incremental funding**, not replacement final price. Bidder gets own total ACL, while encrypted max/winner stay contract-only (`157-171`). After close anyone requests one-time winner-only public decryption (`177-181`). Anyone submits proof; contract constructs exact current winner handle itself, requires request and no resolved winner, then verifies/stores (`187-196`). Winner alone claims, resets own balance, transfers encrypted highest amount to seller and NFT to winner (`202-217`). Anyone may withdraw a losing bidder's total back to that bidder after resolution (`221-234`).

## Structures and clearing

Public beneficiary/payment token/NFT/id/start/end/winner/claim/request flags; private encrypted highest, winning address and address->encrypted bid map (`D:32-60`). Single indivisible item; first-price, no reserve, no pro-rata or quantity bid.

```text
bidTotal[sender] += actualTransfer
if no initialized highest: highest=bidTotal; winner=sender
else if bidTotal > highest: highest=bidTotal; winner=sender
at end decrypt winner only
winner claim: pay highest confidentially; send NFT
loser withdrawal: zero ledger before refund transfer
```

Strict greater-than keeps prior leader on ties. First accepted **zero transfer** can become winner because uninitialized branch assigns sender regardless of value (`166-168`). No-bid auction leaves winner handle uninitialized and has no item recovery transition; zero-bid and empty cases need policy.

## Escrow, refunds, delivery and griefing

NFT locked at creation; confidential deposits equal cumulative bid. Seller paid only when winner claims; no third-party finalize prize or winner claim timeout. Winners consume whole first-price deposit; losers reclaim full sum, zero-before-transfer prevents repeat claims. No spam bond/positive reserve or non-reveal penalties: bidder never performs a reveal. KMS/network availability remains prerequisite to refunds. Token insufficient-balance behavior silently moves zero, documented in tutorial `143`; balance delta protects ranking against requested-but-unfunded bids. Constructor-time safe ERC721 transfer works while recipient has no deployed code; example includes receiver for later receipts (`D:128-131`).

## Privacy

Before close ordinary seller/operator cannot decrypt bids or running max via application ACL. FHE protocol still requires its cryptographic/network assumptions; contract ACL is not committee non-collusion proof. Transaction senders, funding/operator transactions, target auction and timing public even without BidPlaced event. After close winner address public, but highest value **not explicitly public-decrypted**; seller sees the final received transfer via token ACL. Loser totals remain encrypted under intended authorization. ERC-7984 sender/recipient/operator ACL and wrapper public entry amounts are separate leak surfaces; see OpenZeppelin dossier. No finality delay before irrevocable winner disclosure (`D:177-181`).

## UI / UX

No auction UI supplied by these doc snippets. Hardhat helper flow covers encrypted input -> operator approval -> funded bid -> timed wait -> publicDecrypt -> proof submission -> winner claim/loser withdrawal (`D:275-328`, `397-435`). Test suite explicitly refuses non-mock environment (`331-334`); source tests are not proof of real KMS behavior. Needed screens for a port: sale terms, bid total and funding receipt, close snapshot/result pending, private win/loss and settlement/refund status.

## Judgment and Zcash mapping

**STEAL:** exact winner-handle binding, one-time resolve, cumulative bid UX if explicitly labeled, actual transferred amount accounting, winner-only public result, zero-before-refund bookkeeping.

**AVOID:** empty/zero auction ambiguity, winner-gated seller payment, no decryption timeout, repeated funding correlating with bid changes, conflating template/tooling with a working UI.

Zcash cannot execute this comparison or escrow contract. Use encrypted memo/off-chain bid envelopes and off-chain FHE/MPC; result should bind auction id, frozen input-set root and winner pseudonym rather than a public address. Fixed collateral independent of bids protects against recipient viewing-key inference; cumulative exact funding would leak each total to its scanner. FROST controls spend authorization, PCZT coordinates seller/refund/change outputs; neither enforces deadline or hides note values from viewing-key holders. tlock is viable only if all bids may open after close. NEAR Intents supports funding/external asset leg and adds its own metadata and custody boundaries.
