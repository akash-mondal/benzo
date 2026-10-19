# Release-candidate live walkthrough at `ca34e2a` (hosts provisioned at `bd18eb6`), 2026-10-19

`tools/doc-walk.sh` ran one uniform auction on testnet using only the three guides' commands: 3 bids, 4 obligation rows, one custody batch. It ended `RESULT PASS`. Then `benzo settle` was run again three times after the batch was 10 deep (`settle-again.out`):

- **Run 1:** planned the reserve return from the live `benzo-pczt quote-sweep` (B52), as batch 2. The hosts approved it; it was broadcast, mined and receipted.
- **Runs 2 and 3:** no change (idempotent).

Published accounting (`public/summary.json`):
- `reserve_return {remaining_zats: 35000, fee_zats: 10000}`;
- batch 2's own `inspect`: 1 input, 2 actions (Orchard-style padding), fee 10,000, so 25,000 zats were returned to the committed address.

`benzo verify` on a cold copy: exit 0, 19 OK.

Leak audit: `npm run leak-audit -- --sensitive <this auction's three owner keys, the vault UFVK and keys.json group_key> --paths` this dir.
- No owner key and no UFVK match.
- The 31 `address` hits are the published deposit and escrow addresses (public by design).
- The 5 `group_key` hits are the FROST group verifying key, which `benzo vault create` prints (a public key with no spend or view power).

Paths in the transcript are relative.

This run is before B54 (the dust rule). The release walkthrough is repeated after B54, with a dust note and a just-received note at vault addresses (R119).
