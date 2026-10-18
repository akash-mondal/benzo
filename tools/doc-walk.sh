#!/usr/bin/env bash
# Gate DOC live walkthrough: one uniform auction on testnet, run with ONLY the commands the three guides give
# (docs/guide-operator.md, docs/guide-signer.md, docs/guide-bidder.md), in their order. Every guide command is
# echoed as "$ benzo …" with its output into the transcript. The only non-benzo steps are the ones the guides
# leave to the user's own tools: picking an id, picking times, filling the JSON templates (node one-liners), and
# taking the seller's and bidders' own wallet addresses from their wallet (here the testnet bidder wallet, via
# benzo-pczt address, the same generator the harness uses). Prints no key material.
# Usage: tools/doc-walk.sh OUT_DIR   (needs frostd running, hosts provisioned, a funded bidder wallet)
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
set -a; . ./.env; set +a
export BNZ_LWD_SINGLE=1
STATE="$ROOT/${BNZ_STATE_DIR#./}"
OUT="$1"; mkdir -p "$OUT"; T="$OUT/transcript.out"; : > "$T"
PRIV="$STATE/run/doc-walk"; mkdir -p "$PRIV"; chmod 700 "$PRIV"
say() { echo "$*" | tee -a "$T"; }
# run a guide command: echo it, run it, keep its last JSON line in $J
b() { say "\$ benzo $*"; local o; o="$(bin/benzo "$@" 2>&1)" || { echo "$o" | tee -a "$T"; say "ERROR the guide command above failed"; exit 1; }; echo "$o" | redact >> "$T"; J="$(echo "$o" | grep '^{' | tail -1 || true)"; }
# Transcript guard: any JSON field whose name says private/secret/seed/nonce is replaced before it is written.
redact() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const l of s.split("\n")){if(!l)continue;try{const j=JSON.parse(l);const w=v=>v&&typeof v==="object"?(Array.isArray(v)?v.map(w):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/private|secret|seed|nonce/i.test(k)?"<redacted>":w(x)]))):v;console.log(JSON.stringify(w(j)))}catch{console.log(l)}}})'; }
jget() { node -e 'const j=JSON.parse(process.argv[1]);const v=process.argv[2].split(".").reduce((a,k)=>a?.[k],j);console.log(typeof v==="object"?JSON.stringify(v):v)' "$J" "$1"; }
wallet_ua() { "$ROOT/settle/target/release/benzo-pczt" address "$STATE/bidder" --network test | tail -1; }
latest_round() { curl -s -m 10 "https://api.drand.sh/$BNZ_DRAND_CHAIN_HASH/public/latest" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).round))'; }

say "# Gate DOC live walkthrough — commit $(git rev-parse --short HEAD) — $(date -u +%FT%TZ)"
ID="$(openssl rand -hex 32)"; say "# operator picks the auction id: $ID"

