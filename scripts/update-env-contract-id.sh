#!/usr/bin/env bash
# Atualiza VITE_POKER_ZK_CONTRACT_ID em .env e frontend/.env.
# Uso: ./scripts/update-env-contract-id.sh <CONTRACT_ID>
# Exemplo: ./scripts/update-env-contract-id.sh CABC123...
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"
CONTRACT_ID="$1"
if [[ -z "$CONTRACT_ID" ]]; then
  echo "Uso: $0 <CONTRACT_ID>"
  echo "Exemplo: $0 CCTBAQUK4D4WNL3LG234NDG4BQ4MD5BKPCQZLDZIJDQ3KSKKC7OV4X75"
  exit 1
fi

update_env() {
  local file="$1"
  if [[ -f "$file" ]]; then
    if grep -q '^VITE_POKER_ZK_CONTRACT_ID=' "$file" 2>/dev/null; then
      if sed --version 2>/dev/null | head -1 | grep -q GNU; then
        sed -i "s|^VITE_POKER_ZK_CONTRACT_ID=.*|VITE_POKER_ZK_CONTRACT_ID=$CONTRACT_ID|" "$file"
      else
        sed -i.bak "s|^VITE_POKER_ZK_CONTRACT_ID=.*|VITE_POKER_ZK_CONTRACT_ID=$CONTRACT_ID|" "$file"
      fi
    else
      echo "VITE_POKER_ZK_CONTRACT_ID=$CONTRACT_ID" >> "$file"
    fi
    echo "  Atualizado: $file"
  else
    echo "VITE_POKER_ZK_CONTRACT_ID=$CONTRACT_ID" > "$file"
    echo "  Criado: $file"
  fi
}

update_env "$ROOT/.env"
update_env "$ROOT/frontend/.env"
echo ""
echo "Contract ID definido. Recarrega o frontend no browser (ou reinicia 'bun run dev')."
