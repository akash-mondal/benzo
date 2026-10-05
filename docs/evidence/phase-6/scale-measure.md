# Phase 6 scale — measurements (head, 2026-10-05, NU7 testnet, host custody, R28)

Run: `tools/repro/markets.ts scale-8`, auction 094e68c9…: one uniform auction with 8 bids, settled in one batch of 9 spends (8 deposits + the fee reserve) and 10 outputs (10 actions, fee 50,000 zats). Raw timings: `scale/scale-8-timing.jsonl`.

| Phase (per batch) | Time |
|---|---|
| Host build (derive + create + prove on a signer host) | 23.0 s |
| Host approval, each of 2 hosts (verify + derive + strict inspect + sighash) | 17.4 s, 17.7 s |
| FROST session, one per spend (rerandomized RedPallas, coordinator + 2 hosts over frostd) | **8.1 s each** (first 10.1 s), 9 sessions |
| Whole signing step (approvals + sessions) | 110.2 s |
| Mining wait (broadcast → mined, 25 s blocks) | 98.4 s |

**What it means for 17,000 bids**

| Scenario | Signing | Per-batch overhead | Total |
|---|---|---|---|
| Today: one FROST session per spend, sequential (17,000 spends × 8.1 s), 13-output batches (~1,300 batches × ~58 s of build + approvals, and mining overlappable) | ~38 h | ~21 h | ~60 h |
| Option A: one multi-message FROST session per batch (~8–10 s per batch, any number of spends) | — | — | ~4 h of signing at 1,300 batches |
| Option A + B: 50-output batches (~340 batches), mining overlapped with the next batch (disjoint notes) | ~1 h | ~340 × (~40 s build + ~40 s approvals) ≈ 7.5 h | **~9–10 h** (target: 24 h of R) |

**Constraints found (phase6-scale.md §2.1, corrected):**
- Option A needs a frost-client patch: the pinned participant confirms and signs only message[0] of a session.
- A host identity *can* be in several sessions at once; joining with `-S <session>` works. The one-session refusal applies only to a join without `-S`.

## R29 re-measure: parallel single-message sessions (head, 2026-10-05)

Run: `tools/repro/markets.ts scale-8`, auction 95cdfb41…, the same shape (8 bids, one batch, 9 spends). Result: `RESULT PASS scale-8` (CLI = pure clear, receipts = obligations, landed, cold verify). Raw: `scale/scale-8-r29-timing.jsonl`, `scale/scale-8-r29.log`.

| Phase (per batch) | Before (094e68c9) | R29 (95cdfb41) |
|---|---|---|
| Host build | 23.0 s | 32.2 s |
| Host approvals (serial, 2 hosts) | 35.1 s | 41.2 s |
| FROST signing, all 9 spends | 74.8 s (9 × 8.1 s, serial) | **8.2 s** (9 sessions in parallel) |
| Whole signing step | 110.2 s | **50.0 s** |

Signing no longer grows with spends. The per-batch cost is now build + approvals (~70 s). Next: run the two host approvals in parallel (~20 s per batch), then raise `batch_cap` (option B) so there are fewer batches.