say "## operator 1.0 — DKG and keys on the three hosts"
b hosts dkg --id "$ID"; ESCROW="$(jget escrow_ua)"; GROUP="$(jget group_key)"
say "## operator 1.2 — public addresses (2 more deposit slots + the fee reserve)"
b auction addresses --id "$ID" --count 3; D1="$(jget addresses.0)"; D2="$(jget addresses.1)"; FEE="$(jget addresses.2)"
say "## operator 1.2 — the seller's own wallet address (seller's wallet, not a vault address)"
SELLER="$(wallet_ua)"; say "seller_ua (from the seller's wallet): ${SELLER:0:20}…"
say "## operator 1.3 — the pinned public keys"
b hosts keys; EK="$(jget envelope_keys)"; WK="$(jget witness_keys)"
say "## operator 1.4 — the witness set (q = 2)"
b witness set --id "$ID" --q 2 --keys "$(node -e 'console.log(JSON.parse(process.argv[1]).join(","))' "$WK")"; WSFILE="$(jget file)"; WSH="$(jget witness_set_hash)"
NOW=$(date +%s); TSUB=$((NOW + 15*60)); TFRZ=$((NOW + 40*60)); REL=$((NOW + 43*60))
say "## operator 1.5 — the drand round R (release at $(date -u -r $REL +%FT%TZ))"
b drand round --at "$(date -u -r $REL +%FT%TZ)"; R="$(jget round)"
say "## operator 1.6 — fill the template (docs/examples/unsigned-manifest.json) and the operator config"
node -e '
const fs=require("fs"),[,tpl,cfg,out,cout,id,escrow,group,d1,d2,ek,wsh,R,tsub,tfrz,seller,fee]=process.argv;
const m=JSON.parse(fs.readFileSync(tpl));
Object.assign(m,{auction_id:id,escrow_ua:escrow,frost_group_key:group,lot:"gate DOC walkthrough",supply:2,reserve_zats:"10",tick_zats:"10",B_max_zats:"3000",q_max:1,C_zats:"200000",fee_zats:"0",deposit_addresses:[escrow,d1,d2],envelope_keys:JSON.parse(ek),witness_set_hash:wsh,T_submit:+tsub,T_freeze:+tfrz});
m.drand.R=+R; fs.writeFileSync(out,JSON.stringify(m,null,2),{mode:0o600});
const c=JSON.parse(fs.readFileSync(cfg)); c.routing.bidders=[escrow,d1,d2].map(deposit_ua=>({deposit_ua})); c.routing.seller_ua=seller; c.routing.fee_reserve_ua=fee;
fs.writeFileSync(cout,JSON.stringify(c,null,2),{mode:0o600});' docs/examples/unsigned-manifest.json docs/examples/private-operator.json "$PRIV/unsigned-manifest.json" "$PRIV/private-operator.json" "$ID" "$ESCROW" "$GROUP" "$D1" "$D2" "$EK" "$WSH" "$R" "$TSUB" "$TFRZ" "$SELLER" "$FEE"
say "filled: supply 2, C 200000, R $R, T_submit $TSUB, T_freeze $TFRZ (files under \$BNZ_STATE_DIR/run/doc-walk)"
say "## operator 1.7 — create"
b auction create --file "$PRIV/unsigned-manifest.json" --witness-set "$WSFILE" --config "$PRIV/private-operator.json"
say "## operator 2 — sign"
b auction sign --id "$ID"; SIGNER="$(jget signer)"
PUB="$ROOT/tmp/doc-walk/public-$ID"; mkdir -p "$(dirname "$PUB")"
say "## operator 3 — publish"
b auction publish --id "$ID" --dir "$PUB" --config "$PRIV/private-operator.json"
say "## operator 4 — the seller checks the payout binding"
b seller check --manifest "$PUB/manifest.json" --ua "$SELLER"
say "## bidder 2–3 — three bidders prepare and seal (prices 600, 500, 400)"
SEALS=()
for i in 0 1 2; do
  ADDR=("$ESCROW" "$D1" "$D2"); PRICE=$((600 - 100*i)); REFUND="$(wallet_ua)"
  b bid prepare --manifest "$PUB/manifest.json" --signer "$SIGNER"
  node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({price_zats:process.argv[2],quantity:1,address:process.argv[3],refund_ua:process.argv[4]}),{mode:0o600})' "$PRIV/private-bid-$i.json" "$PRICE" "${ADDR[$i]}" "$REFUND"
  b bid seal --manifest "$PUB/manifest.json" --signer "$SIGNER" --file "$PRIV/private-bid-$i.json"
  echo "$J" > "$PRIV/sealed-$i.json"; chmod 600 "$PRIV/sealed-$i.json"
