# Release-candidate walkthrough with a dust note (B54, live)

- Auction `2a7367c5bbf1daf112af7885b79eb925d1ca250411a5d9d3626a29adebbb5cfe`, Zcash testnet.
- Hosts provisioned at `8749545` (`deploy/signers/manifest.json`, 3 isolation proofs OK).
- Run with `BNZ_WALK_DUST=1 tools/doc-walk.sh`, using only the three guides' commands, plus one non-guide step: a stray 4,000-zat note sent to the fee-reserve address (dust txid `ccd1f775…fb9b5`, `transcript.out` line 64).

**What happened**
1. The first pass stopped at `open`: the script's drand wait ended early on a relay timeout, and `open` correctly refused before R. The script was fixed at `ac0d0d2` and resumed at step 7.4 (`BNZ_WALK_RESUME_ID`). The transcript records the resume line.
2. The walkthrough passed: `RESULT PASS gate DOC walkthrough`. The first settle paid 5 rows. The reserve return waited for the 10-deep paid gate (`public/`: no return receipt, no accounting).
3. `benzo settle` was run again 20 minutes later (`settle-again.out`). It broadcast the return `3ae1da81…1cec`, and the auction is SETTLED.

**The published accounting** (`public-after-return/auction.json`):
`reserve_return {remaining_zats: 35000, fee_zats: 10000, dust_notes: 1, dust_zats: 4000}`.
- One `reserve-return` receipt of 25,000 zats, which is 35,000 − 10,000. The row is `paid`.
- The 4,000-zat dust note stays in the vault and is reported as the residue.
- Before B54 this vault would have parked the return forever, because the swept total counted the dust.

**Verify:** `benzo-verify.mjs` on a cold copy of `public-after-return/` exits 0 with 19 OK lines.

**Leak audit**
- No private key found: the 3 bid owner keys and the vault viewing key, built privately and never written here.
- 37 address findings, all public: the manifest's deposit addresses in `auction.json` and `frozen.json`, and the operator's own fee-reserve address that `auction addresses` printed in the transcript.
- The seller and return addresses appear 0 times; they are redacted.
