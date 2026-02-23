#![no_std]

//! # Poker ZK Game Manager
//!
//! Texas Hold'em state machine (Governor of Poker style). Game Hub integration
//! per CONTRACTS_SPEC.md. Payment/ProofVerifier stubbed for integration later.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    Address, Bytes, BytesN, Env, IntoVal, String, contract, contractclient, contracterror, contractimpl,
    contracttype, symbol_short, vec, Symbol, Vec,
};

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    InvalidState = 3,
    CannotPlaySelf = 4,
    GameFull = 5,
    BuyInTooLow = 6,
    BuyInTooHigh = 7,
    AlreadyCommitted = 8,
    AlreadyRevealed = 9,
    InvalidSeed = 10,
    MustCallOrRaise = 11,
    InvalidAmount = 12,
    RaiseTooSmall = 13,
    GameAlreadyDecided = 14,
    NotYourTurn = 15,
    InvalidCards = 16,
    InvalidRank = 17,
    InvalidCommitment = 18,
    InvalidProof = 19,
    GameAlreadyFinished = 20,
    GameCancelled = 21,
    TimeoutNotReached = 22,
    NoTimeoutApplicable = 23,
    ConfigNotSet = 24,
    TableNotFound = 25,
    NoWaitingSession = 26,
    WaitingTimeoutNotReached = 27,
    MessageTooLong = 28,
}

/// A table (mesa) defines blinds, buy-in limits, and max seats. First table in constructor; more via add_table (admin only).
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Table {
    pub small_blind: i128,
    pub big_blind: i128,
    pub min_buy_in: i128,
    pub max_buy_in: i128,
    /// Max seats per table (e.g. 2 for MVP, 4 later). Game starts when min 2 have sat.
    pub max_seats: u32,
}

/// One player waiting at a table. When 2nd sits, game is created.
/// If nobody joins within waiting_timeout, anyone can cancel and player1 is refunded.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WaitingSession {
    pub player1: Address,
    pub buy_in: i128,
    pub created_at: u64,
}

/// Result of sit_at_table: waiting (1/2) or game started. If !waiting then game_id is set.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SitResult {
    pub waiting: bool,
    pub game_id: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GameState {
    WaitingForPlayers = 0,
    ShuffleCommit = 1,
    ShuffleReveal = 2,
    DealCards = 3,
    PreFlop = 4,
    FlopBetting = 5,
    TurnBetting = 6,
    RiverBetting = 7,
    Showdown = 8,
    Finished = 9,
    Cancelled = 10,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Action {
    Fold = 0,
    Check = 1,
    Call = 2,
    Raise = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameConfig {
    pub min_buy_in: i128,
    pub max_buy_in: i128,
    pub small_blind: i128,
    pub big_blind: i128,
    pub rake_percentage: u32,
    pub reveal_timeout: u64,
    pub bet_timeout: u64,
    /// Seconds after which a waiting session (1/2) can be closed; player1 refunded. 0 = no timeout.
    pub waiting_timeout: u64,
    pub treasury: Address,
    pub game_hub: Address,
    /// Optional: when set, lock_funds on create/join and payout_winner on game end.
    pub payment_controller: Option<Address>,
    /// Optional: when set, verify_hand_rank in reveal_hand.
    pub proof_verifier: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub id: u64,
    pub state: GameState,
    pub player1: Address,
    pub player2: Option<Address>,
    pub buy_in: i128,
    pub pot: i128,
    pub small_blind: i128,
    pub big_blind: i128,
    pub dealer_position: u32,
    pub board: Vec<u32>,
    pub board_revealed: u32,
    pub current_bet_p1: i128,
    pub current_bet_p2: i128,
    pub total_bet_p1: i128,
    pub total_bet_p2: i128,
    pub min_raise: i128,
    pub last_raise_amount: i128,
    pub actor: u32,
    pub folded: Option<Address>,
    pub seed_commitment1: Option<BytesN<32>>,
    pub seed_commitment2: Option<BytesN<32>>,
    pub seed_reveal1: Option<BytesN<32>>,
    pub seed_reveal2: Option<BytesN<32>>,
    pub final_seed: Option<BytesN<32>>,
    pub hand_commitment1: Option<BytesN<32>>,
    pub hand_commitment2: Option<BytesN<32>>,
    pub hand_rank1: Option<u32>,
    pub hand_rank2: Option<u32>,
    pub winner: Option<Address>,
    pub created_at: u64,
    pub last_action_at: u64,
    pub table_id: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Config,
    GameHubAddress,
    NextGameId,
    NextTableId,
    Table(u64),
    /// One waiting session per table (1/2). Cleared when 2nd player sits and game starts.
    TableWaiting(u64),
    Game(u64),
    /// Game created via start_game(session_id, ...) — client-provided session ID (XDR join flow).
    SessionGame(u64),
}

const GAME_TTL_LEDGERS: u32 = 518_400;

fn load_config(env: &Env) -> Result<GameConfig, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::ConfigNotSet)
}

