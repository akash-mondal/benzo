# Fhenix official Sealed-Bid Auction PoC

Research owner: `auc-doss-fhe`. Read-only source review, 2026-09-30. Repository: https://github.com/FhenixProtocol/poc-sealed-bid-auction; pinned commit `bba80b51ed4cb7c4ef877f832c89b97682e57ad1`. All `path:line` references below are relative to that checkout, available under `/tmp/zecathon-code/auc-doss-fhe/FhenixProtocol--poc-sealed-bid-auction/`. No repository code, build, tests or deployments were executed. Static findings are distinguished from runtime confirmation.

## Facts and implementation reality

Official ecosystem reference, EVM/CoFHE, not an award claim. Real Solidity FHE calls and confidential token/NFT transfers; Hardhat tests and Next.js client exist. `packages/hardhat/contracts/SealedBidAuction.sol:4-15` imports CoFHE/FHERC20/ERC721. The supplied AuctionToken and AuctionNFT are demo asset contracts; source availability does not prove deployment or production operation. Cryptographic privacy depends on CoFHE computation, ACL enforcement and threshold decryption; this application does not implement that network.

## Lifecycle and exact bid flow

`SealedBidAuction.sol` below means `packages/hardhat/contracts/SealedBidAuction.sol`.

1. Seller approves ERC721, creates named auction with payment-token address and future start/end. NFT moves into contract before creation completes (`150-197`). Active includes scheduled and open periods. `Ended` is an enum member, not an assigned state (`22-28`).
2. Bidder obtains confidential token balance, grants auction an expiring operator permission, locally encrypts uint64 input and submits ciphertext/signature. Client implementation: `packages/nextjs/hooks/useAuction.ts:367-453`.
3. Contract enforces Active, `start <= now < end`, one bid per address (`212-215`); converts input, grants token ACL and calls confidentialTransferFrom (`218-228`). **Actual transferred amount**, not requested amount, becomes deposit and ranked bid (`230-251`). Bidder can decrypt own deposit; seller receives no bid ACL (`235-255`).
4. After end anyone requests settlement if totalBids > 0. State freezes and winner/amount are publicly decryptable; hashes persist for refresh recovery (`268-289`). Client obtains two threshold proofs (`useAuction.ts:523-563`).
5. Anyone finalizes with both verified decryptions; deposit transfers to seller and NFT to winner; state Settled (`297-337`). Losing bidders pull refunds (`344-372`). Seller can cancel only while Active with zero submissions (`379-395`).

## Data and clearing

Auction holds public seller/item/token/times/status/count, encrypted uint64 max and eaddress winner, then plaintext result and ciphertext hashes (`32-52`). Maps hold per-address encrypted deposits and bid/refund flags (`69-72`). Single-item first-price; no reserve, multi-unit or pro-rata.

```text
max = 0; winner = zeroAddress
for accepted submission in chain order:
    d = actual confidential transfer
    higher = encrypted(d > max)
    max = select(higher, d, max)
    winner = select(higher, sender, winner)
after close: decrypt only (winner,max); pay max; deliver item
```

Strict `gt` means earliest equal positive bid wins. **All-zero transfers leave zeroAddress as winner although totalBids is nonzero** (`241-257`); finalize then looks up a zero-address deposit and attempts NFT delivery there (`319-332`). Static liveness concern; not executed.

## Escrow, refunds, delivery and griefing

Bid-sized escrow is confidential, preventing the ordinary public-deposit amount leak. No reveal obligation or non-reveal penalty. Losing deposit returns in full; winner has no change because first-price consumes full deposit. Full NFT custody before bidding avoids seller withdrawal; transaction rollback couples seller transfer and NFT transfer in EVM. No explicit positive-bid constraint, address admission bond or Sybil protection. One-address limit does not prevent many-address zero bids. No timeout refund if threshold network stalls; losers wait for Settled or Cancelled, and seller cannot cancel after a bid (`347-351`, `383-384`). NFT receiver failure may block finalize. External token/NFT calls precede Settled assignment and no reentrancy guard is imported (`319-335`): review this interaction ordering before reuse; an exploit was not demonstrated.

## Privacy and leaks

Before close bidders know own inputs/deposits; ordinary seller/operator cannot decrypt bid values from application ACL. Public chain sees seller/item, bidder addresses, auction participation, time, count and operator approval. `BidPlaced` explicitly indexes bidder and timestamps (`89-93`, `259`); hasBid is public (`72`). After request, winner and winning amount become available to anyone, even before final on-chain settlement (`277-279`). Losers remain ciphertexts but their public identities/refund interactions persist. FHE ciphertext secrecy is not protection from a sufficiently colluding threshold network. No close-finality delay is enforced before making results public; consider reorgs separately.

## UI and UX

`packages/nextjs/components/auction/` contains AuctionsPage/AuctionList/AuctionCard, CreateAuctionForm/NFTSelector, AuctionDetail and PlaceBidModal. Bid workflow exposes operator approval, encrypting, wallet transaction and receipt steps (`useAuction.ts:413-467`). Settlement requires request, wait/decrypt, finalize; persisted handles make refresh survivable. Refund is a distinct action (`587-602`); it is not automatic. UI was inspected as source, not opened or exercised.

## Judgment and Zcash mapping

**STEAL:** actual-funded-amount ranking; result-only decryption; pre-escrowed item; persisted settlement request; public reproducible state transitions with private values. This is the cleanest simple NFT lifecycle in this group.

**AVOID:** no liveness escape, zero-funded bids, public bidder identities, arbitrary token acceptance and external-calls-before-final-state pattern.

Zcash shielded notes hide deposits from chain observers, but the recipient viewing key reveals their amounts. Deposit equal to encrypted bid therefore destroys operator blindness if the operator can scan receipts. Use a common fixed collateral tier independent of bid, client-encrypted bid envelope and separate threshold/FHE computation; rank only bids whose collateral proof/receipt is bound to the envelope. FROST protects spending authority, **not incoming amount visibility**. PCZT lets signers assemble seller payout plus loser refunds/change, but signers must enforce an off-chain result/solvency policy. Memo payload needs auction id, commitment, ciphertext or content hash, and receipt/refund binding within 512 bytes. NFT delivery remains external; NEAR Intents can fund ZEC or support an external item leg but is not an atomic shielded NFT contract.
