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

**Parallel host approvals + review fixes (663837d), auction 6efcd40f…** (finished by `resume:` after a local DNS outage broke `benzo open`; `RESULT PASS`, verify exit 0; raw `scale/scale-8-r29b-timing.jsonl`, `scale/scale-8-r29b.log`): host build 23.0 s, approvals 17.1 s ‖ 20.0 s in parallel, FROST 9 spends **8.1 s**, whole signing step **28.4 s** (110.2 s before R29), mining 33.7 s.

Signing no longer grows with spends. The per-batch cost is now build + approvals (~70 s). Next: run the two host approvals in parallel (~20 s per batch), then raise `batch_cap` (option B) so there are fewer batches.

## R30: one 28-output batch (head, 2026-10-05)

Run: `markets.ts scale-27`, auction 5e2091c9…: 27 bids + the seller in ONE batch, with 28 spends (27 deposits + the fee reserve), 28 outputs and fee 140,000.
- The first settle refused: `benzo-pczt create` still had a third 13-recipient bound (`scale/scale-27-first-settle.err`). Fixed in 41ef5a4, then finished with `resume:`, giving `RESULT PASS` (verify exit 0).
- Mined txid 09a0f834…32e8 at height 4,467,722. **Raw transaction 94,380 bytes**, under the 100 KB bound.
- Raw data: `scale/scale-27-timing.jsonl`, `scale/scale-27.log`.

| Phase | scale-8 (9 spends) | scale-27 (28 spends) |
|---|---|---|
| Host build | 23.0 s | 65.1 s |
| Host approvals (parallel) | ~20 s | ~50 s |
| FROST, all spends in parallel | 8.1 s | **8.2 s** |
| Whole signing step | 28.4 s | 58.9 s |
| Mining wait | 33.7 s | 82.2 s |

**Projection for 17,000 bids:** ~630 batches of 27 bids × ~124 s (build + signing) ≈ **21.7 h** with mining overlapped with the next batch. That is inside the 24 h target, but only just. The cost now is host build and approval, which grow with rows (~2.3 s and ~1.8 s per row), not signing. Next lever: build batch n+1 while batch n is being approved and signed, which needs disjoint notes (rows already are).


## Gate SC live half: scale-55 (head, 2026-10-18, R85, code `1b871d5`)

Run: `tools/repro/markets.ts scale-55`, auction `754bb1c6…`: one uniform auction with **55 bids + the seller = 56 rows, settled in 4 batches of 14** (`batch_cap` 14), host custody (alice + bob), `BNZ_LWD_SINGLE=1`. Result: **`RESULT PASS` (verify exit 0)**. Raw data: `scale/scale-55.log`, `scale/scale-55-resume.log`, `scale/scale-55-timing.jsonl`, and `scale/scale-55-txs.json` (every funding and settlement txid with its mined height and raw size from lightwalletd, plus each batch's redacted inspect block).

- **Funding in 3 transactions.** One funding transaction with 55 deposit outputs would be about 190 KB, so the harness pays at most 19 deposits per transaction, back to back: `0e057645…` (19 deposits + the 400,000 fee reserve, 69,130 bytes), `176af039…` (19, 65,974 bytes), `76b1cbc8…` (17, 59,662 bytes), mined at 4,515,049–4,515,050.
- **One failure, then a resume.** The first `open` failed on a drand relay timeout (`api.drand.sh` i/o timeout during the per-leaf `tle -d`). `resume:754bb1c6…` opened all 55 leaves, cleared, settled and verified. Phase 7 item H11 removes the per-leaf relay dependency.
- **Settlement:** 4 batches, each 15 actions (14 recipients + change), fee 75,000 zats (ZIP-317), raw transaction 50,194 bytes each.

| Batch | txid | Mined | Host build | Host approvals (2, parallel) | FROST, all spends parallel | Whole signing step | Mining wait |
|---|---|---|---|---|---|---|---|
| 1 | `f5512693…` | 4,515,187 | 103.5 s | 87.8 s, 89.3 s | 8.1 s | 97.8 s | 82.9 s |
| 2 | `4ee0bb05…` | 4,515,200 | 100.1 s | 91.0 s, 92.6 s | 8.1 s | 101.0 s | 82.7 s |
| 3 | `ed82b349…` | 4,515,213 | 102.9 s | 88.9 s, 88.8 s | 8.1 s | 97.3 s | 115.5 s |
| 4 | `d1680726…` | 4,515,228 | 104.5 s | 88.4 s, 88.9 s | 8.1 s | 97.4 s | 115.1 s |

**What it shows.**
- FROST signing stays flat at about 8.1 s per batch however many spends it signs (R29 parallel sessions), as at scale-8 and scale-27.
- Each 14-row batch costs about 5 minutes end to end, sequentially: about 100 s host build, about 90 s host approvals, about 8 s FROST, and 80–115 s waiting for the block. The 4 batches settled in about 20 minutes (56 rows, about 170 rows per hour).
- **Host build and approvals grow with the auction's total size, not the batch's.** A 14-row batch here took 100 s to build and about 90 s to approve, more than scale-27's single 28-row batch (65 s, about 50 s). Per batch, by auction size: 9 rows → 23 s build (scale-8), 28 → 65 s (scale-27), 56 → 100 s (scale-55). The cause is in `cli/host-derive.ts` `deriveRows`: every build and every approval re-decrypts EVERY frozen leaf with `tle` (one drand relay call each) before deriving its rows. So each batch costs O(N) and the whole settlement O(N²/batch_cap).
- **Consequence: the offline projection does not hold.** `bench.json`'s 20.9 h for 17,000 bids models host time per batch as a function of the batch's rows. At the measured ~1.8 s per auction row per batch, a 17,000-bid auction would need months of host time. Phase 7 **H13**: each host decrypts the frozen set once per auction (offline, from the beacon signature it already verified) and caches its openings; with that, per-batch host time should fall back to the batch's own rows. Until then the README states the measured limit.

## scale-55 after B43 and B45 (R101, R105)

| Per 14-row batch | R85 (before H13) | R101 (after B43) | R105 (after B45) |
|---|---|---|---|
| host build | ~100 s | ~14 s | ~14 s |
| each host approve | ~89 s | 4–7 s | 4–8 s |
| sign | ~98 s | ~14 s | ~13–16 s |

All figures are flat across batches. At 55 bids B45 changes nothing live, because classification costs only about 3 s there. Offline, at 1,000 bids, it cuts a host's second batch from 61 s to 1.65 s.

R105 auction `58d60e90…` stopped at batch 4 with `InsufficientFunds` (the fee reserve was short by 20,340 zats; H19). The head topped up the reserve with 200,000 zats (`51c9c554…`) and re-ran `benzo settle`. Batch 4 then broadcast (`1805fc1e…`, 14 outputs, 2,607,480 zats landed at 4,516,710), all 56 rows settled, and the cold verify printed 19 OK lines. Logs: `scale/scale-55-b45{,-retry,-settle}.log`, timings `scale/scale-55-b45-timing.jsonl`.
