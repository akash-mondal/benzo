# Phase 7 batch B45: classify addresses in bulk and cache them (H16, now P1 scale)

Head design, 2026-10-19. Live scale-55 after B43 (R101): host build is down from about 100 s to about 14 s per batch, and flat across batches 1–4 at N = 55. But B43's offline profile at N = 1,000 shows the second batch still takes 63 s, 98% of it spawning `benzo-pczt classify-address` once per derived row (about 60 ms each). Every batch derives **every** row of the auction, so this is O(N) per batch and O(N²) for the whole settlement. At 17,000 bids that is about 17 minutes per batch for each host: the README's 17,000-bid limit stays until this lands.

## Design

1. **Bulk mode in the Rust tool** (`settle/src/main.rs`; no crate or version change, the same audited `zcash_address` 0.13.0 calls): `benzo-pczt classify-address --stdin` reads one address per line and prints one JSON line per input, in order. Each line is the exact object the single-address form prints today. An unparseable address prints its `invalid`/`other` object as today; the bulk mode never stops on one bad line.
2. **One classifier module** (`envelope/destination.ts`): `classifyAddresses(list): Classified[]` makes one bulk call per chunk of up to 2,000 addresses. Under it sits an in-process `Map` memo keyed by the exact address string. Keep `classifyAddress(one)` as a thin wrapper over it, so every caller (`classifyDestination`, `unifiedReceivers`, `isUnifiedOn`, `isUnifiedOrchardOn`) gets identical answers.
3. **Host prefetch and disk cache** (`cli/host-derive.ts`):
   - Before the per-row loop, collect every destination the host derived and classify them with one `classifyAddresses` call.
   - Persist the results in `$st/auctions/<id>/classify-cache.json` (mode 0600), keyed by `sha256(address)`, and store the classifier binary's sha256 with them. If the binary changes, the cache is discarded.
   - The classification is a pure function of the address string and the binary, so the cache can never change a verdict. Prove that.
4. **Same verdicts.** For every fixture and fold that touches destinations (envelope opens, claims, seller UA, deliver), the outputs must be byte-identical to main.

## Proof (offline)

- `tools/repro/b45-classify.ts` checks the bulk output against the single-call output on the reference vectors used by the existing destination repro (`tools/repro/` R24 item 3 vectors): every kind, every network, invalid inputs included.
- Re-run `tools/repro/h13-host-scale.ts` at N = 55 and N = 1,000. Report the first and second batch times and the number of `benzo-pczt` spawns, before and after. The target is that the second batch spawns `classify-address` zero times and that host time per batch no longer grows with N.
- `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, the B43/B44 folds, and `cargo build --release --locked` for settle.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b45 -b b45-classify <HEAD>`.
- Offline only. Do not override the git identity. Use `--no-verify` (R32). Commit early.
- No mid-line `//` after code in scripted edits.
- Put outputs under `docs/evidence/phase-7/repro/`, a status block in `docs/STATUS-B.md`, and Questions there.
- **Conflict note:** B44 is editing `envelope/opening.ts` and its callers at the same time. Do not touch `envelope/opening.ts`. Keep `cli/host-derive.ts` edits to the classify prefetch so the two merge cleanly.
