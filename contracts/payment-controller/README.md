# PaymentController

XLM escrow: lock, payout, refund (timeout/cancel).

**Spec:** [CONTRACTS_SPEC.md](../../CONTRACTS_SPEC.md) §4.

**Functions:** `lock_funds`, `payout_winner`, `refund_on_timeout`.

---

## Tasks (CONTRACTS_SPEC §4)

- [x] Use Stellar token contract (token address set at init; use native XLM address per network).
- [x] `lock_funds(player, amount)` — player.require_auth(); transfer to contract; update escrow.
- [x] `payout_winner(winner, payout, rake)` — game-manager auth; transfer to winner and treasury.
- [x] `refund_on_timeout(player, amount)` — game-manager auth; transfer to player; decrease escrow.
- [x] require_auth from player (lock_funds) and game_manager (payout/refund); balance checks.

**Status:** Implemented. lock_funds (player auth), payout_winner and refund_on_timeout (game-manager auth via authorize_as_current_contract). Token and treasury set at init.
