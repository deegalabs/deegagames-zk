# Contract Specification — Poker ZK on Stellar

**Soroban Smart Contracts Specification v2.0**

> **Alignment:** Full Texas Hold'em: mandatory blinds, 4 betting rounds (Pre-Flop, Flop, Turn, River), Fold / Check / Call / Raise actions.

---

## Table of contents

1. [Overview](#1-overview)
2. [GameManager Contract](#2-gamemanager-contract)
3. [ProofVerifier Contract](#3-proofverifier-contract)
4. [PaymentController Contract](#4-paymentcontroller-contract)
5. [GameHubIntegration Contract](#5-gamehubintegration-contract)
6. [Data Structures](#6-data-structures)
7. [Events](#7-events)
8. [Error Codes](#8-error-codes)
9. [Gas Estimates](#9-gas-estimates)
10. [Security Considerations](#10-security-considerations)

---

## 1. Overview

### 1.1 Contract architecture

```
┌─────────────────────────────────────────────────────┐
│              SOROBAN CONTRACTS                      │
└─────────────────────────────────────────────────────┘

┌──────────────────┐
│  PokerGameManager (games/poker)  │ ◄─── Poker state machine
└────────┬─────────┘
         │
    ┌────┼────┬─────────────┐
    │    │    │             │
┌───▼────▼────▼───┐   ┌────▼──────────┐
│ ProofVerifier.rs│   │ Payment       │
│                 │   │ Controller.rs │
└─────────────────┘   └───────────────┘
         │                    │
    ┌────▼────────────────────▼────┐
    │  GameHubIntegration.rs       │
    │  (Hackathon requirement)     │
    └──────────────────────────────┘
              │
         ┌────▼────┐
         │ Stellar │
         │ Network │
         └─────────┘
```

### 1.2 Responsibilities

| Contract | Responsibility | Storage | Gas/tx |
|----------|----------------|---------|--------|
| **GameManager** | State machine, game logic | ~500 bytes | ~0.01 XLM |
| **ProofVerifier** | Verify ZK proofs | ~100 bytes | ~0.005 XLM |
| **PaymentController** | Escrow + payout XLM | ~200 bytes | ~0.002 XLM |
| **GameHubIntegration** | Notify hackathon hub | ~50 bytes | ~0.001 XLM |

---

## 2. GameManager Contract

### 2.1 Overview

**File:** `contracts/games/poker/src/lib.rs` (crate `poker-game-manager`)

**Responsibility:** Manage game state machine, validate transitions, coordinate other contracts.

### 2.2 Stellar Game Studio alignment

GameManager follows the **Stellar Game Studio** pattern (see [AGENTS.md](https://github.com/jamesbachini/Stellar-Game-Studio/blob/main/AGENTS.md) in the [Stellar-Game-Studio](https://github.com/jamesbachini/Stellar-Game-Studio) repo):

| Requirement | Application in Poker ZK |
|-------------|--------------------------|
| **Constructor / Init** | Use `__constructor(env, admin, game_hub)` or `initialize(env, admin, config)` and store **Admin** and **GameHub** (or `config.game_hub`) in **instance storage** (e.g. `DataKey::Admin`, `DataKey::GameHubAddress`). |
| **Game Hub** | Call `game_hub.start_game(...)` **before** persisting game state (in `join_game`, when P2 joins). Call `game_hub.end_game(...)` **before** finalizing the winner (on fold, reveal_hand or claim_timeout). |
| **Auth for start_game** | Ensure both players are authorized to start: in Poker, P1 authorizes in `create_game`, P2 in `join_game`. If the Hub requires `require_auth_for_args` for points, pass `buy_in` as `player1_points`/`player2_points` and obtain auth from both per Hub interface. |
| **Storage and TTL** | Use **temporary storage** for game state (`DataKey::Game(game_id)`). On **every** state write (`save_game`), use `extend_ttl` (or `set` with TTL) of **30 days** (e.g. `518_400` ledgers or equivalent in seconds). Never use persistent for session data. |
| **Randomness** | **Deterministic:** use PRNG with seed derived from known data (e.g. `session_id`, addresses, `final_seed`). Do **not** use `env.ledger().timestamp()` or `env.ledger().sequence()` for drawing. See §2.6 and CIRCUITS_SPEC for `derive_board_cards` and deck. |

Reference: [Stellar Game Studio AGENTS.md](https://github.com/jamesbachini/Stellar-Game-Studio/blob/main/AGENTS.md) (Contract Checklist, Deterministic Randomness).

### 2.3 State Machine

Full Texas Hold'em: blinds, 4 betting rounds (Pre-Flop, Flop, Turn, River), progressive board (0 → 3 → 4 → 5 cards).

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GameState {
    WaitingForPlayers,   // Waiting for P2 to join
    ShuffleCommit,       // Players committing seeds
    ShuffleReveal,       // Players revealing seeds
    DealCards,           // Deriving cards from seed (hole + board)
    PostBlinds,          // Collect Small Blind + Big Blind
    PreFlop,             // Pre-flop betting round (2 hole cards)
    Flop,                // Reveal 3 community cards
    FlopBetting,         // Post-flop betting round
    Turn,                // Reveal 4th community card
    TurnBetting,         // Post-turn betting round
    River,               // Reveal 5th community card
    RiverBetting,        // Final betting round
    Showdown,            // Reveal hands, compare ranking
    Finished,            // Game finished, payout
    Cancelled,           // Game cancelled (timeout)
}
```

**Valid transitions:**
```
WaitingForPlayers → ShuffleCommit (when P2 joins)
ShuffleCommit → ShuffleReveal (both committed)
ShuffleReveal → DealCards (both revealed; derive deck)
DealCards → PostBlinds (collect SB + BB)
PostBlinds → PreFlop (blinds in pot)
PreFlop → Flop (both acted: check/call/fold; no one folded)
PreFlop → Finished (someone folded → other wins)
Flop → FlopBetting (reveal 3 cards)
FlopBetting → Turn (round matched)
FlopBetting → Finished (fold)
Turn → TurnBetting (reveal 4th card)
TurnBetting → River (round matched)
TurnBetting → Finished (fold)
River → RiverBetting (reveal 5th card)
RiverBetting → Showdown (round matched)
RiverBetting → Finished (fold)
Showdown → Finished (winner determined, payout)
* → Cancelled (timeout in any phase)
```

### 2.4 Data Structures

**Mesas (Tables):** A mesa define blinds, limites de buy-in e número de lugares. A primeira mesa é criada no construtor; outras via `add_table` (só admin). Jogadores "sentam" com `sit_at_table(table_id, buy_in)`; se 0/2 fica uma sala de espera (1/2); quando o 2.º senta, o jogo é criado e inicia (ShuffleCommit).

```rust
/// Mesa: blinds, limites, max_seats. table_id = índice (0, 1, …); primeira mesa no construtor, resto com add_table.
#[contracttype]
pub struct Table {
    pub small_blind: i128,
    pub big_blind: i128,
    pub min_buy_in: i128,
    pub max_buy_in: i128,
    pub max_seats: u32,  // e.g. 2 (MVP) or 4
}

/// Uma sala de espera por mesa (1/2). Quando 2.º senta → game criado e sala limpa.
#[contracttype]
pub struct WaitingSession {
    pub player1: Address,
    pub buy_in: i128,
    pub created_at: u64,
}

/// Resultado de sit_at_table: waiting = true (1/2) ou false e game_id quando 2/2.
#[contracttype]
pub struct SitResult {
    pub waiting: bool,
    pub game_id: u64,
}

/// Who is the dealer (0 = P1, 1 = P2). Heads-up: SB = dealer, BB = other.
#[contracttype]
pub struct Game {
    pub id: u64,
    pub state: GameState,
    pub player1: Address,
    pub player2: Option<Address>,
    pub buy_in: i128,           // Initial stack per player (in XLM)
    pub pot: i128,
    pub small_blind: i128,      // e.g. 5 XLM
    pub big_blind: i128,        // e.g. 10 XLM
    pub dealer_position: u8,    // 0 = P1 dealer (P2 BB), 1 = P2 dealer (P1 BB)
    pub board: Vec<u8>,         // 5 community cards (filled once in DealCards; never partial)
    pub board_revealed: u8,     // 0, 3 (flop), 4 (turn), 5 (river) - how many are public
    pub current_bet_p1: i128,   // P1 total bet this round
    pub current_bet_p2: i128,   // P2 total bet this round
    pub total_bet_p1: i128,     // Total bet in hand (for all-in/side pot later)
    pub total_bet_p2: i128,
    pub min_raise: i128,       // Minimum for raise (e.g. big_blind or last raise)
    pub last_raise_amount: i128,
    pub actor: u8,             // 0 = P1's turn, 1 = P2's turn
    pub folded: Option<Address>, // Who folded (if any)
    pub seed_commitment1: Option<BytesN<32>>,
    pub seed_commitment2: Option<BytesN<32>>,
    pub seed_reveal1: Option<BytesN<32>>,
    pub seed_reveal2: Option<BytesN<32>>,
    pub final_seed: Option<BytesN<32>>,
    pub hand_commitment1: Option<BytesN<32>>,
    pub hand_commitment2: Option<BytesN<32>>,
    pub hand_rank1: Option<u8>,
    pub hand_rank2: Option<u8>,
    pub winner: Option<Address>,
    pub created_at: u64,
    pub last_action_at: u64,
    pub table_id: u64,         // Mesa de origem (get_table(table_id) para blinds/limites)
}

#[contracttype]
pub struct GameConfig {
    pub min_buy_in: i128,
    pub max_buy_in: i128,
    pub small_blind: i128,     // e.g. 5 XLM (config only; not per game)
    pub big_blind: i128,       // e.g. 10 XLM (config only)
    pub rake_percentage: u32,  // Basis points (200 = 2%)
    pub reveal_timeout: u64,
    pub bet_timeout: u64,
    pub waiting_timeout: u64,  // Seconds after which anyone can cancel_waiting (0 = only waiting player)
    pub treasury: Address,
    pub game_hub: Address,
    pub payment_controller: Option<Address>,
    pub proof_verifier: Option<Address>,
}
```
**Table configuration:** Cada mesa tem os seus blinds e min/max buy-in (struct Table). O primeiro jogo pode ser criado por `create_game(player, table_id, buy_in)` (1/2 à espera) ou quando o 2.º chama `sit_at_table` (jogo criado automaticamente). Ver docs/MESAS_VIRTUAIS_N_JOGADORES.md e SPEC_COMPLETE.md §6.

### 2.5 Functions

#### 2.5.1 Constructor and Admin

```rust
/// Constructor: admin, game_hub, and first table. Further tables via add_table (admin only).
pub fn __constructor(
    env: Env,
    admin: Address,
    game_hub: Address,
    small_blind: i128,
    big_blind: i128,
    min_buy_in: i128,
    max_buy_in: i128,
    max_seats: u32,
)
/// After deploy: initialize(admin, config) to set GameConfig (waiting_timeout, payment_controller, etc.)
pub fn initialize(env: Env, admin: Address, config: GameConfig) -> Result<(), Error>

/// Add a new table (admin only). Returns new table_id.
pub fn add_table(
    env: Env,
    admin: Address,
    small_blind: i128,
    big_blind: i128,
    min_buy_in: i128,
    max_buy_in: i128,
    max_seats: u32,
) -> Result<u64, Error>

/// Update configuration (admin only)
pub fn update_config(env: Env, admin: Address, config: GameConfig) -> Result<(), Error>
```

#### 2.5.2 Tables and Sitting

```rust
/// Sit at a table. If 0/2 → you become 1/2 (waiting). If 1/2 and you're 2nd with same buy_in → game starts, returns game_id.
pub fn sit_at_table(
    env: Env,
    player: Address,
    table_id: u64,
    buy_in: i128,
) -> Result<SitResult, Error>

/// Get table by id (blinds, limits, max_seats).
pub fn get_table(env: Env, table_id: u64) -> Result<Table, Error>

/// Number of tables (ids 0 .. count-1). Frontend iterates get_table(0)..get_table(count-1).
pub fn get_table_count(env: Env) -> u64

/// Current waiting session for table (1/2). Err(NoWaitingSession) when 0/2.
pub fn get_table_waiting(env: Env, table_id: u64) -> Result<WaitingSession, Error>

/// Cancel waiting (1/2). If caller is the waiting player: always; else only after config.waiting_timeout. Refunds player1 via payment_controller.
pub fn cancel_waiting(env: Env, caller: Address, table_id: u64) -> Result<(), Error>
```

#### 2.5.3 Game Creation (1/2 or direct)

```rust
/// Create a new game (player becomes 1/2 at table). Alternative: 2nd player uses sit_at_table and game is created automatically.
/// @param player: Player 1 address
/// @param table_id: Table id (from get_table_count)
/// @param buy_in: Buy-in amount (within table min/max)
/// @return game_id: Created game ID
pub fn create_game(
    env: Env,
    player: Address,
    table_id: u64,
    buy_in: i128,
) -> Result<u64, Error> {
    // Validations
    player.require_auth();
    let table = load_table(&env, table_id)?;
    require!(buy_in >= table.min_buy_in, Error::BuyInTooLow);
    require!(buy_in <= table.max_buy_in, Error::BuyInTooHigh);
    
    // Lock funds (if payment_controller set)
    if let Some(ref pc) = config.payment_controller { payment_controller::lock_funds(&env, &player, buy_in)?; }
    
    let game_id = next_game_id(&env);
    let game = Game {
        id: game_id,
        state: GameState::WaitingForPlayers,
        player1: player.clone(),
        player2: None,
        buy_in,
        pot: buy_in,
        small_blind: table.small_blind,
        big_blind: table.big_blind,
        table_id,
        created_at: env.ledger().timestamp(),
        last_action_at: env.ledger().timestamp(),
        ..Default::default()
    };
    save_game(&env, game_id, &game);
    // Do NOT call Game Hub here — start_game only when P2 joins (in join_game)
    env.events().publish((symbol_short!("CREATE"), game_id), player);
    Ok(game_id)
}
```

#### 2.5.4 Join Game

```rust
/// Player 2 joins the game
/// @param player: Player 2 address
/// @param game_id: Game ID
pub fn join_game(
    env: Env,
    player: Address,
    game_id: u64,
) -> Result<(), Error> {
    player.require_auth();
    
    let mut game = load_game(&env, game_id)?;
    
    // Validations
    require!(game.state == GameState::WaitingForPlayers, Error::InvalidState);
    require!(game.player1 != player, Error::CannotPlaySelf);
    require!(game.player2.is_none(), Error::GameFull);
    
    // Lock funds
    payment_controller::lock_funds(&env, &player, game.buy_in)?;
    
    // Atualizar game
    game.player2 = Some(player.clone());
    game.pot += game.buy_in;
    game.state = GameState::ShuffleCommit;
    game.last_action_at = env.ledger().timestamp();
    
    save_game(&env, game_id, &game);
    
    // Game Hub: start_game when we have both players (REQUIRED for hackathon)
    let session_id = game_id as u32;
    game_hub_integration::notify_game_start(
        &env,
        session_id,
        &game.player1,
        &player,
    )?;
    
    // Emit event
    env.events().publish((symbol_short!("JOIN"), game_id), player);
    
    Ok(())
}
```

#### 2.5.5 Shuffle Phase

```rust
/// Player commits hash of seed
/// @param player: Player address
/// @param game_id: Game ID
/// @param commitment: hash(seed)
pub fn commit_seed(
    env: Env,
    player: Address,
    game_id: u64,
    commitment: BytesN<32>,
) -> Result<(), Error> {
    player.require_auth();
    
    let mut game = load_game(&env, game_id)?;
    
    // Validations
    require!(game.state == GameState::ShuffleCommit, Error::InvalidState);
    require!(is_player(&game, &player), Error::NotPlayer);
    
    // Salvar commitment
    if player == game.player1 {
        require!(game.seed_commitment1.is_none(), Error::AlreadyCommitted);
        game.seed_commitment1 = Some(commitment);
    } else {
        require!(game.seed_commitment2.is_none(), Error::AlreadyCommitted);
        game.seed_commitment2 = Some(commitment);
    }
    
    // If both committed, advance to reveal
    if game.seed_commitment1.is_some() && game.seed_commitment2.is_some() {
        game.state = GameState::ShuffleReveal;
    }
    
    game.last_action_at = env.ledger().timestamp();
    save_game(&env, game_id, &game);
    
    env.events().publish((symbol_short!("COMMIT"), game_id), player);
    
    Ok(())
}

/// Player reveals seed
/// @param player: Player address
/// @param game_id: Game ID
/// @param seed: Original seed (will be verified against commitment)
pub fn reveal_seed(
    env: Env,
    player: Address,
    game_id: u64,
    seed: BytesN<32>,
) -> Result<(), Error> {
    player.require_auth();
    
    let mut game = load_game(&env, game_id)?;
    
    // Validations
    require!(game.state == GameState::ShuffleReveal, Error::InvalidState);
    require!(is_player(&game, &player), Error::NotPlayer);
    
    // Verificar commitment
    let computed_hash = env.crypto().sha256(&seed);
    
    if player == game.player1 {
        require!(game.seed_reveal1.is_none(), Error::AlreadyRevealed);
        let commitment = game.seed_commitment1.unwrap();
        require!(computed_hash == commitment, Error::InvalidSeed);
        game.seed_reveal1 = Some(seed);
    } else {
        require!(game.seed_reveal2.is_none(), Error::AlreadyRevealed);
        let commitment = game.seed_commitment2.unwrap();
        require!(computed_hash == commitment, Error::InvalidSeed);
        game.seed_reveal2 = Some(seed);
    }
    
    // Se ambos revelaram, computar final seed e deal cards
    if game.seed_reveal1.is_some() && game.seed_reveal2.is_some() {
        let seed1 = game.seed_reveal1.unwrap();
        let seed2 = game.seed_reveal2.unwrap();
        
        // final_seed = hash(seed1 || seed2)
        let mut combined = Vec::new(&env);
        combined.extend_from_slice(&seed1.to_array());
        combined.extend_from_slice(&seed2.to_array());
        game.final_seed = Some(env.crypto().sha256(&combined));
        
        // Deal cards (derive from seed)
        game.board = derive_board_cards(&env, &game.final_seed.unwrap());
        game.state = GameState::Betting;
    }
    
    game.last_action_at = env.ledger().timestamp();
    save_game(&env, game_id, &game);
    
    env.events().publish((symbol_short!("REVEAL"), game_id), player);
    
    Ok(())
}
```

#### 2.5.6 Post Blinds

```rust
/// Collect Small Blind and Big Blind; called once after DealCards.
/// Heads-up: dealer = SB, other = BB. Pot = SB + BB.
pub fn post_blinds(env: Env, game_id: u64) -> Result<(), Error> {
    let mut game = load_game(&env, game_id)?;
    require!(game.state == GameState::DealCards, Error::InvalidState);

    let config = load_config(&env)?;
    game.pot += config.small_blind + config.big_blind;
    if game.dealer_position == 0 {
        game.current_bet_p1 = config.small_blind;
        game.current_bet_p2 = config.big_blind;
        game.total_bet_p1 = config.small_blind;
        game.total_bet_p2 = config.big_blind;
        game.actor = 1; // P2 (BB) acts first in pre-flop
    } else {
        game.current_bet_p1 = config.big_blind;
        game.current_bet_p2 = config.small_blind;
        game.total_bet_p1 = config.big_blind;
        game.total_bet_p2 = config.small_blind;
        game.actor = 0; // P1 (BB) age primeiro
    }
    game.min_raise = config.big_blind;
    game.last_raise_amount = config.big_blind;
    payment_controller::lock_funds(&env, &game.player1, game.current_bet_p1)?;
    payment_controller::lock_funds(&env, &game.player2.as_ref().unwrap(), game.current_bet_p2)?;
    game.state = GameState::PreFlop;
    game.last_action_at = env.ledger().timestamp();
    save_game(&env, game_id, &game);
    Ok(())
}
```

#### 2.5.7 Betting Phase (Fold / Check / Call / Raise)

A single `act()` function for all rounds (PreFlop, FlopBetting, TurnBetting, RiverBetting). The contract advances the round when both have matched (check/call) and it is back to the first to act having "checked" the round.

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Fold = 0,
    Check = 1,
    Call = 2,
    Raise = 3,
}

/// Player action in the current round.
/// @param action: Fold | Check | Call | Raise
/// @param raise_amount: Only used if action == Raise (total to put in the round, not the increment)
/// @param proof: ZK proof of valid hand (required on first action in the hand, or on Raise)
/// @param commitment: hash(hole_cards) (required on player's first action in the hand)
pub fn act(
    env: Env,
    player: Address,
    game_id: u64,
    action: Action,
    raise_amount: i128,
    proof: Option<BytesN<256>>,
    commitment: Option<BytesN<32>>,
) -> Result<(), Error> {
    player.require_auth();
    let mut game = load_game(&env, game_id)?;

    let betting_states = [
        GameState::PreFlop,
        GameState::FlopBetting,
        GameState::TurnBetting,
        GameState::RiverBetting,
    ];
    require!(betting_states.contains(&game.state), Error::InvalidState);
    require!(game.folded.is_none(), Error::GameAlreadyDecided);
    require!(is_current_actor(&game, &player), Error::NotYourTurn);

    let (current_bet_self, current_bet_other) = if player == game.player1 {
        (game.current_bet_p1, game.current_bet_p2)
    } else {
        (game.current_bet_p2, game.current_bet_p1)
    };
    let to_call = current_bet_other - current_bet_self;

    match action {
        Action::Fold => {
            game.folded = Some(player.clone());
            let winner = if player == game.player1 {
                game.player2.clone().unwrap()
            } else {
                game.player1.clone()
            };
            game.winner = Some(winner.clone());
            game.state = GameState::Finished;
            save_game(&env, game_id, &game);
            payout_game(&env, &game)?;
            let session_id = game_id as u32;
            let player1_won = winner == game.player1;
            game_hub_integration::notify_game_end(&env, session_id, player1_won)?;
            env.events().publish((symbol_short!("FOLD"), game_id), player);
            return Ok(());
        }
        Action::Check => {
            require!(to_call == 0, Error::MustCallOrRaise);
        }
        Action::Call => {
            require!(to_call > 0, Error::InvalidAmount);
            if let Some(ref c) = commitment {
                set_hand_commitment_if_first(&env, &mut game, &player, c, proof.as_ref())?;
            }
            payment_controller::lock_funds(&env, &player, to_call)?;
            game.pot += to_call;
            if player == game.player1 {
                game.current_bet_p1 += to_call;
                game.total_bet_p1 += to_call;
            } else {
                game.current_bet_p2 += to_call;
                game.total_bet_p2 += to_call;
            }
        }
        Action::Raise => {
            let min_raise_total = current_bet_other + game.min_raise;
            require!(raise_amount >= min_raise_total, Error::RaiseTooSmall);
            let add = raise_amount - current_bet_self;
            require!(add > 0, Error::InvalidAmount);
            set_hand_commitment_if_first(&env, &mut game, &player, &commitment.unwrap(), proof.as_ref())?;
            payment_controller::lock_funds(&env, &player, add)?;
            game.pot += add;
            if player == game.player1 {
                game.current_bet_p1 = raise_amount;
                game.total_bet_p1 += add;
            } else {
                game.current_bet_p2 = raise_amount;
                game.total_bet_p2 += add;
            }
            game.last_raise_amount = raise_amount - current_bet_other;
            game.min_raise = game.last_raise_amount;
        }
    }

    // Next to act: swap actor
    game.actor = 1 - game.actor;
    game.last_action_at = env.ledger().timestamp();

    // Round matched? (both bet the same this round)
    if game.current_bet_p1 == game.current_bet_p2 {
        game.current_bet_p1 = 0;
        game.current_bet_p2 = 0;
        game.min_raise = game.big_blind;
        game.last_raise_amount = game.big_blind;
        game.state = advance_betting_round(&mut game);
    }
    save_game(&env, game_id, &game);
    env.events().publish((symbol_short!("ACT"), game_id, action as u32), player);
    Ok(())
}

fn advance_betting_round(game: &mut Game) -> GameState {
    match game.state {
        GameState::PreFlop => {
            game.board_revealed = 3;
            game.actor = if game.dealer_position == 0 { 0 } else { 1 };
            GameState::FlopBetting
        }
        GameState::FlopBetting => {
            game.board_revealed = 4;
            game.actor = if game.dealer_position == 0 { 0 } else { 1 };
            GameState::TurnBetting
        }
        GameState::TurnBetting => {
            game.board_revealed = 5;
            game.actor = if game.dealer_position == 0 { 0 } else { 1 };
            GameState::RiverBetting
        }
        GameState::RiverBetting => {
            game.actor = 0;
            GameState::Showdown
        }
        _ => game.state,
    }
}
```

- **First action in hand:** on Call or Raise, the player must send `commitment` and `proof` (hand_validator) once; the contract stores the commitment for showdown.
- **Fold:** ends the hand; the other player wins the pot (payout + `notify_game_end(session_id, player1_won)`).
- **Check:** only allowed when `to_call == 0`.
- **Call:** match opponent's `current_bet`; lock XLM and update pot/totals.
- **Raise:** `raise_amount` = total the player puts in the round; must be >= `current_bet_other + min_raise`; updates `min_raise` to the size of the raise.
- **Round advance:** when `current_bet_p1 == current_bet_p2`, zero round bets, reveal next board card(s) (`board_revealed` 3 → 4 → 5) and change state to FlopBetting → TurnBetting → RiverBetting → Showdown.

**Proof required:** On the player's first action in the hand **or** on any **Raise**, the contract requires `proof` and `commitment` (hand_validator). On subsequent Check/Call (if the player already sent proof earlier in the same hand), proof may be omitted.

**Action order (heads-up):** PreFlop = Big Blind acts first (actor = 1 - dealer_position). Flop/Turn/River = Dealer (SB) acts first (actor = dealer_position). See SPEC_COMPLETE.md §2.

#### 2.5.8 Showdown Phase

```rust
/// Player reveals hand
/// @param player: Player address
/// @param game_id: Game ID
/// @param hole_cards: [card1, card2]
/// @param claimed_rank: Declared ranking (1-10)
/// @param proof: ZK proof of correct ranking
pub fn reveal_hand(
    env: Env,
    player: Address,
    game_id: u64,
    hole_cards: Vec<u8>,
    claimed_rank: u8,
    proof: BytesN<256>,
) -> Result<(), Error> {
    player.require_auth();
    
    let mut game = load_game(&env, game_id)?;
    
    // Validations
    require!(game.state == GameState::Showdown, Error::InvalidState);
    require!(is_player(&game, &player), Error::NotPlayer);
    require!(hole_cards.len() == 2, Error::InvalidCards);
    require!(claimed_rank >= 1 && claimed_rank <= 10, Error::InvalidRank);
    
    // Verificar commitment
    let computed_hash = env.crypto().sha256(&hole_cards.to_bytes());
    
    let commitment = if player == game.player1 {
        game.hand_commitment1.unwrap()
    } else {
        game.hand_commitment2.unwrap()
    };
    
    require!(computed_hash == commitment, Error::InvalidCommitment);
    
    // Verify ZK rank proof
    let public_inputs = vec![
        &env,
        board_to_field(&game.board),
        Field::from(claimed_rank),
        commitment.into(),
    ];
    
    let is_valid = proof_verifier::verify_hand_rank(
        &env,
        proof,
        public_inputs,
    )?;
    
    require!(is_valid, Error::InvalidProof);
    
    // Salvar ranking
    if player == game.player1 {
        require!(game.hand_rank1.is_none(), Error::AlreadyRevealed);
        game.hand_rank1 = Some(claimed_rank);
    } else {
        require!(game.hand_rank2.is_none(), Error::AlreadyRevealed);
        game.hand_rank2 = Some(claimed_rank);
    }
    
    // Se ambos revelaram, determinar winner
    if game.hand_rank1.is_some() && game.hand_rank2.is_some() {
        let rank1 = game.hand_rank1.unwrap();
        let rank2 = game.hand_rank2.unwrap();
        
        game.winner = Some(if rank1 > rank2 {
            game.player1.clone()
        } else if rank2 > rank1 {
            game.player2.clone().unwrap()
        } else {
            // Empate: comparar kickers (simplificado: split pot)
            game.player1.clone()  // TODO: implementar kicker comparison
        });
        
        game.state = GameState::Finished;
        
        // Payout
        payout_game(&env, &game)?;
        
        // Notificar Game Hub (session_id, player1_won)
        let session_id = game_id as u32;
        let player1_won = game.winner.as_ref() == Some(&game.player1);
        game_hub_integration::notify_game_end(&env, session_id, player1_won)?;
    }
    
    game.last_action_at = env.ledger().timestamp();
    save_game(&env, game_id, &game);
    
    env.events().publish((symbol_short!("REVEAL"), game_id, claimed_rank), player);
    
    Ok(())
}
```

#### 2.5.9 Timeout Handling

```rust
/// Claim timeout (any player can call)
/// @param caller: Address of the one claiming
/// @param game_id: Game ID
pub fn claim_timeout(
    env: Env,
    caller: Address,
    game_id: u64,
) -> Result<(), Error> {
    caller.require_auth();
    
    let mut game = load_game(&env, game_id)?;
    
    // Validations
    require!(game.state != GameState::Finished, Error::GameAlreadyFinished);
    require!(game.state != GameState::Cancelled, Error::GameCancelled);
    
    let config = load_config(&env)?;
    let current_time = env.ledger().timestamp();
    let timeout = match game.state {
        GameState::ShuffleCommit | GameState::ShuffleReveal => config.reveal_timeout,
        GameState::Betting | GameState::Showdown => config.bet_timeout,
        _ => return Err(Error::NoTimeoutApplicable),
    };
    
    require!(
        current_time > game.last_action_at + timeout,
        Error::TimeoutNotReached
    );
    
    // Determine who did not act
    let non_acting_player = determine_non_acting_player(&game)?;
    let honest_player = if non_acting_player == game.player1 {
        game.player2.clone().unwrap()
    } else {
        game.player1.clone()
    };
    
    // Forfeit: player who did not act loses stake
    game.winner = Some(honest_player.clone());
    game.state = GameState::Cancelled;
    game.last_action_at = current_time;
    
    save_game(&env, game_id, &game);
    
    // Payout (winner leva tudo)
    payment_controller::payout_winner(
        &env,
        &honest_player,
        game.pot,
        0,  // No rake on timeout
    )?;
    
    // Notificar Game Hub
    let session_id = game_id as u32;
    let player1_won = honest_player == game.player1;
    game_hub_integration::notify_game_end(&env, session_id, player1_won)?;
    
    env.events().publish((symbol_short!("TIMEOUT"), game_id), non_acting_player);
    
    Ok(())
}
```

**Timeout per phase:** See table in SPEC_COMPLETE.md §7. Summary: ShuffleCommit/ShuffleReveal use `config.reveal_timeout`; PreFlop, FlopBetting, TurnBetting, RiverBetting and Showdown use `config.bet_timeout`. On claim_timeout, the player who did not act loses; the other wins the pot and `notify_game_end(session_id, player1_won)` is called.

### 2.6 Helper Functions

```rust
/// Derive the 5 board cards from the seed. Called once when leaving ShuffleReveal;
/// Result is stored in game.board; board_revealed controls how many are public (0→3→4→5).
fn derive_board_cards(env: &Env, seed: &BytesN<32>) -> Vec<u8> {
    let mut cards = Vec::new(env);
    let seed_bytes = seed.to_array();
    
    // Use seed as randomness source
    // Shuffle deck (Fisher-Yates)
    let mut deck: Vec<u8> = (1..=52).collect();
    let mut rng_state = u64::from_be_bytes(seed_bytes[0..8].try_into().unwrap());
    
    for i in (1..52).rev() {
        // LCG (Linear Congruential Generator)
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let j = (rng_state % (i as u64 + 1)) as usize;
        deck.swap(i, j);
    }
    
    // First 5 cards are the board
    for i in 0..5 {
        cards.push_back(deck[i]);
    }
    
    cards
}

/// Check if address is a player in the game
fn is_player(game: &Game, player: &Address) -> bool {
    player == &game.player1 || 
    game.player2.as_ref().map_or(false, |p2| player == p2)
}

/// Determine player who did not act (for timeout)
fn determine_non_acting_player(game: &Game) -> Result<Address, Error> {
    match game.state {
        GameState::ShuffleCommit => {
            if game.seed_commitment1.is_none() {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        },
        GameState::ShuffleReveal => {
            if game.seed_reveal1.is_none() {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        },
        GameState::PreFlop | GameState::FlopBetting | GameState::TurnBetting | GameState::RiverBetting => {
            if game.actor == 0 {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        },
        GameState::Showdown => {
            if game.hand_rank1.is_none() {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        },
        _ => Err(Error::InvalidState),
    }
}

/// Execute game payout
fn payout_game(env: &Env, game: &Game) -> Result<(), Error> {
    let config = load_config(env)?;
    let winner = game.winner.as_ref().unwrap();
    
    // Calcular rake (2%)
    let rake = (game.pot * config.rake_percentage as i128) / 10000;
    let payout = game.pot - rake;
    
    // Transfer to winner
    payment_controller::payout_winner(env, winner, payout, rake)?;
    
    Ok(())
}
```

---

## 3. ProofVerifier Contract

### 3.1 Overview

**Arquivo:** `contracts/proof-verifier/src/lib.rs`

**Responsibility:** Verify ZK proofs on-chain using Barretenberg verifier.

### 3.2 Functions

```rust
/// Verify valid-hand proof
/// @param proof: ZK proof (256 bytes)
/// @param public_inputs: [board_hash, commitment]
/// @return bool: true if proof valid
pub fn verify_hand_valid(
    env: Env,
    proof: BytesN<256>,
    public_inputs: Vec<Field>,
) -> Result<bool, Error> {
    // Validations
    require!(public_inputs.len() == 2, Error::InvalidInputs);
    
    // Load verification key (stored in contract)
    let vk = load_verification_key(&env, "hand_validator")?;
    
    // Chamar Barretenberg verifier (WASM)
    let is_valid = barretenberg::verify(
        &env,
        &vk,
        &proof.to_array(),
        &public_inputs_to_bytes(&public_inputs),
    )?;
    
    Ok(is_valid)
}

/// Verify hand-ranking proof
/// @param proof: ZK proof (256 bytes)
/// @param public_inputs: [board_hash, claimed_rank, commitment]
/// @return bool: true if proof valid
pub fn verify_hand_rank(
    env: Env,
    proof: BytesN<256>,
    public_inputs: Vec<Field>,
) -> Result<bool, Error> {
    // Validations
    require!(public_inputs.len() == 3, Error::InvalidInputs);
    
    // Carregar verification key
    let vk = load_verification_key(&env, "hand_ranker")?;
    
    // Chamar Barretenberg verifier
    let is_valid = barretenberg::verify(
        &env,
        &vk,
        &proof.to_array(),
        &public_inputs_to_bytes(&public_inputs),
    )?;
    
    Ok(is_valid)
}

/// Verify commitment (hash of cards)
/// @param cards: [card1, card2]
/// @param commitment: hash esperado
/// @return bool: true se match
pub fn verify_commitment(
    env: Env,
    cards: Vec<u8>,
    commitment: BytesN<32>,
) -> Result<bool, Error> {
    require!(cards.len() == 2, Error::InvalidCards);
    
    let computed = env.crypto().sha256(&cards.to_bytes());
    
    Ok(computed == commitment)
}
```

---

## 4. PaymentController Contract

### 4.1 Overview

**Arquivo:** `contracts/payment-controller/src/lib.rs`

**Responsibility:** Manage XLM escrow and payouts.

### 4.2 Functions

```rust
/// Lock funds in escrow
/// @param player: Player address
/// @param amount: Amount in XLM
pub fn lock_funds(
    env: Env,
    player: &Address,
    amount: i128,
) -> Result<(), Error> {
    player.require_auth();
    
    // Usar Stellar Asset Contract (native XLM)
    let xlm_token = token::Client::new(&env, &get_xlm_asset(&env));
    
    // Transfer from player to this contract
    xlm_token.transfer(
        player,
        &env.current_contract_address(),
        &amount,
    );
    
    // Atualizar escrow balance
    let mut balance = load_escrow_balance(&env, player).unwrap_or(0);
    balance += amount;
    save_escrow_balance(&env, player, balance);
    
    env.events().publish((symbol_short!("LOCK"), amount), player);
    
    Ok(())
}

/// Payout to winner
/// @param winner: Winner address
/// @param payout: Payout amount
/// @param rake: Rake amount (goes to treasury)
pub fn payout_winner(
    env: Env,
    winner: &Address,
    payout: i128,
    rake: i128,
) -> Result<(), Error> {
    let xlm_token = token::Client::new(&env, &get_xlm_asset(&env));
    let config = load_config(&env)?;
    
    // Transfer payout to winner
    xlm_token.transfer(
        &env.current_contract_address(),
        winner,
        &payout,
    );
    
    // Transfer rake to treasury
    if rake > 0 {
        xlm_token.transfer(
            &env.current_contract_address(),
            &config.treasury,
            &rake,
        );
    }
    
    env.events().publish((symbol_short!("PAYOUT"), payout, rake), winner);
    
    Ok(())
}

/// Refund on timeout/cancel
pub fn refund_on_timeout(
    env: Env,
    player: &Address,
    amount: i128,
) -> Result<(), Error> {
    let xlm_token = token::Client::new(&env, &get_xlm_asset(&env));
    
    xlm_token.transfer(
        &env.current_contract_address(),
        player,
        &amount,
    );
    
    // Atualizar escrow balance
    let mut balance = load_escrow_balance(&env, player).unwrap_or(0);
    balance -= amount;
    save_escrow_balance(&env, player, balance);
    
    env.events().publish((symbol_short!("REFUND"), amount), player);
    
    Ok(())
}
```

---

## 5. GameHubIntegration Contract

### 5.1 Overview

**File:** `contracts/games/poker/src/lib.rs` (PokerGameManager)

**Responsibility:** Required integration with official hackathon contract.

**IMPORTANT:** Use **Stellar Game Studio** (required for the hackathon!)

### 5.2 Official Game Hub interface

```rust
use soroban_sdk::{contractclient, Env, Address};

// Official hackathon contract
const GAME_HUB_ADDRESS: &str = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

// Official interface (from Game Studio GitHub)
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,        // Our contract address
        session_id: u32,         // Game session ID
        player1: Address,
        player2: Address,
        player1_points: i128,    // Pontos iniciais (0)
        player2_points: i128,    // Pontos iniciais (0)
    );

    fn end_game(
        env: Env,
        session_id: u32,
        player1_won: bool        // true se P1 ganhou, false se P2
    );
}
```

### 5.3 Functions Corrigidas

```rust
/// Notify game start (when P2 joins)
pub fn notify_game_start(
    env: &Env,
    session_id: u32,
    player1: &Address,
    player2: &Address,
) -> Result<(), Error> {
    let hub_address = Address::from_string(
        &soroban_sdk::String::from_str(env, GAME_HUB_ADDRESS)
    );
    
    let hub = GameHubClient::new(env, &hub_address);
    
    // Call start_game() with correct interface
    hub.start_game(
        &env.current_contract_address(),  // game_id = nosso contract
        session_id,
        player1,
        player2,
        0,  // player1_points (inicial)
        0   // player2_points (inicial)
    );
    
    Ok(())
}

/// Notify game end (after showdown)
pub fn notify_game_end(
    env: &Env,
    session_id: u32,
    player1_won: bool,  // true se P1 ganhou
) -> Result<(), Error> {
    let hub_address = Address::from_string(
        &soroban_sdk::String::from_str(env, GAME_HUB_ADDRESS)
    );
    
    let hub = GameHubClient::new(env, &hub_address);
    
    // Call end_game() with correct interface
    hub.end_game(
        session_id,
        player1_won  // bool, not Address!
    );
    
    Ok(())
}
```

### 5.4 Integration in GameManager

```rust
// Em create_game()
pub fn create_game(env: Env, player: Address, buy_in: i128) -> u32 {
    // ... criar game
    
    let session_id = next_session_id(&env);
    
    // Save game with 30-day TTL (Game Studio best practice)
    env.storage().temporary().set(
        &DataKey::Game(session_id),
        &game,
        &(30 * 24 * 60 * 60)  // 30 days in seconds
    );
    
    // Notify Game Hub (player2 has not joined yet)
    notify_game_start(
        &env,
        session_id,
        &player,
        &Address::default(),  // player2 empty for now
    )?;
    
    session_id
}

// Em join_game()
pub fn join_game(env: Env, player: Address, session_id: u32) {
    // ... validations
    
    game.player2 = Some(player.clone());
    
    // Update Game Hub with both players
    notify_game_start(
        &env,
        session_id,
        &game.player1,
        &player,  // Agora temos player2!
    )?;
    
    save_game(&env, session_id, &game);
}

// In reveal_hand() (after determining winner)
pub fn reveal_hand(...) {
    // ... showdown logic
    
    // Determinar se player1 ganhou
    let player1_won = game.winner == game.player1;
    
    // Payout
    payout_game(&env, &game)?;
    
    // Notificar Game Hub
    notify_game_end(&env, game.session_id, player1_won)?;
    
    game.state = GameState::Finished;
    save_game(&env, game.session_id, &game);
}
```

---

## 6. Data Structures

### 6.1 Storage keys and TTL (Game Studio)

- **Instance storage:** Admin and GameHub (or hub address) — set in constructor/initialize (§2.2).
- **Temporary storage:** Game state (`DataKey::Game(game_id)`). On **every** write (`save_game`), use `env.storage().temporary().set(...)` with **30-day** TTL and/or `extend_ttl` for the same period, so the game does not expire during the session (Stellar Game Studio standard).

```rust
pub enum DataKey {
    Admin,
    Config,
    GameHubAddress,
    NextGameId,
    NextTableId,
    Table(u64),        // instance: mesa (blinds, limits, max_seats)
    TableWaiting(u64), // instance: uma sala de espera por mesa (1/2)
    Game(u64),         // temporary, 30-day TTL, extend_ttl on every write
    EscrowBalance(Address),
    VerificationKey(String),
}
```

### 6.2 Constants

```rust
pub const MIN_BUY_IN: i128 = 100_0000000;  // 100 XLM
pub const MAX_BUY_IN: i128 = 1000_0000000; // 1000 XLM
pub const RAKE_BPS: u32 = 200;              // 2% (200 basis points)
pub const REVEAL_TIMEOUT: u64 = 300;        // 5 minutos
pub const BET_TIMEOUT: u64 = 300;           // 5 minutos
```

### 6.3 Checklist of data persisted per game

Fields of struct **Game** that are stored (per game_id). Ensure consistency with §2.4 and ARCHITECTURE.

| Campo | Tipo | Uso |
|-------|------|-----|
| id | u64 | Internal ID; session_id = id as u32 for Game Hub |
| state | GameState | Current phase |
| player1, player2 | Address, Option\<Address\> | Jogadores |
| buy_in, pot | i128 | Stack inicial e pote |
| small_blind, big_blind | i128 | Do config |
| dealer_position | u8 | 0 = P1 dealer |
| board | Vec\<u8\> (5) | 5 cards (filled in DealCards) |
| board_revealed | u8 | 0, 3, 4 or 5 |
| current_bet_p1/p2, total_bet_p1/p2 | i128 | Bets in round and in hand |
| min_raise, last_raise_amount | i128 | Raise rules |
| actor | u8 | 0 = vez P1, 1 = vez P2 |
| folded | Option\<Address\> | Who folded |
| seed_commitment1/2, seed_reveal1/2, final_seed | Option\<BytesN<32>\> | Shuffle |
| hand_commitment1/2 | Option\<BytesN<32>\> | Commitments |
| hand_rank1/2 | Option\<u8\> | Rankings at showdown |
| winner | Option\<Address\> | Vencedor |
| created_at, last_action_at | u64 | Timestamps |
| table_id | u64 | Mesa de origem (get_table para blinds/limites) |

Ver SPEC_COMPLETE.md §9.

---

## 7. Events

```rust
// Tables (symbols ≤9 chars for compatibility)
event!("TBL_ADDED", table_id: u64, admin: Address);
event!("TBL_SIT", table_id: u64, player: Address);
event!("TBL_START", table_id: u64, game_id: u64, player: Address);
event!("TBL_CLOSE", table_id: u64, player: Address);  // waiting cancelled, player refunded

// Game lifecycle
event!("CREATE", game_id: u64, player: Address);
event!("JOIN", game_id: u64, player: Address);
event!("COMMIT", game_id: u64, player: Address);
event!("REVEAL", game_id: u64, player: Address);
event!("ACT", game_id: u64, action: u32, player: Address);
event!("FOLD", game_id: u64, player: Address);
event!("REVEAL", game_id: u64, rank: u8, player: Address);
event!("TIMEOUT", game_id: u64, non_acting_player: Address);

// Payments
event!("LOCK", amount: i128, player: Address);
event!("PAYOUT", payout: i128, rake: i128, winner: Address);
event!("REFUND", amount: i128, player: Address);
```

---

## 8. Error Codes

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    // Game errors (100-199)
    InvalidState = 100,
    GameNotFound = 101,
    GameFull = 102,
    GameAlreadyFinished = 103,
    GameCancelled = 104,
    NotPlayer = 105,
    CannotPlaySelf = 106,
    NotYourTurn = 107,
    GameAlreadyDecided = 108,
    ConfigNotSet = 109,
    TableNotFound = 110,
    NoWaitingSession = 111,
    WaitingTimeoutNotReached = 112,
    
    // Betting errors (200-299)
    BuyInTooLow = 200,
    BuyInTooHigh = 201,
    InvalidAmount = 202,
    InsufficientFunds = 203,
    AlreadyBet = 204,
    MustCallOrRaise = 205,
    RaiseTooSmall = 206,
    
    // Shuffle errors (300-399)
    AlreadyCommitted = 300,
    AlreadyRevealed = 301,
    InvalidSeed = 302,
    InvalidCommitment = 303,
    
    // Proof errors (400-499)
    InvalidProof = 400,
    InvalidInputs = 401,
    VerificationFailed = 402,
    
    // Card errors (500-599)
    InvalidCards = 500,
    InvalidRank = 501,
    DuplicateCards = 502,
    
    // Timeout errors (600-699)
    TimeoutNotReached = 600,
    NoTimeoutApplicable = 601,
    
    // General errors (900-999)
    Unauthorized = 900,
    Overflow = 901,
    NotImplemented = 902,
}
```

**Suggested messages for frontend:** See full table in SPEC_COMPLETE.md §8.

---

## 9. Gas Estimates

| Operation | Gas (XLM) | Complexity |
|-----------|-----------|------------|
| `create_game()` | ~0.01 | Medium |
| `join_game()` | ~0.01 | Medium |
| `commit_seed()` | ~0.005 | Low |
| `reveal_seed()` | ~0.008 | Medium (hash computation) |
| `bet()` | ~0.012 | High (proof verification) |
| `fold()` | ~0.005 | Low |
| `reveal_hand()` | ~0.015 | High (proof verification) |
| `claim_timeout()` | ~0.008 | Medium |

**Total per game:** ~0.08-0.10 XLM (~$0.008-0.010)

---

## 10. Security Considerations

### 10.1 Reentrancy Protection

```rust
// Checks-Effects-Interactions pattern
pub fn bet(...) -> Result<(), Error> {
    // 1. CHECKS
    require!(game.state == GameState::Betting, Error::InvalidState);
    require!(is_player(&game, &player), Error::NotPlayer);
    
    // 2. EFFECTS
    game.pot += amount;
    save_game(&env, game_id, &game);
    
    // 3. INTERACTIONS
    payment_controller::lock_funds(&env, &player, amount)?;
    
    Ok(())
}
```

### 10.2 Access Control

```rust
// Only players can act
require!(is_player(&game, &player), Error::NotPlayer);

// Only admin can pause
require!(caller == admin, Error::Unauthorized);
```

### 10.3 Integer Overflow

```rust
// Rust prevents overflow by default (panic in debug, wrap in release)
// Use checked_add() for extra safety
let new_pot = game.pot.checked_add(amount).ok_or(Error::Overflow)?;
```

### 10.4 Front-Running

```rust
// Commit-reveal mitiga front-running
// Player commits hash(action) before revealing real action
```

---

**Version:** 1.0  
**Last updated:** February 16, 2026  
**Autor:** Daniel Gorgonha / Deega Labs
