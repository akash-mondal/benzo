# Phase 4: product backend and CLI (testnet complete)

- **Window:** start immediately after Phase 3 PASSED (2026-10-01). Target **2026-10-16**. Features freeze still **Oct 24**.
- **Networks:** Zcash testnet (Ironwood) + drand mainnet quicknet. **No mainnet transaction.**
- **Ownership:** head agent owns this file. Results and Questions go in `docs/STATUS.md`. Artifacts in `docs/evidence/phase-4/`.
- **User instruction (2026-10-01, this thread), verbatim:** “hey i want to build the full backend end to end and working on a cli / everything from testnet to everything except mainnet and frontend should be finished”
- **Still locked:** R6 — **no frontend**. UI/screens/styling/hosting UI are user-owned. Phase 6 mainnet is later and needs a new contract.

## 1. Goal and finish line

Phases 1–3 proved the hard parts in test scripts. This phase turns them into **one product**: a backend and CLI that run a complete auction on testnet with no UI.

| Gate | Question |
|---|---|
| O | Can an operator create, sign and publish a manifest and run OPEN → FREEZE → OPENED → CLEARED → SETTLED (or CANCELLED) **from the CLI**, with state persisted outside test code? |
| P | Can a bidder seal, pay the fixed C deposit, receive a receipt, and later verify inclusion and their settlement receipt **from the CLI**? |
| Q | Can two signers inspect a batch, run the existing 2-of-3 flow, and settle/refund **from the CLI**, with crash-safe resume? |
| R | Can an independent verifier take only public inputs (manifest, freeze root, ciphertexts, result, txids) and reproduce the clear + settlement accounting in **one command**? |
| S | Does a thin HTTP JSON API expose the same read paths the future UI will need (auction status, operator blob view, freeze board, result, receipts lookup) **without** leaking bid plaintext? |

| Decision | Options |
|---|---|
| CLI name/layout | `benzo <noun> <verb>` (default) or a documented alternative |
| Persist store | SQLite under `$BNZ_STATE_DIR` (default) or a named file layout |
| API bind | `127.0.0.1:8787` for testnet product (default); no auth beyond local bind |

**Finish line.** All of:
1. Gates O–S are READY FOR REVIEW or FAILED/BLOCKED with evidence and a one-command repro.
2. One full CLI-driven auction on testnet, evidenced under `docs/evidence/phase-4/` at a recorded commit (`run.json` as in earlier phases).
3. `verify.sh` exits 0 and is seen failing on a corrupted copy.
4. The one new test this phase names has been seen failing under its mutations.
5. Decisions recorded in STATUS and `EVIDENCE.md`.
6. STATUS says READY FOR REVIEW. **No frontend files. No mainnet.**

## 2. Inherit

AGENTS.md, pins, DESIGN, threat-model minimum design, all Rulings. Phases 1–3 PASSED (1 `04926a7`, 2 `5afd2b2`, 3 `0090781`). Reuse: manifest, admission, freeze, `clear/`, `settle/`, ledger, FROST sessions, `verify.sh` patterns. Do not rewrite working gates to “simplify” the CLI.

## 3. Product surface (this is the work)

### CLI (`bin/benzo` or documented entry)

At least these commands, each with `--help` and stable exit codes:

```
benzo auction create     # lot, reserve, C, R, deadlines, clearing mode → unsigned manifest
benzo auction sign       # operator key; writes signed manifest
benzo auction publish    # writes public auction dir (manifest + later freeze/result)
benzo auction status     # lifecycle, counts, tips; no bid plaintext

benzo bid prepare        # read manifest; refuse mutated manifest (E1 behavior)
benzo bid seal           # local seal (reuse seal/); outputs envelope hex + ZIP-321
benzo bid deposit        # help print / track the fixed-C deposit (may use wallet CLI)
benzo receipt show       # inclusion receipt + settlement receipt if any

benzo freeze             # accepted set → Merkle root + witnesses (reuse F)
benzo open               # after R: decrypt frozen set (Go tle path)
benzo clear              # pure clear → result.json (reuse G)
benzo settle             # batch refund/payout via existing 2-of-3 worker (reuse J–N)
benzo cancel             # exact C refunds, zero openings (reuse M)

benzo sign inspect       # signer: check result, recipients, fees before FROST
benzo sign join          # signer: 2-of-3 session (or hook to frost-client)

benzo verify             # independent: manifest, root, clear, settlement totals, txids
benzo operator view      # only C + opaque blobs (DESIGN §1 operator-blind)
```

The E2E spec drives **these commands**, not internal libraries, for the lifecycle path.

### Backend

- Persistent auction state under `$BNZ_STATE_DIR` (auctions, bids metadata, receipts, ledger reuse). No secrets in the public auction dir.
- Thin **JSON API** (read-only product paths): `GET /auction/:id`, `/operator`, `/freeze`, `/result`, `/receipt/:ciphertext_hash`. Bind `127.0.0.1`. Never return bid plaintext or sealed secrets. Ciphertext hex and opaque blobs are fine.
- Seller-setup **leak check**: `benzo auction create` rejects any field that would put bidder identity, price, or quantity outside the sealed memo (DESIGN §4).
- Logging: no mnemonics, UFVKs, or plaintext bids in logs.

