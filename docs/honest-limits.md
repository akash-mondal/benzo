# Honest limits

Every known limit of this build, in one place. The README carries the short list.

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

- **Leftover fee funds return only when the auction owes nothing else** (H15): after settlement one final `reserve-return` batch pays the vault's whole unspent value minus the ZIP-317 fee to the manifest-committed return address — but only once every row is receipted and no stray deposit or late/excess balance note remains unpaid (claimed or not). An unclaimed stray can therefore delay the return indefinitely: a batch can spend the stray's note and leave its value in internal change, so an earlier sweep could return a bidder's unclaimed money to the operator. That delay is the conservative choice.
- **Dust stays in the vault** (B54): the sweep spends exactly the notes the wallet can select, and the pinned wallet never selects a note of 5,000 zats or less (ZIP-317 `MARGINAL_FEE`). Such a note is permanently unspendable — anyone can create one by sending 1–5,000 zats to a published deposit address — and while its refund is paid from other notes (and never keeps the return waiting once receipted), the note itself stays in the vault forever. The published `reserve_return` accounting reports the residue (`dust_notes`/`dust_zats`): dust of at most 5,000 zats per note stays in the vault.
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
- **Coordinator-local signing is dev-only** (R70): the `cli-auction` drill signs with local FROST signers, which
publish no host-signed approval maps, so a paid stray claim cannot be attested there. Production settlement is
host custody (R28), where every paid claim is attested by two signer hosts.
- **Each signer host trusts its own lightwalletd endpoints** (R28/R64): a host reads notes, mined heights and the
bond-window header from the endpoints in its own launcher config, and two distinct endpoints must agree
(`BNZ_LWD_SINGLE=1` is testnet-only). In this testnet deployment one operator provisions all three hosts with the
same endpoint pair, so the 2-of-3 rests on that one pair. On mainnet each signer's operator must choose its own
independent endpoints.
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
- **Witnesses are trusted to see deposits** (gate H, threat 066): the one-root rule stops a witness quorum from
certifying two different frozen roots, but not from certifying one wrong root. Choose `q_w` so that no quorum can be
built from witnesses you do not trust.
- The seller payout address is committed in the signed manifest and each signer host checks the settlement
packet against it; a seller should check the commitment against their own address before bidding opens with
`benzo seller check --manifest public-dir/manifest.json --ua <your address>`.
- **A chain reorg after the freeze breaks verification** (H17): if a frozen deposit leaves the chain, `open` marks it `reorg`, but `benzo verify` has no chain view and refuses that published row, so an honest auction that saw a reorg would not verify. With 10 confirmations required before freeze this is rare; the fix (witness-signed reorg evidence) is not built yet.
- **`benzo verify` covers auctions that reached the freeze**: an auction cancelled before its freeze has no frozen set
and no result, so `benzo verify` refuses it with `missing frozen`. Its deposits still refund only through each bid's
own memo-bound envelope or its owner's signed claim; each bidder checks their refund with their own wallet scan
(testnet `e20a5f1a…`, R132).
- **An operator can refuse a funded bid** (gate H, threat 005): witnesses check that every frozen leaf is a real
deposit, not that every deposit was admitted, and `benzo verify` checks omissions only against the operator's own
published deposit list. A refused bidder gets no acceptance receipt, and the deposit stays claimable with the bid's
owner key as a stray. Witnesses publishing their own deposit lists is a Phase 7 fix (H12).
- **Signer shares and envelope keys have no built-in backup** (gate H, threat 052): each signer operator backs up
their own. A lost share can stall settlement; a stolen share counts toward the 2-of-3.
- **A lost owner key cannot be recovered** (gate H, threat 067): a bidder who loses a bid's one-time owner key cannot
claim its refund. The row stays an exception, and nobody may redirect it.
- **`benzo fund quote` talks to NEAR 1Click** (gate H, threat 037): it sends your quote fields (origin-chain refund
address, your shielded UA, the amount). The auction never calls it; the default is shielded ZEC you already hold.
- **Do not bridge straight to a deposit address** (gate H, threat 038): the source chain and the bridge can link that
payment to your bid, and Benzo cannot detect it. Fund your own shielded wallet first, wait for confirmations, then
deposit the fixed C.
- Testnet only so far. No mainnet transaction has been made.
