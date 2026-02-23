# Tasks (from specifications)

Checklist derived from CONTRACTS_SPEC, CIRCUITS_SPEC, GAME_FLOW and SPEC_COMPLETE. Details: [contracts/](contracts/README.md), [circuits/](circuits/README.md), [frontend/](frontend/README.md), [scripts/](scripts/README.md).

---

## Contracts (contracts/)

- [x] **PokerGameManager** (`contracts/games/poker`) — state machine, sit_at_table, create_game, join_game, commit/reveal seed, post_blinds, act, reveal_hand, claim_timeout, send_chat; Game Hub (start_game, end_game); 30-day TTL, deterministic randomness. See [contracts/games/poker/README.md](contracts/games/poker/README.md).
- [ ] **ProofVerifier** — verify_hand_valid, verify_hand_rank; VKs. See [contracts/proof-verifier/README.md](contracts/proof-verifier/README.md).
- [x] **PaymentController** — lock_funds, payout_winner, refund_on_timeout. See [contracts/payment-controller/README.md](contracts/payment-controller/README.md).
- [ ] Events and error codes per CONTRACTS_SPEC §7–8 (partially done).

---

## Circuits (circuits/)

- [ ] **hand_validator** — constraints (1–52, no duplicates, commitment); compile, prove, verify, VK.
- [ ] **hand_ranker** — 10-rank logic; claimed_rank constraint; tests, VK.
- [ ] Integration: frontend (NoirJS) + ProofVerifier.

---

## Frontend (frontend/ — deegagames-zk)

- [x] Setup (React, Vite, Freighter); wallet and contract services.
- [x] Join + Shuffle flow (sit_at_table, create, join, commit/reveal seeds).
- [x] Deal + Blinds; progressive board (3→4→5); betting UI (Fold/Check/Call/Raise).
- [ ] Proof generation (first action or Raise; showdown); act() and reveal_hand() with proofs.
- [x] Showdown and payout; error and timeout handling; Hand Ranks modal; History and Chat panels. See [frontend/README.md](frontend/README.md).

---

## Scripts (scripts/)

- [x] Build (poker-game-manager + circuits); deploy Testnet; TS bindings. See [scripts/README.md](scripts/README.md).

---

## References

| Doc | Use |
|-----|-----|
| [CONTRACTS_SPEC.md](CONTRACTS_SPEC.md) | Signatures, structs, transitions, Game Hub |
| [CIRCUITS_SPEC.md](CIRCUITS_SPEC.md) | Inputs/outputs, constraints, Noir |
| [GAME_FLOW.md](GAME_FLOW.md) | Phases, sequence, UI |
| [SPEC_COMPLETE.md](SPEC_COMPLETE.md) | When to call Game Hub, act(), proof, errors, storage |
