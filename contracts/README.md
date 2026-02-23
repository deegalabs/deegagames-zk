# Soroban contracts

Poker ZK (and future games). Full specification in [CONTRACTS_SPEC.md](../CONTRACTS_SPEC.md).

## Structure

| Folder | Contract | Responsibility |
|--------|----------|----------------|
| **games/poker/** | PokerGameManager | Texas Hold'em state machine, `sit_at_table`, `post_blinds`, `act`, `reveal_hand`, Game Hub integration |
| **game-hub/** | GameHub | Stub: `start_game` / `end_game` called by game contracts; can be extended for standings/sessions |
| **payment-controller/** | PaymentController | XLM escrow, lock, payout, refund (shared; authorized by game contracts) |
| **proof-verifier/** | ProofVerifier | On-chain ZK proof verification (hand_validator, hand_ranker) |

Game logic is **one contract per game**. Poker lives in `games/poker` (crate `poker-game-manager`). New games (e.g. blackjack) would go in `games/blackjack/` with their own crate.

## Build

```bash
# From repo root
stellar contract build --package poker-game-manager
stellar contract build --package game-hub
stellar contract build --package payment-controller
stellar contract build --package proof-verifier
```

## Tests

```bash
./scripts/test_contracts.sh
```

- **poker-game-manager:** `test_create_and_join_game`, `test_commit_and_reveal_seed`, `test_post_blinds_and_fold`, etc.
- **payment-controller:** initialize, lock_funds, payout_winner, refund_on_timeout.
- **proof-verifier:** verify_hand_valid, verify_hand_rank (stubs).

**Reference:** CONTRACTS_SPEC.md, SPEC_COMPLETE.md.
