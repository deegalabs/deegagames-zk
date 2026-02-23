#!/usr/bin/env bash
# Build contracts (Soroban) and optionally circuits (Noir).
# Run from repo root: ./scripts/build.sh
# For deploy/bindings use Stellar CLI from root or Game Studio (docs/Stellar-Game-Studio).

set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "Building contracts (poker-game-manager)..."
stellar contract build --package poker-game-manager

echo "Building circuits (Noir)..."
for dir in circuits/hand_validator circuits/hand_ranker; do
  if [ -f "$ROOT/$dir/Nargo.toml" ]; then
    (cd "$ROOT/$dir" && nargo compile 2>/dev/null) || echo "  (skip $dir: nargo not found or compile failed)"
  fi
done

echo "Done. WASM: target/wasm32v1-none/release/poker_game_manager.wasm"
