# Phase 1 evidence

All gates are **READY FOR REVIEW**; only the head agent records PASSED. One clean-tree `BNZ_EVIDENCE_DIR=docs/evidence/phase-1 npm run e2e:live` at **512296f** ran 2026-09-30 19:05:50–19:16:03 UTC, exited 0 and passed all 16 assertion IDs. Generated artifacts are committed in **1a94638**; [run.json](run.json) records results, versions and hashes. Setup at b0019e1 reused the existing dealerless DKG keys and wrote [group-key.txt](setup/group-key.txt), committed in e34f95c.

| Gate | Claim | State | Evidence |
|---|---|---|---|
| G0 | Pinned tools build | READY FOR REVIEW | [versions.txt](versions.txt); original bootstrap at 23f660a, evidence d995df0; setup's bootstrap at b0019e1 also exited 0 |
| A | 2-of-3 FROST spends received Ironwood notes | READY FOR REVIEW | [group key](setup/group-key.txt), [refund](frost/refund.json), [sessions](frost/coordinator.txt), [settlement](frost/settle.json), [PCZT summaries](frost/pczt-inspect.txt) |
| B | Exact 512-byte memos survive mining and vault scanning | READY FOR REVIEW | [deposits](memo/deposits.json), [hashes](memo/sha256sums.txt), `memo/bid{1,2}.{sent,scanned}.hex` |
| C | Browser seal stays closed before R and opens through Go tle after R | READY FOR REVIEW | [before](tlock/before.txt), [after](tlock/after.txt), [beacon](tlock/beacon-R.json), [network events](tlock/requests.jsonl), `tlock/bid{1,2}.{ct,pt}.hex` |
| D | Fixed-C deposits map to the paid per-bid addresses | READY FOR REVIEW | [addresses](scan/addresses.json), [operator view](scan/operator-view.jsonl) |

Decisions:

- **binary_memo:** B1 passed through devtool ZIP-321 payments; each ciphertext is 487 bytes, the envelope uses 494 bytes before padding to 512.
- **frost_2of3:** A1–A5 passed before the cut-off. Refund `f408b439…494c02` mined at 4423194 on both endpoints, spent both new 500,000-zat deposits plus M7's retained 990,000-zat note, and used three two-participant signing sessions. Bidder total rose by 1,975,000 zats; vault total became 0.
- **tlock-js@0.9.0:** C1–C7 passed against mainnet quicknet and official Go tle.

[verify.sh](verify.sh) exited 0 on this evidence at 19:17 UTC: both endpoints, transaction headers/branch IDs, signatures, UFVK group-key binding, independently decrypted memos, tle plaintexts and file hashes passed. Its required corrupted-copy check exited 1 with `ERROR A` from chain re-fetch and `ERROR B` from memo re-derivation. Logs: `tmp/e2e/verify-{positive,negative}.log`; exact failure lines are in STATUS. [Mutations](mutations/) M1–M7 each produced their required failures; both tests retain audit mark R.

Limitations: all three signer shares and the coordinator ran on one machine; endpoints are public; drand threshold trust is assumed. This proves testnet interoperability of the reference path. Independent custody, production security and a complete auction are unverified. Owner keys and settlement commitments are random Phase 1 placeholders. No consumer-wallet result was reported.
