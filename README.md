# Benzo

## Reproduce Phase 1

Testnet only. Needs Rust, Go, Node 24, openssl, jq and sqlite3; see `docs/PHASE-1.md` for what each step proves.

```sh
cp .env.example .env
tools/bootstrap.sh          # builds the pinned tools (tools/pins.env) into .benzo/bin
tools/setup-testnet.sh      # local TLS, 2-of-3 RedPallas DKG through frostd, vault UFVK, vault and bidder wallets
# fund the bidder address that setup prints with >= 0.1 TAZ and wait ~10 confirmations
npm run e2e                 # test 1: seal in headless Chromium, Go tle fails before round R and opens after it
npm run e2e:live            # tests 1 and 2: pay, mine, scan, FROST refund (~35 min, testnet fees)
docs/evidence/phase-1/verify.sh docs/evidence/phase-1   # re-check the recorded evidence
```