### Out of scope (hard)

- Any frontend, styles, HTML product pages, hosting UI (R6).
- Mainnet, own nodes, NU7-specific consensus work.
- Mode B buybacks, NEAR Intents, marketplace adapters (**stretch only if O–S are done**; not in the finish line).
- Batch sizes beyond what Phase 3 already proved unless time remains after O–S.
- Replacing FROST with a single key.

## 4. Traps (in addition to all prior)

1. The CLI must not become a second implementation of clearing or settlement — call the existing `clear/` and `settle/` paths.
2. The API must not be the only way to run an auction (CLI is the product; API is for the future UI).
3. Refuse manifests that do not match the signed bytes (already E1).
4. Keep Phase 1–3 specs green as regression; do not spend their live budget every time.
5. Testnet TAZ: ask before any spend that would drop the bidder below 3C + 40,000 zats.

## 5. Layout

```
cmd/ or cli/          unified CLI
api/                  thin JSON server (read-only)
docs/evidence/phase-4/
```

Hand-written budget: **+800 lines** beyond Phase 3’s 744 (total ~1,544). Justify overage under Questions. No UI packages.

## 6. Tests this phase adds: exactly one

Project ceiling **8 E2E**. Already used **4** (Phase 1×2, Phase 2×1, Phase 3×1). Master plan leaves 2 reserved + 1 browser bid flow (user-owned UI). This phase takes **1**.

**5. `e2e/cli-auction.spec.ts`** (live; ~40–60 minutes). Owns **O, P, Q, R, S**.

- **O1** CLI creates, signs, publishes a manifest; status shows DRAFT→OPEN.
- **O2** CLI freeze → open → clear → settle (or cancel) produces the same `result.json` hash as the Phase 2 pure clear.
- **P1** CLI bid prepare refuses a flipped manifest byte; seal produces a 128-byte-bid envelope; deposit tracked at C.
- **P2** After settle, `benzo receipt show` and `benzo verify` agree on inclusion + settlement receipt fields.
- **Q1** Two signers via `benzo sign inspect` + `benzo sign join` complete 2-of-3; a third signer can stay offline.
- **R1** `benzo verify` on a cold copy of the public auction dir exits 0; a corrupted amount or root exits non-zero with `ERROR` lines.
- **S1** API `GET /operator` returns only opaque blobs + C; `GET /result` matches `result.json`; a flipped byte in the published manifest makes `GET /auction/:id` refuse or mark invalid (same hash as CLI).

Mutations (each must turn the spec red):
- **U1** CLI clear uses a different sort key than `clear/` (O2 fails).
- **U2** API `/operator` includes plaintext bid fields (S1 fails).
- **U3** `benzo verify` skips ledger total check (R1 or P2 fails).

## 7. Evidence

Same rules as Phases 1–3: `run.json` (command, commit, window, one result per ID, SHA-256 of written files, tool versions). `EVIDENCE.md` one page: gate table, decisions, limitations (still: one machine, public endpoints, testnet only, **CLI-driven not UI**, sample auction size). `verify.sh` + corrupted-copy negative check. Evidence dir &lt; 1 MB.

## 8. Schedule

| When | Work |
|---|---|
| Day 1 | CLI skeleton, auction create/sign/publish/status, leak check |
| Day 2 | bid prepare/seal/deposit, freeze/open/clear wired to existing libs |
| Day 3 | settle/cancel + sign inspect/join wiring to Phase 3 worker |
| Day 4 | verify + receipts + JSON API |
| Day 5 | `cli-auction` spec + mutations U1–U3 |
| Day 6 | Evidence run, verify.sh, decisions, READY FOR REVIEW |
| Stretch | Mode B / load sample / NEAR — only after O–S |

## 9. What you may ask the user for

- Testnet TAZ if the bidder would fall below 3C + 40,000 zats.
- A second machine for bob (optional).
- Confirmation before any mainnet step (none in this phase).

## 10. Rulings

Only the head agent writes here, `head@benzo.invalid`, newest last.

