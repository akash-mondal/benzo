# Phase 2: auction core

- **Window:** 2026-10-01 to 2026-10-12 23:59 UTC.
- **Networks:** Zcash testnet (NU6.3 / Ironwood) and drand mainnet quicknet. No mainnet transaction of any kind.
- **Ownership:** the head agent owns this file. You read it and don't edit it.
  - Results, questions and deviations go in `docs/STATUS.md`.
  - Artifacts go in `docs/evidence/phase-2/`.
  - The phase changes only through committed Rulings (section 12).
- **Inherited:** AGENTS.md rules, pins, commands and the Phase 1 stack. Re-read DESIGN.md §3–5, §7 and §14 before writing code. Phase 1 PASSED in R5–R10 (2026-10-01).

## 1. Goal and finish line

Phase 1 proved the primitives. This phase makes the **auction** real on testnet: a signed manifest, bid admission with receipts, a frozen accepted set, deterministic opening and clearing, and rule-based handling of bad bids. Settlement stays the Phase 1 single `create-max` refund; there is no batch worker and no signer console yet.

| Gate | Question |
|---|---|
| E | Does a signed manifest bind every auction parameter, and does the client refuse a changed manifest? |
| F | Are bids admitted only while OPEN, does each get an inclusion receipt, and does freeze publish a Merkle root over the accepted set while bids are still sealed? |
| G | Does anyone holding the frozen root, the opened ciphertexts and the manifest recompute the same clearing result (mode A uniform-price, and single-lot Vickrey)? |
| H | Do malformed, late, replayed, underfunded and over-cap bids get a pre-declared outcome (reject or fixed refund), never an operator choice? |
| I | Does CANCELLED refund fixed C without decrypting bids? |

| Decision (rules in section 8) | Options |
|---|---|
| Freeze commitment | `merkle_root_v1` (default) or a named alternative |
| Clearing spec | pin the exact pro-rata / tie / dust rules the implementation will ship |
| Receipt format | pin the inclusion-receipt fields |

**Finish line.** Phase 2 is done when all of the following hold:
1. Every gate is READY FOR REVIEW, or FAILED or BLOCKED with evidence and a one-command repro.
2. Evidence for gates E–I was written by one `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live` at a recorded commit, plus any setup this phase adds under `setup/`.
3. `docs/evidence/phase-2/verify.sh` exits 0 on that evidence and has been seen failing on a corrupted copy (same pattern as Phase 1).
4. Each test this phase names has been seen failing under every mutation section 7 lists.
5. The three decisions are recorded in STATUS and in `EVIDENCE.md`, each with the evidence that drove it.
6. STATUS says READY FOR REVIEW.

## 2. Read first

- `docs/research/DESIGN.md`: §3 lifecycle, §4 bid, §5 opening and clearing, §7 mode B (do not build mode B), §14 limits.
- `docs/research/zcash-feasibility.md`: "Four-week execution gates" week 2 only.
- `docs/research/threat-model.md`: items 1, 2, 6, 8; threats 001, 003, 013, 021, 036, 057 (same set Phase 1 used).
- Phase 1 evidence and STATUS, especially decisions **binary_memo** and **frost_2of3**.

## 3. Product rules (from DESIGN; test these, do not invent)

**Manifest.** Signed before OPEN. It pins at least: network, auction ID, escrow UA and FROST group key, lot and supply, reserve, price tick, `B_max`, `q_max`, fixed collateral `C`, fee, clearing and tie rules, drand quicknet chain hash + public key + scheme + exact round `R`, `T_submit`, `T_freeze`, refund and cancel policy. The bidder client treats any byte change as a different auction.

**Lifecycle.** `DRAFT → OPEN → FREEZE → SEALED-WAIT → OPENED → CLEARED → SETTLING → SETTLED`, and `FREEZE` failure or cancel → `CANCELLED → REFUNDING`. `T_submit < T_freeze < R`. Nothing is admitted after `T_freeze`. The same auction is never reopened after plaintext exists.

**Admission and receipts.** A bid is in the accepted set only if it was seen before `T_freeze` with a valid envelope (section 6 Phase 1 format) and a confirmed deposit of exactly C to the per-bid address the manifest rules require. Each accepted bid gets an inclusion receipt: ciphertext hash, note/txid, leaf index. The bidder can prove inclusion or dispute omission from the frozen root.

