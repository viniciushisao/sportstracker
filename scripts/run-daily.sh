#!/bin/sh
set -eu
umask 077
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$APP_DIR"
# cPanel cron often has a minimal PATH. Set NODE_BIN to the full path supplied by
# your account's Node.js environment. ENV_FILE defaults to the app's private .env.
NODE_BIN=${NODE_BIN:-node}
export ENV_FILE=${ENV_FILE:-"$APP_DIR/.env"}
exec "$NODE_BIN" --experimental-sqlite "$APP_DIR/dist/main.js" "$@"
