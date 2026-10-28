#!/usr/bin/env bash
# Builds every pinned tool (tools/pins.env) into $BNZ_STATE_DIR/bin and writes docs/evidence/phase-1/versions.txt.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
set -a; . ./.env; . tools/pins.env; set +a
STATE="$ROOT/${BNZ_STATE_DIR#./}"
mkdir -p "$STATE/bin" "$STATE/proto" "$STATE/run"
# One shared target dir, so the three frost-tools crates compile their dependencies once.
TARGET="$STATE/cargo-target"

cargo_install() { # <git> <rev> <package> [--bin name]
  cargo install --locked --git "$1" --rev "$2" --root "$STATE" --target-dir "$TARGET" "${@:3}"
}
# Zcash-devtool and zcash-sign carry the NU7 backport (tools/nu7: testnet NU7 height and branch id on
# the pinned librustzcash crates, nothing else); the as-pinned Ironwood builds stay in bin/ironwood for mainnet.
NU7="$ROOT/tools/nu7/build.sh"
bash "$NU7" tool "$DEVTOOL_GIT" "$DEVTOOL_REV" "$STATE" "$TARGET" "$STATE/nu7-crates" zcash_protocol-0.10.5 zcash_primitives-0.30.1 pczt-0.9.3 -- .
cargo_install "$FROST_TOOLS_GIT" "$FROST_TOOLS_REV" frostd
cargo_install "$FROST_TOOLS_GIT" "$FROST_TOOLS_REV" frost-client --bin frost-client
bash "$NU7" tool "$FROST_TOOLS_GIT" "$FROST_TOOLS_REV" "$STATE" "$TARGET" "$STATE/nu7-crates" zcash_protocol-0.10.0 zcash_primitives-0.29.0 pczt-0.8.0-rc.1 -- zcash-sign
bash "$NU7" crates "$ROOT/vendor/nu7" zcash_protocol-0.10.5 zcash_primitives-0.30.1 pczt-0.9.3 # settle/ and scan/ [patch.crates-io]

GOBIN="$STATE/bin" go install "$TLE_PKG@$TLE_TAG"
GOBIN="$STATE/bin" go install "$GRPCURL_PKG@$GRPCURL_TAG"

curl -fsSL -o "$STATE/proto/service.proto" "$LWD_PROTO_URL/service.proto"
curl -fsSL -o "$STATE/proto/compact_formats.proto" "$LWD_PROTO_URL/compact_formats.proto"
(cd "$STATE/proto" && shasum -a 256 -c - <<EOF
$LWD_PROTO_SHA256_SERVICE  service.proto
$LWD_PROTO_SHA256_COMPACT_FORMATS  compact_formats.proto
EOF
)

npm ci
npx playwright install chromium

OUT="$ROOT/docs/evidence/phase-1/versions.txt"
mkdir -p "$(dirname "$OUT")"
{
  echo "# cargo install --list --root \$BNZ_STATE_DIR"
  cargo install --list --root "$STATE"
  for t in tle grpcurl; do
    echo "# go version -m $t"
    go version -m "$STATE/bin/$t" | sed "s|$STATE|\$BNZ_STATE_DIR|"
  done
  echo "# lightwalletd protos @ $LWD_PROTO_REV"
  (cd "$STATE/proto" && shasum -a 256 service.proto compact_formats.proto)
  echo "# npm (package-lock.json)"
  for p in tlock-js @playwright/test playwright-core esbuild; do
    echo "$p $(jq -r --arg p "node_modules/$p" '.packages[$p].version' package-lock.json)"
  done
} > "$OUT"
echo "wrote $OUT"
