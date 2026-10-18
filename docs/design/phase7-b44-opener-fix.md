# Phase 7 batch B44: the opener never throws on a leaf or memo (Reviewer R P1-1, P1-2 on B43)

Head design, 2026-10-19. Source: Reviewer R, `benzo-sol/reports/pr-p7-b39-b43.md` (REQUEST CHANGES). The head reproduced both P1s on main `6a5c45a` (`tmp/r100/probe.ts`):

| Ciphertext | `sealedBidShape(·, R)` | `openSealedBid` today |
|---|---|---|
| honest | ok | plaintext |
| stanza body = 128 bytes of junk (base64 of `0x5a…`) | **ok** | **THROW** `invalid G2 point: expected 96/192 bytes` |
| stanza round R+1 (a stray memo needs no admission) | fails | **THROW** `refused: ciphertext beacon round` (from `client.get` before the shape check, `envelope/opening.ts:99-100`) |

One admitted junk-body bid stops `open`, `verify`, `deriveRows`, `sign delivery` and `xchain attest` for everyone. One dust deposit carrying a wrong-round memo kills the plan and every host's derivation. B43's contract was "throws only for problems that are not the leaf's". The code throws for both of these.

## Rule (the one contract)

Every caller of `openSealedBid` passes a client built from **this auction's verified beacon** (`publishedClient` BLS-checks it at construction, and that is where a bad beacon throws). Given such a client, **everything about the ciphertext is the ciphertext's fault**. So `openSealedBid(ciphertextHex, client)`:
1. reads the beacon round from the client itself (`client.latest()`, or `get` of the one round it serves) and never calls `client.get` with a round taken from the ciphertext;
2. runs `sealedBidShape(ciphertextHex, beaconRound)` and returns `null` if it fails (wrong round included);
3. decrypts, and returns `null` for **any** exception from the tlock/age/IBE layers (MAC failures, `invalid G2 point`, `rP check failed`, parse errors), and `null` for a plaintext that is not 128 bytes;
4. throws only when the client itself is unusable (no beacon round). This is checked before step 2 and cannot be caused by the ciphertext.

Open, verify, host derivation, the plan, `memoOwner`, `bidPlaintextFor`, `claim-refund`, `sign delivery` and `xchain` all use it unchanged, so they classify identically by construction. Keep `decryptPublished`'s raw contract for the sealed-reserve path only. For the reserve: a manifest's own `sealed_reserve` failing to open is an operator fault and may still stop the open. Say so in a comment.

## Admission: catch the junk body early (the bidder sees it)

Extend `sealedBidShape` with one more structural check: the stanza body's first 96 bytes must decode as a valid compressed BLS12-381 G2 point (`@noble/curves` `bls12_381.G2.ProjectivePoint.fromHex`, already a dependency through `cli/published-beacon.ts`). The other 32 bytes (V, W) cannot be checked before R; a forgery there opens as `undecryptable` by rule step 3. Admission-only, as today: it is never inside verify's old-dir path. Old evidence was sealed honestly, so it keeps verifying; prove that on the dirs the B43 folds replay.

## Proof (offline)

Extend `tools/repro/h14-open-griefing.ts`, or add `tools/repro/b44-opener.ts`. **Red** on main `6a5c45a`, **green** after, for each of:
- (a) junk 128-byte stanza body. Now refused at admission. Built directly into a frozen fixture, it opens `{error:"undecryptable"}`, and verify plus host `deriveRows` agree.
- (b) a valid G2 point with junk V/W. Passes admission, opens `undecryptable`, all paths agree, nothing throws.
- (c) a stray deposit whose memo is a wrong-round sealed bid, and another whose memo body is junk, in a cleared fixture and in a cancelled fixture. The plan and `deriveRows` complete. The stray rows derive their owner key as null, which means claim-only, as today's null path does. Nothing throws.
- (d) `claim-refund` against such a memo refuses that claim cleanly, with a normal ERROR line, not an uncaught throw.
- (e) honest leaves byte-identical to main.

The B43 folds (h11, h13, h14, r77, r78, r81, r82, r73, r40-f5) stay green. `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b44 -b b44-opener-fix 6a5c45a`.
- Offline only: no main `.benzo/`, `.env`, OrbStack/`orb`, testnet or wallets. Fetching a past quicknet beacon, as `h-fixtures.ts` does, is fine.
- Commit early. Final commit `B44: the opener never throws on a leaf or memo (R P1-1, P1-2)`, made `--no-verify` (R32), and authored as the repository's configured user (do not override `user.name`/`user.email`).
- No mid-line `//` after code in scripted edits.
- Red/green outputs go under `docs/evidence/phase-7/repro/`, plus a status block in `docs/STATUS-B.md`, with Questions if anything here is wrong.
