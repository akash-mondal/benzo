# The three auctions the B57 markets re-run left open (recovered at B58, 2026-10-25)

The Oct 23 markets re-run stopped on network failures and left three auctions unfinished. They were finished
with `tools/repro/markets.ts resume:<id>` at `bd518d0`'s product code (B58), on a stable network.

| Auction | Outcome | Record |
|---|---|---|
| `d153e9d9…` (drop) | SETTLED. Batch 1 paid leaf:1, leaf:3 and the seller in the resume. The two owner claims (an out-of-window balance payment, 20,000 zats, and an unadmitted deposit, 200,000 zats) were recorded with the kept owner keys; the resume's second settle could not close stale FROST sessions, and a re-run of `benzo settle` with frostd up paid both in batch 2 (tx `885bb2ae…`). `benzo verify` exit 0. | `resume.out`, `d153-settle-rerun.out`, `d153-verify.out` |
| `b548e8cb…` | CANCELLED before the freeze; the three 200,000-zat deposits refunded at their note values (settle exit 0). `benzo verify` refuses it with `missing frozen`, the disclosed limit (R132, `honest-limits.md`). | `resume.out` |
| `487c44d2…` | SETTLED, every obligation paid, `benzo verify` exit 0. | `resume.out` |
