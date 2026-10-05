# Phase 5 part 2 §1 live market runs (NU7 testnet, host custody, `tools/repro/markets.ts`, `BNZ_LWD_SINGLE=1`)

| Row | Run | Result |
|---|---|---|
| Blind OTC, match | `otc/otc-match.out` | PASS: CLI clear = pure clear (midpoint 800); receipts buyer C−800, seller C+800; landed; cold verify |
| Launch, minimum missed | `launch/launch-miss.out` | PASS: every allocation cancelled, everyone refunded exact C; receipts = registry obligations; verify. Settled after the publisher fix c4bd9fa (allocation.json) |
| Launch, minimum met | `launch/launch-meet.out` | PASS: two lots at the uniform 250 (winners C−250, loser C, seller 500) after the winners' owner-signed delivery records (53b8b10); receipts = obligations; verify re-derives the clear with `launch_input` |
| Recovery | `recoveries/otc-fa22-claims.out` | An OTC run that stopped after funding (harness bug): both deposits were refunded through their owners' claims under host custody, after the mode-aware memo rule d9c5e66 |

Pending in this batch: OTC no-match, RFQ (allowlist, second-lowest price, treasury return), RFQ cancel, bid revision. Fixes the runs exposed: c4bd9fa, 53b8b10, d9c5e66, 5b11408, 562623d, plus the harness hardening commits.
