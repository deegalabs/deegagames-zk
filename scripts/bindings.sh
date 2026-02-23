#!/usr/bin/env bash
# Generate TypeScript bindings from game-manager WASM.
# Run from repo root: ./scripts/bindings.sh
# Then copy the Client/Game types into frontend or use the generated package.

set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

WASM="${WASM:-$ROOT/target/wasm32v1-none/release/poker_game_manager.wasm}"
OUT="${OUT:-/tmp/poker-zk-bindings}"

if [ ! -f "$WASM" ]; then
  echo "Build WASM first: stellar contract build --package poker-game-manager"
  exit 1
fi

stellar contract bindings typescript --wasm "$WASM" --output-dir "$OUT" --overwrite
echo "Bindings written to $OUT"
echo "To update frontend: copy src/index.ts from $OUT/src to frontend/src/games/poker-zk/bindings.ts (merge with existing exports if needed)."
