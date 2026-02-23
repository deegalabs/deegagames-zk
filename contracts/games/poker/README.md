# Poker Game Manager

Texas Hold'em (Poker ZK) contract: game state machine, blinds, betting rounds, Game Hub integration.

**Spec:** [CONTRACTS_SPEC.md](../../../CONTRACTS_SPEC.md) §2.

**Main functions:** `initialize`, `sit_at_table`, `cancel_waiting`, `create_game`, `join_game`, `commit_seed`, `reveal_seed`, `post_blinds`, `act` (Fold/Check/Call/Raise), `reveal_hand`, `claim_timeout`, `send_chat`.

**Shared infra:** Calls **game-hub** (start_game / end_game) and optional **payment-controller** / **proof-verifier** via config.

---

## Build & test

```bash
# From repo root
stellar contract build --package poker-game-manager
cargo test -p poker-game-manager
```

WASM output: `target/wasm32v1-none/release/poker_game_manager.wasm`

---

## Tasks (from CONTRACTS_SPEC §2)

- [x] State machine, GameHub integration, TTL, deterministic randomness.
- [x] sit_at_table, create_game, join_game, commit_seed, reveal_seed, post_blinds, act, reveal_hand, claim_timeout.
- [x] Optional PaymentController and ProofVerifier via config.
