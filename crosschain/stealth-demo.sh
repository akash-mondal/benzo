#!/usr/bin/env bash
# ERC-5564 stealth delivery on a local anvil chain (docs/design/crosschain.md §7 step 4 (a)).
# Builds everything from the working tree, boots anvil, runs crosschain/stealth-demo.mjs (which
# drives the pinned ScopeLift SDK adapter and the shipped `benzo xchain` CLI), then tears down.
# Local dev keys land in $BNZ_STATE_DIR/xchain-local/; run artifacts in tmp/stealth-demo/.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

export PATH="$HOME/.foundry/bin:$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"

EVM_PORT="${BNZ_EVM_PORT:-8546}"

echo "== build (from the working tree)"
(cd contracts/evm && forge build >/dev/null)
npm run build:cli >/dev/null

echo "== boot anvil (127.0.0.1:$EVM_PORT)"
anvil --port "$EVM_PORT" --silent > tmp/anvil-stealth.log 2>&1 &
ANVIL_PID=$!
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do
  evm_ok="$(curl -sf -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' "http://127.0.0.1:$EVM_PORT" 2>/dev/null || true)"
  case "$evm_ok" in *'"result"'*) break ;; esac
  if [ "$i" = 60 ]; then echo "ERROR anvil did not become healthy (tmp/anvil-stealth.log)"; exit 1; fi
  sleep 1
done

echo "== run stealth delivery demo"
BNZ_EVM_RPC="http://127.0.0.1:$EVM_PORT" node crosschain/stealth-demo.mjs
