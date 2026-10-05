# Ruling R28 live proof (auction 29fb6483…, NU7 testnet, host custody, hosts on the R28 build)

`e2e/buyback-mode.spec.ts` `results.json` has 13 of 14 IDs PASS, including every honest-path check and the attacks below.

| Check | Fix | Attack | Refusal |
|---|---|---|---|
| W3 | F3 | every real row paid, plus the remainder to a deposit address disguised as change | `output has no user address and is not owned change` |
| W4 | F1/G-1 | manifest re-signed by a foreign key | `manifest is not signed by this host's pinned operator key` |
| W5 | G-3 | frozen root stripped, state set to REFUNDING | `packet lacks the frozen root this host pinned for the auction` |
| W6 | F2 | after settlement, a new candidate paying leaf 0's real row again | `deposit:e1dfd882…:ironwood:1 already paid by mined batch 1` (alice and carol) |

- W2 (substituted recipient) also passes.
- W6 inside the spec run errored before attacking: the vault's leftover reserve was still unconfirmed change, giving InsufficientFunds (fixed in d9f568c). The same attack was then run standalone on this settled auction with `tools/repro/r28-replay.ts` (`w6-replay.out`). The refusal reasons above were re-read from alice's packets after the run.
