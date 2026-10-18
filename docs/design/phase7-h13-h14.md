# Phase 7 batch B43: one offline opener (H14 open griefing, H13 settlement scale)

Head design, 2026-10-18. Source rows: `docs/design/phase7-hardening.md` H13 (P1 scale) and H14 (P1 liveness). Both live in the same code: how a sealed bid is turned into its plaintext. Builders implement and prove; the head merges, rebuilds the verify bundle and runs the live re-measure (scale-55).

## The problems, measured

- **H14.** Admission checks only the header's one `-> tlock R <chain>` line (`settle/envelopes.ts:64`). A probe (`tmp/h14-probe.ts` in `../benzo-b39`, now gone with the worktree; re-create it in your repro) found:
  - A **malformed stanza body** passes admission, but the open THROWS (`Expected mac, but there were no more lines left!`). That stops the open for every bidder.
  - A **payload cut to 3 bytes** passes admission, and tlock-js returns an EMPTY plaintext, where Go `tle` said MAC failure.
  - For a 128-byte bid the honest structure is fixed: version `age-encryption.org/v1`; one stanza `tlock <R> <chain>` with a 128-byte body (`readAge` from `tlock-js/age/age-reader-writer.js`, pinned 0.9.0; check the exact body length on a real ciphertext and state it); a 32-byte header MAC; a payload of exactly 16 + 128 + 16 = 160 bytes.
- **H13.** Every host `sign build`, `sign approve` and `sign derivable` call goes through `deriveRows` (`cli/host-derive.ts`), which:
  1. runs a full `benzo verify` subprocess (it re-derives every opening);
  2. opens every frozen leaf with Go `tle` (`tleDecryptFailover`, a network call per leaf, `:86-89`);
  3. opens each stray memo with `tle` again (`memoOwner` `:183-187`, and `authenticatedMemoEnvelope(…, tle)`).

  The coordinator's plan does the same (`settle/plan.ts` `tleOpening`/`tleDecryptFailover`). Measured live, the batch time grows with N (scale-55: 100 s per batch).

## Design

1. **One sealed-bid shape rule.** `sealedBidShape(ciphertextHex, R)` returns `ok` or the reason. It is built on `readAge` and enforces the exact structure above. Put it in one module (for example `envelope/opening.ts`).
   - Call it at **admission only**: `bid seal` (the bidder's own self-check) and `bid deposit` admit (`clear/auction-cli.ts`, where `memoTlockCiphertext` is called today). Refuse with `sealed bid structure: <reason>`.
   - Do **not** add it inside `memoTlockCiphertext` or anything verify uses on old directories. Old published dirs must keep verifying unchanged, and the folds that replay them must stay green.
2. **One opener.** `openSealedBid(ciphertextHex, client)` returns plaintext hex, or `null` when the bid is undecryptable:
   - `null` when `sealedBidShape` fails;
   - `null` on the two MAC failures (the `decryptPublished` contract);
   - `null` when the plaintext is not exactly 128 bytes (this closes the empty-plaintext quirk).

   It throws only for errors that do not depend on the leaf (an unverified client, a round other than the beacon's), so beacon problems still stop the caller. Every path that turns a sealed bid into a plaintext uses it: `open` (`clear/auction-cli.ts`, replacing B39's loop), verify's re-derivation (`cli/published-beacon.ts` and its callers), `deriveRows` leaves, `memoOwner`, `authenticatedMemoEnvelope`, and `settle/plan.ts`. **No product path spawns `tle` after this batch.** Keep `tleDecryptFailover` only if a test still needs it, and say which.
3. **The beacon on hosts and in the plan.** Use the published beacon (`pub.beacon`, BLS-checked by `publishedClient`). An auction with no published beacon (cancelled before open) needs it after R for strays. In that case fetch it with B39's failover-plus-verify loop, moved into one shared `fetchVerifiedBeacon(R)` that `open` also uses.
4. **Host openings cache (H13).** After a successful open, the host writes `$st/auctions/<id>/openings.json`: `{frozen_root, beacon_sha256, openings: {leaf_index: plaintext|null}}`, with mode 0600. `beacon_sha256` = sha256(beacon signature). Rules:
   - It is reused only when both keys equal this packet's frozen root and beacon. Otherwise it is rebuilt.
   - It is a cache of this host's own computation, never packet input.
   - Memo openings are cached the same way in `memo-openings.json`, keyed by sha256(ciphertext), since strays are per note.
5. **The per-batch `verify` subprocess.** Measure first: time `benzo verify` on a 55-leaf and on a 1,000-leaf offline fixture (the `tools/bench.ts` machinery). If verify on 1,000 leaves takes under 5 s, keep it as it is and report the numbers. If it takes longer, add a host-only `--openings-cache FILE` to verify:
   - The file must live under `BNZ_STATE_DIR` and be the host's own `openings.json`, with matching root and beacon.
   - Verify then skips re-decrypting leaves the cache covers and still checks everything else.
   - `deriveRows` passes it. The public `benzo verify` never uses it, and its help says so.
6. **Same answers.** For every existing fixture and fold, the openings must be byte-identical to today's.

## Proof

- `tools/repro/h14-open-griefing.ts`. **Red before** (base commit): a malformed-body ciphertext and a 3-byte-payload ciphertext are admitted, and the open throws on the first. **Green after**: both are refused at admission. A frozen fixture built directly with those leaves (bypassing admission, as `h-fixtures.ts` does) opens with them `undecryptable`, `benzo verify` agrees, and host `deriveRows` agrees. Honest leaves open byte-identically.
- `tools/repro/h13-host-scale.ts`, offline. Using the `tools/bench.ts` fixture machinery with N = 55 and N = 1,000, time `deriveRows` (or `sign derivable`, which uses it) for the first and the second batch, before and after. The second batch after must not re-decrypt anything: count `openSealedBid` calls. Report the numbers.
- `npm run typecheck`, `check:structure`, `check:invariants`, `npm run e2e`, and every `tools/repro` fold touching open, verify, host derive or plan (list what you ran). The B39 H11 repro must stay green.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b43 -b b43-opener <HEAD>`.
- Offline only: no `.benzo/` of the main checkout, `.env`, OrbStack/`orb`, testnet or wallets. Fetching a past quicknet beacon once from drand is allowed, as `h-fixtures.ts` does.
- `check:bundle` cannot pass in a worktree (R32): commit with `--no-verify`.
- Plain English comments; no mid-line `//` after code in scripted edits.
- Commits: `B43: H14 …`, `B43: H13 …`. Put red/green outputs under `docs/evidence/phase-7/repro/` and a status block in `docs/STATUS-B.md`. Put Questions there if anything here is wrong.
