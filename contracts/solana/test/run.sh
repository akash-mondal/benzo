#!/usr/bin/env bash
# Benzo cross-chain escrow, Solana test run (docs/design/crosschain.md §7 step 2).
# Builds the program with the pinned cargo build-sbf, boots a local solana-test-validator with it
# loaded, runs test/driver.mjs against that validator, and tears the validator down again.
# All keys used are local dev keys generated into target/ (gitignored); nothing under .benzo/.
set -euo pipefail
cd "$(dirname "$0")/.."   # contracts/solana

export PATH="$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
RPC_PORT="${BNZ_SOLANA_TEST_RPC_PORT:-8901}"
LEDGER="target/test-ledger"
KP="target/deploy/benzo_escrow-keypair.json"

echo "== build-sbf (pinned toolchain, see ../AUDITS.md)"
cargo build-sbf
test -f target/deploy/benzo_escrow.so

PROGRAM_ID="$(solana-keygen pubkey "$KP")"
echo "== program id: $PROGRAM_ID"

echo "== boot solana-test-validator (ledger $LEDGER, rpc 127.0.0.1:$RPC_PORT)"
rm -rf "$LEDGER"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" --faucet-port $((RPC_PORT + 1000)) \
  --bpf-program "$PROGRAM_ID" target/deploy/benzo_escrow.so \
  > target/test-validator.log 2>&1 &
VALIDATOR_PID=$!
cleanup() { kill "$VALIDATOR_PID" 2>/dev/null || true; wait "$VALIDATOR_PID" 2>/dev/null || true; }
trap cleanup EXIT

# bounded readiness poll against the JSON-RPC getHealth method (no fixed sleeps)
for i in $(seq 1 60); do
  health="$(curl -sf -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    "http://127.0.0.1:$RPC_PORT" 2>/dev/null || true)"
  case "$health" in
    *'"result":"ok"'*) break ;;
  esac
  if [ "$i" = 60 ]; then echo "ERROR test-validator did not become healthy (target/test-validator.log)"; exit 1; fi
  sleep 1
done

echo "== run driver"
BNZ_SOLANA_RPC="http://127.0.0.1:$RPC_PORT" node test/driver.mjs "$PROGRAM_ID"