fn save_config(env: &Env, config: &GameConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

fn save_game(env: &Env, game_id: u64, game: &Game) {
    let key = DataKey::Game(game_id);
    env.storage().temporary().set(&key, game);
    env.storage()
        .temporary()
        .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
}

fn save_session_game(env: &Env, session_id: u64, game: &Game) {
    let key = DataKey::SessionGame(session_id);
    env.storage().temporary().set(&key, game);
    env.storage()
        .temporary()
        .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
}

fn load_game(env: &Env, game_id: u64) -> Result<Game, Error> {
    if let Some(game) = env.storage().temporary().get(&DataKey::SessionGame(game_id)) {
        return Ok(game);
    }
    env.storage()
        .temporary()
        .get(&DataKey::Game(game_id))
        .ok_or(Error::GameNotFound)
}

fn next_game_id(env: &Env) -> u64 {
    let key = DataKey::NextGameId;
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(id + 1));
    id
}

fn next_table_id(env: &Env) -> u64 {
    let key = DataKey::NextTableId;
    let id: u64 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(id + 1));
    id
}

fn load_table(env: &Env, table_id: u64) -> Result<Table, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Table(table_id))
        .ok_or(Error::TableNotFound)
}

fn save_table(env: &Env, table_id: u64, table: &Table) {
    env.storage().instance().set(&DataKey::Table(table_id), table);
}

fn load_table_waiting(env: &Env, table_id: u64) -> Option<WaitingSession> {
    env.storage()
        .instance()
        .get(&DataKey::TableWaiting(table_id))
}

fn save_table_waiting(env: &Env, table_id: u64, session: &WaitingSession) {
    env.storage()
        .instance()
        .set(&DataKey::TableWaiting(table_id), session);
}

fn clear_table_waiting(env: &Env, table_id: u64) {
    env.storage()
        .instance()
        .remove(&DataKey::TableWaiting(table_id));
}

fn is_player(game: &Game, player: &Address) -> bool {
    *player == game.player1
        || game
            .player2
            .as_ref()
            .map_or(false, |p2| player == p2)
}

fn is_current_actor(game: &Game, player: &Address) -> bool {
    let actor = if game.actor == 0u32 {
        &game.player1
    } else {
        game.player2.as_ref().unwrap()
    };
    player == actor
}

fn advance_betting_round(game: &mut Game) -> GameState {
    match game.state {
        GameState::PreFlop => {
            game.board_revealed = 3;
            game.actor = game.dealer_position;
            GameState::FlopBetting
        }
        GameState::FlopBetting => {
            game.board_revealed = 4;
            game.actor = game.dealer_position;
            GameState::TurnBetting
        }
        GameState::TurnBetting => {
            game.board_revealed = 5;
            game.actor = game.dealer_position;
            GameState::RiverBetting
        }
        GameState::RiverBetting => {
            game.actor = 0u32;
            GameState::Showdown
        }
        _ => game.state,
    }
}

