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
