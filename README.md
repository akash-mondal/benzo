# Benzo

> *“the price should be public and the participants should not.”*
> — the Zecathon Private Markets track's own words

Benzo is a sealed-bid market engine on Zcash where nobody, including the operator, can read an order before the drand
round R. Until the published opening time, no one — not the operator, not the escrow signers, not the chain — can read
any bid's price or quantity, and no bid can be linked to a bidder. After opening, anyone can recompute the result, and
every loser is refunded automatically in shielded ZEC (the claim, `docs/research/DESIGN.md` §1).

## How it works

1. **Bid.** Every bidder sends the same shielded deposit C, and its memo carries an order sealed with drand timelock to
   the round R.
2. **Freeze.** Before R, the accepted set of orders is frozen and its root is witness-certified, so nothing can be added
   after anyone could decrypt.
3. **Open.** At R the drand beacon releases, and anyone can open every order in the frozen set.
4. **Clear.** A public, deterministic clearing through the mode registry computes fills, prices and refunds from the
   opened orders.
5. **Settle.** A 2-of-3 FROST vault pays out and refunds (`docs/research/DESIGN.md` §6), and every signer recomputes the
   result and checks every output before signing. The testnet deployment settles under **host custody** (R28): each
   signer host pins the operator's manifest-signing key and the frozen root, re-derives every output from its own chain
   scan, and keeps a txid approval ledger so no source is paid twice (`docs/evidence/phase-5/y2-r28/`).
6. **Prove.** Bidders get private settlement receipts, and `benzo verify` recomputes the whole auction from the public
   directory.

## Markets

All modes run on the same engine: the same deposit C, the same freeze, the same drand round, one registry
(`clear/registry.ts`).

| Market | One line | Proof |
|---|---|---|
| Uniform auction (Mode A) | Multi-unit; everyone pays the lowest winning price; the last band fills pro-rata | **testnet-proven live** |
| Vickrey | Single lot; the winner pays the second price | offline-proven |
| Collection drop | Multi-lot uniform auction; serials assigned by a drand-driven shuffle | **testnet-proven live** |
| Launch | Holder and public tranches with a minimum raise; allocations in standard lots | **testnet-proven live** |
| Buyback | A treasury buys the lowest sealed asks; recurring windows with a public report | **testnet-proven live** |
| RFQ | Reverse auction: lowest ask wins, second-lowest sets the price; two quotes minimum | **testnet-proven live** |
| Blind OTC | One buyer and one seller post sealed limits; they trade at the midpoint if the limits cross | **testnet-proven live** |

**testnet-proven live** means the full path ran on Zcash testnet: real payments with memos, mining, scanning, clearing
and 2-of-3 FROST settlement (`docs/evidence/phase-1/EVIDENCE.md` … `docs/evidence/phase-4/EVIDENCE.md`, and — one row
per live auction — the LP-0004 table in [`docs/evidence/phase-6/EVIDENCE.md`](docs/evidence/phase-6/EVIDENCE.md), with
the run artifacts under `docs/evidence/phase-5/markets/`). **offline-proven** means the mode was sealed and opened with
real tlock against the drand mainnet quicknet beacon and cleared and checked by the shipped code, but has not run on
the testnet yet (the runs are recorded in `docs/STATUS-B.md`). One caveat: the Phase 2 live run computed a Vickrey comparison on live inputs, but the sample
prices tied, so the distinct first/second-price path is offline-proven only (`docs/evidence/phase-2/EVIDENCE.md`).

## What's private, what's public

| Private | Public |
|---|---|
| Order price and quantity before R, sealed with drand timelock | The frozen set of ciphertexts and its Merkle root, witness-certified before R |
| Who bids: no address links an order to a wallet, and deposits are shielded | The fixed deposit C (the same for every bidder) and each deposit's ciphertext |
| Where refunds and payouts go: destinations travel only inside encrypted settlement envelopes | After R, every order opens: price and quantity per anonymized leaf, not linkable to any wallet |
| | The clearing result: fills, prices, refunds, fees and the conservation check |
| | The drand beacon for R and its BLS signature, so anyone can re-derive the openings |

## Cross-chain delivery

