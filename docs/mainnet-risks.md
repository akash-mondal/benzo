# Mainnet risks

Builder B, 2026-10-03. Every claim cites a commit or an evidence file. Nothing here is fixed by
rewording: an unclosed risk stays on this list until code and evidence close it. Benzo is testnet
only until the head says mainnet work has started.

## 1. Cross-chain escrows are unreviewed since the reviewer freeze

- **Risk.** The Solana and EVM escrows and their client code (`contracts/`, `crosschain/`) have had
  no reviewer round since the user limited reviewers to Zcash components (2026-10-03, recorded in
  `docs/PHASE-5.md` R25). The §10, R14, R19–R25 fixes landed after that date.
- **Why it matters.** These contracts hold funds. Reviewer R's earlier rounds found a P0 drain (the
  R14 CPI bypass, `contracts/logs/r14-cpi-old-code.out`) and two P0 escrow bugs (the §10 rows in
  `docs/evidence/phase-6/closure.md`). More can be there.
- **Mitigation and status.** Open. A re-review of `contracts/` and `crosschain/` is needed before
  mainnet. Owner: head agent (assign a reviewer or record a waiver). Tracked as closure open item 1.

## 2. Railgun is deferred; confidential SPL delivery is future work

- **Risk.** The EVM private-delivery path is ERC-5564 stealth only. Railgun needs a custody-touching
  shield adapter inside `BenzoEscrow.sol` (custom contract code, so audit-hard) and it conflicts with
  our exact `ethers` pin (`@railgun-community/shared-models` peers on `ethers@6.14.3`; the only
  workaround is `--legacy-peer-deps`). Confidential SPL delivery (`deliver.kind = "ct"`) is a
  standalone Token-2022 capability demo, not an escrow delivery: the Solana escrow pays native SOL
  only (`docs/evidence/phase-5/repro/ct-live.out`, `docs/AUDITS.md`).
- **Why it matters.** Users who want Railgun-style shielding or token-private payouts do not get them
  at launch.
- **Mitigation and status.** Accepted deferral (R24 item 1). README states it and why. Stealth
  delivery is live on Sepolia (`docs/evidence/phase-5/repro/stealth-live.out`). Escrow token support
  and a Railgun adapter are mainnet future work. Owner: head agent, at the mainnet release.

## 3. Solana program upgrade authority

- **Risk.** The current devnet program `2h6tgr5Ay1WE3u6kmPZnKh9EyTu7dkgWFkkrjCA5QyPu` has an upgrade
  authority key (`docs/AUDITS.md`). Whoever holds it can change the escrow's code under live
  auctions. R9 item 1 forbids in-place upgrades across account-layout changes, and every layout
  change so far deployed under a new program ID.
- **Why it matters.** An upgradeable escrow is a custody trust in the key holder.
- **Mitigation and status.** Testnet: fixed by policy and practice (new program ID per layout;
  superseded programs closed, `docs/AUDITS.md`). Mainnet form is open: make the program immutable, or
  use a 2-of-3-controlled upgrade authority with a migration path (R9 item 1). Owner: head agent, at
  the mainnet release. Tracked as closure open item 2.

## 4. The stealth SDK is a beta

- **Risk.** `@scopelift/stealth-address-sdk` is pinned at `1.0.0-beta.5` with no public audit. It does
  the ERC-5564 scheme-1 derivation, announcements and the canonical Announcer/Registry addresses
  (`docs/AUDITS.md`). Its `getAnnouncements` is broken on our pinned viem; we fetch logs ourselves
  and keep every cryptographic step in the SDK (`crosschain/stealth.ts` `scanDeliveries`).
- **Why it matters.** A beta client is the tool's biggest open risk (AUDITS says so). A defect in it
  can misroute or lose a stealth payout.
- **Mitigation and status.** Accepted risk, mitigated not closed. The pin is exact. On-chain behavior
  is the canonical ERC-5564/ERC-6538 contracts, used as-is on Sepolia. Every derived address is
  checked by `checkStealthAddress` before use. Escrow custody never depends on the SDK. The
  signer-reproducible key derivation is our own, disclosed and salted (`docs/AUDITS.md`;
  `docs/evidence/phase-5/repro/r25-1-link-after.out`). Owner: head agent watches upstream for a
  stable, audited release.

## 5. drand and lightwalletd are outside dependencies

- **Risk.** Bids open only when the drand quicknet beacon for round R exists. Deposits and settlement
  need a reachable lightwalletd. Both are public services we do not run.
- **Why it matters.** An outage delays opening and settlement. A bad endpoint answer can abort a
  signer's plan.
