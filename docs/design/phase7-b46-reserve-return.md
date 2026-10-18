# Phase 7 batch B46: return the unused fee reserve (H15, mainnet blocker)

Head design, 2026-10-19. Gate DOC (R97) left 35,000 testnet zats of fee-reserve change in the per-auction host-custody vault, and no command can return it. `settle` pays obligation rows only. The old shared-vault sweep cannot sign for a host-custody vault. On mainnet, the operator's unused fee reserve would be stranded in every auction's vault.

## Safety rule first

The vault can also hold **funds that belong to bidders**: stray deposits and late or excess balance notes that owners may still claim (R42; there is no claim deadline). A return step must therefore **never** sweep "everything left". It may spend only:
- the **fee-reserve note(s)**, meaning notes received at `routing.fee_reserve_ua`, the deposit address the manifest-signed config names; and
- **internal change** of this auction's own settlement transactions, meaning notes at the vault's internal (change) addresses, which hosts already recognise (a host refuses change that is not an internal vault address).

A note at any deposit or balance address is never a source of the return. That holds even when nobody has claimed it.

## Design

1. **Commit the return address in the manifest, as H10 does for the seller.** Add an optional manifest field `reserve_return_ua_commitment`: 64 hex chars, `sha256("benzo-reserve-return-ua-v1\0" || utf8(ua))`. Put the function next to `sellerUaCommitment` and use the one function everywhere. `auction create --config` sets the field from `routing.reserve_return_ua`, with H4's rule (a unified address on the manifest's network with an Orchard/Ironwood receiver). Mainnet `auction create` refuses a manifest without it. Add the field to `validateManifest` with exact shape checks, and to the template plus the field table.
2. **One final row, `reserve-return`.** `benzo settle --id ID` plans it as the last batch, alone, and only when:
   - every obligation row of the plan has a published receipt;
   - no batch is pending; and
   - the eligible sources (rule above) sum to more than the ZIP-317 fee of a one-row transaction.

   The row pays sum − fee to `routing.reserve_return_ua`, and its sources are exactly the eligible notes. If the manifest has no commitment (legacy), the row is never planned. Print one line saying the reserve stays in the vault (legacy, H15).
3. **The hosts check it** (`sign build`, `sign approve`, `sign derivable`, through `cli/host-derive.ts`), deriving from their own data:
   - the packet's `reserve_return_ua` hashes to the manifest commitment; otherwise the row is refused, with exit 3 and named rows as for H10;
   - every source is, by the host's own vault scan, a note at the manifest-config `fee_reserve_ua` or an internal change address of this vault;
   - every obligation row has a receipt in the published dir;
   - the single output is to that UA for sum − fee.

   Anything else is a typed refusal. Keep the `cli/host-derive.ts` edits in one new function so they merge cleanly with B45, which is editing the same file for the classify prefetch.
4. **Publish and verify.** The receipt is published like the others, as party `reserve-return`. `benzo verify`'s accounting accepts exactly one `reserve-return` receipt, only after all obligation receipts, and only from eligible sources: its amount must equal the eligible notes minus the fee by the published accounting. The destination itself is never published, only the commitment.
5. **Docs.** Operator guide: a step after settle (`benzo settle` runs it automatically; this is what you will see), plus the routing field in `docs/examples/private-operator.json`. README honest-limits: one line on how leftover fee funds return. Mark H15 closed in `phase7-hardening.md` when it lands.

## Proof (offline)

`tools/repro/b46-reserve-return.ts`, using the B43/B44 fixture machinery (`tools/repro/h-fixtures.ts`), run on a settled fixture auction whose vault holds the reserve change, a stray deposit and an unclaimed late-balance note:
- **red on base** (no row; the change stranded);
- **green:**
  - the plan has exactly one `reserve-return` row, with sources equal to the reserve change only (the stray and the late-balance note are untouched);
  - the hosts approve it;
  - the hosts refuse a packet with a different return UA, a packet that adds the stray as a source, and a return planned before all receipts exist;
  - a legacy manifest plans no row and prints the line;
  - `benzo verify` accepts the published result and refuses a forged second `reserve-return` receipt.

Also: `npm run typecheck`, `check:structure`, `check:invariants`, `check:dist-require`, `npm run e2e`, plus the H10, H13, H14 and B44 folds.

## Rules

- Work only in your own worktree: in `/Users/akshmnd/Dev Projects/benzo`, `git worktree add ../benzo-b46 -b b46-reserve-return <HEAD>`.
- Offline only: no main `.benzo/`, `.env`, OrbStack/`orb`, testnet or wallets. Fixture state goes under `tmp/`.
- Do not override the git identity. Commit `--no-verify` (R32). Commit early.
- No mid-line `//` after code in scripted edits. Plain English comments.
- Outputs go under `docs/evidence/phase-7/repro/`, plus a status block in `docs/STATUS-B.md`, with Questions there for anything wrong here.
