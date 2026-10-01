# Status: Builder B (Track B) handoff

<!-- Only Builder B writes this file, on branch track-b. Same rules as docs/STATUS.md: outcome first, back every claim
with a command and its result or mark it `unverified`, replace stale lines. Rulings live in the phase doc only. -->

## Phase 4, Track B (R16, R18, R20): READY FOR MERGE

Updated: 2026-10-01T18:39:00Z · Last commit: 2e6b650 · Commits this run: 971da62 (R16+R18), 4258f54 (R20a), 53a7355 (R20b), 2e6b650 (R20c)

- **Questions for the head agent:** see below (line-budget overage, load-time shape choices, user instruction to record).
- **Blockers:** none
- **Scope delivered:** R16 verify re-derives openings with pinned tle + published beacon (`--offline` skips it), R18 `benzo api serve`, R20a canonical `auction.json` per `schemas/public-auction.schema.json` (legacy projections fallback-only), R20b flag interface, R20c separate result/stray obligation checks. No tests (R11). No testnet, wallets, funds, keys or broadcasts.

| Item | State | Evidence (command, output) | Commit |
|---|---|---|---|
| R16 re-derive openings | READY FOR MERGE | Corpus `tmp/p3-public` rebuilt from `docs/evidence/phase-3/settle/` + fresh tle openings + real drand beacon round 32684947 (`tmp/proof-p3.mjs`). `bin/benzo verify tmp/p3-public` → `OK manifest/freeze/receipts/clear/accounting`, exit 0 — the fresh clear equals the **recorded** Phase 3 `result.json`, so the re-derivation matches the original openings. Derive-only copy without `opened.json` → same OK. Flipped published opening → `ERROR verify refused: opening 0 published differs from re-derived`, exit 1. Logs `tmp/proof-logs/r16-*`. | 971da62 |
| R16 `--offline` | READY FOR MERGE | `bin/benzo verify tmp/canon-p3 --signer HEX --offline` → `WARN openings not re-derived` + OK x5, exit 0. Without published openings → `ERROR verify refused: --offline needs one published opening per leaf`, exit 1. No network fetches in this mode. | 971da62 |
| R18 `benzo api serve` | READY FOR MERGE | `bin/benzo api serve --dir tmp/p3-public --port 8791` (through `cli/benzo.ts`, listed in `bin/benzo --help`) → `api listening http://127.0.0.1:8791 …`; all five R11 routes served (`/auction/:id` valid:true, `/operator` blobs only, `/freeze`, `/result`, `/receipt/:ciphertext_hash` inclusion+T2 settlement). Bad dir → `ERROR api refused: missing signer.json` exit 1; missing `--dir` → usage exit 2. Standalone `node api/dist/server.mjs --dir … --port …` (the e2e S1 spawn form) also serves. Logs `tmp/proof-logs/r18-*`. | 971da62 |
| R20a canonical `auction.json` | READY FOR MERGE | `tmp/canon-p3` assembled from real Phase 3 artifacts in `publish()` shape (`tmp/proof-canon.mjs`): `bin/benzo verify --dir tmp/canon-p3 --signer HEX` → OK x5, exit 0. Refusals: `version:2` and a `recipient_hash` key → `ERROR verify refused: auction.json schema`; flipped `manifest.json`/`frozen.json`/`result.json` projections → `ERROR manifest/freeze/clear … projection differs` (each in its own check) and API `GET /auction/:id` → HTTP 400 `{"valid":false,"error":"manifest refused: manifest.json projection differs"}`; clean dir → `valid:true`. Logs `tmp/proof-logs/r20a-*`. | 4258f54 |
| R20a legacy fallback | READY FOR MERGE | `bin/benzo verify --dir tmp/p3-public --signer HEX` and a cold copy of `docs/evidence/phase-2/auction` (`tmp/cold-p2`) → `WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs` + OK x5, exit 0. | 4258f54 |
| R20b flag interface | READY FOR MERGE | `bin/benzo verify --dir PUBLIC --signer HEX [--offline]` and `bin/benzo receipt show --dir PUBLIC --ciphertext-hash HEX [--receipt signed.json]` exactly as R20/Q13 lists them (also `benzo operator view --dir PUBLIC`, see Questions). Wrong `--signer` → `ERROR verify refused: signer mismatch` exit 1; missing `--signer` → usage exit 2. `receipt show` on `tmp/canon-p3` → inclusion + T2 settlement (Phase 3 receipt); with `--receipt tmp/receipt0.json` on the cold Phase 2 copy → `receipt_signed:true`, `settlement:null`. Logs `tmp/proof-logs/r20b-*`. | 53a7355 |
| R20c accounting classes | READY FOR MERGE | Mutations of `tmp/canon-p3` (`tmp/proof-strays.mjs`, logs `tmp/proof-logs/r20c-*`): stray present + seller receipt dropped → `ERROR accounting refused: settlement missing obligation seller` (the pre-fix `resultBound` gate skipped this) while `OK accounting-strays` still runs — neither class masks the other. Stranded stray row → `ERROR accounting-strays … not refunded or exception`; exception row without receipt → OK (T1 defined end); exception row with receipt → ERROR; stray receipt without row → ERROR; smuggled `leaf:9` → `ERROR … neither a result obligation nor a stray deposit`. Rows[0]-amount bump (stray first, real ledger order) → `ERROR accounting-strays refused: stray deposit:…:4608182819 amount`; `leaf:0` bump → `ERROR accounting refused: row leaf:0 amount` — both match cli-auction R1's `/ERROR.*(amount|total|ledger)/`. Clean stray-ok and a cold copy → OK accounting + OK accounting-strays, exit 0 (default tle mode too). | 2e6b650 |

