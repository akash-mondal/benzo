#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${BENZO_ENV_FILE:-/opt/benzo/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing VPS env file: $ENV_FILE" >&2
  exit 1
fi

cd "$ROOT_DIR"

docker compose --env-file "$ENV_FILE" build "$@"
docker compose --env-file "$ENV_FILE" up -d "$@"
