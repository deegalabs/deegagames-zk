# hand_ranker

Proves that the declared hand rank (1–10) is correct for hole_cards + board.

**Spec:** [CIRCUITS_SPEC.md](../../CIRCUITS_SPEC.md) §3.

**Inputs:** `hole_cards` (private), `board` (public, 5), `claimed_rank` (public), `commitment` (public).

---

## Tasks (CIRCUITS_SPEC §3)

- [ ] Create `src/main.nr`; struct/helpers for rank/suit (2–14, 0–3).
- [ ] Implement hand detection: is_royal_flush, is_straight_flush, is_four_kind, is_full_house, is_flush, is_straight, is_three_kind, is_two_pair, is_one_pair; high card.
- [ ] compute_hand_rank(hole, board) → 1..10; constraint: claimed_rank == compute_hand_rank.
- [ ] Constraint: commitment == hash(hole_cards) (consistent with hand_validator).
- [ ] Tests with Prover.toml for all 10 ranks; nargo prove/verify.
- [ ] codegen-verifier; deliver .vk for ProofVerifier.

**Status:** Placeholder — implementation per items above.