Final sweep at 2e6b650 (all exit 0 / HTTP 200): verify canonical, verify `--offline`, verify legacy p3, verify legacy p2 cold copy, operator view, receipt show, `benzo api serve` `/auction` + `/operator`. `npm run build:cli` and `npm run typecheck` pass at every commit. Full logs under `tmp/proof-logs/` (gitignored scratch).

`docs/evidence/phase-4` holds only Track A's `verify.sh` — **no Track A public dir exists yet to cold-copy** (checked `find docs/evidence/phase-4` at 2e6b650). The exact `verify.sh` R invocation shape (`bin/benzo verify --dir <ev>/cli --signer <doc.signer>`) was proven against `tmp/canon-p3`. Ready for Track A's evidence run after merge.

States: TODO · IN PROGRESS · READY FOR MERGE · BLOCKED (outside cause, with repro).

### Public auction directory contract (canonical, per schemas/public-auction.schema.json)

- **Source of truth is `auction.json`** (version, auction_id, signer, manifest packet, state, receipts; optional frozen, result, settlement, opened, beacon). Read per the schema: key set, version 1, state enum, signed-manifest binding, `opened`+`beacon` required from OPENED onward. `signer.json`, `opened.json`, `summary.json` etc. load **only when `auction.json` is absent** (legacy fallback for the Phase 2/3 evidence dirs and their cold copies) and `benzo verify` prints a WARN.
- Canonical dirs must carry `manifest.json`, `frozen.json`, `result.json` **byte-identical** to the document (schema description); each is cross-checked in its own check (`manifest`/`freeze`/`clear`). Other projection files are ignored in canonical mode.
- The trust anchor is the `--signer HEX` flag (R20b); the document's own signer claim must match it.
- Settlement receipts stay the six T2 fields. Ledger rows use `party` = `leaf:N`, `seller`, or `deposit:<txid>:<diversifier-index>` (settle/plan.ts shapes); anything else is refused.

### Commands (Track B)

Each module in `cli/commands/` exports `{ noun, verb, help, run }`; `run(argv)` returns a number (R17 contract; router `cli/benzo.ts`).

```
benzo verify --dir PUBLIC --signer HEX [--offline]        # exit 0 ok, 1 ERROR lines on stderr, 2 usage
benzo receipt show --dir PUBLIC --ciphertext-hash HEX [--receipt signed.json]
benzo operator view --dir PUBLIC
benzo api serve --dir PUBLIC [--host 127.0.0.1] [--port 8787]
node api/dist/server.mjs --dir PUBLIC [--host 127.0.0.1] [--port 8787]   # same server, e2e S1 spawn form
```

Default verify re-derives every opening with `$BNZ_STATE_DIR/bin/tle -d` against drand quicknet (chain hash from the published beacon, bound to the manifest `R`/`chain_hash`; bad-MAC decrypts classify `undecryptable` exactly like `clear/auction-cli.ts`), then reproduces `clear/`. ERROR lines carry check ids `manifest`, `freeze`, `receipts`, `clear`, `accounting`, `accounting-strays` — `ERROR freeze …` for anything root/witness/projection-frozen, `… amount …` wording for amount corruptions, matching cli-auction R1's regexes.

