#!/bin/sh
# Run on the hosting server after updating the checkout and installing dependencies.
set -eu
umask 077
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$APP_DIR"
case "${1:-}" in
  "") ;;
  --university) ;;
  *) echo "Usage: publish.sh [--university]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || exit 2
NODE_BIN=${NODE_BIN:-node}
export GOMAXPROCS=${GOMAXPROCS:-2}
export ENV_FILE=${ENV_FILE:-"$APP_DIR/.env"}
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit
"$NODE_BIN" --experimental-sqlite --import tsx --test --test-concurrency=1 test/*.test.ts
"$NODE_BIN" node_modules/typescript/bin/tsc -p tsconfig.json
"$NODE_BIN" --experimental-sqlite dist/main.js "$@" --dry-run
"$NODE_BIN" --experimental-sqlite dist/main.js "$@" --send --publish
