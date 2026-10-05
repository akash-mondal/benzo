# Phase 5 part 2 §1 live market runs (NU7 testnet, host custody, `tools/repro/markets.ts`, `BNZ_LWD_SINGLE=1`)

| Row | Run | Result |
|---|---|---|
| Blind OTC, match | `otc/otc-match.out` | PASS: CLI clear = pure clear (midpoint 800); receipts buyer C−800, seller C+800; landed; cold verify |
| Launch, minimum missed | `launch/launch-miss.out` | PASS: every allocation cancelled, everyone refunded exact C; receipts = registry obligations; verify. Settled after the publisher fix c4bd9fa (allocation.json) |
| Launch, minimum met | `launch/launch-meet.out` | PASS: two lots at the uniform 250 (winners C−250, loser C, seller 500) after the winners' owner-signed delivery records (53b8b10); receipts = obligations; verify re-derives the clear with `launch_input` |
| Blind OTC, no match | `otc/otc-nomatch.out` | PASS: bid 500 < ask 700, cancelled; both refunded exact C; landed; cold verify |
| RFQ (reverse-Vickrey) | `rfq/rfq.out` | PASS: the non-allowlisted dealer refused; B (300) wins at the second-lowest 400 (C+400); A and X refunded C; 100 of the buyer's 500 budget returned to its signed treasury_ua; landed; cold verify |
| RFQ, one valid quote | `rfq/rfq-cancel.out` | PASS: cancelled; quotes refunded C; the whole 500 returned to the treasury; verify (settled on resume after the signing-lock fixes 9d5bc18/828a9a7) |
| Bid revision | `revision/revision.out` | PASS: the 200 bid superseded by the same owner's 300 inside the window; superseded deposit and loser refunded C; winner pays 300 to the seller; landed; cold verify |
| Collection drop | `drop/drop.out` | PASS at bfe68b6: 3 lots, 4 bids, sealed 300k reserve (lot c's 100k bid below it, lot unfilled); CLI clear = pure clear incl. the serial assignment from the drand beacon at R+2; bond-then-pay — leaf 0 paid its 300k balance in the window, leaf 2 defaulted and its 200k bond went to the seller (receipts leaf:1 C, leaf:3 C, seller 700k = obligations(result, {defaults:[2]}); landed; cold verify; a tampered serial in a cold copy is refused (`canonical result differs`) so verify replays `attachSerials`. First run and its harness fix: `drop/drop-first-run.out` |
| Recovery | `recoveries/drop-a66c-late-recovery.out` | The drop run that FATALed in the harness's pure-check call was finished with `resume:` 30 min after its balance window closed: the winner's late payment made BOTH winners defaulters by the stated rule (plan and both signing hosts derived defaults [0,2] from their own scans), everything settled and verify passed. The RESULT FAIL line is the stale scenario expectation `[2]`, not a product failure |
| Recovery | `recoveries/otc-fa22-claims.out` | An OTC run that stopped after funding (harness bug): both deposits refunded through their owners' claims under host custody, after the mode-aware memo rule d9c5e66 |
| Recovery | `recoveries/rfq-c4c3-claims.out` | An RFQ run that stopped after funding (transient TLS error): its three deposits refunded via owner claims and its 500 treasury funding returned |

- **Done here:** OTC, launch, RFQ, bid revision and the collection drop, all PASS live.
- **Still open from the design's table:** recurring buyback (the 2-round series with serial intake) and receipts prove/statement. Then the spec `e2e/markets.spec.ts` with 5M6–5M10 (head), and the cross-chain demos.
- **Product fixes these runs forced:**
  - bfe68b6: collection drop — serial shuffle at `clear` (beacon fetched through the failover URLs, recorded, published) and bond-then-pay (`balance_addresses`, `clear_height`, settlement waits for the window, defaults host-derived); its first run also forced the harness's pure-check reserve-opening shape fix (`drop/drop-first-run.out` → `drop/drop.out`);
  - c4bd9fa: launch `allocation.json` published;
  - 53b8b10: launch delivery records;
  - d9c5e66: memo rule per mode layout;
  - 5b11408: candidate reuse on retry;
  - 562623d: no host query when nothing is payable;
  - 9d5bc18: machine-wide FROST signing lock;
  - 828a9a7: stale sessions closed per attempt;
  - plus the harness hardening commits.