A winner's cross-chain payout destination travels in the same sealed settlement envelope as its Zcash
refund — signers attest only what they open themselves, never an operator file
(`docs/evidence/phase-5/repro/r19-attest-deliver.out`), and each chain's escrow pays only the kinds it
can (`docs/evidence/phase-5/repro/r25-3-kinds-after.out`). Under host custody each host attests with its own envelope
and cross-chain keys, and `benzo xchain release` pays only when **two distinct signers in the lock's signer set** attest
byte-identical derivations — the same 2-of-3 trust as FROST settlement (R31;
`docs/evidence/phase-5/mutations/X1-a.out`, `X1-b.out`). Where each private-delivery path stands:

| Path | Status | Evidence |
|---|---|---|
| **ERC-5564 stealth addresses (EVM)** | **live on Ethereum Sepolia**: one delivery paid to a fresh one-time address, found and spent by the winner's viewing key alone, with the gas stipend and the announcement on the canonical Announcer | `docs/evidence/phase-5/repro/stealth-live.out` |
| **Token-2022 Confidential Transfers (Solana)** | **live on Solana devnet as a standalone capability demo — not an escrow delivery**: the Solana escrow pays native SOL only, so a confidential SPL delivery needs escrow token support (future work) | `docs/evidence/phase-5/repro/ct-live.out` |
| **Railgun `shield()` (EVM)** | **deferred to mainnet future work**: it needs a custody-touching shield adapter in `BenzoEscrow.sol` (custom contract code, so it merges only after Reviewer R's hard review) and it conflicts with the exact `ethers` pin; ERC-5564 stealth is the EVM private-delivery path for the hackathon | `docs/evidence/phase-5/repro/railgun-blocked.out`, `docs/AUDITS.md` |

Every deliver carries a secret 32-byte salt generated inside the sealed envelope, so guessing a
winner's meta-address never links its payouts
(`docs/evidence/phase-5/repro/r25-1-link-after.out`).

## Honest limits

Copied from `docs/research/DESIGN.md` §14:

- drand threshold collusion can open bids early.
- A 2-of-3 signer collusion can steal or freeze the vault.
- A compromised client can leak its own bid.
- Post-close bid prices become public, anonymized.
- Network metadata (IP, timing) needs Tor or a VPN for strict anonymity.
- Seller delivery is off-chain.
- Fixed collateral C ties up capital above the bid.
- A single C per auction, no raises in the MVP. Old tlock ciphertexts stay openable, so bid revisions are unsafe.

Stated again for this build:

- All orders open at R. Losing bids are not secret forever.
- Two of three signers acting together can misbehave; `benzo verify` shows it after the fact.
- **A colluding 2-of-3 quorum can misdirect a refund and the public cannot tell** (R16 F6): receipts
cannot bind a shielded destination publicly without leaking it. The owner detects non-receipt and
holds a signed settlement statement (`docs/evidence/phase-4/EVIDENCE.md`).
- Each signer can read every refund destination, because they must check the outputs they sign.
- **A deposit slot holds one bid in a bond-then-pay auction, and a collision is refunded** (R40 F1):
deposit slots are a shared public list and a payer is unobservable on shielded Zcash, so no rule can
attribute one address's payment among several bidders. Only the first deposit note at each slot is an
order; every later note there is a stray, refunded to its own depositor (who loses only the fee).
- **A payment that arrives at a balance address is that slot's bidder's** (R40 F1, R41 F10, R41.6): money sent to
someone's manifest-fixed balance address settles that slot's balance up to `balance_due_zats` and nothing else —
the vault keeps nothing there. An overpayment's excess and a defaulted winner's whole in-window payment refund to
that slot's bidder as their own immutable `balance-excess` row (a default forfeits the bond and the lot, never
the balance money they sent), and an out-of-window payment refunds to them as its own `balance-late` row — each
claimable with that slot's bid owner key.
- **A note at the balance address of a deposit slot with no bid is unrecoverable** (R40 F5): nobody can
claim it (no owner key exists for the slot), so it is never swept and never refunded.
- **A reorg deeper than the 10-confirmation gate is outside the model** (R42 F12, R46 F23): balance-address
notes are classified (in-window, late, excess) only once past the ZIP-315 confirmations rule (10), so a
shallower reorg cannot move a note across the window edge; an **unpaid** refund row whose derivation changes is
replaced (rows money has moved for never change), and conservation is checked at every pin. A reorg deeper
than that gate is out of scope, as for any Zcash wallet.
- **Liveness limits of settlement** (R45/R46): rows that no reachable signer host can build are set aside for
that settle run only and re-derived on the next one — an owner's claim makes a set-aside refund payable then.
A signer host that fails in a non-typed way forever (it never answers or always crashes) stalls settlement
until it is fixed or replaced; and a payout row (seller, treasury) that no host can ever derive has no
automatic completion path — it waits, it is never paid elsewhere. Both are liveness limits: funds are never
misdirected.
- **One lightwalletd endpoint on testnet** (R27/R47): since NU7, `testnet.zec.rocks` is the only public NU7
testnet endpoint, so testnet runs set `BNZ_LWD_SINGLE=1` and no second endpoint confirms heights or
transactions. The live evidence records each such check as `PASS (narrowed: …)`. Mainnet refuses the flag and
needs two endpoints.
- **Chain and beacon calls are time-bounded, not guaranteed to finish** (R48/R49): every lightwalletd call is
killed after 10 min (`BNZ_LWD_TIMEOUT_MS`) and retried as transient, and `tle -d` is killed after 2 min. Wallet
sync keeps its progress, but a sync needing more than 3–4 bounded attempts (a long-unsynced wallet) refuses, and
the operator re-runs it. A machine power loss during a sync can leave a block cache that later refuses to decode
(it never yields wrong notes); re-syncing from a clean cache fixes it.
- **A bond window is a block height** (R33/R61): the operator fixes `balance_window_start_height` before
bidding, but R is a time. If blocks arrive faster than the operator assumed, so that the window's start block
predates R, nobody could have known they won when the window opened. The bond is then **void**: two signer
hosts attest it over the identical signed start-block header (read from every configured endpoint), `benzo
verify` recomputes it from that header, every deposit refunds C minus the auction fee (settlement requires a
zero fee, so exactly C), every balance payment refunds in full, and the seller is paid nothing. A bond is a
uniform/vickrey feature only, and `auction create` refuses a start that is already mined.
- **Each signer host trusts its own lightwalletd endpoints** (R28/R64): a host reads notes, mined heights and the
bond-window header from the endpoints in its own launcher config, and two distinct endpoints must agree
(`BNZ_LWD_SINGLE=1` is testnet-only). In this testnet deployment one operator provisions all three hosts with the
same endpoint pair, so the 2-of-3 rests on that one pair. On mainnet each signer's operator must choose its own
independent endpoints. The
sale fails rather than funds locking. Pick a conservative start.
- **Test-harness gates attest the machine under test** (R49/R52/R53): the NU7 tools are path builds, so
the pinned-binary gate checks the build's provenance record against the committed source and patches, and each
evidence `run.json` pins the record's digest. The gate cannot be independent of the machine that built the tools;
reproducible builds would be needed for that. The development fund-recovery sweeps in the live specs assume one
live run at a time.
- The signer-reproducible stealth derivation is custom (2-of-3 signers must derive the same one-time
address); its salt is known only to envelope openers, so a guessed meta-address links nothing
(`docs/AUDITS.md`, `docs/evidence/phase-5/repro/r25-1-link-after.out`).
- On the cancel path a signer authenticates a refund's envelope from the chain alone — the deposit
memo commits to it (memo framing v2) — so cancellation never needs a decryption
(`docs/evidence/phase-5/repro/r16-memo-bound.out`).
- Delivery of off-chain assets relies on the marketplace adapter.
- Testnet only so far. No mainnet transaction has been made.

