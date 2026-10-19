# H15 live proof: the unused fee reserve returned (testnet, 2026-10-19)

Auction `426b8585…`, uniform, supply 2, bids 600/500/400. Created through `tools/doc-walk.sh` with `routing.reserve_return_ua` set, so the signed manifest commits `reserve_return_ua_commitment`. Hosts provisioned at `7a54fd5` (R107 and R107b included). Transcript: `transcript.out` (addresses shortened). The cold copy of the published dir: `public/`.

| Step | Result |
|---|---|
| Batch 1 (after R107) | four rows paid (`e07e533f…`, mined at 4,516,838); state SETTLED |
| First return attempt | the vault's change was not yet spendable, logged as "the reserve stays in the vault until the next benzo settle" |
| Second settle | crashed (R107b: the gate counted the return itself); fixed |
| Third settle | the return was signed by the hosts and broadcast; the resend failed with "already exists in mempool" (H20 item 1) |
| Chain | **return `46b5a8ac…` mined at 4,516,884: 25,000 zats at the committed return address**; the vault holds only a 0-value note |
| Published | receipt `reserve-return` 25,000 and accounting `{remaining_zats: 35000, fee_zats: 10000}`; 5 receipts in total |
| Cold `benzo verify` | 19 OK, exit 0 |
| Settle once more | refused to republish: "a reserve-return receipt without its planned accounting" (H20 item 2; the published dir is already correct) |
