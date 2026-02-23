# hand_validator

Proves that the player has 2 valid cards (range 1–52, no duplicates, correct commitment).

**Spec:** [CIRCUITS_SPEC.md](../../CIRCUITS_SPEC.md) §2.

**Inputs:** `hole_cards` (private), `board` (public, 5 cards), `commitment` (public).

---

## Implementation

- **Constraints:** Cards in [1,52]; no duplicate hole cards; hole cards not in board; commitment binding.
- **Commitment:** `commitment = hole_cards[0] + hole_cards[1] * 53` (injective for [1,52]²). For production, switch to Poseidon2 per spec when your Noir toolchain provides it (e.g. `std::hash::poseidon2` or [noir-lang/poseidon](https://github.com/noir-lang/poseidon)).
- **Prover.toml:** Example inputs; `commitment = 14 + 27*53 = 1445` for hole_cards `[14, 27]`.

## Build and prove (requires Nargo)

```bash
nargo compile
nargo prove
nargo verify
```

---

## Tasks

- [x] Constraints: range, no duplicates, commitment.
- [x] Prover.toml example.
- [ ] Optional: Poseidon2 when available; codegen-verifier; deliver .vk for ProofVerifier.
