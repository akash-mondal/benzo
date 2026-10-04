# Buyback run 3 (auction b379359d…, NU7 testnet, host custody)

- **Spec results (`results.json`):** Y1a, V1a, X1a, V1b, W2, W1, X1b and Y1c PASS. Y1b and V2 FAIL, from one cause: the settlement `d0bf28ff…` broadcast on NU7, then the worker died when the second lightwalletd endpoint (`zaino.testnet.unsafe.zec.rocks`) returned 503 past `chainTx`'s retries. That endpoint is still down mid-NU7.
- **Fixes:** ea86728 treats a transient outage as not-yet-seen. d7e06b8 adds `BNZ_LWD_SINGLE=1`, testnet only, recorded.
- **Completion (`settle-completion.log`):** the same staged batch completed with `BNZ_LWD_SINGLE=1`. Receipts: `leaf:0` 500210, `leaf:1` 500210, `leaf:2` 500000, `treasury` 10, exactly V2's expectation. `cold/` passes `benzo verify` (13 checks OK).
- A clean single-run pass is `buyback-run4`.
