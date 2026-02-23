#!/usr/bin/env bash
# Run unit tests for all Soroban contracts.
# Requires: Rust toolchain (rustup). Run from repo root: ./scripts/test_contracts.sh
# Prefer Rust cargo: if rustup is installed, use the toolchain cargo so it is not shadowed by snap.

set -e
cd "$(dirname "$0")/.."

CARGO="cargo"
if command -v cargo &>/dev/null; then
  if ! cargo --version 2>/dev/null | grep -q "cargo"; then
    CARGO=""
  fi
fi
if [[ -z "$CARGO" ]] && [[ -x "$HOME/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/cargo" ]]; then
  CARGO="$HOME/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/cargo"
  echo "Using Rust cargo from toolchain: $CARGO"
fi
if ! command -v "$CARGO" &>/dev/null || ! "$CARGO" --version &>/dev/null; then
  echo "Error: Rust cargo not found. Install with: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi

echo "Testing poker-game-manager..."
"$CARGO" test -p poker-game-manager

echo "Testing payment-controller..."
"$CARGO" test -p payment-controller

echo "Testing proof-verifier..."
"$CARGO" test -p proof-verifier

echo "All contract tests passed."
