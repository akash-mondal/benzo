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
