#![cfg(test)]

use crate::{Action, GameConfig, GameState, PokerZkContract, PokerZkContractClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }
    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
    }
}

fn setup_test() -> (
    Env,
    PokerZkContractClient<'static>,
    MockGameHubClient<'static>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });
    let hub_addr = env.register(MockGameHub, ());
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let contract_id = env.register(
        PokerZkContract,
        (
            &admin,
            &hub_addr,
            &5i128,
            &10i128,
            &100i128,
            &1_000_000i128,
            &2u32,
        ),
    );
    let client = PokerZkContractClient::new(&env, &contract_id);
    let config = GameConfig {
        min_buy_in: 100,
        max_buy_in: 1_000_000,
        small_blind: 5,
        big_blind: 10,
        rake_percentage: 200,
        reveal_timeout: 3600,
        bet_timeout: 300,
        waiting_timeout: 3600,
        treasury,
        game_hub: hub_addr.clone(),
        payment_controller: None,
        proof_verifier: None,
    };
    client.initialize(&admin, &config);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let hub_client = MockGameHubClient::new(&env, &hub_addr);
    (env, client, hub_client, player1, player2)
}

fn seed_commit(env: &Env, seed: &BytesN<32>) -> BytesN<32> {
    let bytes = Bytes::from_slice(env, &seed.to_array());
    env.crypto().sha256(&bytes).to_bytes()
}

#[test]
fn test_create_and_join_game() {
    let (_env, client, _hub, player1, player2) = setup_test();
    let buy_in = 1000i128;
    let game_id = client.create_game(&player1, &0u64, &buy_in);
    let game = client.get_game(&game_id);
    assert_eq!(game.state, GameState::WaitingForPlayers);
    assert_eq!(game.player1, player1);
    assert!(game.player2.is_none());
    assert_eq!(game.pot, buy_in);

    client.join_game(&player2, &game_id);
    let game2 = client.get_game(&game_id);
    assert_eq!(game2.state, GameState::ShuffleCommit);
    assert_eq!(game2.player2, Some(player2));
    assert_eq!(game2.pot, buy_in + buy_in);
}

#[test]
fn test_commit_and_reveal_seed() {
    let (env, client, _hub, player1, player2) = setup_test();
    let buy_in = 1000i128;
    let game_id = client.create_game(&player1, &0u64, &buy_in);
    client.join_game(&player2, &game_id);

    let seed1 = BytesN::from_array(&env, &[1u8; 32]);
    let seed2 = BytesN::from_array(&env, &[2u8; 32]);
    let commit1 = seed_commit(&env, &seed1);
    let commit2 = seed_commit(&env, &seed2);
    client.commit_seed(&player1, &game_id, &commit1);
    client.commit_seed(&player2, &game_id, &commit2);

    let game = client.get_game(&game_id);
    assert_eq!(game.state, GameState::ShuffleReveal);

    client.reveal_seed(&player1, &game_id, &seed1);
    client.reveal_seed(&player2, &game_id, &seed2);

    let game2 = client.get_game(&game_id);
    assert_eq!(game2.state, GameState::DealCards);
    assert!(game2.final_seed.is_some());
    assert_eq!(game2.board.len(), 5);
}

#[test]
fn test_post_blinds_and_fold() {
    let (env, client, _hub, player1, player2) = setup_test();
    let buy_in = 1000i128;
    let game_id = client.create_game(&player1, &0u64, &buy_in);
    client.join_game(&player2, &game_id);
    let seed1 = BytesN::from_array(&env, &[1u8; 32]);
    let seed2 = BytesN::from_array(&env, &[2u8; 32]);
    client.commit_seed(&player1, &game_id, &seed_commit(&env, &seed1));
    client.commit_seed(&player2, &game_id, &seed_commit(&env, &seed2));
    client.reveal_seed(&player1, &game_id, &seed1);
    client.reveal_seed(&player2, &game_id, &seed2);

    client.post_blinds(&game_id);
    let game = client.get_game(&game_id);
    assert_eq!(game.state, GameState::PreFlop);
    assert!(game.current_bet_p1 > 0 || game.current_bet_p2 > 0);

    client.act(&player2, &game_id, &Action::Fold, &0, &None, &None);
    let game2 = client.get_game(&game_id);
    assert_eq!(game2.state, GameState::Finished);
    assert_eq!(game2.winner, Some(player1));
}

#[test]
fn test_sit_at_table_waiting_then_start() {
    let (env, client, _hub, player1, player2) = setup_test();
    let buy_in = 1000i128;
    let table_id = 0u64;

    let r1 = client.sit_at_table(&player1, &table_id, &buy_in);
    assert!(r1.waiting);
    assert_eq!(r1.game_id, 0);

    let waiting = client.get_table_waiting(&table_id);
    assert_eq!(waiting.player1, player1);
    assert_eq!(waiting.buy_in, buy_in);

    let r2 = client.sit_at_table(&player2, &table_id, &buy_in);
    assert!(!r2.waiting);
    let game_id = r2.game_id;

    let game = client.get_game(&r2.game_id);
    assert_eq!(game.state, GameState::ShuffleCommit);
    assert_eq!(game.player1, player1);
    assert_eq!(game.player2, Some(player2));
    assert_eq!(game.pot, buy_in + buy_in);

    // After 2nd sit, waiting is cleared and game started; get_table_waiting would return NoWaitingSession
}

#[test]
fn test_cancel_waiting_by_player_anytime() {
    let (_env, client, _hub, player1, _player2) = setup_test();
    let buy_in = 1000i128;
    let table_id = 0u64;

    let r1 = client.sit_at_table(&player1, &table_id, &buy_in);
    assert!(r1.waiting);
    let waiting = client.get_table_waiting(&table_id);
    assert_eq!(waiting.player1, player1);

    client.cancel_waiting(&player1, &table_id);
    // Table is free again: player1 can sit and become 1/2
    let r2 = client.sit_at_table(&player1, &table_id, &buy_in);
    assert!(r2.waiting);
}

#[test]
fn test_cancel_waiting_by_other_after_timeout() {
    let (env, client, _hub, player1, player2) = setup_test();
    let buy_in = 1000i128;
    let table_id = 0u64;

    client.sit_at_table(&player1, &table_id, &buy_in);
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600 + 4000, // waiting_timeout is 3600 in config
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });
    client.cancel_waiting(&player2, &table_id);
    // Table is free: player2 can sit and become 1/2
    let r = client.sit_at_table(&player2, &table_id, &buy_in);
    assert!(r.waiting);
}

#[test]
#[should_panic]
fn test_cancel_waiting_by_other_before_timeout_fails() {
    let (_env, client, _hub, player1, player2) = setup_test();
    let buy_in = 1000i128;
    let table_id = 0u64;

    client.sit_at_table(&player1, &table_id, &buy_in);
    client.cancel_waiting(&player2, &table_id); // WaitingTimeoutNotReached
}

#[test]
fn test_set_payment_controller() {
    let (env, client, _hub, _player1, _player2) = setup_test();
    let admin = client.get_admin();
    let cfg_before = client.get_config();
    assert!(cfg_before.payment_controller.is_none());

    let pc_addr = Address::generate(&env);
    client.set_payment_controller(&admin, &Some(pc_addr.clone()));
    let cfg_mid = client.get_config();
    assert_eq!(cfg_mid.payment_controller, Some(pc_addr));

    client.set_payment_controller(&admin, &None);
    let cfg_after = client.get_config();
    assert!(cfg_after.payment_controller.is_none());
}
