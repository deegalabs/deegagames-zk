#![cfg(test)]

use crate::{PaymentController, PaymentControllerClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, MuxedAddress};

/// Minimal mock token for tests: balance and transfer only.
#[contract]
pub struct MockToken;

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub enum MockTokenDataKey {
    Balance(Address),
}

#[contractimpl]
impl MockToken {
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .instance()
            .get(&MockTokenDataKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        from.require_auth();
        let to_addr = to.address();
        let from_balance = Self::balance(env.clone(), from.clone());
        let to_balance = Self::balance(env.clone(), to_addr.clone());
        assert!(from_balance >= amount, "insufficient balance");
        env.storage()
            .instance()
            .set(&MockTokenDataKey::Balance(from), &(from_balance - amount));
        env.storage()
            .instance()
            .set(&MockTokenDataKey::Balance(to_addr), &(to_balance + amount));
    }

    /// Test helper: mint tokens to an address (no auth in mock).
    pub fn mint(env: Env, to: Address, amount: i128) {
        let balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .instance()
            .set(&MockTokenDataKey::Balance(to), &(balance + amount));
    }
}

fn setup(
    env: &Env,
) -> (
    PaymentControllerClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let game_manager = Address::generate(env);
    let player = Address::generate(env);

    let token_id = env.register(MockToken, ());
    let mock_token_client = MockTokenClient::new(env, &token_id);
    mock_token_client.mint(&player, &10_000);

    let pc_id = env.register(PaymentController, ());
    let pc_client = PaymentControllerClient::new(env, &pc_id);
    pc_client.initialize(&admin, &token_id, &treasury, &game_manager);

    (pc_client, admin, treasury, game_manager, player, token_id)
}

#[test]
fn test_initialize_and_get_escrow_balance() {
    let env = Env::default();
    let (client, _admin, _treasury, _gm, player, _token) = setup(&env);
    let unknown = Address::generate(&env);
    assert_eq!(client.get_escrow_balance(&unknown), 0);
    assert_eq!(client.get_escrow_balance(&player), 0);
}

#[test]
fn test_lock_funds() {
    let env = Env::default();
    let (client, _admin, _treasury, _gm, player, _token) = setup(&env);
    let amount = 1_000i128;
    client.lock_funds(&player, &amount);
    assert_eq!(client.get_escrow_balance(&player), amount);
    client.lock_funds(&player, &500);
    assert_eq!(client.get_escrow_balance(&player), 1_500);
}

#[test]
fn test_payout_winner() {
    let env = Env::default();
    let (client, _admin, _treasury, _gm, player, _token) = setup(&env);
    client.lock_funds(&player, &2_000);
    client.payout_winner(&player, &1_800, &200);
    // Escrow balance is not decremented by payout_winner (contract only transfers token)
    assert_eq!(client.get_escrow_balance(&player), 2_000);
}

#[test]
fn test_refund_on_timeout() {
    let env = Env::default();
    let (client, _admin, _treasury, _gm, player, _token) = setup(&env);
    client.lock_funds(&player, &1_000);
    client.refund_on_timeout(&player, &1_000);
    assert_eq!(client.get_escrow_balance(&player), 0);
}

