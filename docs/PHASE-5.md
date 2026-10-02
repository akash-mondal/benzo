# Phase 5: remaining product on the CLI (testnet complete)

- **Window:** Track B may start as soon as its Phase 4 R20 follow-up is merged. Track A starts only after the head commits **Phase 4 PASSED**. Target **2026-10-13**. Feature freeze still **Oct 24**.
- **Networks:** Zcash testnet (Ironwood; NU7 activates on testnet around Oct 5–6) + drand mainnet quicknet. **No mainnet transaction.**
- **Ownership:** head agent owns this file. Track A results/Questions in `docs/STATUS.md`, Track B in `docs/STATUS-B.md`. Artifacts in `docs/evidence/phase-5/`.
- **User instruction (2026-10-01), verbatim:** “i want this to built as an cli interface first so we have all the work except frontend and mainnet release left till the end so plan accordingly”
- **Still locked:** R6 — **no frontend**. Mainnet is Phase 7 and needs its own contract.

## 1. Goal and finish line

Phase 4 made one product that runs a Mode A auction from the CLI. This phase closes the remaining product and P0 trust gaps that DESIGN and the threat model promise, still CLI-only, so that Phase 6 only hardens and packages and Phase 7 only adds the user's UI and mainnet.

| Gate | Question |
|---|---|
| V | Can a treasury run a **Mode B sealed buyback** (DESIGN §7) end to end from the CLI on testnet: budget + floor in the signed manifest, sealed asks under the same C/tlock/freeze rules, uniform-price clearing of the lowest asks up to budget, payouts and refunds through the existing 2-of-3 path? |
| W | Is every bidder's **refund/delivery destination in an authenticated settlement envelope** (encrypted to the custody signers, signed by the bid's one-time owner key whose pubkey is inside the tlock plaintext), never in public plaintext, and do signers **refuse** any PCZT output that does not match a valid envelope? (threat model #7, #32, #38) |
| X | Is the frozen root **co-signed by a board-witness quorum** (`n_w`, `q_w` separate from custody `t_s`) before round R, and do `benzo verify` and every signer refuse a root without a valid certificate or with two conflicting certificates? (threat model #5, #6, #22) |
| Y | Do the three custody signers run as **separately hosted processes** (own state, own key share, own `frostd` TLS connection, no shared filesystem), with a **dealerless DKG per auction** from the CLI, and does settlement still complete with any 2 of 3? (threat model #13, #15, #19) |
| Z | **One marketplace adapter** (manifest binds collection, serial range and metadata commitment; `benzo claim` turns the winner's private settlement receipt into a delivery claim; exception queue for paid-not-delivered). |

| Decision | Options |
|---|---|
| Signer hosting (Y) | OrbStack Linux machines/containers on this Mac, one per signer, with separate state volumes (default); or a second physical machine for one signer if the user provides it |
| Envelope crypto (W) | X25519 + ChaCha20-Poly1305 sealed to a per-auction envelope key held by each signer (default) or age recipients; owner signature Ed25519 over (auction_id, ciphertext_hash, envelope_ct) |
| Witness set (X) | `n_w = 3`, `q_w = 2` with keys separate from custody shares (default); witnesses may be co-hosted with signers only if their keys are distinct and that is disclosed in EVIDENCE |
| Marketplace adapter (Z) | Zilkroad serial registry with signed holder receipts (default), or LASTWICK |
| Mode B ties/dust | Same rules as Mode A, mirrored (ascending asks, tie by committed leaf index, integer zatoshi rounding, pre-declared dust rule) |

**Finish line.** All of:
1. Gates V–Z are READY FOR REVIEW or FAILED/BLOCKED with evidence and a one-command repro.
2. One full Mode B buyback auction on testnet using separately hosted signers, envelopes and a witness certificate, evidenced under `docs/evidence/phase-5/` at a recorded commit (`run.json` as in earlier phases).
3. Phase 4's Mode A `cli-auction` spec still passes on the new signer hosting, envelopes and witness path (R8-style regression, all specs at one commit).
4. `verify.sh` exits 0 and is seen failing on a corrupted copy.
5. The one new test has been seen failing under each of its mutations.
6. STATUS and STATUS-B say READY FOR REVIEW / READY FOR MERGE. **No frontend files. No mainnet.**

## 2. Inherit

AGENTS.md, pins, DESIGN, threat model, all Phase 1–4 Rulings (Phase 4 R1–R20 and anything after). Reuse `clear/`, `settle/`, the ledger, FROST sessions, the Phase 4 CLI router contract (R17) and `schemas/public-auction.schema.json`. Do not rewrite working gates; extend them.

## 3. Work split

Same two-builder protocol as Phase 4 (AGENTS.md "Two builders"; R11–R14). The head merges `track-b` into `main`.

### Track B (offline, no funds, no keys beyond generated test fixtures) — starts first

Library and CLI pieces A will wire into the live path. Each lands with logged manual runs, no new tests.

1. **Mode B clearing (V):** a pure function next to Mode A in `clear/` (new file `clear/mode-b.ts`; do not edit Mode A logic). Same `result.json` shape with a `mode` field; conservation check holds. `benzo verify` reproduces Mode B results.
2. **Settlement envelopes (W):** `envelope/` module: seal (client side), open (signer side), owner-key signature, binding to `auction_id` + `ciphertext_hash`. `benzo bid seal` gains real owner keys (replacing the Phase 1 random bytes in the plaintext layout; the 128-byte layout stays). Envelope ciphertexts are published; plaintext destinations never are. `benzo verify` checks that every envelope signature verifies against the owner pubkey in its opening.
3. **Witness certificates (X):** `witness/` module and `benzo witness sign|verify`: certificate format over (auction_id, frozen_root, leaf_count, T_freeze, chain anchor), `q_w`-of-`n_w` check, equivocation detection (two certificates, different roots → refuse). `benzo verify` requires a valid certificate.
5. **Marketplace adapter (Z):** `adapters/zilkroad.ts` (or the decided alternative), manifest fields for collection, serial range and metadata commitment, `benzo claim` and an exception-queue file format.
6. **Schema:** Track B proposes additions to `schemas/public-auction.schema.json` under Questions; Track A applies schema changes (as in R20).

Track B files: `clear/mode-b.ts`, `envelope/`, `witness/`, `adapters/`, `cli/commands/{verify,operator,receipt,api,witness,claim}.ts`, `api/`, `docs/STATUS-B.md`.

### Track A (live testnet) — starts after Phase 4 PASSED

1. **Separately hosted signers (Y):** three signer hosts per the decision, each with its own state volume and `frostd` TLS connection; `benzo sign dkg` runs a dealerless DKG per auction from the CLI (frost-client DKG flow). Scripted host bring-up under `deploy/signers/` (no secrets committed).
2. **Wire envelopes (W):** signers open envelopes and refuse any PCZT output whose recipient/amount does not match a valid, owner-signed envelope. Bidders' refund destinations come only from envelopes; remove the Phase 3 R3 pinned-copy shortcut from the live path.
3. **Wire witnesses (X):** freeze collects a `q_w` certificate from the witness hosts before `T_freeze`; open/clear/settle refuse without it.
4. **Mode B live (V):** `benzo auction create --mode buyback` with budget + floor; a live buyback on testnet using B's clearing.
5. **Spec, mutations, evidence, regression.**

Track A files: everything else, including `settle/`, `cli/benzo.ts` (router), A's commands, `deploy/`, `e2e/`, `schemas/`, evidence.

## 4. Traps (in addition to all prior)

1. **NU7 lands on testnet during this phase.** Re-check activation height and the R7 expiry guard before every broadcast after Oct 5. If a pinned SDK breaks across the upgrade, write BLOCKED with the exact error and the upstream issue; do not fork consensus code.
2. "Separate hosts" that share a filesystem, a key file or one `frostd` identity do not pass Y. Prove isolation (separate volumes, separate credentials) in EVIDENCE.
3. Witness keys must not be the custody shares (threat model #6). Same human may run both only if disclosed.
4. Envelope plaintext (refund addresses) must never appear in logs, public dirs, API output or evidence. Only ciphertexts and hashes.
5. Mode B must not fork the settlement path: payouts to sellers and refunds both go through the existing ledger and 2-of-3 flow.
7. Phase 1–4 specs stay green as regression; do not spend their live budget every tick.
8. Testnet TAZ: ask before any spend that would drop the bidder below 3C + 40,000 zats.

## 5. Budget

Hand-written budget **+900 lines** beyond Phase 4's final count: Track B about 500, Track A about 400. Schema JSON and `docs/` prose do not count (R20 precedent). Justify overage under Questions. No UI packages.

## 6. Tests this phase adds: exactly one

Project ceiling **8 E2E**. Used **5** (Phase 1×2, Phase 2×1, Phase 3×1, Phase 4×1). Reserved after this phase: browser bid flow (user-owned UI) and one spare. This phase takes **1**.

**6. `e2e/buyback-mode.spec.ts`** (live; Track A owns it). One Mode B buyback on testnet with separately hosted signers, envelopes and a witness certificate.

- **V1** Mode B manifest (budget, floor) signs and publishes; CLI clear output equals B's pure Mode B clear on the same opened set; conservation holds.
- **V2** Winning asks are paid the uniform price, losing asks get exact C back, via the 2-of-3 path; `benzo verify` reproduces totals from a cold copy.
- **W1** No refund/delivery address appears in any public file, API response or log; every envelope's owner signature verifies against the opened owner pubkey.
- **W2** A coordinator-substituted recipient in one PCZT output is refused by both signers before FROST.
- **X1** Open/clear refuse a root without a `q_w` certificate; `benzo verify` refuses a public dir carrying two certificates for different roots.
- **Y1** DKG produces a fresh group key for this auction from three separate hosts; settlement completes with signers 1+3 while signer 2's host is stopped.

Mutations (each must turn the spec red):
- **5M1** Mode B clear sorts asks descending (V1 fails).
- **5M2** Signer accepts any recipient when the envelope is missing (W2 fails).
- **5M3** Witness check counts one signature twice (X1 fails).
- **5M4** Settlement payload logs the opened envelope (W1 fails).
- **5M5** DKG reuses the previous auction's group key (Y1 fails).

## 7. Evidence

Same rules as Phases 1–4: `run.json` (command, commit, window, one result per ID, SHA-256 of written files, tool versions). `EVIDENCE.md` one page: gate table, decisions, host-isolation proof, limitations (one physical machine unless the user provides another, public endpoints, testnet only, CLI-driven not UI, sample size). `verify.sh` + corrupted-copy negative check. Evidence dir < 1 MB.

## 8. Schedule

| When | Track B | Track A |
|---|---|---|
| Day 1 | Mode B clearing; envelope module | (Phase 4 finish and review) |
| Day 2 | Witness certificates; verify extensions | Signer hosts + per-auction DKG |
| Day 3 | Marketplace adapter | Wire envelopes and witnesses |
| Day 4 | Follow-ups from head review | Mode B live; spec |
| Day 5 | — | Mutations, Mode A regression on new path, evidence, READY FOR REVIEW |

## 9. What you may ask the user for

- Testnet TAZ if the bidder would fall below 3C + 40,000 zats.
- A second physical machine for one signer (optional; OrbStack isolation is the default).
- Confirmation before any mainnet step (none in this phase).

## 10. Rulings

- R1 2026-10-02: **Scope locked (user: "i just want a contained great product").** Benzo is one product: the operator-blind sealed-bid auction house (Mode A auctions + Mode B buybacks). NEAR Intents funding is removed from this phase and from the roadmap; no RFQ, call market, prediction market, launchpad or cross-chain execution. Time saved goes to Phase 6 quality (P0 closure, scale, leak audit, packaging, docs) and the demo.
- R2 2026-10-02: **Scope widened inside one engine (supersedes R1's "no RFQ, call market, launchpad").** User, verbatim: “cant we support more private markets in our core we build including this” and “ok lets add this”. Benzo stays **one product**: the operator-blind market engine on Zcash. New market types are **clearing modes** on the shared pipeline plus **core features**, specified in §11 below. Still out: NEAR Intents, any cross-chain execution or token delivery by Benzo, prediction markets, anything needing an outside oracle. Part 1 (gates V–Z, current Track B work) is unchanged and lands first. Target moves to **2026-10-12** for part 1 and **2026-10-14** for part 2 (Phase 4 is finishing ~2 weeks early).

## 11. Part 2: the blind market engine (added by R2)

Every market shares one pipeline: identical C deposit with a sealed order in the memo → freeze (witness-certified) before R → open at R → **public deterministic clearing function selected by `mode`** → settlement through the ledger and 2-of-3 vault → private receipts → `benzo verify`. A new market is a clearing function plus manifest fields, never a new pipeline.

### Gates

| Gate | Question |
|---|---|
| EN | **Mode registry.** Does `clear/` dispatch on the signed manifest's `mode`, with a versioned 128-byte plaintext layout per mode, and do `benzo verify`, the API and signers' recomputation all go through the same registry (one code path per mode, no per-mode copies of verify)? |
| CF | **Core features, usable by every mode where meaningful:** (1) **bond-then-pay** — C is a bond (e.g. 10% of cap); winners pay the balance in a window after clearing; a defaulter forfeits the bond to the seller net of fees and the lot stays unfilled (no re-clear by default); (2) **sealed reserve/floor** — tlock-encrypted to R in the manifest, opened with the bids; (3) **bid revision** — a later order signed by the same one-time owner key supersedes earlier ones; only the latest admitted before `T_submit` counts; superseded orders are refunded exactly once; (4) **multi-lot rounds** — many distinct lots cleared in one round, one deposit per (bidder, lot); (5) **recurring rounds** — a schedule of rounds, each its own manifest hash, R, freeze and vault. |
| MK | **Modes** (auction and buyback exist): **collection drop** (multi-lot auction preset), **launch** (uniform-price sale; private allocation receipts; a published allocation file — fresh destination, amount in **standard lot sizes**, one delivery batch for all winners, file hash in the public dir; delivery on the token's own chain is the project's job and is stated as such), **RFQ desk** (allowlisted dealer quote keys in the manifest; best quote meeting the reserve wins; non-allowlisted quotes refunded exact C), **call market** (two-sided uniform-price uncrossing per round; sellers' asks bound to a marketplace-adapter serial checked before freeze; recurring), **blind OTC deal** (two parties seal a max and a min; trade at the midpoint if max ≥ min; otherwise both refunded). Each: pure clearing in `clear/`, manifest fields, verify + API support, one live testnet run. |

### Decisions

| Decision | Default |
|---|---|
| Bond size | Manifest field `bond_bps` of the cap; balance window in blocks; defaults 1,000 bps and 288 blocks |
| Revision privacy | After R, superseded orders open too (anonymized, linked by owner key). Disclosed in README limits |
| Launch delivery | Allocation file + hash only; no chain-specific code |
| OTC disclosure | Both limits open at R (tlock opens everything). Disclosed; no claim of "match bit only" |
| Seller collateral (call market) | Sellers post the same C, so side is invisible before R |

### Work split
- **Track B (offline), after its part-1 items merge:** EN registry + per-mode plaintext layouts; pure clearing for drop, launch (incl. standard-lot split + allocation file), RFQ, call market, OTC; CF pure logic (bond/balance accounting, sealed reserve open, revision supersede rules, multi-lot, round linkage); verify + API for all modes. Files: `clear/` new mode files + registry, `envelope/`, `witness/`, `adapters/`, Track B CLI commands, `api/`.
- **Track A (live), after part 1 PASSED:** manifest/schema fields, `benzo auction create --mode …`, balance-payment intake and default handling in settle, round scheduler (`benzo market run --rounds N`), live runs of every mode, the spec, evidence.

### Test: one more (the spare slot)
Ceiling 8. After part 1: 6 used. Part 2 takes **7. `e2e/markets.spec.ts`** (live, Track A); the 8th stays reserved for the user's browser bid flow. One run covers: a collection drop with a sealed reserve and bond-then-pay (one winner pays the balance, one defaults); an RFQ with one non-allowlisted quote; two call-market rounds; one OTC match and one no-match; one launch with its allocation file; one bid revision. Assertions per mode: CLI result equals the registry's pure clear; conservation; `benzo verify` on a cold copy. Mutations: **5M6** registry dispatches the wrong mode for one lot; **5M7** defaulter's bond refunded instead of forfeited; **5M8** superseded order counted; **5M9** RFQ ignores the allowlist; **5M10** call market clears at the highest bid instead of the uncrossing price.

### Budget
+1,200 hand-written lines for part 2 (Track B ~750, Track A ~450). Schema and docs excluded.
- R3 2026-10-02: **Research adopted (user: “ship the updates and whatever to be dropped from your research and put that in work”).** Source: `zcash/research/benzo-ideas/STEAL-LIST.md` + `REPORT.md` (head). Changes to §11 and part 1:
  1. **Dropped: call market** (value 2/5, effort L: one on-chain asset, sell side needs off-chain escrow). Remove it from MK, the markets spec and mutation 5M10. Still out: prediction markets, perps, bonding curves, NEAR/cross-chain, per-person caps/KYC, netting, atomic swaps.
  2. **RFQ = reverse-Vickrey procurement** (Tirai, HackCanton S2 3rd): lowest valid ask wins and is paid the **second-lowest** ask; **fewer than 2 valid quotes → cancel, refund all exact C**; dealer bonds forfeited if the winner misses the delivery deadline (signer-attested). Replaces “best quote wins”. 5M9 becomes “RFQ pays the winner its own ask (first price)”.
  3. **Launch tranches + minimum raise** (Zama public auction; SealPad): optional (a) holder tranche at the floor gated by marketplace-adapter holder receipts, (b) the main sealed uniform-price auction, (c) a follow-on at the published clearing price filled by mined height; **minimum raise not met → everyone refunded**. Caps are per deposit (a per-person cap is unenforceable on shielded deposits; say so).
  4. **Recurring buyback windows** (Confidential Buybacks, Zama S3 3rd): Mode B series via recurring rounds, fresh vault per window, sealed treasury max price; a **public per-window report** (units bought, clearing price, ZEC spent, serials). Rename the manifest field `floor_zats` → `max_price_zats` (it is the treasury's maximum).
  5. **Fair serial assignment for drops** (Pulla, HackCanton S2 RWA winner): after clearing, winners map to serials by a Fisher–Yates shuffle seeded from drand round `R + k` (k in the manifest, k ≥ 1); `benzo verify` replays it. No operator choice.
  6. **“Missing bid? Prove it”** (ZecBit paid-but-missing; lost reservation): `benzo receipt prove` outputs the inclusion proof against the frozen root; a deposit mined before `T_submit` but absent from the root is moved to the exception queue and refunded automatically; `benzo bid` warns that exchange withdrawals can miss `T_submit`.
  7. **Signed settlement statement + no transparent refunds** (zooko/forum, @mert): `benzo receipt statement` emits an owner-key-signed JSON (auction, leaf, fill, price, payout/refund txid) checkable against `result.json` and the chain; the envelope validator **rejects t-addrs, TEX and UAs without a shielded receiver** (part 1, gate W).
  8. **Signer approval binding** (Alluvren; BitSafe rubric, part 1 gate Y/T): each signer signs only over `H(manifest ‖ frozen_root ‖ drand_sig ‖ result.json ‖ batch-plan version)`; a changed plan voids prior approvals; the signer CLI refuses before freeze and before R. Phase 5 evidence includes a drill killing one signer **mid-batch** with settlement completing.
  9. Budget: part 2 stays +1,200 (call market out pays for items 2–7). Dates unchanged (part 1 Oct 12, part 2 Oct 14).
  Track B owns the pure logic for 2–7 (clearing, shuffle, statements, envelope validator, verify/API); Track A owns manifests, live runs, settlement/default handling, the signer binding (8) and the drill.
- R4 2026-10-02: **Track B part 1 review (items 1–3 at dbc4bf0, c38d85d, 82dce10) and answers to Track B's Phase 5 questions.**
  1. Accepted: Mode B manifest = Mode A manifest + `buyback` block + `clearing.mode: "buyback"`; the envelope publication record `{ciphertext_hash, envelope_ct, owner_sig}` under `auction.json` `envelopes`; Track B touching `cli/product.ts`'s bid-seal block for owner keys (that block only).
  2. **Witness binding (head finding after merging main into track-b):** `benzo verify` on track-b now refuses every directory without a witness set, including all Phase 2–4 evidence, and a side-packet that is not committed to by the signed manifest could simply be removed from a Phase 5 directory. Fix: the signed manifest carries optional `witness_set_hash` (SHA-256 of the signed witness-set packet). Verify **requires** a valid `q_w` certificate when the manifest has it, refuses a witness set whose hash differs, and for manifests without it prints `WARN no witness set (pre-Phase-5 manifest)` and continues. Track B may make the minimal `manifest/schema.ts` change to accept this optional field; Track A keeps ownership of that file.
  3. Review fixes Track B must land before any live envelope run: fixed-length envelope padding (ciphertext length must not reveal the receiver type); the envelope validator rejects t-addrs, TEX and UAs without a shielded receiver; Mode B conservation becomes real invariants (`price × Σfill ≤ budget`, fills ≤ quantities, winners' asks ≤ price, `treasury_zats` recorded); `floor_zats` → `max_price_zats`.
  4. Disclose in README honest limits: the per-auction envelope key is held by all three signers, so any one signer can read every refund destination (needed to check outputs).
  5. Merge policy: Track B's Phase 5 work stays on track-b and reaches main only after Phase 4 is PASSED (A's live mutation chain patches `api/public-auction.ts`; Phase 4 evidence must be recorded on Phase 4 code). The head merges main into track-b as needed.
- R5 2026-10-02: **Head transfers for the reviewer lab (not protocol spends).** The user set up `gpt-6.1-sol` as an independent reviewer with its own lab (`/Users/akshmnd/Dev Projects/benzo-sol`, separate clones, frostd :2746, its own keys). Funded: 0.05 TAZ from the Track A bidder wallet (txid `b122fc24ccd16fd39e67b23305462062fb1f7c45a15ddeda4332e545327ca797`), plus 3 devnet SOL and 0.04 Sepolia ETH from Track B's deployer keys (EVM tx `0x77241b9b2b55c47c152f78b5ce095bb2fa218c7208294e6a2ad7d484d0c596d1`). Track A: reconcile the TAZ outflow. Builders never use or read the lab; the lab never touches builder checkouts.
- R6 2026-10-02: **Reviewer R findings, head-verified (reproduced by rerunning `benzo-sol/tests/*.mjs`). Track A's first Phase 5 part 1 items, before any other live work:**
  1. **P1, signer reserve check (Reviewer R F2):** `settle/plan.ts:76` takes `reserve_opening` from the published document; the sealed reserve is never re-derived on the signer path, so a forged opening changes the clearing (repro: 4000 → 5000, two bidders dropped) and all signer checks pass. Fix: when the manifest has `sealed_reserve`, decrypt it fresh with `tle` in the signer plan and require equality with the published opening. Factor `cli/commands/verify.ts:82-85` into one shared helper used by both verify and the signer, so the two cannot drift. Add mutation U7 (forged reserve opening); it must go red before any signature.
  2. **P0, envelope-authenticated destinations (Reviewer R F3; this is gate W of part 1):** settlement pays `routing-<name>.json` destinations from operator config; no settlement path opens or compares the owner-signed envelope (repro: a mismatched routing is accepted by `settle init`). Implement W exactly as `docs/design/phase5-part1-live.md` §4 describes: each signer opens every output's envelope with its own key, checks `owner_sig` and the `settlement_commitment`, and refuses any PCZT output whose recipient or amount doesn't match. Remove the routing-file destination path from product mode. Mutation 5M2 covers it.
  Both proven with the reviewer's repro scripts turning from CONFIRMED to fixed (copy them under `e2e/`-free `tools/repro/`, not as new E2E specs).
- R7 2026-10-02: **Two-reviewer findings on R6 (Reviewer R `pr-a-r6-reserve-envelopes` BLOCK, Reviewer G `gpr-a-r6-reserve-envelopes`); the head confirmed the consensus P0 in code** (`settle/cli.ts destinations()` builds the gate-W check from `auction()`, the coordinator's private ledger). Track A, in this order, each with a test that fails on the current code and passes on the fix:
  1. **P0 (R F-3 = G1, both reviewers): root gate W in signer-derived data.** A signer resolves a destination only from **its own fresh `tle` openings** (already computed in `settle/plan.ts`) and the **published** `auction.json` envelope records, and refuses if the coordinator's private ledger differs from either. No destination input may come from `STATE/auction/<id>.json`.
  2. **P0 (R F-1, R F-2 = G4): the operator never holds envelope private keys, and the keys are authenticated.** Each signer generates its own X25519 envelope keypair in its own state dir (its own host after part 1 §1). The signed manifest pins all three public keys (`envelope_keys`), and `bid seal` encrypts to those pinned keys only (multi-recipient format: Track B delivers it per part-1 design §4). Until B delivers, block product-mode settlement with a clear error rather than use an operator-held key.
  3. **P1 (R F-4 = G3): a malformed, undersized or undecryptable envelope moves that leaf to the exception queue** and never aborts settlement for the other parties.
  4. **P1 (R F-5 = G5): exception queue completion.** `benzo claim-refund` with an owner-key-signed request naming a shielded destination, which the signers check against the opened owner key. `benzo verify` accepts correctly exception-queued leaves and rejects anything else.
  5. **P1 (G2): `publish()` emits `reserve_opening` after R,** so sealed-reserve product auctions can settle and verify. Prove it with a live run that has a sealed reserve.
  6. **P1 (G6): stray-deposit refunds never go to operator-chosen destinations.** A stray whose memo holds a valid sealed bid is refunded through its own envelope like any bid; anything else goes to the exception queue (claimable as in item 4, when an owner key exists). Drop `stray_refund_ua` from routing.
  7. **P2 (R F-6, G8): evidence must exercise the shipped wiring,** including a live regression at the final commit and fixtures where routing ≠ envelope destinations.
  Both reviewers review the result again (`review_pair.sh`) before Phase 5 part 1 continues.
- R8 2026-10-02: **Reviewer G's clearance audit (`benzo-sol-g/reports/g-full-01.md`): it independently verified Track B's §10 fixes live (Solana driver all PASS incl. dusting cases; forge 24/24) and found two new P1s plus three over-strong clearances by R.**
  1. **Track B, P1 (G9):** the Solana escrow **state** PDA still uses "non-empty ⇒ locked" in `lock` (`lib.rs:469-471`): 1 lamport sent to the predictable `["escrow", auction_id]` PDA before lock blocks the auction forever (G's live probe). Apply the §10 pre-funding-safe pattern: locked means `owner == program && data_len == STATE_LEN`. Add a dust-before-lock test (red, then green), then redeploy.
  2. **Track A, P1 (G10):** gate X witness certification is not wired into the product flow: `publish()` emits no witness fields, `benzo witness sign` can't run on product dirs, and the signer path never checks certificates. Implement it per `docs/design/phase5-part1-live.md` §5 after R7, as a refusal (not WARN) for any manifest carrying `witness_set_hash`.
  3. R's clearances corrected: F2 "fixed" was dead wiring in product mode (R7 item 5); the witness-check clearance is moot until G10; `envelope/destination.ts` remains a mainnet blocker until replaced by `zcash_address` (head replace list).
- R9 2026-10-03: **Reviewer R re-review of Track B's §10 batch (`benzo-sol/reports/pr-b-s10-fixes.md`): REQUEST CHANGES.** All six earlier findings were verified fixed with evidence. Remaining, for Track B after its current run (G9 is already in flight; R's F-1 independently confirms it):
  1. **P1 (R F-2): no in-place upgrades across account-layout changes.** A program version that changes an account layout or markers is deployed under a **new program ID**, never as an in-place upgrade over live auctions. Record the layout version in the state account. For mainnet, plan to make the program immutable, or a 2-of-3-controlled upgrade authority with a migration path (Phase 6 H item).
  2. **P2 (R F-3):** `benzo xchain attest` reads the asset from the chain (escrow state) and refuses a mismatching or missing `--asset`; it never defaults silently.
  3. **P2 (R F-4):** EVM gets Solana's model: `submitAttestation` stores the approved root (once per auction and batch, `expiry <= deadline`), then `releaseApproved(payouts[])` can be cranked many times, so a partial or failed release never consumes the approval. Remove or clearly label `--only`.
  4. **P2 (R F-5):** EVM `lock` is `nonReentrant`, with the effect write before the external call where the delta check allows.
  Re-review by Reviewer R after these land; merge only on APPROVE.
- R10 2026-10-03: **Head review of A's R7.2/R7.3 (4d10f40, 71d1bcb) and B's multi-recipient envelopes (b000cb1).** R7.2 and R7.3 are accepted as interim (every product envelope refund waits in the exception queue until B's format merges). B's format is accepted in principle (libsodium `crypto_box_seal` stanzas + IETF ChaCha20-Poly1305 body, header as associated data). Changes, each with a test that fails before and passes after:
  1. **Track B, P2 (key commitment + exact recipient set):** ChaCha20-Poly1305 is not key-committing, so a hostile sealer could wrap different content keys for different signers and make them open different destinations. Add `key_commit = crypto_generichash(32, content_key, key = "benzo-envelope-v2-kc" padded per libsodium)` to the header (inside the associated data); `openEnvelope` recomputes it after unwrapping and refuses a mismatch (`envelope key commitment`). Export `envelopeRecipients(envelope_ct)` and the fixed byte length for n = 3. In product validation, a record whose stanza public keys are not exactly the manifest's `envelope_keys` in order is "no valid owner-signed settlement envelope" (exception queue). Proof: a hand-built envelope whose stanza 2 wraps a different key under stanza 1's commitment opens for recipient 1 and is refused for recipient 2; an envelope sealed to 1 or 2 of the 3 pinned keys is refused by the validator. In `docs/AUDITS.md`, say plainly that the libsodium audit covered 1.0.12/1.0.13 and name the libsodium version bundled in `libsodium-wrappers` 0.8.4.
  2. **Track A, after B's format merges:** `envelopeRecordShape` uses B's exported n = 3 length (not 572); `bid seal` seals to `m.envelope_keys` from the verified manifest (drop `bid.envelope_pubkey`); remove `ENVELOPE_INTERIM_REFUSAL` and pay through the validated envelope.
  3. **Track A, P1 (signer-side key pin, missing from R7.2; design §10 item 2):** nothing checks that `envelope_keys` are the signers' own keys, so an operator can pin keys it holds and every signer still signs. Each signer, in `auction sign` and again in its settlement plan, requires `manifest.envelope_keys[i]` (alice 0, bob 1, carol 2) to equal the public key in its own `signers/<name>/envelope-key.json`, else refuses with `manifest does not pin this signer's envelope key`. Repro: a manifest with an operator key at index 1 is accepted on the current code and refused after.
  4. **Track A, P1 (signer disagreement never stalls settlement):** before a batch is planned, each signer writes `envelope-opens-<name>.json` with `{leaf, ok, dest_sha256}` per leaf (never the destination). A leaf's refund is payable only when at least 2 signers report `ok` with the same `dest_sha256`; otherwise it goes to the exception queue with reason `signers could not agree on the envelope destination`. A signer refuses any batch output that differs from its own opened destination. Wire it locally now and over the network with part 1 §3.
  5. **Track A, P3:** `benzo sign envelope-key` must not need a git checkout (signer hosts have none): take `--state DIR` or `BNZ_STATE_DIR`, defaulting to `~/.benzo-signer`.
  Order for A: finish the current R7 item, then R10 item 3, then the rest of R7, then items 2, 4 and 5 once B's format is merged. Reviewer R reviews b000cb1 now (`pr-b-envelopes-v2`); B's format merges only after item 1 lands and R approves.
- R11 2026-10-03: **Head review of R7.4 (062f74f): accepted, with one fix for Track A (P2, griefing).** `claim-refund` on the operator side records the first claim per party *before* any signature check, so anyone who submits a well-shaped but unsigned claim for `leaf:N` first blocks the real owner's claim forever (`a different claim for this party is already recorded`). Fix: record every distinct well-shaped claim (deduplicate exact repeats, cap at 8 per party), and in the signer plan use the **first one whose owner signature verifies** against the signer's own fresh opening. Repro: a junk claim recorded first, then the owner's valid claim: refused today, paid after. Do it together with R10 item 3.
- R12 2026-10-03: **Reviewer R on B's envelopes (`benzo-sol/reports/pr-b-envelopes-v2.md`, REQUEST CHANGES), head-checked.** R reviewed track-b at b000cb1, before main's R7.2 was merged in, so F-1 (operator-held key) is already fixed on main, and F-1/F-2's "`bid seal` ignores `envelope_keys`" is R10 item 2. F-5 (recipient count leaks through length) disappears once exactly 3 stanzas are required. Remaining, confirmed in code (`api/public-auction.ts` envelope check parses no `envelope_ct` format, length or recipients):
  1. **Track B, P1 (R F-2/F-4):** one shared rule `envelopeRecordValid(record, envelope_keys)`, exported from `envelope/`: exact v2 length for n = 3, magic, and stanza recipients equal to `envelope_keys` in order. Intake (`clear/auction-cli.ts admit`, one-line Track A change allowed) refuses anything else when the manifest pins keys, and `benzo verify` reports ERROR for any published record that breaks it (the operator admitted it). Pre-v2 (572-byte) records are accepted only in directories whose manifest has no `envelope_keys` (Phase 2–4 evidence).
  2. **Track B, P2 (R F-6):** commit the `mr-*` red/green checks as `tools/repro/` scripts with their outputs under `docs/evidence/phase-5/repro/`, the way Track A does.
  3. **Track A, P1 (R F-3), with R10 items 2 and 4:** a record that `validEnvelope` accepts but this signer cannot open makes its open report `ok: false`; `destinations()` never throws on a single leaf.
  Reviewer R re-reviews B's envelope work after R10 item 1 and R12 items 1–2 land; merge on APPROVE only.
- R13 2026-10-03: **Head review of 8a37993 (verify accepts a claim-paid leaf with no envelope record): accepted, plus one P2 for Track A.** Today `benzo verify` takes "paid through an owner-signed claim" on the signing quorum's word: the claim is private, so nobody else can check that it existed or was signed by the bid's owner. Make it publicly checkable without revealing the destination. The claim signature covers `{kind: "claim-refund", auction_id, party, destination_sha256}` (signers still check the full destination hashes to it), and `publish()` adds a `claims` list of `{party, destination_sha256, owner_sig}` for every paid claim. Verify then requires, for every claim-paid row, a published claim whose `owner_sig` verifies against the owner key in that leaf's opening (or the stray memo's opening); otherwise ERROR. Repro: a published claim with a forged signature is refused by verify. Do it with R11.
- R14 2026-10-03: **Reviewer R on R9 (`benzo-sol/reports/pr-b-r9-contracts.md`): BLOCK, head-confirmed P0.** The four R9 fixes are correct. But **F1 (P0):** Solana `submit_attestation` checks the Ed25519 precompile against the *top-level* instruction's data (`load_current_index_checked`), never against the attestation bytes it parses. When it is reached by CPI, the top-level instruction belongs to the caller, so an attacker program can present the signers' signatures over one honest attestation and pass a forged one (any batch index, any allocation root) to the escrow, then drain it with `release_approved`. The head reran R's lab PoC (`benzo-sol/lab/pr-b-r9/lab-only/run-poc.sh` at 4d9c0e6): ALL PASS, 5 SOL drained, and the direct (non-CPI) control is refused. EVM is not affected. Track B, first, before anything else:
  1. **P0 fix, both checks:** (a) `submit_attestation` refuses unless `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT` (no CPI); (b) it loads the instruction at `current`, requires its `program_id` to be this program, and requires its `data[2..2+ATT_LEN]` to equal the exact `att` bytes it parsed. Add a new error for each. Check every other instruction for any other sysvar-derived trust (expect none).
  2. **Regression:** copy R's proxy program and `cpi-forge.mjs` into `contracts/solana/test/` as a fixture. The forged CPI submit must turn from landed (red, on the 4d9c0e6 program) to refused (green), and the honest direct submit and release must still pass. The full driver must stay all PASS.
  3. **Deploy** under a new program ID (no in-place upgrade, per R9 item 1), rerun one live devnet cycle, and mark `AE1LQwTy…` SUPERSEDED in STATUS-B and `docs/AUDITS.md`.
  4. **P2 (R F3):** EVM `approval(auctionId, batchIndex)` view returns `(allocationRoot, resultHash, expiry, exists)` (drop the unused `nonce` or document it), and `benzo xchain status` prints and compares `resultHash` with the published `result.json` hash. Forge test.
  5. **P2 (R F2):** `crosschain/local-demo.sh` uses `if [ -f .env ]; then set -a; . ./.env; set +a; fi` (bash 3.2 exits on sourcing a missing file).
  The cross-chain merge into main waits for Reviewer R's APPROVE on the fix.
