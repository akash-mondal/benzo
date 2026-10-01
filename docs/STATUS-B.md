# Status: Builder B (Track B) handoff

<!-- Only Builder B writes this file, on branch track-b. Same rules as docs/STATUS.md: outcome first, back every claim
with a command and its result or mark it `unverified`, replace stale lines. Rulings live in the phase doc only. -->

## Phase 4, Track B ([docs/PHASE-4.md](PHASE-4.md) R11–R14): READY FOR MERGE

Updated: 2026-10-01T15:20:00Z · Last commit: (this commit)

- **Questions for the head agent:** see below (shared config files, public-dir contract, CLI router shape).
- **Blockers:** none
- **Scope delivered:** gate R (`benzo verify`), gate S (`api/` read-only JSON), `benzo operator view`, `benzo receipt show`. No tests added (R11). No testnet, wallets, keys, or broadcasts.

| Item | State | Evidence (command, output path) | Commit |
|---|---|---|---|
| R: `benzo verify` (public inputs only, cold copy) | READY FOR MERGE | `node tmp/benzo.mjs verify tmp/cold-p3/public` (cold copy of Phase 3 public dir) → `OK manifest/freeze/receipts/clear/accounting`, exit 0. Corrupted `payment_zats` → `ERROR clear refused: canonical result differs` + `ERROR accounting refused: allocation 0 does not account C`, exit 1. Corrupted freeze root (Phase 2) → `ERROR freeze refused: freeze root`, exit 1. Corrupted manifest byte → `ERROR verify refused: manifest byte hash`, exit 1. Also green on `docs/evidence/phase-2/auction` and `tmp/p3-public` (Phase 3 settle/main + real `summary.json`). | this commit |
| S: read-only JSON API (`api/`) | READY FOR MERGE | `node tmp/api.mjs --dir tmp/p3-public --port 8788` then curl all five routes. `GET /auction/:id` `valid:true`; `GET /operator` keys `[C_zats,auction_id,blobs,count,total_collateral_zats]` only (no price/quantity/plaintext); `GET /result` matches `result.json`; `GET /freeze` root `e36ba607…`; `GET /receipt/:ciphertext_hash` T2 settlement shape. Flipped manifest byte → HTTP 400 `{"valid":false,"error":"refused: manifest byte hash"}`. Binds `127.0.0.1`. | this commit |
| `benzo operator view` | READY FOR MERGE | `node tmp/benzo.mjs operator view tmp/cold-p3/public` → `{auction_id, C_zats:"500000", count, total_collateral_zats, blobs:[{leaf_index,ciphertext_hash,ciphertext_hex}]}`. Asserted no `price/quantity/plaintext/payment/refund/outcome` fields. | this commit |
| `benzo receipt show` | READY FOR MERGE | `node tmp/benzo.mjs receipt show tmp/p3-public <ciphertext_hash>` → inclusion (auction_id, manifest_hash, ciphertext_hash, deposit, leaf_index, included:true) + settlement `{auction_id,party:"leaf:0",txid,pool,output_index,amount_zats}` (Phase 3 real receipt). `--receipt <signed.json>` also sets `receipt_signed:true`. Phase 2 without settlement → `settlement: null`. | this commit |

States: TODO · IN PROGRESS · READY FOR MERGE · BLOCKED (outside cause, with repro).

### Public auction directory contract (working, until `schemas/public-auction.schema.json` lands)

Read-only files used by `benzo verify`, `operator view`, `receipt show` and the API:

- `manifest.json` — signed manifest packet (`bytes`, `sha256`, `signer`, `signature`)
- `signer.json` — `{signer}` Ed25519 SPKI DER hex (trust anchor)
- `frozen.json` — freeze board (root, witnesses `paths`, leaves with `ciphertext_hex`)
- `opened.json` — post-R public openings `[{leaf_index, plaintext_hex}]` (needed to reproduce clear offline)
- `result.json` — canonical `clear/` output
- optional `receipts.json` — signed inclusion receipts
- optional `summary.json` — settlement `{rows, receipts}`; receipt objects must be exactly `{auction_id, party, txid, pool, output_index, amount_zats}` (T2)