**Freeze.** While ciphertexts are still sealed, publish: Merkle root over the accepted set (leaf = ciphertext hash || deposit ref, as pinned), leaf count, witnesses path, and the cutoff timestamp. Reorg handling: if a deposit leaves the chain after freeze, follow the pinned rule (default: refund fixed C, remove from result by leaf index; do not reopen admission).

**Opening and clearing (anyone can recompute).** At `R`, decrypt the frozen set with the pinned Go `tle` path (no new sealer work). Invalid ciphertexts follow the pre-declared refund rule (C minus fee). Then:
- **Mode A (multi-unit, uniform price):** sort by price desc, fill supply, all winners pay the lowest winning price; final band pro-rata with integer zatoshi rounding; dust rule pinned in the manifest; ties by committed leaf index; reserve and minimum fill apply.
- **Single-lot (Vickrey):** winner pays the second price; publish the payment, not the maximum, where possible.

**Cancel.** If freeze fails or the auction is cancelled before opening, refund fixed C to every deposit **without decrypting**. This path must work before we ever take "real" deposits in Phase 4.

## 4. Inherited traps (do not rediscover)

Phase 1 traps 1–11 still apply. Additionally:
1. **Do not put bid data in the manifest.** The manifest is public and signed; bids are sealed.
2. **Merkle leaves must commit to the ciphertext hash and the deposit reference**, not to plaintext fields.
3. **Clearing is a pure function** of (manifest, frozen set, opened plaintexts). No clock, no operator input, no network in the clearing step.
4. **ZIP-321 remains the only binary-memo send path** (Phase 1 decision).
5. **NU7.** Testnet activation may land in this window. Keep pre-activation evidence. Do not upgrade pins without a Ruling. Do not broadcast within ~40 blocks of a published activation height.

## 5. Layout this phase

```
manifest/           manifest schema + signing helper (CLI or small script; no service)
clear/              deterministic clearing library + CLI (pure; stdin/JSON → result.json)
e2e/                existing two specs + this phase's specs
docs/evidence/phase-2/
```

Reuse `seal/`, `scan/`, `tools/`, `e2e/lib` as they are. Do not grow a UI. The only user-facing surface remains the Phase 1 sealer page (it may print a ZIP-321 URI and envelope; it may accept a manifest id later only if needed to test E).

Budget: about 1,200 lines of hand-written code total with Phase 1 included (Phase 1 was 1,385; this phase may add ~800). Justify a larger number under Questions.

## 6. What is out of scope

- Batch multi-output refund workers, settlement ledgers, exception queues.
- Signer console, auctioneer dashboard, styling, WebZjs, consumer wallets.
- Mode B buybacks, NEAR Intents, collection delivery adapters.
- Mainnet, own nodes, regtest, NU7-specific consensus code.
- drand relay failover; owner-key / settlement-envelope encryption (Phase 1 placeholders stay placeholders).
- More than the tests named in section 7.

## 7. Tests this phase adds: exactly one

Project ceiling is still eight automated tests for the whole project (AGENTS.md); the master plan gives Phase 2 **one** (a full auction on testnet). Phase 1 owns two. This spec owns gates E–I. Same harness rules: `BNZ_LIVE=1` project `live` adds it; one `test()`; assertions are `test.step` IDs with `expect.soft`; failures print `ERROR <ID> <reason>`. Locked assertion lists; changing one needs a Ruling.

**3. `e2e/auction-core.spec.ts`** (live; ~50 minutes; fees ≈ one sealed round of deposits + one refund/cancel). Owns **E, F, G, H, I**.

Preconditions: Phase 1 binaries match pins; both endpoints and drand answer; bidder spendable ≥ 3C + 40,000 zats; `.benzo` holds vault + frost configs. Same frostd start/stop rule as test 2.

