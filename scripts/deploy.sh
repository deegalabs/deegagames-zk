#!/usr/bin/env bash
# Build and deploy poker-game-manager to Stellar testnet.
# Requires: Stellar CLI, identity with XLM (e.g. stellar keys generate deployer --network testnet --fund).
# Run from repo root: ./scripts/deploy.sh
# Then set frontend/.env: VITE_POKER_ZK_CONTRACT_ID=<printed-id>

set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

SOURCE_ACCOUNT="${DEPLOYER_SOURCE:-deployer}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

echo "Building poker-game-manager..."
stellar contract build --package poker-game-manager

WASM="$ROOT/target/wasm32v1-none/release/poker_game_manager.wasm"
if [[ ! -f "$WASM" ]]; then
  echo "Error: WASM not found at $WASM"
  exit 1
fi

# Resolve deployer address for constructor (admin and game_hub placeholder)
echo "Using source account: $SOURCE_ACCOUNT"
ADMIN=$(stellar keys public-key "$SOURCE_ACCOUNT" 2>/dev/null || true)
if [[ -z "$ADMIN" ]]; then
  echo "Error: Could not get public key for identity '$SOURCE_ACCOUNT'. Create one with:"
  echo "  stellar keys generate $SOURCE_ACCOUNT --network testnet --fund"
  exit 1
fi

# Deploy: __constructor(admin, game_hub, small_blind, big_blind, min_buy_in, max_buy_in, max_seats)
# Example: 50/100 blinds, 1-5 XLM (10^7 stroops), 2 seats for MVP
echo "Deploying to testnet..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source-account "$SOURCE_ACCOUNT" \
  --network testnet \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --admin "$ADMIN" \
  --game_hub "$ADMIN" \
  --small_blind 50 \
  --big_blind 100 \
  --min_buy_in 10000000 \
  --max_buy_in 50000000 \
  --max_seats 2)

echo ""
echo "Deployed poker-game-manager (testnet): $CONTRACT_ID"
echo ""

# Deploy Game Hub stub (poker-game-manager needs a contract address for start_game/end_game, not an account)
echo "Building and deploying game-hub (stub)..."
stellar contract build --package game-hub 2>/dev/null || true
HUB_WASM="$ROOT/target/wasm32v1-none/release/game_hub.wasm"
if [[ -f "$HUB_WASM" ]]; then
  HUB_ID=$(stellar contract deploy \
    --wasm "$HUB_WASM" \
    --source-account "$SOURCE_ACCOUNT" \
    --network testnet \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE")
  echo "Deployed game-hub: $HUB_ID"
  stellar contract invoke --id "$CONTRACT_ID" --source-account "$SOURCE_ACCOUNT" \
    --network testnet --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" \
    -- set_hub --new_hub "$HUB_ID"
  echo "Poker game-manager set_hub($HUB_ID) done."
  echo ""
fi

# Update .env key (used for VITE_POKER_ZK_CONTRACT_ID and VITE_GAME_HUB_CONTRACT_ID)
update_env_key() {
  local key="$1" val="$2" file="$3"
  if [[ -f "$file" ]]; then
    if grep -q "^${key}=" "$file" 2>/dev/null; then
      if sed --version 2>/dev/null | head -1 | grep -q GNU; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$file"
      else
        sed -i.bak "s|^${key}=.*|${key}=${val}|" "$file"
      fi
    else
      echo "${key}=${val}" >> "$file"
    fi
    echo "  Updated $file ($key)"
  else
    echo "${key}=${val}" > "$file"
    echo "  Created $file"
  fi
}

# Build and deploy PaymentController (optional, for escrow)
echo "Building payment-controller..."
stellar contract build --package payment-controller 2>/dev/null || true
PC_WASM="$ROOT/target/wasm32v1-none/release/payment_controller.wasm"
if [[ -f "$PC_WASM" ]]; then
  echo "Deploying payment-controller..."
  PC_ID=$(stellar contract deploy \
    --wasm "$PC_WASM" \
    --source-account "$SOURCE_ACCOUNT" \
    --network testnet \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE")
  echo "Deployed payment-controller: $PC_ID"
  echo ""
  echo "To enable escrow:"
  echo "  1. Get native XLM token id:  stellar keys address native --network testnet  (or use Stellar docs for testnet native asset)"
  echo "  2. Initialize payment-controller:  stellar contract invoke --id $PC_ID --source $SOURCE_ACCOUNT --network testnet \\"
  echo "       initialize --admin $ADMIN --token <NATIVE_XLM_TOKEN_ID> --treasury $ADMIN --game_manager $CONTRACT_ID"
  echo "  3. Call poker-game-manager set_payment_controller with payment_controller: $PC_ID"
  echo ""
fi

# Update .env so frontend (vite envDir: '..') picks up the new contract ID
for f in "$ROOT/.env" "$ROOT/frontend/.env"; do
  update_env_key "VITE_POKER_ZK_CONTRACT_ID" "$CONTRACT_ID" "$f"
done
if [[ -n "${HUB_ID:-}" ]]; then
  for f in "$ROOT/.env" "$ROOT/frontend/.env"; do
    update_env_key "VITE_GAME_HUB_CONTRACT_ID" "$HUB_ID" "$f"
  done
fi

echo ""
echo "Next steps:"
echo "  1. Recarrega o frontend no browser — o .env já tem o contract ID."
echo "  2. Usa o fluxo Create & Export / Import Auth Entry / Load Existing Game (Session ID)."