## Deviations
- `benzo operator view` also moved from positional to `--dir PUBLIC` (R20b names only verify and receipt show; R20's rule says "Use flags, not positional arguments"). Nothing in the tree called the positional form (e2e and verify.sh use the API route and verify/receipt). Flagged under Questions.

## Environment changes
- Carried from earlier runs: `npm ci`; pinned `tle` v1.2.0 in `$BNZ_STATE_DIR/bin/tle`; Playwright Chromium. This run added none. The Phase 3 beacon was fetched read-only from `BNZ_DRAND_URLS` (public drand API) for the proof corpus.

## Deferred
- Full JSON-Schema validation of `auction.json` (hand checks cover the schema's key set and every field the checks consume; no validator dependency in budget).

## Questions

1. **User instruction (2026-10-01, this thread), verbatim:** "You are Builder B on the Benzo worktree /Users/akshmnd/Dev Projects/benzo-b, branch track-b. AGENTS.md is your operating manual. Read it, docs/STATUS-B.md and docs/PHASE-4.md (Rulings R15–R20) first. You run headless and non-interactive. Nobody will answer questions mid-run and background monitors never report back. Run every build and check in the foreground, wait for it, read the output and keep working. Do not end your run until the work below is committed, or you have written BLOCKED with a reason in docs/STATUS-B.md. State you inherit: a previous Builder B run wrote R16/R18 code and died before verifying or committing it. These files are uncommitted in your tree: api/public-auction.ts, api/server.ts, cli/commands/verify.ts, new cli/commands/api.ts. The head has merged the latest main, which brings Track A's schemas/public-auction.schema.json, its canonical auction.json publishing, and Ruling R20. Its last manual checks showed `benzo verify --offline` rejected as bad usage and `benzo api serve` reported as an unknown command, so treat that code as unverified. Do, in order: 1. Review the uncommitted diff (`git diff`, plus cli/commands/api.ts). Finish R16 (verify re-derives openings from the published beacon, `--offline` skips network fetches) and R18 (`benzo api serve` wired through the router per the R17 contract). Build and typecheck, prove each with a logged manual run, commit. 2. R20: a. Read the canonical auction.json per the schema. Legacy projections are a fallback only for the Phase 2/3 evidence dirs. b. Flag interface: `benzo verify --dir PUBLIC --signer HEX [--offline]` and `benzo receipt show --dir PUBLIC --ciphertext-hash HEX`. c. Accounting bug: stray-deposit parties must never cause the result's obligations to be skipped. Check both classes independently. Prove each with logged manual runs, including a cold copy of a public dir Track A published under docs/evidence/phase-4 if one exists. Commit each verified step. 3. Update docs/STATUS-B.md with the commands run and their output, then set READY FOR MERGE or BLOCKED. Add no tests. Touch only Track B files. Never touch /Users/akshmnd/Dev Projects/benzo, funds or keys. Do not merge, rebase or cherry-pick." — followed; commits made in that order (R16/R18 kept the inherited positional interface in 971da62, then R20b switched to flags in 53a7355).
2. **Line budget:** Track B hand-written code is 626 lines (`api/public-auction.ts` 303, `api/server.ts` 101, `cli/commands/{verify,operator,receipt,api}.ts` 222) vs R12's ≈400. The overage is the R16/R18/R20 scope that arrived after the split: beacon binding, canonical-schema reading, projection cross-checks, the two-class accounting, and the `api serve` module. Trimming would weaken checks; please extend the Track B budget (R10's +200 or a new Ruling) or tell me what to drop.
3. **Load-time shape choices (confirm or rule):** `loadPublicAuction` requires `frozen` and `result` (clear error `missing frozen`/`missing result`) even though the schema marks them optional, because every Track B reader targets a post-freeze public dir (gate R inputs). The schema's opened+beacon rule is enforced exactly as written (OPENED/CLEARED/SETTLED only, so SETTLING is not forced). `GET /auction/:id` runs the same checks as `benzo verify`: manifest failure → HTTP 400 (the cli-auction S1 flip case), any other failure → 200 with `valid:false`, all pass → `valid:true`.
4. **`operator view` flags:** moved to `--dir PUBLIC` per R20's "use flags, not positional arguments" (R20b text names only verify and receipt show). Revert if Track A expects a positional there.

## Test audit (R11: Track B adds none)
No new specs. Proof is the logged manual runs above (scratch only in `tmp/`, never committed). The R20c corpus shows the pre-fix masking failure mode explicitly: with any `deposit:` receipt present, the old `resultBound` gate skipped every result obligation; `tmp/proof-logs/r20c-stray-missing-obligation.out` shows it now refused.

## Last session
- **Window:** after the 2026-10-01T15:25:00Z handoff; finished 2026-10-01T18:39:00Z (start time not recorded).
- **Outcome:** Inherited uncommitted R16/R18 code verified and committed, then R20a/b/c each proven and committed. The head's two failing checks now work: `bin/benzo verify --dir PUBLIC --signer HEX --offline` (WARN + OK) and `bin/benzo api serve --dir PUBLIC` (five routes on 127.0.0.1). Canonical `auction.json` reading with byte-identical projection checks; flag interface exactly as R20b; accounting split into `accounting` (result obligations) and `accounting-strays` (T1 ends) with neither masking the other. No Track A public dir under `docs/evidence/phase-4` yet (only verify.sh) — proven against real Phase 2/3 evidence and a publish()-shaped canonical assembly instead.
