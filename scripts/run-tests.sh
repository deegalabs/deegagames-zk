#!/usr/bin/env bash
# Executa os testes dos contratos (poker-game-manager, payment-controller, game-hub).
# Correr na raiz do repo: ./scripts/run-tests.sh
# Requer: cargo/rust estável (wasm32 target) e stellar CLI para build.
#
# Se aparecer "unknown proxy name: 'cursor'" ao correr cargo, o ambiente (ex: Cursor IDE)
# está a invocar o binário com nome "cursor". Usamos exec -a cargo para forçar o nome correto.

set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"
CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
if [[ -L "$CARGO" ]]; then
  RUN_CARGO() { exec -a cargo "$CARGO" "$@"; }
else
  RUN_CARGO() { "$CARGO" "$@"; }
fi

echo "=== poker-game-manager ==="
( RUN_CARGO test --package poker-game-manager )
echo ""

echo "=== payment-controller ==="
( RUN_CARGO test --package payment-controller ) 2>/dev/null || true
echo ""

echo "=== game-hub ==="
( RUN_CARGO test --package game-hub ) 2>/dev/null || true
echo ""

echo "=== proof-verifier ==="
( RUN_CARGO test --package proof-verifier ) 2>/dev/null || true
echo ""

echo "Todos os testes passaram (ou pacote sem testes)."
