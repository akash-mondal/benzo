# Evidence

Raw output from real runs, on Zcash testnet or offline against real drand. Nothing is summarised away.

| What | Where | Result |
|---|---|---|
| A settled round you can check yourself (the README's verify example) | [`verify-example/`](verify-example/) | `benzo verify`: 19 `OK` |
| A paid bid the operator left out: caught on the bidder's page, then refunded on the bidder's own claim | [`left-out-bid/`](left-out-bid/) | refunded in tx `4e19ae06…a778` |
| Every market driven through benzo.space in a browser: start, seal, pay, open, settle, check | [`live-markets/`](live-markets/) | uniform, drop, buyback, OTC, RFQ: `passed` |
| A linked series of buybacks | [`live-markets/buyback-series.out`](live-markets/buyback-series.out) | `RESULT PASS` |
| A token launch, settled with its delivery list | [`launch-round/`](launch-round/) | `benzo verify`: 19 `OK` |
| Cross-chain payouts: an ERC-5564 stealth address on Sepolia, a Token-2022 confidential transfer on Solana devnet, and three cross-chain rounds | [`crosschain/`](crosschain/) | each `RESULT PASS` |
| 17,000 sealed bids admitted, frozen, opened, cleared, planned and verified offline; an 8-bid round settled on testnet | [`scale/`](scale/) | [`bench.json`](scale/bench.json), `RESULT PASS scale-8` |
| The published package on a fresh VM with no network, and a byte-for-byte rebuild from a fresh clone | [`reproducible-build/`](reproducible-build/) | `OK` for each artifact |

Check a round's folder yourself:

```sh
node dist/benzo-verify.mjs --signer "$(cat docs/evidence/verify-example/signer)" --dir docs/evidence/verify-example/public
```
