# Phase 7 evidence: the release runs

Everything here ran on Zcash testnet or offline with real drand. Each folder holds the raw output; nothing is summarised away.

## Start here

| What | Where | Result |
|---|---|---|
| A real round you can check yourself | [`gold/doc-walk/`](gold/doc-walk/) | `benzo verify` prints 19 `OK` (the README's two-minute check) |
| The same round, as a transcript of the three guides' commands | [`gold/doc-walk.out`](gold/doc-walk.out) | `RESULT PASS gate DOC walkthrough` |
| An 8-bid round, settled and verified from cold | [`gold/scale-8-final.out`](gold/scale-8-final.out) | `RESULT PASS scale-8` |
| A linked buyback series | [`gold/buyback-series.out`](gold/buyback-series.out) | `RESULT PASS buyback-series` |
| A paid bid the operator left out, caught by its bidder | [`excluded-bid/`](excluded-bid/) | caught; refund re-run pending |
| Three cross-chain rounds | [`gold/xchain-demo1-final.out`](gold/xchain-demo1-final.out), [2](gold/xchain-demo2-final.out), [3](gold/xchain-demo3-final.out) | each `RESULT PASS` |

## Rounds driven through the website

[`ui-drive/`](ui-drive/) holds Playwright runs that use the site the way a person does: start a round, invite bidders, seal bids in the browser, pay from a testnet wallet, paste the transaction id, watch the opening, wait for settlement and run every check on the Verify page.

- `drive-uniform.log`: the local site. Two bids, one changed before paying, settled with 3 payments.
- `live-<market>.log`: the same drive against the live deploy, benzo.space (one the host server, see the README). Each log ends with Playwright's own `passed` or `failed` line.

## The engine's own test suites

[`rg/`](rg/) has the release-gate runs, one `run.json` per suite with the commit and a verdict for every check:

| Suite | Checks | Note |
|---|---|---|
| `auction-core` | 23, all pass | one check narrowed (below) |
| `cli-auction` | 74, all pass | two checks narrowed: signers on the coordinator publish no host-signed maps, so that attestation is checked in the drop market run instead |
| `buyback-mode` | 14, all pass | |
| `settle-crash` | 6, all pass | settlement resumed after a crash at each step; one check narrowed |
| `testnet-golden-path` | 9, all pass | one check narrowed |

"Narrowed" means the check passed with one stated limit: testnet had a single lightwalletd we could rely on (`BNZ_LWD_SINGLE=1`), so agreement between two endpoints was not checked.

## Does the testing catch bugs?

[`mutations-final/`](mutations-final/) (and the earlier `mutations-b57/`, `mutations-b58/`): each run applies a patch that plants one known bug (for example, sealing to the wrong drand round), runs the suite and then reverts it. Every file states the failure it expected. All of them went red with the planted bug and green again after the revert, with a clean tree. The patches are in [`mutations/`](mutations/) and `../phase-1/mutations/`.

## Clean machine and reproducible build

[`pk-vm/`](pk-vm/): on a fresh Linux VM with no network, no checkout and an empty home, the published npm package installs, verifies a real round (all `OK`) and refuses two tampered copies. A fresh clone rebuilds the packages byte for byte (`04-rebuild.out`: `OK` for each).

## Live settlement edge cases

- [`h15-live/`](h15-live/): an unused fee reserve returned to its committed address after settlement.
- [`rel-walk-ca34e2a/`](rel-walk-ca34e2a/): the release candidate's walkthrough, then `benzo settle` run again three times (the reserve return once, then no change).
- [`rel-walk-dust-f47384d/`](rel-walk-dust-f47384d/): the same with a stray dust note sent to the reserve address.

## Fix-by-fix reproductions

[`repro/`](repro/) has one before/after output per fix, named by the batch that made it (`b44-…` to `b54-…`, `h10-…` to `h14-…`). [`docs/STATUS.md`](../../STATUS.md) says what each one fixed.