- R1 2026-10-01: User scope for this phase is **full testnet backend + CLI**. Frontend remains user-owned (Phase 3 R6). Mainnet is out of scope. Extras (buybacks, NEAR, marketplace) are stretch after gates O–S, not finish-line items.
- R2 2026-10-01: One new E2E (`e2e/cli-auction.spec.ts`, IDs O1–S1). Project total becomes 5 of 8. CLI must call existing `clear/` and `settle/` rather than reimplementing them (trap 1).
- R3 2026-10-01: **Carry-over fixes from the independent Phase 3 review.** A head-agent review (4 read-only reviewers: verify.sh positive + 4 corrupted copies, both batches re-fetched on both endpoints, mutation audit, full-history secret scan) agreed Phase 3 stays PASSED, and found the items in R4–R9. They are Phase 4 scope and must be done before Phase 4 READY FOR REVIEW and before any mainnet work.
- R4 2026-10-01: **Gate T: robustness and privacy carry-overs.** Owned by `e2e/cli-auction.spec.ts`, which remains one test, so the project stays at 5 of 8.
  - **T1 Stray deposits do not block settlement.** Before freeze, send (a) one non-C note (e.g. C+1 or dust) to a used per-bid address and (b) one exact-C deposit that is not admitted (after `T_submit`). Admitted bids must settle. Each stray note ends in a defined ledger state: either refunded at its received value (network fee from the reserve) or an `exception` row that `benzo settle --exceptions` refunds. Nothing is silently stranded, and nothing blocks. Today `plan.ts` blocks all settlement and cancel on any non-C or unconfirmed note; fix that.
  - **T2 No linkable recipient data in public artifacts.** The public auction dir, API responses and evidence contain no per-recipient hash or any other value derived from a refund address. Drop `recipient_hash` from capture. If a match must be shown, emit `matches_pinned_routing: true|false`, or a hash salted with a secret kept in `$BNZ_STATE_DIR`. Settlement receipts stay `{auction_id, party, txid, pool, output_index, amount_zats}`.
  - **T3 An expired staged batch recovers.** Add an `exception` ledger state. A staged signed batch whose PCZT expires before mining moves to `exception`; `benzo settle` then re-plans those rows into a fresh batch with a fresh PCZT. Final totals equal `result.json`, and nobody is paid twice. Drill it live with a short product-level expiry (`settlement.pczt_expiry_blocks` in operator config, not a test-only flag), delaying the second signer past it.
  - **T4 Signers recompute amounts themselves.** `benzo sign inspect` derives expected per-party amounts from its own fresh opening, its own `clear/` run and its own routing copy. It refuses if any batch row or PCZT output differs. It must not take expected amounts from coordinator ledger rows.
  - **T5 Any two of three.** The signing pair is chosen at run time, not hard-coded (`settle/sign.ts` currently fixes alice+bob). Run one settlement with Alice offline, so Bob and Carol sign. `offline_signer` in evidence is the member observed not to join, not a constant.
- R5 2026-10-01: **Two more mutations** for `cli-auction`, each shown red as in earlier phases: **U4**, signer inspect takes expected amounts from coordinator rows (T4 fails); **U5**, restore the all-or-nothing deposit guard (T1 fails).
- R6 2026-10-01: **Batch size and PCZT expiry are measured, not assumed.**
  - Run one live settlement with as many recipients as TAZ allows (target 10–20).
  - Record the signing time per randomizer, total signing time, actions, fee and blocks elapsed.
  - Derive the PCZT expiry from batch size with at least 2× margin over the measured worst case, and put the formula in `EVIDENCE.md`.
  - Pin the batch cap to the largest size that expiry covers. Until then, Phase 3's "cap 50" is only an upper bound.
  - Ask the user for TAZ under Needs user if the bidder would fall below 3C + 40,000 zats.
- R7 2026-10-01: **NU7 window.** Testnet NU7 is planned for about 2026-10-06, inside this phase.
  - Replace the 40-block NU7 broadcast guard with one based on the PCZT's actual expiry height: refuse to create or broadcast a batch whose expiry height reaches a published activation height while the tip is still before it.
  - If NU7 activates and the pinned tools stop producing valid transactions, follow PHASE-1 §13: keep the pre-activation evidence, record `NU7 re-run pending`, and do not upgrade pins without a Ruling.
- R8 2026-10-01: **Regression.**
  - `npm run e2e:live` may select only the current phase's spec. This ratifies the Phase 3 selection, which had no Ruling.
  - Before Phase 4 READY FOR REVIEW, run all five specs once at one commit and record each result: the default run plus every live spec once. The TAZ spend for this is approved.
- R9 2026-10-01: **Phase 3 evidence wording.** The build agent edits `docs/evidence/phase-3/EVIDENCE.md` and STATUS. No new runs and no gate changes.
  - **K:** say "per-signer check processes started by the coordinator on one host; participants auto-confirm", not "independent".
  - **L:** say "killed after allocation, before PCZT creation; staged and broadcast resume not exercised in Phase 3".
  - **Ledger:** say "exception state not implemented in Phase 3".
  - **N:** say "only the Carol-offline case shown; the signing pair was fixed".
  - **M:** say "pre-freeze OPEN-state cancel; opening count self-reported, backed by the closed-port exit".
  - **Add limits:** drand threshold trust; one operator holds all three FROST shares; one wallet plays all bidders and the seller; the target+200 expiry makes settlement transactions distinguishable on chain.
  - Fix the STATUS golden-path assertion IDs to B1, D1–D3, A1–A5.
  - Align the manifests' `refund.invalid` text with exact C (Phase 3 R2).
- R10 2026-10-01: **Line budget for R3–R9:** up to +200 lines beyond this phase's +800, for a total of about 1,744. Justify any overage under Questions. These are fixes to existing paths, not new product scope.
