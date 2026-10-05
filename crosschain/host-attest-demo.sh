#!/usr/bin/env bash
# Cross-chain signer-host demo (part 2 §2 items (a)-(c), docs/design/crosschain.md §1): builds everything
# from the working tree, boots an anvil EVM chain and a solana-test-validator with the BenzoEscrow program
# loaded, runs crosschain/host-attest-demo.mjs (three LOCAL SIGNER STATE DIRS stand in for the signer hosts:
# BNZ_STATE_DIR per signer), then tears down. Host state dirs land in $BNZ_STATE_DIR/xchain-hosts/; run
# artifacts in tmp/host-attest-demo/.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

export PATH="$HOME/.foundry/bin:$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"
export BNZ_SOLANA_TEST_RPC_PORT=8902

EVM_PORT=8547
LEDGER="contracts/solana/target/test-ledger-hostattest"
KP="contracts/solana/target/deploy/benzo_escrow-keypair.json"

echo "== build (from the working tree)"
(cd contracts/evm && forge build >/dev/null)
(cd contracts/solana && cargo build-sbf 2>&1 | tail -1)
npm run build:cli >/dev/null
PROGRAM_ID="$(solana-keygen pubkey "$KP")"
echo "== solana program id: $PROGRAM_ID"

echo "== boot anvil (127.0.0.1:$EVM_PORT) and solana-test-validator (127.0.0.1:$BNZ_SOLANA_TEST_RPC_PORT)"
anvil --port "$EVM_PORT" --silent > tmp/anvil-hostattest.log 2>&1 &
ANVIL_PID=$!
rm -rf "$LEDGER"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --rpc-port "$BNZ_SOLANA_TEST_RPC_PORT" --faucet-port $((BNZ_SOLANA_TEST_RPC_PORT + 1000)) \
  --bpf-program "$PROGRAM_ID" contracts/solana/target/deploy/benzo_escrow.so \
  > tmp/test-validator-hostattest.log 2>&1 &
VALIDATOR_PID=$!
cleanup() { kill "$ANVIL_PID" "$VALIDATOR_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; wait "$VALIDATOR_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do
  evm_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' "http://127.0.0.1:$EVM_PORT" 2>/dev/null || true)"
  sol_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:$BNZ_SOLANA_TEST_RPC_PORT" 2>/dev/null || true)"
  case "$evm_ok$sol_ok" in
    *'"result"'*'"ok"'*) break ;;
  esac
  if [ "$i" = 60 ]; then echo "ERROR local chains did not become healthy (tmp/anvil-hostattest.log, tmp/test-validator-hostattest.log)"; exit 1; fi
  sleep 1
done

echo "== run host-attest demo"
BNZ_SOLANA_PROGRAM="$PROGRAM_ID" BNZ_EVM_RPC="http://127.0.0.1:$EVM_PORT" node crosschain/host-attest-demo.mjs
