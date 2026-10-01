# Phase 2 evidence

Gates E–I are **READY FOR REVIEW**. Only the head records PASSED. One clean `BNZ_EVIDENCE_DIR=docs/evidence/phase-2 npm run e2e:live` at **b834747bd297ba9708f2eec89789be0512f8f9cc** ran 2026-10-01T04:11:26.477Z–2026-10-01T04:58:21.648Z and passed all twelve assertion IDs. Generated artifacts were committed separately at **aa4676b2e0fddee20e63d2bb00fb9b724555b234**. [run.json](run.json) records versions, results and hashes.

| Gate | State | Evidence |
|---|---|---|
| E | READY FOR REVIEW | `auction/manifest.json`, `signer.json`; E1/E2 |
| F | READY FOR REVIEW | `auction/receipts.json`, `frozen.json`; F1/F2 |
| G | READY FOR REVIEW | `auction/opened.json`, `clear-input.json`, `result.json`, `vickrey.json`; G1–G3 |
| H | READY FOR REVIEW | `auction/deposits.json`, `bad-amounts.json`, fresh bid memos; H1–H4 |
| I | READY FOR REVIEW | `auction/cancel.json`, `refund.json`, `pczt-inspect.txt`, `signatures.json`; I1 |

- **Freeze:** `merkle_root_v1`, SHA-256(00 || ciphertext SHA-256 bytes || canonical deposit JSON plus newline); parent SHA-256(01 || left || right), duplicate odd sibling, empty SHA-256(02). Ordered leaves commit to ciphertext and deposit; F1/F2 verified receipts and independent paths/non-members.
- **Clearing:** signed mode selects settlement. Uniform-price sorts price descending and leaf index ascending; fully fills upper bands; marginal units floor(supply × quantity / band demand), residual units by ascending leaf index; minimum-fill failure clears all fills; reserve filters low bids. Winners pay the lowest winning price, integer zatoshis. Vickrey pays second price (reserve for a sole bidder), hides maximum-price fields, and is also a deterministic comparison on the same envelopes. G1/G2/G3 verified the live inputs.
- **Receipt:** Ed25519 signature and SHA-256 over canonical newline-terminated JSON fields `auction_id`, `manifest_hash`, `ciphertext_hash`, `deposit` (`txid`, Ironwood pool, address, diversifier index), `leaf_index`. Independent verification uses trusted manifest signer, published root and sibling path; F2 and verify.sh exercised that boundary.

[verify.sh](verify.sh) exited 0 against the recorded evidence. A copy with corrupt manifest hash and leaf hash exited 1 with ERROR E and ERROR F/G. Logs: `tmp/e2e/phase2-verify-{positive,negative}-v2.log`. [N1–N7](mutations/) each made the complete real-network spec fail at its contracted assertion; every run completed a conserving mined refund and reversed its patch. Final run used unchanged production code after the mutations.

Limitations: signer shares/coordinator on one machine; public endpoints; drand threshold trust. Clearing sample is two accepted bids, not 17k; the same-envelope Vickrey sample has tied prices, so distinct first/second prices are unverified. H2 used real C−1 and C+1 notes. This phase uses the inherited single create-max sweep; batch settlement is Phase 3. No consumer-wallet, UI, mainnet or independent-host custody claim.