## Quick start

Node 24 and a checkout are enough. These are the exact commands and output of one run (2026-10-06; the runs are recorded in `docs/STATUS-B.md`,
and [`docs/reproducible-build.md`](docs/reproducible-build.md) has the byte-for-byte rebuild recipe):

```sh
npm ci                 # install the locked dependencies
npm run typecheck      # check the sources
npm run build:verify   # build dist/benzo-verify.mjs; the sha256 is reproducible
npm run build:cli      # build bin/benzo
```

Each exited 0. The verification bundle rebuilds byte-for-byte:

```text
$ shasum -a 256 dist/benzo-verify.mjs
b122bf2b3503ee319f5d638c32b968ffe2fd03bd08875b5dc4648cfcce1451ce  dist/benzo-verify.mjs
$ cat docs/verify-bundle.sha256
b122bf2b3503ee319f5d638c32b968ffe2fd03bd08875b5dc4648cfcce1451ce  dist/benzo-verify.mjs
```

Then verify the shipped public auction directory (the expected signer key is published in the directory's own
`signer.json`):

```text
$ bin/benzo verify --dir docs/evidence/phase-4/cli --signer 302a300506032b65700321000ad232b8429de606bf4c437c476fff5b233023d1037e0c908adaf149badb7891
OK projection
OK missing-deposits
OK delivery
OK report
OK manifest
OK freeze
OK witness
OK receipts
OK clear
OK envelope
OK claims
OK accounting
OK balances
WARN no witness set (pre-Phase-5 manifest)
OK accounting-strays
```