- **Mitigation and status.** Mitigated; residual dependency accepted. Today the signer path fails
  tlock decryption over across every `BNZ_DRAND_URLS` endpoint (3 rounds); a MAC failure means the
  ciphertext is undecryptable and a network failure on all endpoints throws (commit `7071c42`).
  lightwalletd `GetTransaction` and gRPC calls retry transient endpoint errors 4 times with backoff;
  `NotFound` is unchanged (commit `bb5414e`). Evidence checks use both `BNZ_LWD_URL` and
  `BNZ_LWD_URL_ALT` (`docs/evidence/phase-4/verify.sh`). `benzo verify` re-derives openings offline
  from the published, BLS-verified beacon signature and touches the network only with
  `--fetch-beacon` (`docs/verify-it-yourself.md`). If the beacon never arrives, refunds need no
  decryption: C comes back to each bidder (`docs/research/DESIGN.md`: "drand unavailable? The quorum
  refunds fixed C to every deposit without decrypting anything"; the DOC item is `docs/PHASE-6.md` §5a).

## 6. Signer collusion (2-of-3)

- **Risk.** Two of three signers acting together can steal or freeze the vault. A colluding quorum
  can also misdirect a refund and the public cannot tell (R16 F6): receipts cannot bind a shielded
  destination publicly without leaking it.
- **Why it matters.** This is the protocol's core custody trust. It cannot be removed with code; it
  can only be made visible and expensive.
- **Mitigation and status.** Accepted honest limit (R16 F6), disclosed in README honest limits
  (`01bb2d6`). Signers run on separate hosts with their own keys (Phase 5 part 1). Each signer
  recomputes every batch from its own data and signs only over `H(manifest ‖ frozen_root ‖ drand_sig
  ‖ result.json ‖ batch-plan version)` (R3 item 8). A witness board certifies the frozen root before
  R. A mid-batch signer-kill drill completes settlement (Phase 6 gate H evidence for threat-model
  #13/#15). The owner detects non-receipt and holds an owner-key-signed settlement statement
  (`benzo receipt statement`; `docs/evidence/phase-4/EVIDENCE.md`).

## 7. Settlement scale

- **Risk.** The organizer's volume target is 17,000 bids in 48 hours. Every deposit note needs its
  own RedPallas spend-authorization signature, so 17,000 bids means about 17,000 threshold
  signatures. Measured today: 13 outputs per batch, 479 s signing per batch, 171 blocks from
  proposal to mining (`docs/design/phase6-scale.md`). At that rate 1,300 batches take about 173
  hours. That is not acceptable.
- **Why it matters.** An auction that cannot settle in a day is not a product, no matter how private.
- **Mitigation and status.** Open (gate SC). `docs/design/phase6-scale.md` is measure-then-decide:
  measure where the 479 s goes, multi-message sessions, parallel sessions and bigger batches
  (`docs/evidence/phase-6/scale-measure.md`, Track A), then the head picks one of multi-message
  signing, larger batches, parallel pipelines, or an honest throughput limit in the README. Target:
  17,000 bids settled within 24 hours of R on testnet hardware, with the ledger proving no row was
  ever in two broadcast batches. Owner: head agent (choice), Track A (measurement).

## 8. Envelope-key handling on signer hosts

- **Risk.** The per-auction settlement-envelope private key is held by all three signers, so any one
  signer can read every refund destination (they must, to check the outputs they sign). The keys are
  generated signer-side (`benzo sign envelope-key`) and live in each signer's state dir
  (`~/.benzo-signer` or `BNZ_STATE_DIR`); the signed manifest pins the three public keys
  (`docs/AUDITS.md` "signer procedure").
- **Why it matters.** A compromised signer host learns every bidder's refund destination for that
  auction. An operator-held key would learn all of them for all auctions — that P0 is closed
  (`docs/evidence/phase-6/closure.md` A3/A4).
- **Mitigation and status.** Mitigated and disclosed. Keys are per auction, generated on the signer's
  own host, and pinned in the signed manifest; a missing key file is a refusal, never a skip (R16
  item 5). README honest limits states that each signer can read every refund destination. Mainnet
  hardening: keep signer hosts separate and one auction per key (already the design). Owner: head
  agent (operations policy).

## 9. The `zcash_address` swap is closed

- **Risk (was).** `envelope/destination.ts` hand-wrote bech32m, F4Jumble and ZIP-316 address
  parsing. Reviewer G filed it as a mainnet gate (`g-full-01 G12`): hand-written encoders must not
  classify custody destinations at mainnet.
- **Why it matters.** A parser bug can misclassify an address and misdirect or refuse a refund.
- **Mitigation and status.** Closed 2026-10-03 (R24 item 3 (i)). The hand-written parser is deleted;
  classification comes from the pinned, audited `zcash_address` 0.13.0 (librustzcash) through
  `benzo-pczt classify-address` (commit `9f50fcf`). Proven on 637 inputs with verdicts identical to
  the old parser plus official labels and fresh real testnet addresses
  (`docs/evidence/phase-6/repro/r24-3i-classify-address.out`; mutations `R24-3i-a`, `R24-3i-b`).
  `docs/AUDITS.md` marks the row closed.
