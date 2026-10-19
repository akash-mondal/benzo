# Benzo

> *“the price should be public and the participants should not.”*
> — the Zecathon Private Markets track's own words

Benzo is a sealed-bid market engine on Zcash where nobody, including the operator, can read an order before the drand
round R. Until the published opening time, no one — not the operator, not the escrow signers, not the chain — can read
any bid's price or quantity, and no bid can be linked to a bidder. After opening, anyone can recompute the result, and
every loser is refunded automatically in shielded ZEC (the claim, `docs/research/DESIGN.md` §1).

## Check it yourself in 2 minutes

You need Node 24 and this checkout:

```sh
npm ci && npm run build:verify
shasum -a 256 dist/benzo-verify.mjs      # equals docs/verify-bundle.sha256
node dist/benzo-verify.mjs --signer 302a300506032b6570032100b2e3328b111dc70e59fedd2474f3b43d6171fa67a0e0569b04132f721836878e \
  --dir docs/evidence/phase-7/rel-walk-ca34e2a/public
```

That directory is a real testnet auction from the release-candidate walkthrough: three sealed bids, an opening at a drand round, 2-of-3 FROST settlement and the leftover fee returned. Verify recomputes all of it from public files and prints 19 `OK` lines. To see it refuse a doctored file, follow [`docs/verify-it-yourself.md`](docs/verify-it-yourself.md).

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

## Who can see what

| Can see… | Operator | Escrow signers (each) | Other bidders | Chain observer | Anyone after R |
|---|---|---|---|---|---|
| Your price and quantity before R | no | no | no | no | n/a |
| Your price and quantity after R | yes | yes | yes | yes | yes, as an anonymized leaf |
| Which wallet sent your order | no | no | no | no | no |
| Your refund or payout address | no | yes (they check what they sign) | no | no | no |
| The frozen set of sealed orders and its root | yes | yes | yes | yes | yes |
| The clearing result: fills, prices, refunds | after R | after R | after R | after R | yes |

Before R, nobody can open an order. This is enforced by drand timelock, not by access control. Every deposit is the same fixed C, so its size says nothing. Deposits are shielded, so no address links an order to a wallet. Refund and payout addresses travel only inside settlement envelopes encrypted to the signers. The limits behind each "no" are in [Honest limits](#honest-limits).

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

## What runs where today

| Where | What runs there |
|---|---|
| **Zcash testnet, live** | Six market modes end to end (uniform, collection drop, launch, buyback, RFQ, blind OTC): real shielded deposits with sealed memos, freeze, drand opening, clearing, and 2-of-3 FROST settlement. The current deployment settles under host custody on three signer VMs. Also live: a settlement worker killed mid-batch and resumed, refunds, stray claims, and the leftover fee reserve returned (`docs/evidence/phase-7/rel-walk-ca34e2a/`) |
| **Ethereum Sepolia, live** | A cross-chain payout to an ERC-5564 stealth address |
| **Solana devnet, live** | Token-2022 confidential transfer, as a standalone capability demo, not an escrow delivery |
| **Offline, with real drand** | Vickrey's distinct first and second price; 17,000 sealed bids admitted, frozen, opened, cleared and verified (`docs/evidence/phase-6/bench.json`) |
| **Measured, not run at full size** | Settling 17,000 bids: about 600 batches, projected at roughly a day on testnet |
| **Not built** | Mainnet (no mainnet transaction yet), witness-published deposit lists (H12), witness-signed reorg evidence (H17), a multi-transaction reserve sweep (H25), Railgun delivery |

## Honest limits

From the design (`docs/research/DESIGN.md` §14):

- drand threshold collusion can open bids early.
- A 2-of-3 signer collusion can steal or freeze the vault.
- A compromised client can leak its own bid.
- Post-close bid prices become public, anonymized.
- Network metadata (IP, timing) needs Tor or a VPN for strict anonymity.
- Seller delivery is off-chain.
- Fixed collateral C ties up capital above the bid.
- A single C per auction, no raises. Old tlock ciphertexts stay openable, so bid revisions are unsafe.

This build adds about 30 more, each with its reason. They cover signer trust, the reorg gate, dust, the fee reserve, the one testnet endpoint, the backup of keys and more: [`docs/honest-limits.md`](docs/honest-limits.md).

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
ec044a128889e67632251339d10d4243fdbfe02090b3fbf824ed6c6d40500bc0  dist/benzo-verify.mjs
$ cat docs/verify-bundle.sha256
ec044a128889e67632251339d10d4243fdbfe02090b3fbf824ed6c6d40500bc0  dist/benzo-verify.mjs
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

Every public claim, with its status, evidence and limits, is listed in [`docs/claims.yaml`](docs/claims.yaml).

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

**Live scale (gate SC, scale-55; Phase 7 H13/H16):** the first live 55-bid run showed each signer host re-decrypting
every bid for every batch, about 100 s of host time per batch, growing with the auction. Since H13 (openings cached per
host) and H16 (address checks done in bulk and cached), a host's per-batch work no longer grows with the auction.
- **Live, 55 bids:** about 45 s of compute per 14-row batch, flat across batches.
- **Offline, 1,000 bids:** 1.65 s for a host's second batch.

Settlement is now bounded by chain inclusion, about one batch per block. A 17,000-bid auction is about 600 batches at
`batch_cap` 28. That projects to roughly a day on testnet, inside the 24 h window only with some margin, and it has
**not been measured at that size**. Measured: [`docs/evidence/phase-6/scale-measure.md`](docs/evidence/phase-6/scale-measure.md).

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
