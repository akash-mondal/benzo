# Phase 7 batch B39: H10 (seller payout bound by the manifest) and H11 (open without per-leaf relay calls)

Head design, 2026-10-18. Source rows: `docs/design/phase7-hardening.md` H10 (P1) and H11 (P2). Builders implement and prove; the head reviews, merges, rebuilds the verify bundle and runs the live proof.

## H10 — the seller payout address is committed in the signed manifest

**Problem.** The seller payout's address reaches the signer hosts only through the coordinator's packet (`packet.json` `seller_ua`, from operator routing: `settle/cli.ts:127,155,202`). Hosts check the payout's amount, not its address (`cli/commands/sign-approve.ts:88-91`, `cli/commands/sign-build.ts:49-50`, `cli/commands/sign-derivable.ts:29`). One malicious coordinator can redirect the seller's proceeds, and the published settlement cannot show it.

**Design.**
1. **New optional signed-manifest field `seller_ua_commitment`**: 64 hex chars, `sha256("benzo-seller-ua-v1\0" || utf8(seller_ua))`. A commitment, not the address, so the manifest stays destination-free (R74 leak rules). Add it to the manifest schema and its canonical bytes in `manifest/schema.ts`, with exact shape checks. Put the commitment function in one shared place (for example `manifest/schema.ts` or `envelope/destination.ts`) and use it everywhere.
2. **`auction create`** (`cli/product.ts`, the manifest builder) sets it from the operator's `routing.seller_ua` whenever that is set, and refuses a `seller_ua` that is not a unified address on the manifest's network with a shielded Orchard/Ironwood receiver (this also closes **H4**: reuse `isUnifiedOn` from `envelope/destination.ts` and add the receiver check).
3. **Signer hosts** (`sign build`, `sign approve`, `sign derivable`): when the manifest has `seller_ua_commitment`, the packet's `seller_ua` must hash to it, or the seller row is refused (a typed refusal like the others in `sign-build.ts`, never a silent pass). When the manifest lacks the field (auctions created before H10), keep today's amount-only behaviour and print one `WARN legacy manifest: seller payout address not bound (H10)` line.
4. **Mainnet**: `auction create` on `network: "main"` refuses to create a manifest without `seller_ua_commitment` for any mode that has a seller obligation.
5. **Verify**: `benzo verify` checks the field's shape when present. It cannot check the address (receipts carry no recipient), and must not try.
6. **README**: replace the "A malicious coordinator can redirect the seller's proceeds" honest-limits bullet with one plain line: the seller address is committed in the signed manifest and each signer host checks it; a seller should check the commitment against their own address before bidding opens (give the one-line command, e.g. `benzo seller check --manifest … --ua …`, if you add it; a tiny read-only command is welcome).

**Proof (offline).**
- `tools/repro/h10-seller-binding.ts`: a fixture auction whose packet carries a different `seller_ua` than the committed one. **Red before** (run against a pristine checkout of the base commit: the host accepts the substituted address) and **green after** (all three host paths refuse it; the honest address passes; a legacy manifest without the field still settles with the WARN).
- Unit-level checks for the commitment function and the schema shape (good, bad length, uppercase hex, extra field).
- `npm run typecheck`, `npm run e2e` (the offline seal suite) and every existing `tools/repro` fold that touches `sign-*` or the manifest schema stay green; list what you ran.

## H11 — `open` decrypts offline from one verified beacon

**Problem.** `clear/auction-cli.ts:113-127` fetches the opening beacon from the first `BNZ_DRAND_URLS` relay only, then runs `tle -d` once per leaf, and each run contacts a relay again. One relay timeout fails the whole open (gate SC scale-55, R85).

**Design.**
1. Fetch the round-R beacon trying every relay in `BNZ_DRAND_URLS` in order, each with the existing time bound; the first answer whose BLS signature verifies wins (`cli/published-beacon.ts` `publishedClient` already verifies it).
2. Decrypt every leaf offline with `decryptPublished(ciphertext_hex, publishedClient(beacon))`, with no `tle` subprocess and no network.
3. **Keep the exact semantics**: a reorged leaf stays `{error:"reorg"}`; only an authenticated-ciphertext failure is `{error:"undecryptable"}`; any other failure (bad beacon, library error) is an error that stops the open, never a bad bid. Read `decryptPublished` to see what it returns for each case and map it exactly; if it cannot tell an authentication failure from another error, make it tell (small, typed change).
4. `ledger.trace` records one `beacon fetch` and one `offline decrypt` operation instead of one `tle -d` per leaf.

**Proof (offline).**
- `tools/repro/h11-open-offline.ts`: open a fixture auction (sealed with real tlock to a past quicknet round, as `tools/bench.ts` does) with `BNZ_DRAND_URLS` set to `http://127.0.0.1:9/,<a fixture server or the published beacon>` so the first relay fails. **Red before**: the base commit's `open` fails. **Green after**: open succeeds, and its `opened` set is byte-identical to the base commit's `open` run with a working relay, including one deliberately undecryptable leaf (`undecryptable`) and one bad-MAC case.
- `benzo verify` on the opened fixture passes (verify already re-derives openings offline, so it is the equivalence check).

## Rules

- Work in your own git worktree: in `/Users/akshmnd/Dev Projects/benzo`, run `git worktree add ../benzo-b39 -b b39-h10-h11 <HEAD>` and work only there. Do not touch the main checkout.
- Offline only: no `.benzo/` of the main checkout, `.env`, OrbStack/`orb`, testnet, wallets or live Playwright runs. Use fixture state under `tmp/` inside your worktree (the R43 rule: a script may delete a state dir only under `tmp/` or `$TMPDIR`).
- `check:bundle` cannot pass in a worktree (R32), so commit with `--no-verify` and say so; run `npm run typecheck` and `npm run check:structure` yourself.
- Plain English comments, no mid-line `//` after code in scripted edits.
- One commit per item (`B39: H10 …`, `B39: H11 …`), red/green outputs under `docs/evidence/phase-7/repro/`, and a short status block at the top of `docs/STATUS-B.md`.
