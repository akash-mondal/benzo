# Live regression on NU7 testnet

- All 13 cli-auction IDs PASS (`results.json`), on the R27 backport with `BNZ_LWD_SINGLE=1`.
- The Playwright test status was nonetheless FAILED. The spec's post-test cleanup (sweeping the global vault back to the bidder with `create-max`) was refused, "notes ineligible", because the last settlement's change note had 2 confirmations. This is housekeeping after the assertions, not a product check.
- Fixed in 76a3930: cleanup waits for maturity.