fn determine_non_acting_player(game: &Game) -> Result<Address, Error> {
    match game.state {
        GameState::ShuffleCommit => {
            if game.seed_commitment1.is_none() {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        }
        GameState::ShuffleReveal => {
            if game.seed_reveal1.is_none() {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        }
        GameState::PreFlop
        | GameState::FlopBetting
        | GameState::TurnBetting
        | GameState::RiverBetting => {
            if game.actor == 0u32 {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        }
        GameState::Showdown => {
            if game.hand_rank1.is_none() {
                Ok(game.player1.clone())
            } else {
                Ok(game.player2.clone().unwrap())
            }
        }
        _ => Err(Error::InvalidState),
    }
}

/// Derive 5 board cards from seed (Fisher-Yates shuffle with LCG).
fn derive_board_cards(env: &Env, seed: &BytesN<32>) -> Vec<u32> {
    let mut deck: [u32; 52] = [0; 52];
    for i in 0..52u32 {
        deck[i as usize] = i + 1;
    }
    let seed_bytes = seed.to_array();
    let mut rng_state =
        u64::from_be_bytes(seed_bytes[0..8].try_into().unwrap_or([0u8; 8]));
    for i in (1..52).rev() {
        rng_state = rng_state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1);
        let j = (rng_state % (i as u64 + 1)) as usize;
        let tmp = deck[i];
        deck[i] = deck[j];
        deck[j] = tmp;
    }
    let mut cards = Vec::new(env);
    for i in 0..5 {
        cards.push_back(deck[i]);
    }
    cards
}

fn board_hash(env: &Env, board: &Vec<u32>) -> BytesN<32> {
    let mut buf = [0u8; 20];
    for i in 0..5u32 {
        let c = board.get(i).unwrap_or(0);
        let start = (i as usize) * 4;
        buf[start..start + 4].copy_from_slice(&(c as u32).to_le_bytes());
    }
    env.crypto().sha256(&Bytes::from_slice(env, &buf)).into()
}

/// Execute game payout: call PaymentController when configured, else no-op.
fn payout_game(env: Env, game: &Game) -> Result<(), Error> {
    let config = load_config(&env)?;
    let Some(ref pc) = config.payment_controller else {
        return Ok(());
    };
    let winner = game.winner.as_ref().ok_or(Error::InvalidState)?;
    let rake = (game.pot as u64)
        .saturating_mul(config.rake_percentage as u64)
        .saturating_div(10_000) as i128;
    let payout = game.pot.saturating_sub(rake);
    let sub = SubContractInvocation {
        context: ContractContext {
            contract: pc.clone(),
            fn_name: Symbol::new(&env, "payout_winner"),
            args: vec![&env, winner.into_val(&env), payout.into_val(&env), rake.into_val(&env)],
        },
        sub_invocations: Vec::new(&env),
    };
    env.authorize_as_current_contract(vec![&env, InvokerContractAuthEntry::Contract(sub)]);
    env.invoke_contract::<()>(
        pc,
        &Symbol::new(&env, "payout_winner"),
        vec![&env, winner.into_val(&env), payout.into_val(&env), rake.into_val(&env)],
    );
    Ok(())
}

/// Com 2 jogadores, após o payout reinicia o jogo para outra mão: estado ShuffleCommit,
/// seeds/board/apostas zerados, dealer alternado. Não chama hub.end_game.
fn reset_game_for_next_hand(env: &Env, game_id: u64) -> Result<(), Error> {
    let mut game = load_game(env, game_id)?;
    if game.state != GameState::Finished {
        return Err(Error::InvalidState);
    }
    if game.player2.is_none() {
        return Ok(());
    }
    game.dealer_position = 1u32.saturating_sub(game.dealer_position);
    game.state = GameState::ShuffleCommit;
    game.pot = 0;
    game.board = Vec::new(env);
    game.board_revealed = 0;
    game.current_bet_p1 = 0;
    game.current_bet_p2 = 0;
    game.total_bet_p1 = 0;
    game.total_bet_p2 = 0;
    game.min_raise = game.big_blind;
    game.last_raise_amount = game.big_blind;
    game.actor = 0;
    game.folded = None;
    game.seed_commitment1 = None;
    game.seed_commitment2 = None;
    game.seed_reveal1 = None;
    game.seed_reveal2 = None;
    game.final_seed = None;
    game.hand_commitment1 = None;
    game.hand_commitment2 = None;
    game.hand_rank1 = None;
    game.hand_rank2 = None;
    game.winner = None;
    game.last_action_at = env.ledger().timestamp();
    save_game(env, game_id, &game);
    save_session_game(env, game_id, &game);
    env.events()
        .publish((symbol_short!("NEXT_HAND"), game_id), ());
    Ok(())
}

#[contract]
pub struct PokerZkContract;

#[contractimpl]
impl PokerZkContract {
    /// Initialize with admin and config (or use __constructor(admin, game_hub) for minimal).
    pub fn initialize(env: Env, admin: Address, config: GameConfig) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            admin.require_auth();
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &config.game_hub);
        Ok(())
    }

    /// Constructor: admin, game_hub, and first table (mesa). Further tables via add_table (admin only).
    /// max_seats: e.g. 2 for MVP, 4 for 4-player tables later.
    /// Also sets Config so start_game and other functions work (load_config).
    pub fn __constructor(
        env: Env,
        admin: Address,
        game_hub: Address,
        small_blind: i128,
        big_blind: i128,
        min_buy_in: i128,
        max_buy_in: i128,
        max_seats: u32,
    ) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::GameHubAddress, &game_hub);
        let config = GameConfig {
            min_buy_in,
            max_buy_in,
            small_blind,
            big_blind,
            rake_percentage: 0,
            reveal_timeout: 300,
            bet_timeout: 120,
            waiting_timeout: 600,
            treasury: admin.clone(),
            game_hub: game_hub.clone(),
            payment_controller: None,
            proof_verifier: None,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        let first_table = Table {
            small_blind,
            big_blind,
            min_buy_in,
            max_buy_in,
            max_seats,
        };
        save_table(&env, 0, &first_table);
        env.storage().instance().set(&DataKey::NextTableId, &1u64);
    }

    /// Add a new table (mesa). Only admin. max_seats e.g. 2 (MVP) or 4.
    pub fn add_table(
        env: Env,
        admin: Address,
        small_blind: i128,
        big_blind: i128,
        min_buy_in: i128,
        max_buy_in: i128,
        max_seats: u32,
    ) -> Result<u64, Error> {
        admin.require_auth();
        let table_id = next_table_id(&env);
        let table = Table {
            small_blind,
            big_blind,
            min_buy_in,
            max_buy_in,
            max_seats,
        };
        save_table(&env, table_id, &table);
        env.events()
            .publish((symbol_short!("TBL_ADDED"), table_id), admin);
        Ok(table_id)
    }

    /// Sit at a table. If nobody waiting → you're 1/2 (waiting). If one waiting → game starts (2/2), returns game_id.
    /// Conforme vão entrando usuários, montam-se as mesas virtuais; a mesa inicia quando tem 2 jogadores.
    pub fn sit_at_table(
        env: Env,
        player: Address,
        table_id: u64,
        buy_in: i128,
    ) -> Result<SitResult, Error> {
        player.require_auth();
        let config = load_config(&env)?;
        let table = load_table(&env, table_id)?;
        if buy_in < table.min_buy_in {
            return Err(Error::BuyInTooLow);
        }
        if buy_in > table.max_buy_in {
            return Err(Error::BuyInTooHigh);
        }

        if let Some(session) = load_table_waiting(&env, table_id) {
            if session.player1 == player {
                return Err(Error::CannotPlaySelf);
            }
            if session.buy_in != buy_in {
                return Err(Error::InvalidAmount);
            }
            clear_table_waiting(&env, table_id);
            let game_id = next_game_id(&env);
            let game = Game {
                id: game_id,
                state: GameState::ShuffleCommit,
                player1: session.player1.clone(),
                player2: Some(player.clone()),
                buy_in,
                pot: buy_in + buy_in,
                small_blind: table.small_blind,
                big_blind: table.big_blind,
                dealer_position: 0,
                board: Vec::new(&env),
                board_revealed: 0,
                current_bet_p1: 0,
                current_bet_p2: 0,
                total_bet_p1: 0,
                total_bet_p2: 0,
                min_raise: table.big_blind,
                last_raise_amount: table.big_blind,
                actor: 0,
                folded: None,
                seed_commitment1: None,
                seed_commitment2: None,
                seed_reveal1: None,
                seed_reveal2: None,
                final_seed: None,
                hand_commitment1: None,
                hand_commitment2: None,
                hand_rank1: None,
                hand_rank2: None,
                winner: None,
                created_at: env.ledger().timestamp(),
                last_action_at: env.ledger().timestamp(),
                table_id,
            };
            save_game(&env, game_id, &game);
            if let Some(ref pc) = config.payment_controller {
                env.invoke_contract::<()>(
                    pc,
                    &Symbol::new(&env, "lock_funds"),
                    vec![&env, player.into_val(&env), buy_in.into_val(&env)],
                );
            }
            let hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let hub = GameHubClient::new(&env, &hub_addr);
            hub.start_game(
                &env.current_contract_address(),
                &(game_id as u32),
                &game.player1,
                &player,
                &buy_in,
                &buy_in,
            );
            env.events()
                .publish((symbol_short!("CREATE"), game_id), session.player1.clone());
            env.events()
                .publish((symbol_short!("JOIN"), game_id), player.clone());
            env.events()
                .publish((symbol_short!("TBL_START"), table_id, game_id), player);
            return Ok(SitResult {
                waiting: false,
                game_id,
            });
        }

        let now = env.ledger().timestamp();
        let session = WaitingSession {
            player1: player.clone(),
            buy_in,
            created_at: now,
        };
        save_table_waiting(&env, table_id, &session);
        if let Some(ref pc) = config.payment_controller {
            env.invoke_contract::<()>(
                pc,
                &Symbol::new(&env, "lock_funds"),
                vec![&env, player.into_val(&env), buy_in.into_val(&env)],
            );
        }
        env.events()
            .publish((symbol_short!("TBL_SIT"), table_id), player);
        Ok(SitResult {
            waiting: true,
            game_id: 0,
        })
    }

    /// Get current waiting session for a table (1/2). Returns error when 0/2.
    pub fn get_table_waiting(env: Env, table_id: u64) -> Result<WaitingSession, Error> {
        load_table(&env, table_id)?;
        load_table_waiting(&env, table_id).ok_or(Error::NoWaitingSession)
    }

    /// Start a game with a client-provided session ID (XDR / Game Studio flow).
    /// P1 signs auth for (session_id, table_id, buy_in); P2 submits the tx with P1's auth injected.
    /// Game is stored under SessionGame(session_id); get_game(session_id) returns it.
    pub fn start_game(
        env: Env,
        session_id: u64,
        table_id: u64,
        player1: Address,
        player2: Address,
        buy_in: i128,
    ) -> Result<(), Error> {
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            table_id.into_val(&env),
            buy_in.into_val(&env),
        ]);
        // Same as template (number-guess): P2 also signs auth for args so simulation returns two address auth entries (no sorobanCredentialsSourceAccount), avoiding SDK "reading 'switch'" error.
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            table_id.into_val(&env),
            buy_in.into_val(&env),
        ]);
        if player1 == player2 {
            return Err(Error::CannotPlaySelf);
        }
        let config = load_config(&env)?;
        let table = load_table(&env, table_id)?;
        if buy_in < table.min_buy_in {
            return Err(Error::BuyInTooLow);
        }
        if buy_in > table.max_buy_in {
            return Err(Error::BuyInTooHigh);
        }
        if env.storage().temporary().has(&DataKey::SessionGame(session_id))
            || env.storage().temporary().has(&DataKey::Game(session_id))
        {
            return Err(Error::GameFull);
        }

        let game = Game {
            id: session_id,
            state: GameState::ShuffleCommit,
            player1: player1.clone(),
            player2: Some(player2.clone()),
            buy_in,
            pot: buy_in + buy_in,
            small_blind: table.small_blind,
            big_blind: table.big_blind,
            dealer_position: 0,
            board: Vec::new(&env),
            board_revealed: 0,
            current_bet_p1: 0,
            current_bet_p2: 0,
            total_bet_p1: 0,
            total_bet_p2: 0,
            min_raise: table.big_blind,
            last_raise_amount: table.big_blind,
            actor: 0,
            folded: None,
            seed_commitment1: None,
            seed_commitment2: None,
            seed_reveal1: None,
            seed_reveal2: None,
            final_seed: None,
            hand_commitment1: None,
            hand_commitment2: None,
            hand_rank1: None,
            hand_rank2: None,
            winner: None,
            created_at: env.ledger().timestamp(),
            last_action_at: env.ledger().timestamp(),
            table_id,
        };
        save_session_game(&env, session_id, &game);
        if let Some(ref pc) = config.payment_controller {
            env.invoke_contract::<()>(
                pc,
                &Symbol::new(&env, "lock_funds"),
                vec![&env, player1.into_val(&env), buy_in.into_val(&env)],
            );
            env.invoke_contract::<()>(
                pc,
                &Symbol::new(&env, "lock_funds"),
                vec![&env, player2.into_val(&env), buy_in.into_val(&env)],
            );
        }
        let hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let hub = GameHubClient::new(&env, &hub_addr);
        hub.start_game(
            &env.current_contract_address(),
            &(session_id as u32),
            &player1,
            &player2,
            &buy_in,
            &buy_in,
        );
        env.events()
            .publish((symbol_short!("CREATE"), session_id), player1.clone());
        env.events()
            .publish((symbol_short!("JOIN"), session_id), player2.clone());
        env.events()
            .publish((symbol_short!("TBL_START"), table_id, session_id), player2);
        Ok(())
    }

    /// Cancel a waiting session (1/2). Frees the table for new players.
    /// - If caller is the waiting player (player1): can cancel anytime → refund and clear.
    /// - Else: only after waiting_timeout seconds → refund player1 and clear (so the mesa can be "encerrada" after a period).
    pub fn cancel_waiting(env: Env, caller: Address, table_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let config = load_config(&env)?;
        let session = load_table_waiting(&env, table_id).ok_or(Error::NoWaitingSession)?;
        let now = env.ledger().timestamp();

        let can_cancel = if caller == session.player1 {
            true
        } else {
            if config.waiting_timeout == 0 {
                return Err(Error::WaitingTimeoutNotReached);
            }
            now >= session.created_at.saturating_add(config.waiting_timeout)
        };

        if !can_cancel {
            return Err(Error::WaitingTimeoutNotReached);
        }

        clear_table_waiting(&env, table_id);
        if let Some(ref pc) = config.payment_controller {
            let sub = SubContractInvocation {
                context: ContractContext {
                    contract: pc.clone(),
                    fn_name: Symbol::new(&env, "refund_on_timeout"),
                    args: vec![
                        &env,
                        session.player1.into_val(&env),
                        session.buy_in.into_val(&env),
                    ],
                },
                sub_invocations: Vec::new(&env),
            };
            env.authorize_as_current_contract(vec![&env, InvokerContractAuthEntry::Contract(sub)]);
            env.invoke_contract::<()>(
                pc,
                &Symbol::new(&env, "refund_on_timeout"),
                vec![
                    &env,
                    session.player1.into_val(&env),
                    session.buy_in.into_val(&env),
                ],
            );
        }
        env.events()
            .publish((symbol_short!("TBL_CLOSE"), table_id), session.player1);
        Ok(())
    }

    pub fn get_table(env: Env, table_id: u64) -> Result<Table, Error> {
        load_table(&env, table_id)
    }

    /// Number of tables (ids 0..count-1). Frontend can iterate get_table(0)..get_table(count-1).
    pub fn get_table_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextTableId).unwrap_or(0)
    }

    pub fn create_game(env: Env, player: Address, table_id: u64, buy_in: i128) -> Result<u64, Error> {
        player.require_auth();
        let config = load_config(&env)?;
        let table = load_table(&env, table_id)?;
        if buy_in < table.min_buy_in {
            return Err(Error::BuyInTooLow);
        }
        if buy_in > table.max_buy_in {
            return Err(Error::BuyInTooHigh);
        }

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
            dealer_position: 0,
            board: Vec::new(&env),
            board_revealed: 0,
            current_bet_p1: 0,
            current_bet_p2: 0,
            total_bet_p1: 0,
            total_bet_p2: 0,
            min_raise: table.big_blind,
            last_raise_amount: table.big_blind,
            actor: 0,
            folded: None,
            seed_commitment1: None,
            seed_commitment2: None,
            seed_reveal1: None,
            seed_reveal2: None,
            final_seed: None,
            hand_commitment1: None,
            hand_commitment2: None,
            hand_rank1: None,
            hand_rank2: None,
            winner: None,
            created_at: env.ledger().timestamp(),
            last_action_at: env.ledger().timestamp(),
            table_id,
        };
        save_game(&env, game_id, &game);
        if let Some(ref pc) = config.payment_controller {
            env.invoke_contract::<()>(
                pc,
                &Symbol::new(&env, "lock_funds"),
                vec![&env, player.into_val(&env), buy_in.into_val(&env)],
            );
        }
        env.events()
            .publish((symbol_short!("CREATE"), game_id), player);
        Ok(game_id)
    }

    pub fn join_game(env: Env, player: Address, game_id: u64) -> Result<(), Error> {
        player.require_auth();
        let mut game = load_game(&env, game_id)?;
        if game.state != GameState::WaitingForPlayers {
            return Err(Error::InvalidState);
        }
        if player == game.player1 {
            return Err(Error::CannotPlaySelf);
        }
        if game.player2.is_some() {
            return Err(Error::GameFull);
        }

        game.player2 = Some(player.clone());
        game.pot += game.buy_in;
        game.state = GameState::ShuffleCommit;
        game.last_action_at = env.ledger().timestamp();
        save_game(&env, game_id, &game);
        let config = load_config(&env)?;
        if let Some(ref pc) = config.payment_controller {
            env.invoke_contract::<()>(
                pc,
                &Symbol::new(&env, "lock_funds"),
                vec![&env, player.into_val(&env), game.buy_in.into_val(&env)],
            );
        }

        let hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .unwrap();
        let hub = GameHubClient::new(&env, &hub_addr);
        let session_id = game_id as u32;
        hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &game.player1,
            &player,
            &game.buy_in,
            &game.buy_in,
        );

        env.events()
            .publish((symbol_short!("JOIN"), game_id), player);
        Ok(())
    }

    pub fn commit_seed(
        env: Env,
        player: Address,
        game_id: u64,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();
        let mut game = load_game(&env, game_id)?;
        if game.state != GameState::ShuffleCommit {
            return Err(Error::InvalidState);
        }
        if !is_player(&game, &player) {
            return Err(Error::NotPlayer);
        }

        if player == game.player1 {
            if game.seed_commitment1.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.seed_commitment1 = Some(commitment);
        } else {
            if game.seed_commitment2.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.seed_commitment2 = Some(commitment);
        }
        if game.seed_commitment1.is_some() && game.seed_commitment2.is_some() {
            game.state = GameState::ShuffleReveal;
        }
        game.last_action_at = env.ledger().timestamp();
        save_game(&env, game_id, &game);
        env.events()
            .publish((symbol_short!("COMMIT"), game_id), player);
        Ok(())
    }

    pub fn reveal_seed(
        env: Env,
        player: Address,
        game_id: u64,
        seed: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();
        let mut game = load_game(&env, game_id)?;
        if game.state != GameState::ShuffleReveal {
            return Err(Error::InvalidState);
        }
        if !is_player(&game, &player) {
            return Err(Error::NotPlayer);
        }

        let seed_bytes = Bytes::from_slice(&env, &seed.to_array());
        let computed = env.crypto().sha256(&seed_bytes).to_bytes();
        if player == game.player1 {
            if game.seed_reveal1.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            if computed != *game.seed_commitment1.as_ref().unwrap() {
                return Err(Error::InvalidSeed);
            }
            game.seed_reveal1 = Some(seed);
        } else {
            if game.seed_reveal2.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            if computed != *game.seed_commitment2.as_ref().unwrap() {
                return Err(Error::InvalidSeed);
            }
            game.seed_reveal2 = Some(seed);
        }

        if game.seed_reveal1.is_some() && game.seed_reveal2.is_some() {
            let s1 = game.seed_reveal1.as_ref().unwrap().clone();
            let s2 = game.seed_reveal2.as_ref().unwrap().clone();
            let mut combined = [0u8; 64];
            combined[0..32].copy_from_slice(&s1.to_array());
            combined[32..64].copy_from_slice(&s2.to_array());
            let mut first = [0u8; 32];
            first.copy_from_slice(&combined[0..32]);
            let mut second = [0u8; 32];
            second.copy_from_slice(&combined[32..64]);
            let b1 = Bytes::from_slice(&env, &first);
            let b2 = Bytes::from_slice(&env, &second);
            let h1 = env.crypto().sha256(&b1);
            let h2 = env.crypto().sha256(&b2);
            let mut xor_seed = [0u8; 32];
            for i in 0..32 {
                xor_seed[i] = h1.to_array()[i] ^ h2.to_array()[i];
            }
            game.final_seed = Some(BytesN::from_array(&env, &xor_seed));
            game.board = derive_board_cards(&env, game.final_seed.as_ref().unwrap());
            game.state = GameState::DealCards;
        }
        game.last_action_at = env.ledger().timestamp();
        save_game(&env, game_id, &game);
        env.events()
            .publish((symbol_short!("REVEAL"), game_id), player);
        Ok(())
    }

    pub fn post_blinds(env: Env, game_id: u64) -> Result<(), Error> {
        let mut game = load_game(&env, game_id)?;
        if game.state != GameState::DealCards {
            return Err(Error::InvalidState);
        }
        let config = load_config(&env)?;
        game.pot += config.small_blind + config.big_blind;
        if game.dealer_position == 0 {
            game.current_bet_p1 = config.small_blind;
            game.current_bet_p2 = config.big_blind;
            game.total_bet_p1 = config.small_blind;
            game.total_bet_p2 = config.big_blind;
            game.actor = 1u32;
        } else {
            game.current_bet_p1 = config.big_blind;
            game.current_bet_p2 = config.small_blind;
            game.total_bet_p1 = config.big_blind;
            game.total_bet_p2 = config.small_blind;
            game.actor = 0u32;
        }
        game.min_raise = config.big_blind;
        game.last_raise_amount = config.big_blind;
        game.state = GameState::PreFlop;
        game.last_action_at = env.ledger().timestamp();
        save_game(&env, game_id, &game);
        Ok(())
    }

    pub fn act(
        env: Env,
        player: Address,
        game_id: u64,
        action: Action,
        raise_amount: i128,
        _proof: Option<BytesN<256>>,
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
        if !betting_states.contains(&game.state) {
            return Err(Error::InvalidState);
        }
        if game.folded.is_some() {
            return Err(Error::GameAlreadyDecided);
        }
        if !is_current_actor(&game, &player) {
            return Err(Error::NotYourTurn);
        }

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
                payout_game(env.clone(), &game)?;
                if game.player2.is_some() {
                    reset_game_for_next_hand(&env, game_id)?;
                } else {
                    let hub_addr: Address = env
                        .storage()
                        .instance()
                        .get(&DataKey::GameHubAddress)
                        .unwrap();
                    let hub = GameHubClient::new(&env, &hub_addr);
                    hub.end_game(&(game_id as u32), &(winner == game.player1));
                }
                env.events()
                    .publish((symbol_short!("FOLD"), game_id), player);
                return Ok(());
            }
            Action::Check => {
                if to_call != 0 {
                    return Err(Error::MustCallOrRaise);
                }
            }
            Action::Call => {
                if to_call <= 0 {
                    return Err(Error::InvalidAmount);
                }
                if let Some(ref c) = commitment {
                    if player == game.player1 {
                        game.hand_commitment1 = Some(c.clone());
                    } else {
                        game.hand_commitment2 = Some(c.clone());
                    }
                }
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
                if raise_amount < min_raise_total {
                    return Err(Error::RaiseTooSmall);
                }
                let add = raise_amount - current_bet_self;
                if add <= 0 {
                    return Err(Error::InvalidAmount);
                }
                let c = commitment.ok_or(Error::InvalidCommitment)?;
                if player == game.player1 {
                    game.hand_commitment1 = Some(c);
                } else {
                    game.hand_commitment2 = Some(c);
                }
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

        game.actor = 1u32 - game.actor;
        game.last_action_at = env.ledger().timestamp();
        if game.current_bet_p1 == game.current_bet_p2 {
            game.current_bet_p1 = 0;
            game.current_bet_p2 = 0;
            game.min_raise = game.big_blind;
            game.last_raise_amount = game.big_blind;
            game.state = advance_betting_round(&mut game);
        }
        save_game(&env, game_id, &game);
        env.events()
            .publish((symbol_short!("ACT"), game_id, action as u32), player);
        Ok(())
    }

    /// Reveal hand at showdown. Calls ProofVerifier when configured.
    pub fn reveal_hand(
        env: Env,
        player: Address,
        game_id: u64,
        hole_cards: Vec<u32>,
        claimed_rank: u32,
        proof: BytesN<256>,
    ) -> Result<(), Error> {
        player.require_auth();
        let mut game = load_game(&env, game_id)?;
        if game.state != GameState::Showdown {
            return Err(Error::InvalidState);
        }
        if !is_player(&game, &player) {
            return Err(Error::NotPlayer);
        }
        if hole_cards.len() != 2 {
            return Err(Error::InvalidCards);
        }
        if claimed_rank < 1 || claimed_rank > 10 {
            return Err(Error::InvalidRank);
        }

        let c0 = hole_cards.get(0).unwrap_or(0);
        let c1 = hole_cards.get(1).unwrap_or(0);
        let mut cards_arr = [0u8; 32];
        cards_arr[0] = c0 as u8;
        cards_arr[1] = c1 as u8;
        let bytes_in = Bytes::from_slice(&env, &cards_arr);
        let computed = env.crypto().sha256(&bytes_in).to_bytes();
        let commitment = if player == game.player1 {
            game.hand_commitment1.clone()
        } else {
            game.hand_commitment2.clone()
        };
        let commitment = commitment.ok_or(Error::InvalidCommitment)?;
        if computed != commitment {
            return Err(Error::InvalidCommitment);
        }
        if let Some(ref pv) = load_config(&env)?.proof_verifier {
            let bh = board_hash(&env, &game.board);
            let valid: bool = env.invoke_contract(
                pv,
                &Symbol::new(&env, "verify_hand_rank"),
                vec![
                    &env,
                    proof.into_val(&env),
                    bh.into_val(&env),
                    claimed_rank.into_val(&env),
                    commitment.into_val(&env),
                ],
            );
            if !valid {
                return Err(Error::InvalidProof);
            }
        }

        if player == game.player1 {
            if game.hand_rank1.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            game.hand_rank1 = Some(claimed_rank);
        } else {
            if game.hand_rank2.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            game.hand_rank2 = Some(claimed_rank);
        }

        if game.hand_rank1.is_some() && game.hand_rank2.is_some() {
            let r1 = game.hand_rank1.unwrap();
            let r2 = game.hand_rank2.unwrap();
            game.winner = Some(if r1 > r2 {
                game.player1.clone()
            } else if r2 > r1 {
                game.player2.clone().unwrap()
            } else {
                game.player1.clone()
            });
            game.state = GameState::Finished;
            save_game(&env, game_id, &game);
            payout_game(env.clone(), &game)?;
            if game.player2.is_some() {
                reset_game_for_next_hand(&env, game_id)?;
                env.events()
                    .publish((symbol_short!("REVEAL"), game_id, claimed_rank), player);
                return Ok(());
            }
            let hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .unwrap();
            let hub = GameHubClient::new(&env, &hub_addr);
            let player1_won = game.winner.as_ref() == Some(&game.player1);
            hub.end_game(&(game_id as u32), &player1_won);
        }
        game.last_action_at = env.ledger().timestamp();
        save_game(&env, game_id, &game);
        env.events()
            .publish((symbol_short!("REVEAL"), game_id, claimed_rank), player);
        Ok(())
    }

    /// Quando o tempo de resposta do jogador acaba, o jogo avança automaticamente:
    /// - Em apostas: se não há aposta a pagar → CHECK automático; senão → FOLD automático. O jogo continua.
    /// - Em commit/reveal ou showdown: o jogador que não agiu perde a mão (outro ganha).
    /// Qualquer um pode chamar (ex.: adversário ou frontend) para o jogo não ficar travado.
    pub fn advance_timeout(env: Env, game_id: u64) -> Result<(), Error> {
        let mut game = load_game(&env, game_id)?;
        if game.state == GameState::Finished {
            return Err(Error::GameAlreadyFinished);
        }
        if game.state == GameState::Cancelled {
            return Err(Error::GameCancelled);
        }
        let config = load_config(&env)?;
        let now = env.ledger().timestamp();
        let timeout = match game.state {
            GameState::ShuffleCommit | GameState::ShuffleReveal => config.reveal_timeout,
            GameState::PreFlop
            | GameState::FlopBetting
            | GameState::TurnBetting
            | GameState::RiverBetting
            | GameState::Showdown => config.bet_timeout,
            _ => return Err(Error::NoTimeoutApplicable),
        };
        if now <= game.last_action_at + timeout {
            return Err(Error::TimeoutNotReached);
        }
        let non_acting = determine_non_acting_player(&game)?;

        match game.state {
            GameState::ShuffleCommit | GameState::ShuffleReveal | GameState::Showdown => {
                // Sem equivalente a "check"; quem não agiu perde a mão.
                let winner = if non_acting == game.player1 {
                    game.player2.clone().unwrap()
                } else {
                    game.player1.clone()
                };
                game.winner = Some(winner.clone());
                game.state = if game.state == GameState::Showdown {
                    GameState::Finished
                } else {
                    GameState::Cancelled
                };
                game.last_action_at = now;
                save_game(&env, game_id, &game);
                payout_game(env.clone(), &game)?;
                if game.player2.is_some() && game.state == GameState::Finished {
                    reset_game_for_next_hand(&env, game_id)?;
                } else {
                    let hub_addr: Address = env
                        .storage()
                        .instance()
                        .get(&DataKey::GameHubAddress)
                        .unwrap();
                    let hub = GameHubClient::new(&env, &hub_addr);
                    hub.end_game(&(game_id as u32), &(winner == game.player1));
                }
                env.events()
                    .publish((symbol_short!("TIMEOUT"), game_id), non_acting);
            }
            GameState::PreFlop
            | GameState::FlopBetting
            | GameState::TurnBetting
            | GameState::RiverBetting => {
                let (current_bet_self, current_bet_other) = if non_acting == game.player1 {
                    (game.current_bet_p1, game.current_bet_p2)
                } else {
                    (game.current_bet_p2, game.current_bet_p1)
                };
                let to_call = current_bet_other - current_bet_self;

                if to_call == 0 {
                    // Auto-Check: passa a vez e avança a ronda se as apostas estiverem igualadas.
                    game.actor = 1u32 - game.actor;
                    game.last_action_at = now;
                    if game.current_bet_p1 == game.current_bet_p2 {
                        game.current_bet_p1 = 0;
                        game.current_bet_p2 = 0;
                        game.min_raise = game.big_blind;
                        game.last_raise_amount = game.big_blind;
                        game.state = advance_betting_round(&mut game);
                    }
                    save_game(&env, game_id, &game);
                    env.events()
                        .publish((symbol_short!("TMOUT_CHK"), game_id), non_acting);
                } else {
                    // Auto-Fold: quem não respondeu perde a mão.
                    game.folded = Some(non_acting.clone());
                    let winner = if non_acting == game.player1 {
                        game.player2.clone().unwrap()
                    } else {
                        game.player1.clone()
                    };
                    game.winner = Some(winner.clone());
                    game.state = GameState::Finished;
                    game.last_action_at = now;
                    save_game(&env, game_id, &game);
                    payout_game(env.clone(), &game)?;
                    if game.player2.is_some() {
                        reset_game_for_next_hand(&env, game_id)?;
                    } else {
                        let hub_addr: Address = env
                            .storage()
                            .instance()
                            .get(&DataKey::GameHubAddress)
                            .unwrap();
                        let hub = GameHubClient::new(&env, &hub_addr);
                        hub.end_game(&(game_id as u32), &(winner == game.player1));
                    }
                    env.events()
                        .publish((symbol_short!("TMOUT_F"), game_id), non_acting);
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// [Deprecated] Use advance_timeout. Reclamar timeout (jogador inativo perde). Mantido por compatibilidade.
    pub fn claim_timeout(env: Env, _caller: Address, game_id: u64) -> Result<(), Error> {
        _caller.require_auth();
        Self::advance_timeout(env, game_id)
    }

    pub fn get_game(env: Env, game_id: u64) -> Result<Game, Error> {
        load_game(&env, game_id)
    }

    pub fn get_config(env: Env) -> Result<GameConfig, Error> {
        load_config(&env)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    /// Set or clear the payment controller (escrow). Admin only. Enables lock_funds on sit/create/join and payout_winner on game end.
    pub fn set_payment_controller(env: Env, admin: Address, payment_controller: Option<Address>) {
        admin.require_auth();
        let mut config = load_config(&env).expect("Config not set");
        config.payment_controller = payment_controller;
        save_config(&env, &config);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Send an on-chain chat message for a game.
    /// Message is emitted as a contract event (not stored) — cost is just the tx fee.
    /// Max 280 characters.
    pub fn send_chat(env: Env, sender: Address, game_id: u64, message: String) -> Result<(), Error> {
        sender.require_auth();
        if message.len() > 280 {
            return Err(Error::MessageTooLong);
        }
        env.events().publish(
            (symbol_short!("CHAT"), game_id),
            (sender, message),
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
