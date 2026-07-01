#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${BENZO_ENV_FILE:-/opt/benzo/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing VPS env file: $ENV_FILE" >&2
  exit 1
fi

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|\#*) continue ;;
    *=*) ;;
    *) continue ;;
  esac
  key=${line%%=*}
  value=${line#*=}
  case "$key" in
    *[!A-Za-z0-9_]*|"") continue ;;
  esac
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  export "$key=$value"
done < "$ENV_FILE"

cd "$ROOT_DIR"

docker compose --env-file "$ENV_FILE" build "$@"
docker compose --env-file "$ENV_FILE" up -d "$@"