Exit code 0. The same checks run from the standalone bundle outside any checkout; see
[`docs/verify-it-yourself.md`](docs/verify-it-yourself.md) for a full walkthrough, what each check means, and a
tampering demo. Why the release time is exact and the beacon is trustworthy: [`docs/why-timelock.md`](docs/why-timelock.md).
Building a UI? Every route of the JSON API is documented in [`docs/api-reference.md`](docs/api-reference.md). The three
shipped artifacts — the verify bundle, the npm package and the bidder bundle — rebuild byte-for-byte from a fresh
clone: [`docs/reproducible-build.md`](docs/reproducible-build.md).

## Evidence

Testnet runs (each `EVIDENCE.md` links the artifacts and the recorded command):

- [`docs/evidence/phase-1/EVIDENCE.md`](docs/evidence/phase-1/EVIDENCE.md) — pinned tools, 2-of-3 FROST spends, memos
  through mining, browser seal and Go `tle` open.
- [`docs/evidence/phase-2/EVIDENCE.md`](docs/evidence/phase-2/EVIDENCE.md) — one complete auction: receipts, freeze,
  clearing, stray-value handling, cancel and refund.
- [`docs/evidence/phase-3/EVIDENCE.md`](docs/evidence/phase-3/EVIDENCE.md) — batch settlement, crash and recovery
  drills, the signed public directory.
- [`docs/evidence/phase-4/EVIDENCE.md`](docs/evidence/phase-4/EVIDENCE.md) — the CLI auction on testnet: operator
  commands, public API, multi-batch FROST settlement.

Offline scale ([`docs/evidence/phase-6/bench.json`](docs/evidence/phase-6/bench.json), run at `3bfde30`): 17,000
synthetic sealed bids (the organizer's 48-hour volume, `docs/PHASE-6.md`), sealed with real tlock to a past quicknet
round, then admitted, frozen, opened, cleared, batch-planned and verified: **generate 538 s, admission 3 s, freeze
0.4 s, open 451 s, clear 0.7 s, batch-plan 0.07 s, verify 455 s** (peak RSS ≤ 1,058 MiB). Settlement: **608 batches of
up to 28 outputs** (`batch_cap` 28, R30 — a 28-output batch settled in one 94,380-byte transaction,
[`docs/evidence/phase-6/scale-measure.md`](docs/evidence/phase-6/scale-measure.md)), an estimated **88,040,000 zats**
of ZIP-317 fees, and a projected **20.9 h** of settlement wall time (24.1 h at the old cap of 13) from the measured
scale-8/scale-27 points, with 2-of-3 FROST signing flat at 8.2 s per batch under R29's parallel single-message
sessions (`bench.json`'s `projection` block).

## Repository layout

- `seal/` — the browser bidder: seals the order into the deposit memo with drand timelock.
- `manifest/` — signed manifest schema and CLI; pins the quicknet chain and the auction's rules.
- `clear/` — the clearing engine: one registry entry per market mode.
- `envelope/` — settlement envelopes: where refund and payout destinations travel, encrypted.
- `crosschain/` — cross-chain escrows and private-delivery adapters (EVM, Solana, stealth, Token-2022).
- `witness/` — witness certificates over the frozen root.
- `scan/` — the vault scanner (Rust): finds deposits on chain.
- `settle/` — settlement planning and ledger: payouts, refunds, batches.
- `api/` — the public read API over a public auction directory.
- `cli/` — the `benzo` commands, including `benzo verify`.
- `adapters/` — marketplace and buyback report adapters (read-only).
- `tools/` — bootstrap, benchmark, leak audit and build scripts.
- `e2e/` — the end-to-end tests against real dependencies.
- `schemas/` — JSON schemas for the public files.
- `docs/` — phase contracts, evidence, research and guides.
- `bin/`, `dist/` — built entry points and the standalone verification bundle.
