#!/usr/bin/env bash
# Cross-chain local demo (docs/design/crosschain.md §7 step 3): builds everything from the working
# tree, boots an anvil EVM chain and a solana-test-validator with the BenzoEscrow program loaded,
# runs crosschain/local-demo.mjs (which drives the shipped `benzo xchain` CLI), then tears down.
# Local dev keys land in $BNZ_STATE_DIR/xchain-local/; run artifacts in tmp/xchain-demo/.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

export PATH="$HOME/.foundry/bin:$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
# R14 item 5 (reviewer R F2): bash 3.2 exits the shell when sourcing a missing file — guard the
# optional .env explicitly instead of `. ./.env 2>/dev/null || true` (which died silently)
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"
export BNZ_SOLANA_TEST_RPC_PORT=8901

EVM_PORT=8546
LEDGER="contracts/solana/target/test-ledger-demo"
KP="contracts/solana/target/deploy/benzo_escrow-keypair.json"

echo "== build (from the working tree)"
(cd contracts/evm && forge build >/dev/null)
(cd contracts/solana && cargo build-sbf 2>&1 | tail -1)
npm run build:cli >/dev/null
PROGRAM_ID="$(solana-keygen pubkey "$KP")"
echo "== solana program id: $PROGRAM_ID"

echo "== boot anvil (127.0.0.1:$EVM_PORT) and solana-test-validator (127.0.0.1:$BNZ_SOLANA_TEST_RPC_PORT)"
anvil --port "$EVM_PORT" --silent > tmp/anvil-demo.log 2>&1 &
ANVIL_PID=$!
rm -rf "$LEDGER"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --rpc-port "$BNZ_SOLANA_TEST_RPC_PORT" --faucet-port $((BNZ_SOLANA_TEST_RPC_PORT + 1000)) \
  --bpf-program "$PROGRAM_ID" contracts/solana/target/deploy/benzo_escrow.so \
  > tmp/test-validator-demo.log 2>&1 &
VALIDATOR_PID=$!
cleanup() { kill "$ANVIL_PID" "$VALIDATOR_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; wait "$VALIDATOR_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do
  evm_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' "http://127.0.0.1:$EVM_PORT" 2>/dev/null || true)"
  sol_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:$BNZ_SOLANA_TEST_RPC_PORT" 2>/dev/null || true)"
  case "$evm_ok$sol_ok" in
    *'"result"'*'"ok"'*) break ;;
  esac
  if [ "$i" = 60 ]; then echo "ERROR local chains did not become healthy (tmp/anvil-demo.log, tmp/test-validator-demo.log)"; exit 1; fi
  sleep 1
done

echo "== run demo"
BNZ_SOLANA_PROGRAM="$PROGRAM_ID" node crosschain/local-demo.mjs
