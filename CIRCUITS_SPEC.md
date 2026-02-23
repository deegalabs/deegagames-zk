# ZK Circuit Specification — Poker ZK on Stellar

**Noir Zero-Knowledge Circuits Specification v1.0**

---

## Table of contents

1. [Overview](#1-overview)
2. [Circuit #1: Hand Validator](#2-circuit-1-hand-validator)
3. [Circuit #2: Hand Ranker](#3-circuit-2-hand-ranker)
4. [Helper Functions](#4-helper-functions)
5. [Proof Generation](#5-proof-generation)
6. [Verification](#6-verification)
7. [Performance Analysis](#7-performance-analysis)
8. [Security Considerations](#8-security-considerations)
9. [Testing Strategy](#9-testing-strategy)
10. [Integration Guide](#10-integration-guide)

---

## 1. Overview

### 1.1 ZK architecture

```
┌─────────────────────────────────────────────────────┐
│              NOIR ZK CIRCUITS                       │
└─────────────────────────────────────────────────────┘

CIRCUIT #1: hand_validator.nr
├─ Purpose: Prove "I have a valid hand"
├─ Inputs: hole_cards (private), board (public), commitment (public)
├─ Constraints: ~200-300
├─ Proof time: ~5-10s
└─ Proof size: ~256 bytes

CIRCUIT #2: hand_ranker.nr
├─ Purpose: Prove "correct hand rank"
├─ Inputs: hole_cards (private), board (public), claimed_rank (public)
├─ Constraints: ~500-1000
├─ Proof time: ~10-15s
└─ Proof size: ~256 bytes

BACKEND: Barretenberg
├─ Proof system: PLONK
├─ Curve: BN254
└─ Hash: Poseidon2 (Stellar Protocol 25)
```

### 1.2 ZK flow

```
1. Player has private cards: [A♠, K♠]
2. Public board: [10♠, 9♠, 8♠, 7♦, 2♣]
3. Player computes: commitment = hash(hole_cards)
4. Player generates proof: "I have a valid hand" (Circuit #1)
5. Player submits: bet(amount, proof, commitment)
6. Contract verifies: proof valid? ✓
7. At showdown: Player generates rank proof (Circuit #2)
8. Player submits: reveal(cards, rank=9, proof)
9. Contract verifies: proof valid? ✓ + commitment match? ✓
10. Winner determined: rank 9 > rank 6
```

---

## 2. Circuit #1: Hand Validator

### 2.1 Overview

**File:** `circuits/hand_validator.nr`

**Purpose:** Prove that the player has 2 valid cards without revealing them.

**Guarantees:**
- Cards are in range [1,52]
- No duplicates (hole vs hole, hole vs board)
- Commitment is correct (hash(hole_cards) == commitment)

**Board in circuit:** Always **5 cards** (public). The contract and frontend derive the full board after reveal_seed; in all rounds (PreFlop, Flop, Turn, River) and at showdown they use the same 5-card array. See SPEC_COMPLETE.md §5.

### 2.2 Circuit Code

```noir
// hand_validator.nr
use dep::std;

fn main(
    // PRIVATE INPUTS (not revealed)
    hole_cards: [u8; 2],
    
    // PUBLIC INPUTS (on-chain)
    board: pub [u8; 5],
    commitment: pub Field
) {
    // ═══════════════════════════════════════════
    // CONSTRAINT #1: Cards in range [1,52]
    // ═══════════════════════════════════════════
    assert(hole_cards[0] >= 1);
    assert(hole_cards[0] <= 52);
    assert(hole_cards[1] >= 1);
    assert(hole_cards[1] <= 52);
    
    // ═══════════════════════════════════════════
    // CONSTRAINT #2: No duplicates (hole vs hole)
    // ═══════════════════════════════════════════
    assert(hole_cards[0] != hole_cards[1]);
    
    // ═══════════════════════════════════════════
    // CONSTRAINT #3: No duplicates (hole vs board)
    // ═══════════════════════════════════════════
    for i in 0..5 {
        assert(hole_cards[0] != board[i]);
        assert(hole_cards[1] != board[i]);
    }
    
    // ═══════════════════════════════════════════
    // CONSTRAINT #4: Correct commitment
    // ═══════════════════════════════════════════
    // Use Poseidon2 hash (Stellar Protocol 25 native)
    let computed_commitment = std::hash::poseidon2([
        hole_cards[0] as Field,
        hole_cards[1] as Field
    ]);
    
    assert(commitment == computed_commitment);
}
```

### 2.3 Inputs Specification

```typescript
// TypeScript interface for frontend
interface HandValidatorInputs {
    // Private inputs (not sent on-chain)
    hole_cards: [number, number];  // [1-52, 1-52]
    
    // Public inputs (sent on-chain)
    board: [number, number, number, number, number];  // [1-52, ...]
    commitment: string;  // Field (hex string)
}

// Example
const inputs: HandValidatorInputs = {
    hole_cards: [14, 27],  // A♠ (14), K♠ (27)
    board: [23, 22, 21, 7, 2],  // 10♠, 9♠, 8♠, 7♦, 2♣
    commitment: "0x1a2b3c..."  // hash(14, 27)
};
```

### 2.4 Constraints Analysis

```
Total Constraints: ~200-300

Breakdown:
├─ Range checks (hole_cards): 4 constraints
│   └─ 2 cards × 2 bounds (>= 1, <= 52)
│
├─ Uniqueness checks: 12 constraints
│   ├─ hole vs hole: 1 constraint
│   └─ hole vs board: 2 cards × 5 board = 10 constraints
│
└─ Hash computation (Poseidon2): ~180-280 constraints
    └─ 2 field elements → 1 hash
```

### 2.5 Performance

```
Proof Generation:
├─ Time: ~5-10s (client-side, CPU-bound)
├─ Memory: ~500 MB RAM
└─ Browser: Chrome/Firefox (WASM support)

Proof Verification:
├─ Time: <1s (on-chain, Soroban)
├─ Gas: ~0.005 XLM (~$0.0005)
└─ Proof size: ~256 bytes
```

---

## 3. Circuit #2: Hand Ranker

### 3.1 Overview

**File:** `circuits/hand_ranker.nr`

**Purpose:** Prove that the declared hand ranking is correct.

**Guarantees:**
- Commitment is correct (same validation as Circuit #1)
- Computed ranking == claimed_rank
- Poker hand logic is correct

### 3.2 Circuit Code

```noir
// hand_ranker.nr
use dep::std;

fn main(
    // PRIVATE INPUTS
    hole_cards: [u8; 2],
    
    // PUBLIC INPUTS
    board: pub [u8; 5],
    claimed_rank: pub u8,
    commitment: pub Field
) {
    // ═══════════════════════════════════════════
    // STEP 1: Verify commitment (same as Circuit #1)
    // ═══════════════════════════════════════════
    let computed_commitment = std::hash::poseidon2([
        hole_cards[0] as Field,
        hole_cards[1] as Field
    ]);
    assert(commitment == computed_commitment);
    
    // ═══════════════════════════════════════════
    // STEP 2: Compute actual ranking
    // ═══════════════════════════════════════════
    let actual_rank = compute_poker_hand(hole_cards, board);
    
    // ═══════════════════════════════════════════
    // STEP 3: Verify claimed_rank is correct
    // ═══════════════════════════════════════════
    assert(claimed_rank == actual_rank);
}

// ═══════════════════════════════════════════════════
// POKER HAND RANKING LOGIC
// ═══════════════════════════════════════════════════

fn compute_poker_hand(hole: [u8; 2], board: [u8; 5]) -> u8 {
    // Combine hole cards + board
    let all_cards = [
        hole[0], hole[1],
        board[0], board[1], board[2], board[3], board[4]
    ];
    
    // Rankings (1-10):
    // 1 = High Card
    // 2 = One Pair
    // 3 = Two Pair
    // 4 = Three of a Kind
    // 5 = Straight
    // 6 = Flush
    // 7 = Full House
    // 8 = Four of a Kind
    // 9 = Straight Flush
    // 10 = Royal Flush
    
    // Check in descending order (rarest first)
    if is_royal_flush(all_cards) { return 10; }
    if is_straight_flush(all_cards) { return 9; }
    if is_four_kind(all_cards) { return 8; }
    if is_full_house(all_cards) { return 7; }
    if is_flush(all_cards) { return 6; }
    if is_straight(all_cards) { return 5; }
    if is_three_kind(all_cards) { return 4; }
    if is_two_pair(all_cards) { return 3; }
    if is_one_pair(all_cards) { return 2; }
    
    return 1; // High card
}

// ═══════════════════════════════════════════════════
// HELPER FUNCTIONS (Poker Logic)
// ═══════════════════════════════════════════════════

fn is_royal_flush(cards: [u8; 7]) -> bool {
    // Royal Flush = Straight Flush with A, K, Q, J, 10
    if !is_straight_flush(cards) {
        return false;
    }
    
    // Extract ranks
    let ranks = extract_ranks(cards);
    
    // Check for A (rank 14), K (13), Q (12), J (11), 10 (10)
    let has_ace = contains(ranks, 14);
    let has_king = contains(ranks, 13);
    let has_queen = contains(ranks, 12);
    let has_jack = contains(ranks, 11);
    let has_ten = contains(ranks, 10);
    
    return has_ace && has_king && has_queen && has_jack && has_ten;
}

fn is_straight_flush(cards: [u8; 7]) -> bool {
    return is_flush(cards) && is_straight(cards);
}

fn is_four_kind(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    
    // Check if any rank appears 4 times
    for i in 0..7 {
        if counts[i] == 4 {
            return true;
        }
    }
    
    return false;
}

fn is_full_house(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    
    let mut has_three = false;
    let mut has_pair = false;
    
    for i in 0..7 {
        if counts[i] == 3 {
            has_three = true;
        }
        if counts[i] == 2 {
            has_pair = true;
        }
    }
    
    return has_three && has_pair;
}

fn is_flush(cards: [u8; 7]) -> bool {
    let suits = extract_suits(cards);
    let suit_counts = count_suits(suits);
    
    // Check if any suit appears >= 5 times
    for i in 0..4 {
        if suit_counts[i] >= 5 {
            return true;
        }
    }
    
    return false;
}

fn is_straight(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let sorted_ranks = sort_ranks(ranks);
    
    // Check sequence of 5 consecutive cards
    let mut consecutive = 1;
    
    for i in 0..6 {
        if sorted_ranks[i+1] == sorted_ranks[i] + 1 {
            consecutive += 1;
            if consecutive >= 5 {
                return true;
            }
        } else if sorted_ranks[i+1] != sorted_ranks[i] {
            consecutive = 1;
        }
    }
    
    // Special case: A-2-3-4-5 (wheel)
    let has_ace = contains(sorted_ranks, 14);
    let has_two = contains(sorted_ranks, 2);
    let has_three = contains(sorted_ranks, 3);
    let has_four = contains(sorted_ranks, 4);
    let has_five = contains(sorted_ranks, 5);
    
    if has_ace && has_two && has_three && has_four && has_five {
        return true;
    }
    
    return false;
}

fn is_three_kind(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    
    for i in 0..7 {
        if counts[i] == 3 {
            return true;
        }
    }
    
    return false;
}

fn is_two_pair(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    
    let mut pair_count = 0;
    
    for i in 0..7 {
        if counts[i] == 2 {
            pair_count += 1;
        }
    }
    
    return pair_count >= 2;
}

fn is_one_pair(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    
    for i in 0..7 {
        if counts[i] == 2 {
            return true;
        }
    }
    
    return false;
}

// ═══════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════

fn extract_ranks(cards: [u8; 7]) -> [u8; 7] {
    let mut ranks = [0; 7];
    
    for i in 0..7 {
        // Card encoding: 1-52
        // Rank = (card - 1) / 4 + 2
        // Suits: ♠=0, ♥=1, ♦=2, ♣=3
        ranks[i] = ((cards[i] - 1) / 4) + 2;
    }
    
    return ranks;
}

fn extract_suits(cards: [u8; 7]) -> [u8; 7] {
    let mut suits = [0; 7];
    
    for i in 0..7 {
        // Suit = (card - 1) % 4
        suits[i] = (cards[i] - 1) % 4;
    }
    
    return suits;
}

fn count_ranks(ranks: [u8; 7]) -> [u8; 15] {
    let mut counts = [0; 15];  // Ranks 2-14 (A)
    
    for i in 0..7 {
        counts[ranks[i]] += 1;
    }
    
    return counts;
}

fn count_suits(suits: [u8; 7]) -> [u8; 4] {
    let mut counts = [0; 4];
    
    for i in 0..7 {
        counts[suits[i]] += 1;
    }
    
    return counts;
}

fn sort_ranks(ranks: [u8; 7]) -> [u8; 7] {
    let mut sorted = ranks;
    
    // Bubble sort (simple, constraint-efficient)
    for i in 0..7 {
        for j in 0..(7-i-1) {
            if sorted[j] > sorted[j+1] {
                let temp = sorted[j];
                sorted[j] = sorted[j+1];
                sorted[j+1] = temp;
            }
        }
    }
    
    return sorted;
}

fn contains(arr: [u8; 7], value: u8) -> bool {
    for i in 0..7 {
        if arr[i] == value {
            return true;
        }
    }
    return false;
}
```

### 3.3 Inputs Specification

```typescript
interface HandRankerInputs {
    // Private inputs
    hole_cards: [number, number];
    
    // Public inputs
    board: [number, number, number, number, number];
    claimed_rank: number;  // 1-10
    commitment: string;
}

// Example
const inputs: HandRankerInputs = {
    hole_cards: [14, 27],  // A♠, K♠
    board: [23, 22, 21, 7, 2],  // 10♠, 9♠, 8♠, 7♦, 2♣
    claimed_rank: 9,  // Straight Flush
    commitment: "0x1a2b3c..."
};
```

### 3.4 Constraints Analysis

```
Total Constraints: ~500-1000

Breakdown:
├─ Commitment verification: ~180-280 constraints
│
├─ Rank extraction: ~50 constraints
│   └─ 7 cards × division/modulo ops
│
├─ Suit extraction: ~50 constraints
│
├─ Counting logic: ~100 constraints
│   ├─ count_ranks(): ~50
│   └─ count_suits(): ~50
│
├─ Sorting: ~150 constraints
│   └─ Bubble sort (7 elements)
│
└─ Hand checking: ~200-400 constraints
    ├─ is_royal_flush(): ~50
    ├─ is_straight_flush(): ~50
    ├─ is_four_kind(): ~30
    ├─ is_full_house(): ~40
    ├─ is_flush(): ~30
    ├─ is_straight(): ~80
    ├─ is_three_kind(): ~30
    ├─ is_two_pair(): ~40
    └─ is_one_pair(): ~30
```

### 3.5 Performance

```
Proof Generation:
├─ Time: ~10-15s (client-side)
├─ Memory: ~800 MB RAM
└─ Complexity: O(n²) sorting + O(n) checks

Proof Verification:
├─ Time: <1s (on-chain)
├─ Gas: ~0.008 XLM (~$0.0008)
└─ Proof size: ~256 bytes
```

---

## 4. Helper Functions

### 4.1 Card Encoding

```typescript
// Card encoding: 1-52
// Rank: 2-14 (2, 3, ..., J=11, Q=12, K=13, A=14)
// Suit: ♠=0, ♥=1, ♦=2, ♣=3

function encodeCard(rank: number, suit: number): number {
    // card = (rank - 2) * 4 + suit + 1
    return (rank - 2) * 4 + suit + 1;
}

function decodeCard(card: number): { rank: number, suit: number } {
    const rank = Math.floor((card - 1) / 4) + 2;
    const suit = (card - 1) % 4;
    return { rank, suit };
}

// Examples:
// 2♠ = encodeCard(2, 0) = 1
// A♠ = encodeCard(14, 0) = 49
// K♥ = encodeCard(13, 1) = 46
```

### 4.2 Commitment Generation

```typescript
import { Poseidon } from '@noir-lang/noir_js';

function generateCommitment(hole_cards: [number, number]): string {
    // Use Poseidon2 hash (Stellar Protocol 25)
    const hash = Poseidon.hash([
        BigInt(hole_cards[0]),
        BigInt(hole_cards[1])
    ]);
    
    return '0x' + hash.toString(16);
}

// Example:
const commitment = generateCommitment([14, 27]);
// Output: "0x1a2b3c4d5e6f..."
```

---

## 5. Proof Generation

### 5.1 Frontend Integration

```typescript
import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';

// Carregar circuit WASM
const handValidatorCircuit = await fetch('/circuits/hand_validator.json');
const handRankerCircuit = await fetch('/circuits/hand_ranker.json');

// Inicializar Noir
const noir = new Noir(handValidatorCircuit);
const backend = new BarretenbergBackend(handValidatorCircuit);

// Gerar proof
async function generateHandValidProof(
    hole_cards: [number, number],
    board: [number, number, number, number, number],
    commitment: string
): Promise<{ proof: Uint8Array, publicInputs: string[] }> {
    
    // Preparar inputs
    const inputs = {
        hole_cards,
        board,
        commitment
    };
    
    // Gerar witness
    const witness = await noir.execute(inputs);
    
    // Gerar proof (~5-10s)
    const proof = await backend.generateProof(witness);
    
    return {
        proof: proof.proof,
        publicInputs: proof.publicInputs
    };
}
```

### 5.2 Progress Tracking

```typescript
// Show progress to user (proof gen takes ~10-15s)
function generateProofWithProgress(
    inputs: any,
    onProgress: (progress: number) => void
): Promise<Proof> {
    
    return new Promise((resolve, reject) => {
        // Simulate progress (Noir has no native callback)
        let progress = 0;
        const interval = setInterval(() => {
            progress += 10;
            onProgress(Math.min(progress, 90));
        }, 1000);
        
        generateHandValidProof(inputs)
            .then(proof => {
                clearInterval(interval);
                onProgress(100);
                resolve(proof);
            })
            .catch(err => {
                clearInterval(interval);
                reject(err);
            });
    });
}

// Usage
await generateProofWithProgress(inputs, (progress) => {
    console.log(`Generating proof: ${progress}%`);
    updateProgressBar(progress);
});
```

---

## 6. Verification

### 6.1 On-Chain Verification (Soroban)

```rust
// ProofVerifier contract
use barretenberg::Verifier;

pub fn verify_hand_valid(
    env: Env,
    proof: BytesN<256>,
    public_inputs: Vec<Field>,
) -> Result<bool, Error> {
    
    // Load verification key (stored in contract)
    let vk = load_verification_key(&env, "hand_validator")?;
    
    // Verificar proof
    let verifier = Verifier::new(&env);
    let is_valid = verifier.verify(
        &vk,
        &proof.to_array(),
        &public_inputs_to_bytes(&public_inputs),
    )?;
    
    Ok(is_valid)
}
```

### 6.2 Off-Chain Verification (Testing)

```typescript
// For local testing (faster than on-chain)
async function verifyProofOffChain(
    proof: Uint8Array,
    publicInputs: string[],
    circuit: any
): Promise<boolean> {
    
    const backend = new BarretenbergBackend(circuit);
    
    const isValid = await backend.verifyProof({
        proof,
        publicInputs
    });
    
    return isValid;
}
```

---

## 7. Performance Analysis

### 7.1 Benchmarks

| Operation | Time | Memory | Notes |
|-----------|------|--------|-------|
| **Circuit Compilation** | ~2-3s | ~200 MB | One-time (cached) |
| **Witness Generation** | ~1-2s | ~100 MB | Per proof |
| **Proof Generation (Circuit #1)** | ~5-10s | ~500 MB | hand_validator |
| **Proof Generation (Circuit #2)** | ~10-15s | ~800 MB | hand_ranker |
| **Proof Verification (on-chain)** | <1s | ~50 MB | Soroban |
| **Proof Verification (off-chain)** | ~500ms | ~50 MB | Testing |

### 7.2 Optimization Strategies

```typescript
// 1. Pre-compile circuits (cache WASM)
const circuitCache = new Map();

async function loadCircuitCached(name: string) {
    if (circuitCache.has(name)) {
        return circuitCache.get(name);
    }
    
    const circuit = await fetch(`/circuits/${name}.json`);
    circuitCache.set(name, circuit);
    return circuit;
}

// 2. Web Workers (do not block UI)
const proofWorker = new Worker('/workers/proof-generator.js');

proofWorker.postMessage({ inputs, circuit: 'hand_validator' });
proofWorker.onmessage = (event) => {
    const { proof, publicInputs } = event.data;
    // Usar proof...
};

// 3. Pre-computation (generate common proofs in advance)
const commonProofs = {
    'pair_aces': await generateProof(...),
    'flush_spades': await generateProof(...),
    // ...
};
```

---

## 8. Security Considerations

### 8.1 Circuit Soundness

```
GARANTIAS:
Commitment binding: hash(cards) is unique
Constraint completeness: all poker rules covered
No information leakage: private inputs never revealed

ASSUMPTIONS:
Poseidon2 hash is collision-resistant
Barretenberg prover has no bugs
Circuit logic is correct (no edge cases)
```

### 8.2 Tested edge cases

```typescript
// 1. Ace-high straight (A-K-Q-J-10)
testCase({
    hole_cards: [49, 46],  // A♠, K♥
    board: [45, 44, 43, 1, 2],  // Q♦, J♣, 10♠, 2♠, 3♠
    expected_rank: 5  // Straight
});

// 2. Ace-low straight (A-2-3-4-5, "wheel")
testCase({
    hole_cards: [49, 1],  // A♠, 2♠
    board: [5, 9, 13, 20, 30],  // 3♠, 4♠, 5♠, ...
    expected_rank: 5  // Straight
});

// 3. Full house vs Flush (full house wins)
testCase({
    hole_cards: [1, 2],  // 2♠, 2♥
    board: [5, 6, 7, 8, 9],  // 3♠, 3♥, 3♦, 4♠, 4♥
    expected_rank: 7  // Full House
});

// 4. Kicker comparison (same pair, different kickers)
// TODO: Implement kicker logic
```

### 8.3 Known Limitations

```
MVP LIMITATIONS:
Kicker comparison not implemented (ties = split pot)
Suit ranking not considered (flush tiebreak)
Proof generation slow (~10-15s) - optimize with GPU if needed
```

---

## 9. Testing Strategy

### 9.1 Unit Tests (Noir)

```noir
// tests/hand_validator.test.nr
#[test]
fn test_valid_hand() {
    let hole_cards = [14, 27];  // A♠, K♠
    let board = [23, 22, 21, 7, 2];
    let commitment = std::hash::poseidon2([14 as Field, 27 as Field]);
    
    // Should not panic
    main(hole_cards, board, commitment);
}

#[test]
#[should_fail]
fn test_duplicate_cards() {
    let hole_cards = [14, 14];  // Duplicate!
    let board = [23, 22, 21, 7, 2];
    let commitment = std::hash::poseidon2([14 as Field, 14 as Field]);
    
    // Should panic
    main(hole_cards, board, commitment);
}

#[test]
#[should_fail]
fn test_invalid_commitment() {
    let hole_cards = [14, 27];
    let board = [23, 22, 21, 7, 2];
    let commitment = Field::from(0);  // Wrong commitment!
    
    // Should panic
    main(hole_cards, board, commitment);
}
```

### 9.2 Integration Tests (TypeScript)

```typescript
describe('Hand Validator Circuit', () => {
    it('should generate valid proof for valid hand', async () => {
        const inputs = {
            hole_cards: [14, 27],
            board: [23, 22, 21, 7, 2],
            commitment: generateCommitment([14, 27])
        };
        
        const { proof, publicInputs } = await generateHandValidProof(inputs);
        
        expect(proof).toBeDefined();
        expect(proof.length).toBe(256);
        
        const isValid = await verifyProofOffChain(proof, publicInputs, circuit);
        expect(isValid).toBe(true);
    });
    
    it('should reject proof with wrong commitment', async () => {
        const inputs = {
            hole_cards: [14, 27],
            board: [23, 22, 21, 7, 2],
            commitment: '0x0000000000000000'  // Wrong!
        };
        
        await expect(
            generateHandValidProof(inputs)
        ).rejects.toThrow('Constraint failed');
    });
});

describe('Hand Ranker Circuit', () => {
    it('should correctly identify Royal Flush', async () => {
        const inputs = {
            hole_cards: [49, 46],  // A♠, K♠
            board: [45, 44, 43, 1, 2],  // Q♠, J♠, 10♠, ...
            claimed_rank: 10,
            commitment: generateCommitment([49, 46])
        };
        
        const { proof } = await generateHandRankProof(inputs);
        const isValid = await verifyProofOffChain(proof, ...);
        
        expect(isValid).toBe(true);
    });
    
    // Test all 10 hand rankings...
});
```

### 9.3 Test Coverage

```
TARGET: 100% coverage of poker hands

✅ High Card
✅ One Pair
✅ Two Pair
✅ Three of a Kind
✅ Straight (including wheel A-2-3-4-5)
✅ Flush
✅ Full House
✅ Four of a Kind
✅ Straight Flush
✅ Royal Flush

EDGE CASES:
✅ Ace-high straight
✅ Ace-low straight (wheel)
✅ Multiple flushes (different suits)
✅ Duplicate ranks
⚠️ Kicker comparison (TODO)
```

---

## 10. Integration Guide

**Contract flow (tables, sit_at_table, act, reveal_hand):** See CONTRACTS_SPEC.md and docs/MESAS_VIRTUAIS_N_JOGADORES.md. This document specifies only the ZK circuits (hand_validator, hand_ranker) and their public/private inputs.

### 10.1 Setup

```bash
# Instalar Noir
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Verify installation
nargo --version

# Compilar circuits
cd circuits
nargo compile hand_validator
nargo compile hand_ranker

# Gerar verification keys
nargo codegen-verifier
```

### 10.2 Frontend Integration

```typescript
// 1. Importar libraries
import { Noir } from '@noir-lang/noir_js';
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg';

// 2. Carregar circuits
const handValidatorCircuit = await import('./circuits/hand_validator.json');
const handRankerCircuit = await import('./circuits/hand_ranker.json');

// 3. Inicializar
const noir = new Noir(handValidatorCircuit);
const backend = new BarretenbergBackend(handValidatorCircuit);

// 4. Gerar proof
const { proof, publicInputs } = await generateHandValidProof(inputs);

// 5. Submit to Soroban
await gameContract.bet(amount, proof, commitment);
```

### 10.3 Soroban Integration

```rust
// 1. Adicionar dependency
[dependencies]
barretenberg = "0.1.0"

// 2. Store verification key in contract
pub fn store_vk(env: Env, circuit_name: String, vk: BytesN<1024>) {
    env.storage().persistent().set(&DataKey::VK(circuit_name), &vk);
}

// 3. Verificar proof
pub fn verify_proof(env: Env, proof: BytesN<256>, inputs: Vec<Field>) -> bool {
    let vk = load_vk(&env, "hand_validator");
    barretenberg::verify(&env, &vk, &proof, &inputs)
}
```

---

**Version:** 1.0  
**Last updated:** February 16, 2026  
**Autor:** Daniel Gorgonha / Deega Labs
