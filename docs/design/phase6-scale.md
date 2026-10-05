# Design: Phase 6 settlement scale (gate SC, live half)

Head-owned brief (2026-10-03, draft). This is a measure-then-decide design: the experiments in §2 come first, and the head picks the §3 option from their numbers. Builders implement, and disagreements go under Questions.

## 1. The problem, in numbers

- The organizer's volume target is 17,000 bids in 48 hours.
- Every deposit note in the vault must be spent once to refund or pay it, and every Orchard spend needs its own RedPallas spend-authorization signature from the 2-of-3 FROST group. **So 17,000 bids means about 17,000 threshold signatures,** whatever the batch layout.
- **Measured today** (STATUS 2026-10-02T03:59Z, Phase 4 drill):
  - 13 outputs per batch, 14 actions, fee 70,000 zats;
  - normal signing 479 s per batch, worst 37.6 s per step;
  - 171 blocks from proposal to mining (this included the expired-batch recovery drill).
- At 13 outputs per batch, 17,000 bids is about 1,300 batches. At 479 s each, run one at a time, that's about 173 hours, which is not acceptable. The offline bench (`docs/evidence/phase-6/bench.json`) shows that admission, freeze, open and clear are not the bottleneck. Signing and mining are.

## 2. Measure first (Track A, testnet, about 2 hours)

Record each number in `docs/evidence/phase-6/scale-measure.md` with its command and raw output.
1. **Where the 479 s goes:** per batch, time PCZT build, proving, each FROST round (commit, sign, aggregate) per action, and broadcast. Split protocol round trips from computation.
2. **Spends vs outputs:** how many spends and how many outputs the 13-output batch had. Outputs need no signature, only proving.
3. **Multi-message sessions:** whether frostd/frost-client can sign all of a PCZT's spend actions in one session (`message_count > 1`), and the time per extra message.
4. **Parallel sessions:** throughput with 1, 4 and 8 concurrent signing sessions on the three signer hosts (after part 1 §1).
5. **Bigger batches:** time and fee for 1 spend → 50 outputs, and for 50 spends → 50 outputs, under the ZIP-317 fee and the block size.

## 2.1 Findings so far (head, 2026-10-05)

- **§2.1:** settlement now records its phases (`state/run/settle-timing.jsonl`, cedcdd4):
  - host build;
  - each host approval;
  - each FROST session, by pool;
  - the whole signing step;
  - mining.
  Every live run from now on produces the numbers.
- **§2.3, multi-message sessions:** `frost-client coordinator` accepts several `-m`/`-r` pairs in one session. zcash-sign computes every spend's randomizer up front and only prompts for them one at a time (`prompt_for_signatures`). So one session per batch is possible without changing zcash-sign: read the randomizers, run one session, then answer zcash-sign's prompts.
- **Security catch (blocks option A as-is):** the pinned frost-client participant shows and confirms only `signing_package[0].message()` (`frost-client/src/participant/comms.rs`), and `generate_signature` (`participant/round2.rs`) signs only `signing_package.first()` with `randomizer[0]`. A multi-message session therefore needs a patch to the signing tool.
- **§2.4, parallel sessions (corrected 2026-10-05):** a host's identity *can* be in several sessions at once. `frost-client participant -S <session>` joins a named one; only a join *without* `-S` refuses when more than one is open. The part 2 collisions came from joining without `-S`. **Chosen: R29 (`docs/PHASE-6.md` §6).** All of a transaction's single-message sessions run in parallel, with no tool patch.

## 3. Options the head will choose from (after §2)

- **A. Multi-message signing:** one FROST session per PCZT signs every spend action, removing round trips per action. Expected to be the biggest win if §2.3 holds.
- **B. Larger, decoupled batches:** raise `batch_cap` to whatever §2.5 supports. Outputs are cheap to add, and fees scale with actions (`max(spends, outputs)`), so pairing each spend with one output keeps the fee per bid flat.
- **C. Parallel pipelines:** N concurrent batch workers with disjoint note sets, bounded by signer-host CPU and by the ledger's pinned-batch rules (SQLite claims of rows; no row in two batches).
- **D. Honest limit:** if A–C can't reach 17,000 within 24 hours of R, state the measured throughput (bids per hour) in README, and keep the live demo at a size that settles within the video window.

**Target:** 17,000 bids settled within 24 hours of R on testnet hardware, with the ledger proving no row was ever in two broadcast batches.

## 4. Invariants that must not change

- Each signer still recomputes each batch from its own data.
- Approval binding (§3 of part 1) covers every message in a multi-message session.
- The kill-a-signer drill still completes.
- PCZT expiry is still derived from the measured formula (R6).
