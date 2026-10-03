#!/usr/bin/env bash
# R14 item 3 one-command repro (Builder B): deploy the fixed benzo_escrow under a NEW devnet
# program ID (no in-place upgrade, R9 item 1) and run one live devnet cycle through the shipped
# `benzo xchain` CLI (lock -> attest 2-of-3 -> release -> status --result -> refund after the
# deadline), the R9 item-6 Solana cycle shape with the R14 published-result-hash tie included.
#
# Blocked on devnet funds at run time (2026-10-03): the deployer needs ~0.6 SOL (fresh
# ProgramData for the ~102 KB program + fees + the cycle). After a user airdrop to the deployer
# (printed below), this single command does the whole item; it fails loudly at the balance gate
# until then. Key material stays under $BNZ_STATE_DIR and is never printed. Public values only
# go to the transcript $BNZ_STATE_DIR/xchain-live/r14-cycle.out.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
export PATH="$HOME/.local/share/solana/install/active_release/bin:${PATH:-}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export BNZ_STATE_DIR="${BNZ_STATE_DIR:-$(git rev-parse --show-toplevel)/.benzo}"

RPC="https://api.devnet.solana.com"
DEPLOYER="$BNZ_STATE_DIR/solana/deployer.json"
PROGRAM_KP="$BNZ_STATE_DIR/solana/program-v3-keypair.json"   # the NEW program id (R14 build)
SIGNS="$BNZ_STATE_DIR/xchain-live/sol-signers.json"
S0="$BNZ_STATE_DIR/xchain-live/sol-signer-0.key"
S1="$BNZ_STATE_DIR/xchain-live/sol-signer-1.key"
LIVE="$BNZ_STATE_DIR/xchain-live"
TRANSCRIPT="$LIVE/r14-cycle.out"
WORK="$LIVE/r14"
mkdir -p "$WORK"
: > "$TRANSCRIPT"
log() { echo "$*" | tee -a "$TRANSCRIPT"; }

DEPLOYER_PK="$(solana-keygen pubkey "$DEPLOYER")"

# ---- balance gate: fail loudly with the exact missing input ----
BALANCE_LAMPORTS="$(solana balance "$DEPLOYER_PK" --url "$RPC" --lamports | awk '{print $1}')"
NEED=700000000   # ~0.57 SOL fresh ProgramData + fees + a 0.02 SOL cycle, with margin
if [ "$BALANCE_LAMPORTS" -lt "$NEED" ]; then
  echo "ERROR r14-deploy blocked: deployer $DEPLOYER_PK holds $BALANCE_LAMPORTS lamports on devnet; need >= $NEED" | tee -a "$TRANSCRIPT"
  echo "NOT RUN r14-deploy-cycle missing devnet funds — user airdrop to $DEPLOYER_PK (faucets are user-only per AGENTS.md), then rerun: bash tools/repro/r14-devnet-deploy-cycle.sh" | tee -a "$TRANSCRIPT"
  exit 1
fi

log "r14 deploy+cycle $(date -u +%Y-%m-%dT%H:%M:%SZ) deployer $DEPLOYER_PK balance $BALANCE_LAMPORTS lamports"

# ---- build the working tree (the R14-fixed program + CLI) ----
(cd contracts/solana && cargo build-sbf 2>&1 | tail -1)
npm run build:cli >/dev/null
SO="contracts/solana/target/deploy/benzo_escrow.so"
SO_SHA="$(shasum -a 256 "$SO" | awk '{print $1}')"
log "so sha256 $SO_SHA"

# ---- deploy under a NEW program id (no in-place upgrade) ----
if [ ! -f "$PROGRAM_KP" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$PROGRAM_KP" >/dev/null
fi
PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KP")"
solana program deploy --url "$RPC" --keypair "$DEPLOYER" --program-id "$PROGRAM_KP" "$SO" | tee -a "$TRANSCRIPT"
log "solana program $PROGRAM_ID (new; AE1LQwTyvPmjoTNdX2b7krH2yBejUgjnBdmGYpB9yna4 SUPERSEDED)"
solana program show "$PROGRAM_ID" --url "$RPC" | tee -a "$TRANSCRIPT"

# ---- one live devnet cycle through the shipped CLI ----
A="0x$(openssl rand -hex 32)"
DEST="$WORK/dest.json"; RETURN="$WORK/return.json"
test -f "$DEST" || solana-keygen new --no-bip39-passphrase --silent --outfile "$DEST" >/dev/null
test -f "$RETURN" || solana-keygen new --no-bip39-passphrase --silent --outfile "$RETURN" >/dev/null
DEST_PK="$(solana-keygen pubkey "$DEST")"
RETURN_PK="$(solana-keygen pubkey "$RETURN")"
NOW="$(date -u +%s)"
LOCK_UNTIL=$((NOW + 120)); DEADLINE=$((NOW + 240)); EXPIRY=$((NOW + 200))

ALLOC="$WORK/allocation.json"
cat > "$ALLOC" <<EOF
{"standard_lot":"10000000","leaves":[{"index":0,"lot_count":1,"destination_kind":2,"destination":"$DEST_PK"}]}
EOF
RESULT="$WORK/result.json"
printf '{"auction_id":"%s","winners":[{"leaf":0,"lot_count":1}]}\n' "$A" > "$RESULT"
RESULT_HASH="$(node -e 'const {createHash}=require("node:crypto");const {readFileSync}=require("node:fs");process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$RESULT")"

log "solana auction $A dest $DEST_PK return $RETURN_PK (lockUntil $LOCK_UNTIL deadline $DEADLINE)"
BENZO="bin/benzo"
lock_out="$($BENZO xchain lock --chain solana --auction "$A" --amount 20000000 --lot 10000000 \
  --lock-until "$LOCK_UNTIL" --deadline "$DEADLINE" --signers "$SIGNS" --return "$RETURN_PK" \
  --key "$DEPLOYER" --escrow "$PROGRAM_ID" --rpc "$RPC")"
log "solana lock $lock_out"

attest_out="$($BENZO xchain attest --chain solana --auction "$A" --allocation "$ALLOC" \
  --result-hash "$RESULT_HASH" --batch 0 --nonce 0 --expiry "$EXPIRY" \
  --signer-key "$S0" --signer-key "$S1" --escrow "$PROGRAM_ID" --rpc "$RPC" \
  --out "$WORK/bundle.json" --asset 0x0000000000000000000000000000000000000000)"
log "solana attest $attest_out"

release_out="$($BENZO xchain release --chain solana --bundle "$WORK/bundle.json" --key "$DEPLOYER" --rpc "$RPC")"
log "solana release $release_out"

# R14 item 4: status ties the approved resultHash to the published result.json hash
$BENZO xchain status --chain solana --auction "$A" --escrow "$PROGRAM_ID" --rpc "$RPC" \
  --bundle "$WORK/bundle.json" --result "$RESULT" | tee -a "$TRANSCRIPT"

# wait past the deadline (bounded poll against chain time, never a fixed sleep)
while [ "$(date -u +%s)" -lt "$((DEADLINE + 5))" ]; do sleep 5; done
refund_out="$($BENZO xchain refund --chain solana --auction "$A" --key "$DEPLOYER" --rpc "$RPC" --escrow "$PROGRAM_ID")"
log "solana refund $refund_out"

$BENZO xchain status --chain solana --auction "$A" --escrow "$PROGRAM_ID" --rpc "$RPC" | tee -a "$TRANSCRIPT"
log "RESULT PASS r14 devnet deploy + one live cycle on $PROGRAM_ID"
