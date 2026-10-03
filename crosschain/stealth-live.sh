#!/usr/bin/env bash
# One LIVE ERC-5564 stealth delivery on Ethereum Sepolia (crosschain/stealth-live.mjs). The
# deployer key stays in $BNZ_STATE_DIR/evm/deployer.key and never reaches a command line.
# Run artifacts in tmp/stealth-live/. Usage: bash crosschain/stealth-live.sh [RPC_URL]
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"
npm run build:cli >/dev/null
echo "== run live stealth delivery on Ethereum Sepolia"
node crosschain/stealth-live.mjs "${1:-}"
