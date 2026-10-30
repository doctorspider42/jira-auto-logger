#!/usr/bin/env sh
# Builds the app from the current sources. Pass --run to start it afterwards.
#   ./build.sh          build only
#   ./build.sh --run    build, then launch the fresh binary
set -e

cd "$(dirname "$0")"

RUN=0
for arg in "$@"; do
  case "$arg" in
    --run|-run|run) RUN=1 ;;
    *) echo "Unknown argument: $arg (usage: ./build.sh [--run])" >&2; exit 2 ;;
  esac
done

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies"
  npm ci
fi

# --no-bundle: just the release binary. Installers need the updater signing
# key and are built by the release workflow.
echo "==> Building"
npm run build -- --no-bundle

BIN="src-tauri/target/release/jira-auto-logger"
echo "==> Built $BIN"

if [ "$RUN" = 1 ]; then
  echo "==> Starting"
  "./$BIN" &
fi
