// Hand Validator circuit - CIRCUITS_SPEC section 2
// Proves: 2 valid cards in [1,52], no duplicates vs board, commitment = binding(hole_cards)
//
// Commitment: binding for (c0, c1) in [1,52]^2. For production use Poseidon2
// (std::hash::poseidon2 or noir-lang/poseidon) when available in your Noir toolchain.
// Here we use a deterministic injective map so the circuit compiles without extra deps.

fn main(
    hole_cards: [u8; 2],
    board: pub [u8; 5],
    commitment: pub Field,
) {
    // CONSTRAINT #1: cards in range [1, 52]
    assert(hole_cards[0] >= 1);
    assert(hole_cards[0] <= 52);
    assert(hole_cards[1] >= 1);
    assert(hole_cards[1] <= 52);

    // CONSTRAINT #2: no duplicate hole cards
    assert(hole_cards[0] != hole_cards[1]);

    // CONSTRAINT #3: hole cards not in board
    for i in 0..5 {
        assert(hole_cards[0] != board[i]);
        assert(hole_cards[1] != board[i]);
    }

    // CONSTRAINT #4: commitment == binding(hole_cards)
    // Injective for (a,b) in [1,52]: computed = a + b*53 (Field arithmetic)
    let c0 = hole_cards[0] as Field;
    let c1 = hole_cards[1] as Field;
    let computed_commitment = c0 + c1 * 53;
    assert(commitment == computed_commitment);
}