done
say "# GAP G10: bid seal does not print address (the guides say it does); the address comes from the bidder's own private-bid.json"
say "## operator 5 / bidder 4 — one funding transaction: three deposits + the fee reserve (60,000 zats)"
node -e 'const fs=require("fs"),[,dir,fee]=process.argv;const bids=[0,1,2].map(i=>{const s=JSON.parse(fs.readFileSync(`${dir}/sealed-${i}.json`)),p=JSON.parse(fs.readFileSync(`${dir}/private-bid-${i}.json`));return {uri:s.uri,address:p.address,envelope_hex:s.envelope_hex}});fs.writeFileSync(`${dir}/deposit-pay.json`,JSON.stringify({bids,reserve:{address:fee,amount_zats:"60000"}}),{mode:0o600})' "$PRIV" "$FEE"
b bid deposit --id "$ID" --file "$PRIV/deposit-pay.json" --pay; TXID="$(jget txid)"
say "## bidder 4 → operator 6 — admission records (one per deposit)"
say "# GAP G9: admission refuses until the deposit has 10 confirmations (clear/auction-cli.ts:69); the guide does not say so. Retrying each record every 30 s."
for i in 0 1 2; do
  node -e 'const fs=require("fs"),[,dir,i,txid]=process.argv;const s=JSON.parse(fs.readFileSync(`${dir}/sealed-${i}.json`)),p=JSON.parse(fs.readFileSync(`${dir}/private-bid-${i}.json`));fs.writeFileSync(`${dir}/deposit-${i}.json`,JSON.stringify({txid,address:p.address,envelope_hex:s.envelope_hex,envelope_ct_hex:s.envelope_ct_hex,owner_sig_hex:s.owner_sig_hex}),{mode:0o600})' "$PRIV" "$i" "$TXID"
  for k in $(seq 1 60); do
    if o="$(bin/benzo bid deposit --id "$ID" --file "$PRIV/deposit-$i.json" 2>&1)"; then say "\$ benzo bid deposit --id $ID --file \$BNZ_STATE_DIR/run/doc-walk/deposit-$i.json"; echo "$o" | redact >> "$T"; break; fi
    [ "$k" = 1 ] && say "(attempt $k refused: $(echo "$o" | grep ERROR | tail -1))"
    [ "$(date +%s)" -ge "$TFRZ" ] && { say "ERROR deposit $i not admissible before T_freeze"; exit 1; }
    sleep 30
  done
done
say "## operator 4 (watch) — status"
b auction status --id "$ID"
echo "$ID" > "$OUT/auction-id"; echo "$SIGNER" > "$OUT/signer"
say "## operator 7.1 — wait for T_submit"
while [ "$(date +%s)" -lt $((TSUB + 5)) ]; do sleep 20; done
say "## operator 7.2 — freeze"
b freeze --id "$ID"
say "## bidder 5 — prove each bid is in"
for i in 0 1 2; do b receipt prove --dir "$PUB" --ciphertext-hash "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).ciphertext_hash)' "$PRIV/sealed-$i.json")"; done
say "## operator 7.3 — witness certificates"
b hosts witness --id "$ID" --names alice,bob
say "## operator 7.4 — wait for R, open, clear"
while [ "$(latest_round)" -lt "$R" ]; do sleep 10; done
b open --id "$ID"
b clear --id "$ID"
say "## operator 7.5 — the hosts' envelope-opening reports"
b hosts envelope-opens --id "$ID"
say "## operator 7.6 — settle"
b settle --id "$ID"
say "## operator 10 — verify before announcing (cold copy)"
COLD="$ROOT/tmp/doc-walk/cold-$ID"; rm -rf "$COLD"; cp -R "$PUB" "$COLD"
b verify --dir "$COLD" --signer "$SIGNER"
say "## bidder 6 — settlement statements"
for i in 0 1 2; do b receipt statement --dir "$PUB" --ciphertext-hash "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).ciphertext_hash)' "$PRIV/sealed-$i.json")"; done
say "## operator 9 — public view and report"
b operator view --dir "$PUB"
b report --dir "$PUB"
say "## bidder 9 — anyone verifies"
b verify --dir "$PUB" --signer "$SIGNER"
cp -R "$PUB" "$OUT/public"
say "RESULT PASS gate DOC walkthrough $ID"
