#!/usr/bin/env bash
# Ativa escrow XLM: payment-controller + set_payment_controller no poker-game-manager.
# Requer: poker-game-manager já deployado (e com set_payment_controller, i.e. build recente).
# Uso: GAME_MANAGER_ID=<id> ./scripts/enable-escrow.sh
# Ou define VITE_POKER_ZK_CONTRACT_ID no .env e corre: ./scripts/enable-escrow.sh

set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

SOURCE_ACCOUNT="${DEPLOYER_SOURCE:-deployer}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

# Poker game-manager existente (deve ter set_payment_controller)
if [[ -n "$GAME_MANAGER_ID" ]]; then
  CONTRACT_ID="$GAME_MANAGER_ID"
elif [[ -f "$ROOT/.env" ]]; then
  CONTRACT_ID=$(grep -E '^VITE_POKER_ZK_CONTRACT_ID=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 || true)
fi
if [[ -z "$CONTRACT_ID" || "$CONTRACT_ID" == "YOUR_CONTRACT_ID" ]]; then
  echo "Erro: define GAME_MANAGER_ID ou VITE_POKER_ZK_CONTRACT_ID no .env"
  exit 1
fi

ADMIN=$(stellar keys public-key "$SOURCE_ACCOUNT" 2>/dev/null || true)
if [[ -z "$ADMIN" ]]; then
  echo "Erro: identidade '$SOURCE_ACCOUNT' não encontrada. Cria com: stellar keys generate $SOURCE_ACCOUNT --network testnet --fund"
  exit 1
fi

echo "Poker game-manager: $CONTRACT_ID"
echo "Admin: $ADMIN"
echo ""

# 1) Upgrade poker-game-manager para WASM com set_payment_controller (se ainda não tiver)
echo "Building poker-game-manager..."
stellar contract build --package poker-game-manager 2>/dev/null || true
GM_WASM="$ROOT/target/wasm32v1-none/release/poker_game_manager.wasm"
if [[ -f "$GM_WASM" ]]; then
  echo "Installing new poker_game_manager.wasm to get hash..."
  INSTALL_OUT=$(stellar contract install --wasm "$GM_WASM" --source-account "$SOURCE_ACCOUNT" --network testnet --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" 2>&1)
  WASM_HASH=$(echo "$INSTALL_OUT" | grep -oE '[a-f0-9]{64}' | head -1)
  if [[ -n "$WASM_HASH" ]]; then
    echo "Upgrading poker-game-manager with hash $WASM_HASH..."
    stellar contract invoke --id "$CONTRACT_ID" --source-account "$SOURCE_ACCOUNT" \
      --network testnet --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" \
      -- upgrade --new_wasm_hash "$WASM_HASH"
    echo "Upgrade done."
  fi
  echo ""
fi

# 2) Token XLM nativo (testnet)
echo "Fetching native XLM token ID..."
NATIVE_TOKEN=$(stellar lab token id --asset native --network testnet 2>/dev/null || true)
if [[ -z "$NATIVE_TOKEN" ]]; then
  echo "Aviso: não foi possível obter o token nativo. Usa: stellar lab token id --asset native --network testnet"
  echo "Depois inicializa o payment-controller manualmente e chama set_payment_controller."
  exit 1
fi
echo "Native XLM token: $NATIVE_TOKEN"
echo ""

# 3) Build e deploy payment-controller
echo "Building payment-controller..."
stellar contract build --package payment-controller 2>/dev/null || true
PC_WASM="$ROOT/target/wasm32v1-none/release/payment_controller.wasm"
if [[ ! -f "$PC_WASM" ]]; then
  echo "Erro: $PC_WASM não encontrado"
  exit 1
fi
echo "Deploying payment-controller..."
PC_ID=$(stellar contract deploy --wasm "$PC_WASM" --source-account "$SOURCE_ACCOUNT" \
  --network testnet --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE")
echo "Payment-controller: $PC_ID"
echo ""

# 4) Inicializar payment-controller (admin, token, treasury, game_manager)
echo "Initializing payment-controller..."
stellar contract invoke --id "$PC_ID" --source-account "$SOURCE_ACCOUNT" \
  --network testnet --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" \
  -- initialize \
  --admin "$ADMIN" \
  --token "$NATIVE_TOKEN" \
  --treasury "$ADMIN" \
  --game_manager "$CONTRACT_ID"
echo ""

# 5) Ativar escrow no poker-game-manager
echo "Setting payment_controller on poker-game-manager..."
stellar contract invoke --id "$CONTRACT_ID" --source-account "$SOURCE_ACCOUNT" \
  --network testnet --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" \
  -- set_payment_controller --admin "$ADMIN" --payment_controller "$PC_ID"
echo ""

echo "Escrow ativado."
echo "  Payment-controller: $PC_ID"
echo "  Ao sentar/criar jogo, XLM será lockado no contrato; no fim da mão o vencedor recebe payout."
