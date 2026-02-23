# DeegaGames ZK

**Provably fair games with Zero-Knowledge proofs on Stellar**

[![Hackathon](https://img.shields.io/badge/Stellar-ZK%20Gaming%20Hackathon-blue)](https://dorahacks.io/hackathon/stellar-hacks-zk-gaming/detail)
[![Prize](https://img.shields.io/badge/Prize%20Pool-$10k%20USD-green)](https://dorahacks.io/hackathon/stellar-hacks-zk-gaming/detail)

---

## Overview

**DeegaGames ZK** is a **multi-game platform** on Stellar Soroban. Each game has its own contract under `contracts/games/`. The first game is **Poker ZK**: Texas Hold'em heads-up (2 players), mandatory blinds, 4 betting rounds (Pre-Flop, Flop, Turn, River), Fold/Check/Call/Raise, and ZK proofs for fairness. Built with **Soroban** (Rust) and **Noir** (circuits). Frontend package: **deegagames-zk**.

### Problem

Traditional online poker requires trusting a centralized dealer. Players cannot verify:
- Whether the shuffle was fair
- Whether their cards were not seen by others
- Whether the outcome was not manipulated

### Solution

Poker ZK addresses this with:
- **Commit-Reveal Multi-Party**: Distributed shuffle without a central dealer
- **Hand Validation (Noir)**: Prove you have a valid hand without revealing cards
- **Hand Ranking (Noir)**: Prove correct hand rank at showdown
- **XLM Integration**: Bets in Lumens (XLM) via Soroban smart contracts

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DEEGAGAMES ZK                            │
│              (Poker ZK · first game)                        │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐
│   Player 1   │         │   Player 2   │
│  (Freighter) │         │  (Freighter) │
└──────┬───────┘         └──────┬───────┘
       │                        │
       └────────┬───────────────┘
                │
        ┌───────▼────────┐
        │   Frontend     │
        │  React + Vite  │
        └───────┬────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───▼────┐  ┌──▼───┐  ┌───▼─────┐
│  Noir  │  │Stellar│  │ Horizon │
│Circuits│  │Soroban│  │   API   │
└────────┘  └───────┘  └─────────┘
    │           │
    │      ┌────▼─────┐
    │      │ Game Hub │
    │      │ Contract │
    │      └──────────┘
    │
┌───▼──────────────────┐
│  ZK Proof Generation │
│   (Client-side)      │
└──────────────────────┘
```

**Layers:**
1. **Players**: Freighter Wallet (Stellar native)
2. **Frontend**: React + TypeScript + Vite
3. **ZK Layer**: Noir circuits (hand_validator.nr + hand_ranker.nr)
4. **Blockchain**: Stellar Soroban (Testnet)
5. **Indexing**: Horizon API (built-in)

---

## Repository structure

```
deegagames-zk/   (or poker-zk-stellar/)
├── README.md, ARCHITECTURE.md, CONTRACTS_SPEC.md, CIRCUITS_SPEC.md, GAME_FLOW.md, SPEC_COMPLETE.md, TASKS.md
├── contracts/           # Soroban contracts
│   ├── games/
│   │   └── poker/      # Poker ZK (Texas Hold'em) — crate poker-game-manager
│   ├── game-hub/        # start_game / end_game (shared by games)
│   ├── payment-controller/  # XLM escrow (shared)
│   └── proof-verifier/  # On-chain ZK verification
├── circuits/            # Noir circuits (hand_validator, hand_ranker)
├── frontend/            # deegagames-zk — React + Vite, library of games
├── scripts/             # Build, deploy, bindings (poker-game-manager)
└── docs/                # Optional notes
```

### Where the code lives

- **Poker contract:** `contracts/games/poker/` (crate `poker-game-manager`, WASM `poker_game_manager.wasm`). State machine, Game Hub, optional PaymentController/ProofVerifier.
- **Frontend:** `frontend/` (package **deegagames-zk**). React + Vite, Stellar Wallets Kit + Freighter. Games library + Poker ZK UI.
- **Circuits:** `circuits/hand_validator/`, `circuits/hand_ranker/` — Noir (stubs; full logic per CIRCUITS_SPEC).

**Build and run:**

```bash
stellar contract build --package poker-game-manager
# Or: ./scripts/build.sh
cargo test -p poker-game-manager
cd frontend && pnpm install && pnpm dev
```

**Deploy:** `./scripts/deploy.sh` (Stellar CLI + identity with XLM). Set `VITE_POKER_ZK_CONTRACT_ID` in `frontend/.env`. Bindings: `./scripts/bindings.sh` (copy into `frontend/src/games/poker-zk/bindings.ts`).

**Local & 2-player:** See `frontend/.env.example`. Run `pnpm run setup` in frontend, fund both addresses, restart dev server.

---

## MVP scope (heads-up Texas Hold'em)

### Feature set

| Feature | MVP (2 players) | Note |
|---------|-----------------|------|
| **Players** | 2 (heads-up) | 4+ table in future version |
| **Blinds** | Small Blind + Big Blind (e.g. 5/10 XLM) | Mandatory |
| **Betting** | Fold, Check, Call, Raise | Full actions |
| **Rounds** | Pre-Flop, Flop, Turn, River | 4 betting rounds |
| **Board** | 3 → 4 → 5 progressive cards | Flop, Turn, River |
| **Stakes** | Buy-in + blinds (e.g. 100 XLM stack, 5/10 blinds) | Configurable |
| **Network** | Testnet | Mainnet later |

### ZK proofs (Noir)

We use **Noir** for circuits (not RISC Zero). See [CIRCUITS_SPEC.md](CIRCUITS_SPEC.md).

1. **Proof #1**: "I have a valid hand" (when betting) — `hand_validator`
2. **Proof #2**: "Correct hand rank" (showdown) — `hand_ranker`
3. **Proof #3**: "Valid commitment" (anti-cheat)

### Randomness strategy

**Commit-Reveal Multi-Party:**
```
1. P1 commits hash(seed1)
2. P2 commits hash(seed2)
3. P1 reveals seed1
4. P2 reveals seed2
5. Final seed = hash(seed1 || seed2)
6. Deck = shuffle(final_seed)
```

**Griefing protection:** Timeout (5 min) + forfeit stake

---

## Zero-Knowledge circuits (Noir)

### Circuit #1: Hand Validator
```noir
// Proof: "I have 2 valid cards"
fn main(
    hole_cards: [u8; 2],      // Private
    board: pub [u8; 5],       // Public
    commitment: pub Field     // Public
) {
    // Constraints:
    // 1. Cards in range [1,52]
    // 2. No duplicates
    // 3. Correct commitment
}
```

### Circuit #2: Hand Ranker
```noir
// Proof: "My hand rank is correct"
fn main(
    hole_cards: [u8; 2],      // Private
    board: pub [u8; 5],       // Public
    claimed_rank: pub u8,     // Public (1-10)
    commitment: pub Field     // Public
) {
    // Constraints:
    // 1. Correct commitment
    // 2. Computed ranking = claimed_rank
}
```

**Complexity:**
- Total LOC: ~200 (circuit + helpers)
- Constraints: ~500-1000
- Proof gen: ~10-15s (client-side)
- Proof verify: <1s (on-chain)

---

## XLM integration (Stellar Soroban)

### Smart contracts

1. **PokerGameManager** (`contracts/games/poker`): Poker state machine
2. **ProofVerifier**: ZK proof verification (shared)
3. **PaymentController**: Escrow + XLM payout (shared)
4. **GameHub**: start_game / end_game (shared; stub)

### Game Hub integration

```rust
// Official Game Hub interface:
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,        // Contract address
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool        // true if P1 won
    );
}

// Required calls:
hub.start_game(&game_id_address, session_id, &p1, &p2, 0, 0);
hub.end_game(&session_id, player1_won);
```

### Tokenomics

```
Buy-in: 100 XLM (locked on-chain)
Pot: 200 XLM (2 players)
Rake: 2% (4 XLM → treasury)
Payout: 196 XLM → Winner
```

---

## Full game flow

```
PHASE 1: JOIN GAME (~10s)
├─ P1: createGame(100 XLM)
├─ P2: joinGame(100 XLM)
└─ Pot = 200 XLM locked

PHASE 2: SHUFFLE (~20s)
├─ P1: commitSeed(hash(seed1))
├─ P2: commitSeed(hash(seed2))
├─ P1: revealSeed(seed1)
├─ P2: revealSeed(seed2)
└─ Deck = shuffle(hash(seed1||seed2))

PHASE 3: DEAL CARDS (<1s)
├─ P1 receives: [A♠, K♠] (private)
├─ P2 receives: [Q♥, J♥] (private)
└─ Board: [10♠, 9♠, 8♠, 7♦, 2♣] (public)

PHASE 4: BETTING (~15-20s)
├─ P1: bet(20 XLM) + proof "valid hand"
├─ P2: call(20 XLM) + proof "valid hand"
└─ Pot = 240 XLM

PHASE 5: SHOWDOWN (~30-40s)
├─ P1: reveal(cards) + proof "Straight Flush (rank=9)"
├─ P2: reveal(cards) + proof "Flush (rank=6)"
└─ Contract: verify proofs + compare ranks

PHASE 6: PAYOUT (~5s)
├─ Winner: P1 (rank 9 > rank 6)
├─ Rake: 4.8 XLM (2%)
└─ Transfer: 235.2 XLM → P1
```

**Total game time:** ~80-100 seconds (~1.5 minutes)

---

## Competitive differentiators

| Criteria | Poker ZK Lite | Traditional Poker | Full Mental Poker |
|----------|---------------|-------------------|-------------------|
| **Trust model** | Multi-party + ZK | Central dealer | Fully trustless |
| **Provably fair** | Yes | No | Yes |
| **Complexity** | Medium | Low | Very high |
| **Feasibility 2 weeks** | Yes | Yes | No (4-6 weeks) |
| **Market appeal** | High | Medium | High |

**Total score:** 88/100 (Top 3 target)

---

## Trust assumptions

### We assume
- At least 1 player is honest (seed generation)
- Stellar validators >2/3 are honest (BFT consensus)
- Noir circuit is correct (hand ranking logic)
- Soroban VM executes WASM deterministically

### Breaks if
- Both players collude (seed manipulation)
- >1/3 Stellar validators attack the network (Byzantine)
- Critical bug in Noir circuit
- Exploit in Barretenberg backend

### We do NOT trust
- Central dealer (eliminated)
- Single player controlling randomness
- Off-chain server to validate proofs
- Players being honest without proofs

---

---

## Submission requirements

### Official checklist

- [ ] **ZK mechanic core**: Working Noir circuits
- [ ] **Deploy Testnet**: Contracts + Game Hub integration
- [ ] **Frontend**: Playable UI with Freighter wallet
- [ ] **Open source**: Public GitHub with README
- [ ] **Video demo**: 2-3 min showing gameplay + ZK

### Deliverables

**Code:**
- Soroban contracts (Rust)
- Noir circuits (.nr files)
- Frontend (React + TS)
- Tests (unit + integration)

**Docs:**
- Technical README
- Architecture (this doc)
- Trust assumptions
- Setup instructions

**Demo:**
- Gameplay video
- Live deploy URL (Testnet)
- ZK proofs walkthrough

---

**Deploy and bindings** are done from this repo: `./scripts/deploy.sh`, `./scripts/bindings.sh`. Game Hub (start_game / end_game) is implemented in the poker contract.

---

## Documentation (this repository)

Documents used for hackathon evaluation:

| Document | Description |
|----------|-------------|
| [README.md](./README.md) | This file — overview and setup |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture (5 layers, decisions) |
| [CONTRACTS_SPEC.md](./CONTRACTS_SPEC.md) | Soroban contract specification |
| [CIRCUITS_SPEC.md](./CIRCUITS_SPEC.md) | ZK circuit specification (Noir) |
| [GAME_FLOW.md](./GAME_FLOW.md) | Game flow (phases, actions, states) |
| [SPEC_COMPLETE.md](./SPEC_COMPLETE.md) | Complete spec for dev (Game Hub, act(), errors, storage) |
| [TASKS.md](./TASKS.md) | Per-folder tasks (checklist from specs) |

---

## Useful links

### Hackathon
- [DoraHacks Page](https://dorahacks.io/hackathon/stellar-hacks-zk-gaming/detail)
- [Quickstart Guide](https://dorahacks.io/hackathon/stellar-hacks-zk-gaming/quickstart-guide)
- [Resources](https://dorahacks.io/hackathon/stellar-hacks-zk-gaming/resources)

### Stellar Game Studio (reference)
- [GitHub Repo](https://github.com/jamesbachini/Stellar-Game-Studio)

### Stellar
- [Stellar Docs](https://developers.stellar.org/)
- [Soroban Docs](https://stellar.org/soroban)
- [Protocol 25 (X-Ray)](https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25)

### ZK tools
- [Noir Docs](https://noir-lang.org/docs/)
- [RISC Zero Docs](https://dev.risczero.com/)
- [Noir Verifier](https://github.com/yugocabrio/rs-soroban-ultrahonk)

### Support
- [Telegram Group](https://t.me/+FEA6-X1dfelkMzE5)
- [Discord #zk-chat](https://discord.gg/MRZCHcMWDE)

---

## License

MIT License — Open Source

---

## Team

**Developer:** Daniel Gorgonha  
**Hackathon:** Stellar ZK Gaming  
**Organization:** Deega Labs  

---

## Goal

**Win $5,000 USD (1st place)** by demonstrating:
- ZK proofs actually work (not fake)
- Commitment scheme well implemented
- Hybrid on/off-chain architecture
- Surprisingly good UX for ZK
- Professional documentation of trade-offs

---

**Status:** In development  
**Last updated:** February 2026