Built against Phase 2 `docs/evidence/phase-2/auction/` and Phase 3 `docs/evidence/phase-3/settle/main/` (+ `settle/signer.json`, opened derived with pinned `tle` into `tmp/` scratch only).

### Commands (Track B modules)

Each module in `cli/commands/` exports `{ noun, verb, help, run }` with `run(argv: string[]): Promise<number>` (0 ok, 1 ERROR, 2 usage). `verify` uses `verb: ""` (`benzo verify <dir>`). Router `cli/benzo.ts` is Track A (R12). Until it lands, manual runs use scratch `tmp/track-b-cli.ts` bundled to `tmp/benzo.mjs` (gitignored).

API: `node tmp/api.mjs --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787]` (from `api/server.ts`). No `benzo api` verb (not in R12 command list).

## Deviations
none

## Environment changes
- `npm ci` (node_modules was missing). esbuild postinstall blocked by allowScripts; `npx esbuild` still works (0.28.2).
- `go install github.com/drand/tlock/cmd/tle@v1.2.0` (pin `TLE_TAG`) into `$BNZ_STATE_DIR/bin/tle` so scratch Phase 3 openings could be derived from ciphertexts. Not used inside `benzo verify` itself (verify is public-input-only and offline).
- `npx playwright install chromium` for the default e2e regression attempt.

## Deferred
- Wire `cli/benzo.ts` load of Track B modules once Track A lands the router (Track A).
- Adapt file names/shape to `schemas/public-auction.schema.json` when Track A commits it (R12).

## Last session
- **Window:** 2026-10-01T14:30:00Z to 2026-10-01T15:20:00Z
- **Outcome:** All four Track B items READY FOR MERGE against Phase 2/3 public artifacts. Gate R: cold-copy verify exit 0 on clean dirs, exit 1 with `ERROR` lines on corrupted amount, root, and manifest byte. Gate S: five read-only JSON routes on `127.0.0.1`, no plaintext in `/operator`, `/result` matches `result.json`, flipped manifest refused. `operator view` is N×C + opaque blobs only. `receipt show` returns inclusion + T2 settlement receipt. ~390 hand-written lines under `api/` + `cli/commands/` (Track B budget ≈400). No automated tests (R11).
- **Regression:** `npm run e2e` PASS (`PASSED default seal in the browser, open with tle after R (41 s)` in `tmp/e2e/report.json`). No testnet spend.

## Questions

1. **Shared config (R12 does not assign these to Track B):** `tsconfig.json` `include` does not list `api` or `cli`, so `npm run typecheck` skips Track B sources (verified with `npx tsc -p tmp/tsconfig.track-b.json` exit 0). `.gitignore` has `manifest/dist/`, `clear/dist/`, `settle/dist/` but not `api/dist/` or `cli/dist/`. Please add `api` and `cli` to typecheck include and ignore their `dist/` outputs (or grant Track B those two files).
2. **Public dir schema:** Track B treats `opened.json` (post-R public plaintexts) as part of the public auction dir so `benzo verify` can reproduce `clear/` offline from a cold copy without `tle` or network. Confirm `schemas/public-auction.schema.json` includes it; if the schema omits openings, verify must open ciphertexts with `tle` (then a cold copy is not offline).
3. **CLI router shape:** Track B modules export `{ noun, verb, help, run }` and `run(argv: string[]): Promise<number>`. `benzo verify` is `verb: ""`. Confirm `cli/benzo.ts` (Track A) uses this shape so the three modules load unchanged.
4. **API entry:** `api/server.ts` is started standalone (`--dir`, `--host`, `--port`); R12’s command list has no API verb. Confirm no `benzo api serve` wrapper is required on Track B.

## Test audit (R11: Track B adds none)
No new specs. Proof is the logged manual runs above (scratch only in `tmp/`, never committed).
