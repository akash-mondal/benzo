#!/usr/bin/env bash
# Local dry run of tools/repro/xchain-demos.ts (part 2 §2): builds the driver from the working tree, boots an anvil
# EVM chain and a solana-test-validator with the BenzoEscrow program loaded, and runs the demos' TARGET-CHAIN half
# (--local: cleared result fixture + three local signer state dirs standing in for the hosts). The head runs the live
# flow on main: node tmp/xchain-demos.mjs <demo...> (real signer hosts, real testnet chains).
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

export PATH="$HOME/.foundry/bin:$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"
export BNZ_SOLANA_TEST_RPC_PORT=8903

EVM_PORT=8548
LEDGER="contracts/solana/target/test-ledger-xchaindemos"
KP="contracts/solana/target/deploy/benzo_escrow-keypair.json"

echo "== build (from the working tree)"
(cd contracts/evm && forge build >/dev/null)
(cd contracts/solana && cargo build-sbf 2>&1 | tail -1)
npm run build:cli >/dev/null
npx esbuild tools/repro/xchain-demos.ts --bundle --platform=node --format=esm \
  --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);' \
  --outfile=tmp/xchain-demos.mjs --log-level=warning
PROGRAM_ID="$(solana-keygen pubkey "$KP")"
echo "== solana program id: $PROGRAM_ID"

echo "== boot anvil (127.0.0.1:$EVM_PORT) and solana-test-validator (127.0.0.1:$BNZ_SOLANA_TEST_RPC_PORT)"
anvil --port "$EVM_PORT" --silent > tmp/anvil-xchaindemos.log 2>&1 &
ANVIL_PID=$!
rm -rf "$LEDGER"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --rpc-port "$BNZ_SOLANA_TEST_RPC_PORT" --faucet-port $((BNZ_SOLANA_TEST_RPC_PORT + 1000)) \
  --bpf-program "$PROGRAM_ID" contracts/solana/target/deploy/benzo_escrow.so \
  > tmp/test-validator-xchaindemos.log 2>&1 &
VALIDATOR_PID=$!
cleanup() { kill "$ANVIL_PID" "$VALIDATOR_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; wait "$VALIDATOR_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do
  evm_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' "http://127.0.0.1:$EVM_PORT" 2>/dev/null || true)"
  sol_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:$BNZ_SOLANA_TEST_RPC_PORT" 2>/dev/null || true)"
  case "$evm_ok$sol_ok" in
    *'"result"'*'"ok"'*) break ;;
  esac
  if [ "$i" = 60 ]; then echo "ERROR local chains did not become healthy (tmp/anvil-xchaindemos.log, tmp/test-validator-xchaindemos.log)"; exit 1; fi
  sleep 1
done

echo "== run xchain demos (local dry run)"
BNZ_SOLANA_PROGRAM="$PROGRAM_ID" BNZ_EVM_RPC="http://127.0.0.1:$EVM_PORT" node tmp/xchain-demos.mjs --local "$@"
