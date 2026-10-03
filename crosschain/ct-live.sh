#!/usr/bin/env bash
# One live Token-2022 Confidential Transfer delivery on Solana devnet (crosschain/ct-delivery.mjs).
# The devnet deployer key stays in $BNZ_STATE_DIR/solana/deployer.json and never reaches a command
# line (keypair paths only). Run artifacts in tmp/ct-live/. Usage: bash crosschain/ct-live.sh [RPC_URL]
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
export PATH="$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"
echo "== run live Token-2022 confidential transfer delivery on Solana devnet"
node crosschain/ct-delivery.mjs "${1:-}"
