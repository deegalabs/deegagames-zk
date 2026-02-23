# Technical Architecture — Poker ZK on Stellar

**Detailed Architecture Document v2.0**

> **Alignment:** Full Texas Hold'em: blinds (SB/BB), 4 betting rounds (Pre-Flop, Flop, Turn, River), Fold/Check/Call/Raise actions, progressive board (3 → 4 → 5 cards).

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [System layers](#2-system-layers)
3. [10-decision framework](#3-10-decision-framework)
4. [Data flow](#4-data-flow)
5. [Separation of responsibilities](#5-separation-of-responsibilities)
6. [Trust model](#6-trust-model)
7. [Failure modes](#7-failure-modes)
8. [Performance and latency](#8-performance-and-latency)
9. [Scalability](#9-scalability)
10. [Security](#10-security)

---

## 1. Architecture overview

### 1.1 Architectural model

**Pattern:** Hybrid On-Chain/Off-Chain Execution with ZK Proofs

```
┌─────────────────────────────────────────────────────────────────┐
│                  POKER ZK ARCHITECTURE (5 LAYERS)               │
└─────────────────────────────────────────────────────────────────┘

LAYER 1: ACTORS (Players)
├─ Player 1 (Freighter Wallet)
└─ Player 2 (Freighter Wallet)
    │
    ▼
LAYER 2: FRONTEND (React + Vite)
├─ Game UI (Card Display + Betting)
├─ Wallet Connector (Freighter SDK)
└─ State Management (Zustand)
    │
    ├──────────────┬──────────────┐
    ▼              ▼              ▼
LAYER 3:      LAYER 4:       LAYER 5:
ZK LAYER      SOROBAN        STELLAR
├─ Noir       ├─ Game        ├─ RPC
│  Circuits   │  Manager     ├─ Horizon
├─ Proof      ├─ Proof       └─ Consensus
│  Generator  │  Verifier
└─ Barretenberg└─ Payment
```

### 1.2 Architectural principles

1. **Privacy First**: Cards never revealed until showdown
2. **Cryptographic Trust**: ZK proofs instead of trusted dealer
3. **Minimal On-Chain**: Only critical state on-chain (cost/latency)
4. **Auditability**: All proofs and commitments public
5. **Fail-Safe**: Timeouts + force-exit mechanisms

---

## 2. System layers

### 2.1 Layer 1: Actors (Players)

**Components:**
- Freighter Wallet (Stellar native)
- Testnet XLM (gas + buy-in)
- Browser with WASM support

**Responsibilities:**
- Sign transactions
- Generate random seeds (shuffle)
- Compute ZK proofs client-side
- Keep cards private off-chain

**Requirements:**
- Freighter extension installed
- Minimum 150 XLM (100 buy-in + 50 gas)
- Modern CPU (proof gen ~10-15s)

### 2.2 Layer 2: Frontend (React + Vite)

**Stack:**
```typescript
Frontend:
├─ Framework: React 18 + TypeScript
├─ Build: Vite
├─ Styling: Tailwind CSS + shadcn/ui
├─ State: Zustand (global state)
├─ Wallet: @stellar/freighter-api
├─ Stellar: @stellar/stellar-sdk
└─ ZK: @noir-lang/noir_js
```

**Modules:**

1. **Game UI**
   - Card display (SVG assets)
   - Betting interface
   - Pot/stack display
   - Game phase indicator

2. **Wallet Connector**
   - Freighter integration
   - Account detection
   - Transaction signing
   - Balance queries

3. **Proof Generator**
   - Load Noir circuits (WASM)
   - Generate proofs client-side
   - Progress indicator (10-15s)
   - Error handling

4. **State Management**
   - Game state sync
   - Player actions queue
   - Blockchain events listener
   - Local card storage (encrypted)

### 2.3 Layer 3: ZK Layer (Noir)

**Circuits:**

#### Circuit #1: hand_validator.nr
```noir
// Size: ~50 LOC
// Constraints: ~200-300
// Proof time: ~5-10s
// Proof size: ~256 bytes

Inputs:
├─ Private: hole_cards [u8; 2]
└─ Public: board [u8; 5], commitment Field

Constraints:
├─ Cards in range [1,52]
├─ No duplicates (hole vs hole, hole vs board)
└─ hash(hole_cards) == commitment
```

#### Circuit #2: hand_ranker.nr
```noir
// Size: ~150 LOC (+ helpers)
// Constraints: ~500-1000
// Proof time: ~10-15s
// Proof size: ~256 bytes

Inputs:
├─ Private: hole_cards [u8; 2]
└─ Public: board [u8; 5], claimed_rank u8, commitment Field

Constraints:
├─ hash(hole_cards) == commitment
└─ compute_hand_rank(hole, board) == claimed_rank

Helper Functions:
├─ is_royal_flush()
├─ is_straight_flush()
├─ is_four_kind()
├─ is_full_house()
├─ is_flush()
├─ is_straight()
├─ is_three_kind()
├─ is_two_pair()
├─ is_one_pair()
└─ compare_kickers()
```

**Proof Generation Flow:**
```
1. Frontend carrega circuit WASM
2. Noir compiles to constraints
3. Barretenberg executa witness generation
4. Gera STARK proof (~10-15s)
5. Returns proof + public inputs
6. Frontend submits to Soroban
```

### 2.4 Layer 4: Soroban (Smart Contracts)

**Contracts:**

#### PokerGameManager (contracts/games/poker)
```rust
// Responsibility: Poker (Texas Hold'em) state machine
// Storage: ~500 bytes per game
// Gas: ~0.01 XLM per tx

State Machine:
├─ WaitingForPlayers
├─ ShuffleCommit
├─ ShuffleReveal
├─ DealCards
├─ Betting
├─ Showdown
└─ Finished

Functions:
├─ create_game(buy_in: i128) -> u64
├─ join_game(game_id: u64)
├─ commit_seed(hash: BytesN<32>)
├─ reveal_seed(seed: BytesN<32>)
├─ bet(amount: i128, proof: BytesN<256>)
├─ fold()
├─ reveal_hand(cards: Vec<u8>, proof: BytesN<256>)
└─ claim_timeout()
```

#### ProofVerifier.rs
```rust
// Responsibility: Verify ZK proofs on-chain
// Gas: ~0.005 XLM per verify

Functions:
├─ verify_hand_valid(proof: BytesN<256>, public_inputs: Vec<Field>) -> bool
├─ verify_hand_rank(proof: BytesN<256>, public_inputs: Vec<Field>) -> bool
└─ verify_commitment(cards: Vec<u8>, commitment: BytesN<32>) -> bool

Integration:
└─ Usa Barretenberg verifier (WASM)
```

#### PaymentController.rs
```rust
// Responsibility: Escrow + payout XLM
// Gas: ~0.002 XLM per transfer

Functions:
├─ lock_funds(player: Address, amount: i128)
├─ payout_winner(winner: Address, pot: i128, rake: i128)
├─ refund_on_timeout(player: Address, amount: i128)
└─ collect_rake(treasury: Address, amount: i128)

Integration:
└─ Usa Stellar Asset Contract (native XLM)
```

#### GameHubIntegration.rs
```rust
// Responsibility: Integration with official hackathon contract
// REQUIRED for submission

const GAME_HUB: &str = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

Functions:
├─ notify_game_start(game_id: u64)
└─ notify_game_end(game_id: u64, winner: Address)
```

### 2.5 Layer 5: Stellar Network

**Components:**

1. **Stellar RPC (Testnet)**
   - Submit transactions
   - Query ledger state
   - ~5s finality (BFT consensus)

2. **Horizon API**
   - Index blockchain events
   - Query transaction history
   - Stream real-time updates

3. **Consensus Layer**
   - Stellar Consensus Protocol (SCP)
   - BFT (Byzantine Fault Tolerant)
   - Assumes >2/3 validators honest

---

## 3. 10-decision framework

### Decision #1: Why blockchain?

**Choice:** Stellar blockchain as settlement layer

**Alternativas:**
- Central server with traditional DB
- P2P without blockchain (WebRTC)
- Ethereum L2 (Arbitrum, zkSync)

**Trade-off:** We gain auditability + trustlessness, we lose latency (~5s finality)

**Rationale:** Poker REQUIRES public audit of fairness. Blockchain is the only way to prove provably fair without a central authority. Stellar chosen for: (a) low gas cost, (b) official ZK hackathon, (c) native XLM integration.

---

### Decision #2: Which blockchain layer?

**Choice:** L1 Stellar Testnet (not L2)

**Alternativas:**
- Ethereum mainnet (too expensive)
- Optimistic Rollup (saques lentos)
- zkRollup (additional complexity)

**Trade-off:** Simplicity vs maximum throughput

**Rationale:** Heads-up poker has low TPS (~1 tx/10s). L1 Stellar handles this easily (~150 TPS available). L2 would add complexity with no benefit for MVP.

---

### Decision #3: Which ZK mechanism?

**Choice:** Noir circuits (not RISC Zero)

**Alternativas:**
- RISC Zero zkVM (general computation)
- Circom (more mature, Ethereum-focused)
- Cairo (Starknet-specific)

**Trade-off:** Learning curve vs flexibility

**Rationale:** Noir ideal for fixed rules (hand ranking). Rust-like syntax (familiar). NoirJS allows proof gen in the browser. RISC Zero better for generic logic (RTS combat), but overkill for poker.

---

### Decision #4: Shuffle strategy

**Choice:** Commit-Reveal Multi-Party (not full Mental Poker)

**Alternativas:**
- Full Mental Poker (Barnett-Smart)
- Central dealer (quebra trust model)
- VRF Oracle (if available on Stellar)

**Trade-off:** We gain simplicity + 2-week feasibility, we lose 100% decentralization

**Rationale:** Full Mental Poker requires 4-6 weeks to implement. Commit-Reveal distributes trust between players, implementable in 2-3 days. Final seed = hash(seed1 || seed2), no single player controls it alone.

**Griefing mitigation:**
```rust
// Timeout protection
const REVEAL_TIMEOUT: u64 = 300; // 5 minutos

if current_time > commit_time + REVEAL_TIMEOUT {
    // Player who did not reveal loses stake
    forfeit_stake(non_revealing_player);
    refund_stake(honest_player);
}
```

---

### Decision #5: Data availability

**Choice:** Hybrid (critical on-chain, rest off-chain)

**Alternativas:**
- Full on-chain (reveal all cards)
- Full off-chain (no audit)
- Celestia/Avail (modular DA)

**Trade-off:** Cost vs privacy

**Rationale:**

**ON-CHAIN:**
- Commitments (hash cartas)
- ZK proofs
- Bets e pot state
- Final hand rankings
- XLM transfers

**OFF-CHAIN:**
- Actual card values (until showdown)
- Intermediate game state
- UI animations

**Benefit:** Cost ~90% lower than full on-chain, keeps privacy (core of ZK).

---

### Decision #6: Indexing

**Choice:** Horizon API (built-in Stellar)

**Alternativas:**
- The Graph subgraph (Ethereum-focused)
- Custom indexer (PostgreSQL)
- Direct RPC polling (ineficiente)

**Trade-off:** Simplicity vs customization

**Rationale:** Horizon API is native to Stellar, no extra setup. Already indexes transactions, contracts, events. Sufficient for MVP (list active games, bet history).

---

### Decision #7: State management

**Choice:** Critical state on-chain, transient off-chain

**Alternativas:**
- Everything on-chain (state bloat)
- Everything off-chain (no audit)
- State channels (complexity)

**Trade-off:** Storage cost vs verifiability

**Rationale:**

**ON-CHAIN:**
- Pot amount
- Player addresses
- Game phase
- Commitments
- Proofs

**OFF-CHAIN:**
- UI state (animations)
- Chat (se tiver)
- Intermediate bets before commit

**Pattern:** Phase transition = on-chain tx. Intermediate moves = local state.

---

### Decision #8: Reorg handling

**Choice:** Wait for 1 confirmation (Stellar finality ~5s)

**Alternativas:**
- 0 confirmations (high risk)
- 6+ confirmations (too slow)
- Automatic rollback (complex)

**Trade-off:** UX latency vs Security

**Rationale:** Stellar BFT consensus = near-instant finality. Deep reorgs are extremely rare. 1 confirmation (~5s) = sweet spot for UX.

**Reorg detection:**
```typescript
// Frontend monitora ledger sequence
if (current_sequence < last_known_sequence) {
    // Reorg detectado!
    pauseGame();
    alertPlayers("Blockchain reorganization detected");
    rollbackToLastValidState();
}
```

---

### Decision #9: Interoperability

**Choice:** None (MVP mono-chain)

**Alternativas:**
- Bridge to Ethereum (accept ETH)
- IBC to Cosmos (cross-chain bets)
- Wormhole integration

**Trade-off:** Simplicity vs market reach

**Rationale:** MVP focuses on XLM-native experience. Bridge adds attack surface (hack history) and unnecessary complexity to demonstrate ZK Gaming. Post-hackathon: consider Wormhole to accept USDC/ETH.

---

### Decision #10: Where is the trust?

**Choice:** Multi-party randomness + Cryptographic proofs + Consensus

**Trust Assumptions:**
1. At least 1 player is honest (seed generation)
2. Noir circuit is bug-free (hand ranking)
3. Stellar validators >2/3 honestos (BFT)
4. Soroban VM executes correctly (WASM)

**We do not trust:**
- ❌ Central dealer
- Single player generating all randomness
- ❌ Off-chain server validar proofs
- Players revealing cards before proofs

---

## 4. Data flow

### 4.1 Game creation flow

```
Player 1                Frontend              Soroban              Stellar
   │                       │                     │                    │
   │─────createGame()─────>│                     │                    │
   │                       │──sign_tx()─────────>│                    │
   │                       │                     │──submit_tx()──────>│
   │                       │                     │<──confirmed────────│
   │                       │<──game_id=42────────│                    │
   │<───"Game Created"─────│                     │                    │
   │                       │                     │                    │
   │                       │──notify_hub()──────>│                    │
   │                       │  (start_game)       │                    │
```

### 4.2 Shuffle flow (Commit-Reveal)

```
P1          P2          Frontend        Soroban         Stellar
│           │              │              │               │
│──gen_seed1()──>          │              │               │
│──hash(seed1)──>          │              │               │
│           │──commit()───>│──sign_tx()──>│──submit()────>│
│           │              │              │<──confirmed───│
│           │              │              │               │
│           │<──gen_seed2()──────────────────────────────│
│           │<──hash(seed2)────────────────────────────  │
│           │──commit()───>│──sign_tx()──>│──submit()────>│
│           │              │              │<──confirmed───│
│           │              │              │               │
│──reveal(seed1)──────────>│──sign_tx()──>│──submit()────>│
│           │              │              │<──confirmed───│
│           │──reveal(seed2)──────────────>│──submit()────>│
│           │              │              │<──confirmed───│
│           │              │              │               │
│           │              │<──final_seed─────────────────│
│           │              │  =hash(s1||s2)               │
```

### 4.3 Proof generation flow

```
Player              Frontend           Noir Circuit      Soroban
  │                    │                    │              │
  │──bet_action()─────>│                    │              │
  │                    │──load_circuit()───>│              │
  │                    │                    │              │
  │                    │──generate_proof()─>│              │
  │                    │  (hole_cards,      │              │
  │                    │   board,           │              │
  │                    │   commitment)      │              │
  │                    │                    │              │
  │                    │                    │──compute()──>│
  │                    │                    │  (~10-15s)   │
  │                    │<──proof_π──────────│              │
  │                    │                    │              │
  │                    │──submit_bet()──────────────────>  │
  │                    │  (amount, proof_π)               │
  │                    │                    │<──verify()───│
  │                    │                    │              │
  │<──"Bet Accepted"───│<──────────────────────────────────│
```

---

## 5. Separation of responsibilities

| Layer | Location | Responsibility | Trust Level |
|--------|-------------|------------------|-------------|
| **Shuffle** | Off-chain (Multi-party) | Generate random seed | 🟡 Distributed trust |
| **Card Dealing** | Off-chain (Client) | Derive cards from seed | 🟢 Deterministic |
| **Hand Validation** | ZK Proof (Noir) | Prove valid hand | 🟢 Cryptographic |
| **Proof Verification** | On-chain (Soroban) | Verify ZK proofs | 🟢 Consensus |
| **Payout** | On-chain (Soroban) | Transfer XLM to winner | 🟢 Consensus |
| **Data Availability** | On-chain (Stellar) | State roots + proofs | 🟢 Consensus |

---

## 6. Trust Model

### 6.1 Assumimos Que

At least 1 player is honest in seed generation  
✅ **Stellar validators >2/3 honestos** (BFT consensus)  
✅ **Noir circuit correto** (hand ranking logic)  
Barretenberg prover has no bugs  
Soroban VM executes WASM deterministically  
Stellar Testnet will not suffer deep reorg (>10 blocks)

### 6.2 Quebra Se

🔴 **Ambos players colidem** (seed manipulation)  
🔴 **>1/3 Stellar validators atacam rede** (Byzantine)  
Critical bug discovered in Noir circuit  
Exploit in Barretenberg backend
Bug in Soroban contract (reentrancy, overflow)
🔴 **Testnet resetada** (loss of state)

### 6.3 We do not trust

❌ **Central dealer** (eliminado)  
Single player controlling randomness  
❌ **Off-chain server validar proofs**  
Players being honest without proofs  
Frontend not being modified (open-source)

---

## 7. Failure modes

### Failure #1: Player abandons during shuffle

**Scenario:** P1 commits seed, P2 does not reveal (griefing)

**Impact:** Game stuck, P1 cannot recover stake

**Probability:** Medium (if player has bad intent)

**Mitigation:**
```rust
// Timeout: If P2 does not reveal in 5 min → forfeit
const REVEAL_TIMEOUT: u64 = 300;

if env.ledger().timestamp() > game.commit_time + REVEAL_TIMEOUT {
    // P2 loses stake (goes to P1)
    forfeit_penalty(&game.player2, &game.player1);
    // Contract can cancel game
    game.state = GameState::Cancelled;
}
```

---

### Failure #2: Bug in Noir circuit (hand ranking)

**Scenario:** Circuit accepts invalid proof (e.g. Ace-high straight bug)

**Impact:** Player wins with inferior hand (cryptographic fraud)

**Probability:** Medium (ZK circuits are complex)

**Mitigation:**
- **Extensive Testing:** 100+ test cases (all hand combinations)
- **Audit:** Code review by ZK experts (post-hackathon)
- **Dispute Period:** Allow challenge within 24h (future)
- **Open Source:** Community can audit circuit

---

### Failure #3: Transaction front-running

**Scenario:** Validator sees P1's tx (bet) before commit, manipulates order

**Impact:** P2 can decide fold/call based on P1 action (unfair advantage)

**Probability:** Low (Stellar has private mempool)

**Mitigation:**
- **Commit-Reveal for Bets:** P1 commits hash(action), P2 commits, both reveal
- **Encrypted Mempool:** Stellar validators do not see tx before including
- **Timelock:** Actions only valid after N blocks

---

### Failure #4: Gas limit exceeded (proof verification)

**Scenario:** On-chain proof verification consumes too much gas, tx fails

**Impact:** Game cannot finish, pot stuck

**Probability:** Medium (depends on proof complexity)

**Mitigation:**
- **Gas Profiling:** Test cost of verify() before deploy
- **Proof Optimization:** Minimize constraints in circuit
- **Fallback:** If verify fails, allow admin intervention (emergency)
- **Batching:** Verify multiple proofs in 1 tx (future)

---

### Failure #5: Stellar Testnet reset

**Scenario:** Stellar Testnet is reset (full state wipe)

**Impact:** All games lost, XLM disappears (but it is Testnet, no real value)

**Probability:** Medium (Testnets reset periodically)

**Mitigation:**
- **Off-Chain Backup:** Snapshot game state in DB
- **Mainnet Migration Plan:** Prepare mainnet deploy
- **User Warning:** "Testnet may reset, use for demo only"

---

## 8. Performance and latency

### 8.1 Timing per phase

| Phase | Actions | Estimated time | Bottleneck |
|------|-------|----------------|---------|
| **Join Game** | 2 tx (create + join) | ~10s (2x 5s finality) | Stellar consensus |
| **Shuffle** | 4 tx (2 commits + 2 reveals) | ~20s | Stellar consensus |
| **Deal Cards** | Off-chain (deterministic) | <1s | Local computation |
| **Betting** | Proof gen + 2 tx | ~15-20s (10s proof + 10s tx) | ZK proof generation |
| **Showdown** | 2 proofs + 2 tx | ~30-40s | ZK proof generation |
| **Payout** | 1 tx (automatic) | ~5s | Stellar consensus |

**Total Game Time:** ~80-100 segundos (~1.5 minutos)

### 8.2 Future optimizations

1. **Proof Pre-computation:**
   - Pre-gerar proofs comuns (pairs, flush)
   - Cache in IndexedDB
   - Reduces latency to ~2-3s

2. **Transaction batching:**
   - Combine multiple actions in 1 tx
   - Reduces confirmations from 4 to 2
   - Economiza ~10s

3. **GPU Acceleration:**
   - WebGPU for proof generation
   - Reduces time from 10-15s to 2-3s
   - Requer browser support

4. **State Channels:**
   - Off-chain betting rounds
   - Only settle on-chain at the end
   - Reduz custo ~80%

---

## 9. Scalability

### 9.1 Current limitations (MVP)

- **Players:** 2 (heads-up)
- **Concurrent Games:** ~10-20 (Testnet limit)
- **TPS:** ~1 tx/10s per game
- **Storage:** ~500 bytes per game

### 9.2 Scalability roadmap

**Phase 1 (MVP):** Heads-up, Testnet  
**Phase 2 (Post-Hackathon):** Multiplayer (6-9 players), Mainnet  
**Phase 3 (Produto):** Tournaments, State Channels, L2  

### 9.3 Bottlenecks

1. **Proof Generation (Client-side):**
   - Limited by player CPU
   - Solution: GPU acceleration, pre-computation

2. **Stellar Finality (~5s):**
   - Inherent to consensus
   - Solution: State channels for off-chain actions

3. **Gas Costs (Mainnet):**
   - ~0.02 XLM per game (~$0.002)
   - Solution: Batching, L2 (Soroban rollup)

---

## 10. Security

### 10.1 Attack vectors

| Attack | Probability | Impact | Mitigation |
|--------|---------------|---------|-----------|
| **Seed Manipulation** | Medium | High | Multi-party commit-reveal |
| **Circuit Bug** | Medium | High | Extensive tests + audit |
| **Front-Running** | Low | Medium | Encrypted mempool |
| **Griefing (timeout)** | Medium | Medium | Forfeit penalty |
| **Reentrancy** | Low | High | Checks-effects-interactions |
| **Integer Overflow** | Low | High | Rust safe math |
| **Sybil Attack** | Low | Medium | Stake requirement |

### 10.2 Security measures

1. **Smart Contract:**
   - Checks-effects-interactions pattern
   - Reentrancy guards
   - Safe math (Rust default)
   - Access control (only players)

2. **ZK Circuits:**
   - Extensive unit tests (100+ cases)
   - Constraint coverage analysis
   - Open-source audit

3. **Frontend:**
   - Input validation
   - CSP headers
   - No eval() usage
   - Secure randomness (crypto.getRandomValues)

4. **Operational:**
   - Rate limiting (DoS protection)
   - Monitoring & alerts
   - Emergency pause mechanism
   - Upgrade path (proxy pattern)

---

## Success metrics

### Technical
- ✅ Proof generation time: < 15s
- ✅ Verification cost: < $0.01
- ✅ Throughput: 10+ moves/min
- ✅ Latency: < 5s user feedback

### Gameplay
- ✅ Session time: > 5min
- ✅ Replay value: Alta
- Skill cap: Medium
- ✅ Onboarding: < 2min

### Arquitetura
- ✅ Code coverage: > 70%
- ✅ Circuit auditado: Sim
- Documentation: Complete
- Reproducible deploy: Yes

---

**Version:** 1.0  
**Last updated:** February 16, 2026  
**Autor:** Daniel Gorgonha / Deega Labs