Steps:
- **E1** The signed manifest's bytes hash to the value the client displays; a flipped byte in the manifest makes the bidder client refuse it.
- **E2** Two bidders (two envelope + deposit pairs) are accepted while OPEN with receipts; a third attempt after `T_freeze` is refused with no receipt.
- **F1** Freeze output lists exactly the accepted leaves; each receipt's leaf index opens to the expected ciphertext hash.
- **F2** The Merkle root verifies for every accepted leaf; a non-member hash does not verify.
- **G1** After `R`, a clean-room clear (CLI or spec-side pure call into `clear/`) from (manifest, frozen set, ciphertexts) equals the result.json the golden path produced (byte-stable canonical JSON).
- **G2** Mode A: uniform price, pro-rata band and tie-by-leaf-index hold on the opened bids (use small crafted quantities in this run so the band is hit).
- **G3** Single-lot mode on the same envelopes (or a paired mini-auction): winner pays second price.
- **H1** Truncated / wrong-length envelope is rejected, no receipt.
- **H2** Deposit ≠ C (under and over) is rejected or refunded at the pinned value; never partially accepted.
- **H3** Replay of a known ciphertext+deposit is rejected (idempotent receipt; no double leaf).
- **H4** A bid after `T_freeze` (and a bid with `R` already passed) is rejected.
- **I1** Cancelled auction (use a second mini-auction in the same spec, or the cancel drill after G): all deposits refunded at C, **zero** `tle -d` invocations in the cancel path's request/log trace.

Mutations (each turns the spec red):
- **N1** Manifest signer skips the drand round field (E1 fails).
- **N2** Admission ignores `T_freeze` (E2 fails).
- **N3** Freeze commits plaintext hash instead of ciphertext hash (F2 or G1 fails).
- **N4** Clearing sorts ties by reveal order (G2 fails).
- **N5** Accept deposits of any amount (H2 fails).
- **N6** Allow a duplicate ciphertext leaf (H3 fails).
- **N7** Cancel path decrypts before refund (I1 fails).

## 8. Decisions

Record each in STATUS and `EVIDENCE.md` with the evidence that drove it.

**Freeze commitment.** Choose `merkle_root_v1` if F1–F2 hold on the live run. Otherwise name the failure and propose one alternative (e.g. a signed manifest of the ordered leaf list) without building it.

**Clearing spec.** Freeze the exact algorithm this phase implements (band fill, rounding, dust, ties, reserve) into the manifest schema. If the live G1–G3 run forces a change, record the before/after rule under Questions and re-run G.

**Receipt format.** Pin the fields (ciphertext hash, deposit ref, leaf index, auction id). If a verifier outside the repo can check inclusion with only the published root + path + manifest, record that as the evidence.

## 9. Evidence rules

Same as Phase 1 §10, paths under `docs/evidence/phase-2/`. `run.json` again records command, commit, UTC window, one result per assertion ID, SHA-256 of every file the run wrote, and tool versions. Allowed and forbidden fields unchanged (no secrets). `EVIDENCE.md` is one page: gate table, three decisions, limitations (still include: signers on one machine, public endpoints, drand threshold trust; add that clearing was verified on a 2–3 bid sample, not 17k bids).

`verify.sh` re-checks at least:
- manifest hash and signature over the recorded manifest bytes;
- freeze root against the recorded leaves;
- `tle -d` on recorded ciphertexts (reuse Phase 1 pattern);
- refund txids for H/I outcomes on both endpoints;
- clear result hash against the canonical `result.json`;
- `run.json` file hashes and `git diff --quiet <run commit> HEAD -- e2e seal scan tools manifest clear package-lock.json playwright.config.ts`.

Negative check: corrupt the manifest hash and one leaf, expect `ERROR E` and `ERROR F` (or `ERROR G`) lines and exit non-zero.

Keep `docs/evidence/phase-2/` under 1 MB.

## 10. Schedule

| When | Work |
|---|---|
| Days 1–2 | Manifest schema + signer; admission + receipts; freeze root; pure `clear/` CLI |
| Days 3–4 | Test 3 and mutations N1–N4 on testnet |
| Days 5–6 | Bad-bid + cancel rules; test 4 and mutations N5–N7 |
| Days 7–8 | Evidence run; `verify.sh` + negative check; decisions; READY FOR REVIEW |

NU7 may activate in this window. Keep the pre-activation evidence; record `NU7 re-run pending` under Blocked items if pins break.

## 11. What you may ask the user for in this phase

- Testnet TAZ if the bidder would fall below 3C + 40,000 zats for the live runs (ask before spending; same cautious budget).
- A second machine for bob (still optional).
- Nothing else.

## 12. Rulings

Only the head agent writes here, in commits authored by `head@benzo.invalid`. Entries go newest last, as `R<n> <UTC date>: <ruling>`. A gate is PASSED only when a Ruling names it with its commit.

- R1 2026-10-01: Master plan (user-locked) gives Phase 2 **one** test. `e2e/auction-core.spec.ts` is that test and owns gates E–I. Do not add a second spec. H and I are steps inside it.
