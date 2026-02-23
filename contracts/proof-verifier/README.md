# ProofVerifier

On-chain verification of ZK proofs (hand_validator, hand_ranker).

**Spec:** [CONTRACTS_SPEC.md](../../CONTRACTS_SPEC.md) §3.

**Functions:** `verify_hand_valid`, `verify_hand_rank`.

---

## Tasks (CONTRACTS_SPEC §3)

- [ ] Integration with verifier (Barretenberg/Ultrahonk or native Stellar Protocol 25).
- [x] `verify_hand_valid(proof, board_hash, commitment)` — stub returns true.
- [x] `verify_hand_rank(proof, board_hash, claimed_rank, commitment)` — stub returns true.
- [ ] Store or receive verification keys (VK) for hand_validator and hand_ranker circuits.
- [x] Handle InvalidInputs (invalid claimed_rank) per §8.

**Status:** Stub implemented. verify_hand_valid and verify_hand_rank return true; replace with Barretenberg/native verifier when available.
