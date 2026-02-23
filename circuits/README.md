# ZK circuits (Noir)

Circuits for hand validation and hand ranking. Specification in [CIRCUITS_SPEC.md](../CIRCUITS_SPEC.md).

## Structure

| Folder | Circuit | Use |
|--------|---------|-----|
| **hand_validator/** | hand_validator.nr | Prove "I have a valid hand" (hole_cards + board 5 + commitment) |
| **hand_ranker/** | hand_ranker.nr | Prove "correct hand rank" at showdown |

Board in the circuit is always **5 cards** (see SPEC_COMPLETE §5).

## Commitment (both circuits)

Both circuits use the same **binding** for the commitment: `commitment = hole_cards[0] + hole_cards[1] * 53` (injective for cards in [1,52]). For production, replace with Poseidon2 per CIRCUITS_SPEC when the Noir toolchain provides it.

## Install (Nargo)

```bash
# Install Noir toolchain (noirup)
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
source ~/.nargo/env   # or add ~/.nargo/bin to PATH

# Check
nargo --version
```

## Build and run (both circuits)

From repo root:

```bash
# hand_validator
cd circuits/hand_validator
nargo compile
nargo execute   # uses Prover.toml inputs; witness saved to target/hand_validator.gz

# hand_ranker
cd ../hand_ranker
nargo compile
nargo execute   # witness saved to target/hand_ranker.gz
```

**Note:** Some Nargo builds (e.g. 1.0.0-beta.18) do not include `nargo prove` / `nargo verify`. For proof generation use a proving backend (e.g. Barretenberg) or NoirJS on the frontend; for on-chain verification use ProofVerifier (e.g. rs-soroban-ultrahonk) with the circuit’s VK/inputs.

---

## Tests (hand_ranker)

```bash
cd circuits/hand_ranker
nargo test
```

Ten `#[test]` functions cover all 10 hand ranks (1 = High Card ... 10 = Royal Flush). Card encoding: `(rank-2)*4 + suit + 1` (rank 2-14, suit 0-3).

---

## Tasks (from CIRCUITS_SPEC)

- [x] **hand_validator:** constraints (1–52, no duplicates, hole vs board, commitment); Prover.toml; binding map (Poseidon2 optional for production).
- [x] **hand_ranker:** full ranking logic (Royal Flush … High card) in Noir; compile + execute pass; 10 `#[test]` tests (one per rank) all passing; Prover.toml example (three of a kind); remaining: generate VK.
- [ ] Board always 5 cards (SPEC_COMPLETE §5); integrate with frontend (NoirJS) and ProofVerifier (VK/inputs).
- [ ] Benchmarks: proof time and size per CIRCUITS_SPEC §7.

**Reference:** CIRCUITS_SPEC.md §2–3, §5–6, SPEC_COMPLETE §5.
