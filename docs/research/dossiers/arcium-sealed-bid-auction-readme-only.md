# arcium-sealed-bid-auction — README-only candidate

## 1. Facts

Repository [ssgkgk1-sketch/arcium-sealed-bid-auction](https://github.com/ssgkgk1-sketch/arcium-sealed-bid-auction), commit `9d15dde51dc7e712648c06fa2687e0171c2ea1e9`. Read-only checkout `/tmp/zecathon-code/auc-doss-fhe/ssgkgk1-sketch--arcium-sealed-bid-auction/`. Entire tracked tree at this commit contains only README.md. No award independently established. README.md:1 names the project; :2 claims an encrypted Vickrey auction using Arcium. Neither chain settlement, runtime operation nor encryption implementation is established by that sentence. No project code was executed.

## 2. Lifecycle and flow

No states, deadlines, transitions, SDK or submission flow supplied. “Vickrey” names a mechanism but does not establish a implemented bid path.

## 3. Data and clearing

No bid/deposit/result structures or algorithm supplied. In a conventional single-unit Vickrey auction, highest wins and pays second price, with reserve/tie/single-bid policies requiring specification; that is general mechanism background, not a code fact about this repository. No pseudocode can honestly be derived from the source.

## 4. Escrow and griefing

No custody, refunds, item delivery, bonds, duplicate prevention, non-reveal penalty or recovery code/spec supplied.

## 5. Privacy

No evidence identifies decryptors, output disclosure, funding leakage or MPC failure/collusion boundary. An encrypted-auction description is insufficient to conclude operator blindness or permanent losing-bid secrecy.

## 6. UI and UX

No UI, screenshot, client or test flow in tracked tree.

## 7. Judgment and Zcash mapping

**STEAL:** no independently implemented feature. **AVOID:** promoting a candidate title to a working implementation. Use the separate [official Arcium dossier](arcium-official-sealed-bid-example.md) for real Arcis/Anchor code and the [Protocol 01 extract dossier](arcium-sealed-bid-auction.md) for conditional escrow design fragments.

Zcash mapping remains hypothetical: off-chain encrypted clearing, real funded shielded ZEC receipts and FROST policy settlement. This repository supplies none of the mechanism/result/escrow binding required to support that architecture.
