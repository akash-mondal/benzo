# Phase 7 batch B48: Reviewer R's three P3s (H18)

Head design, 2026-10-19. Source: `benzo-sol/reports/pr-p7-b39-b43.md` P3s, `phase7-hardening.md` H18. Each item is small. Keep each fix minimal and give it its own proof.

1. **A seller-commitment mismatch refuses only the seller row** (`cli/host-derive.ts` sellerBinding and its callers `sign build`/`approve`/`derivable`). Today a mismatched packet `seller_ua` refuses the **whole** packet, even when the batch has no seller row, so an inconsistent config stalls bidder refunds. Change it so that:
   - a batch **without** a seller row ignores `seller_ua`;
   - a batch **with** one refuses exactly that row (typed, exit 3, `refused-rows ["seller"]`, as today).

   Proof: a mismatched `seller_ua` packet whose batch has no seller row builds and approves its refund rows. The same packet with the seller row is refused for that row only.
2. **`seller check` requires a signed manifest** (`cli/commands/seller.ts`). Refuse a raw (unsigned) manifest object with one ERROR line saying to pass the published `manifest.json`. With `--signer HEX`, the packet must be signed by exactly that key (already true; keep it). Proof: a raw object is refused, a signed packet passes, and the wrong `--signer` is refused.
3. **`verify --openings-cache` refuses any file but the host's own cache** (`cli/commands/verify.ts`). Refuse unless the resolved path is exactly `$BNZ_STATE_DIR/auctions/<the dir's auction id>/openings.json`. Proof: a cache copied elsewhere is refused, and the host's own cache works as today.

Rules: work in your own worktree (`git worktree add ../benzo-b48 -b b48-p3s <HEAD>` in `/Users/akshmnd/Dev Projects/benzo`); offline only; do not override the git identity; commit `--no-verify` (R32); commit early. Run `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, the h10 fold, the h13 fold and the b47 settle e2e. Outputs go under `docs/evidence/phase-7/repro/`, plus a status block in `docs/STATUS-B.md` and Questions there.
