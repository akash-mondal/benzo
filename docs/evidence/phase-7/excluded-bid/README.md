# A paid bid the operator left out

The operator cheats on purpose: it takes bidder B's paid, sealed bid and keeps it out of the frozen set.
This run shows that B finds out and gets the deposit back.

Live on benzo.space, Zcash testnet, round `9d87d234…ad16a`.

1. Bidders A and B seal bids in the browser and pay their deposits.
2. The operator withholds B's record (a test switch on the intake), so B's bid is not frozen.
3. After the freeze, B's page asks for its proof of inclusion and gets `refused: ciphertext not in frozen set`.
   It shows **The operator left your bid out** ([`2-caught-on-bidder-page.png`](2-caught-on-bidder-page.png)).
4. The signers scan the round's addresses on chain themselves, so their settlement lists B's deposit as a refund.
5. B presses **Claim my 200,000 zats back**. The page signs the claim with the bid's own key, and the signers pay it
   ([`3-refunded.png`](3-refunded.png)).

| File | What |
|---|---|
| [`run.log`](run.log) | this run, ending `RESULT PASS` |
| [`run-1-detection.log`](run-1-detection.log), [`1-left-out.png`](1-left-out.png) | an earlier round: detection only |
