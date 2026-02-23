#![no_std]

//! PaymentController: XLM escrow and payouts for the poker game.
//! Only the configured game-manager contract may call payout_winner and refund_on_timeout.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, symbol_short,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    Treasury,
    GameManager,
    Escrow(Address),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    ConfigNotSet = 2,
    InsufficientBalance = 3,
    InvalidAmount = 4,
}

#[contract]
pub struct PaymentController;

#[contractimpl]
impl PaymentController {
    /// Initialize: token (native XLM address), treasury, and game-manager (authorized caller for payout/refund).
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        treasury: Address,
        game_manager: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            admin.require_auth();
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::GameManager, &game_manager);
        Ok(())
    }

    /// Lock funds in escrow. Caller must be the player (require_auth).
    pub fn lock_funds(env: Env, player: Address, amount: i128) -> Result<(), Error> {
        player.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::ConfigNotSet)?;
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&player, &env.current_contract_address(), &amount);
        let key = DataKey::Escrow(player.clone());
        let balance: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(balance + amount));
        env.events().publish((symbol_short!("LOCK"), amount), player);
        Ok(())
    }

    /// Payout winner and rake. Only game-manager may call.
    pub fn payout_winner(
        env: Env,
        winner: Address,
        payout: i128,
        rake: i128,
    ) -> Result<(), Error> {
        let game_manager: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameManager)
            .ok_or(Error::ConfigNotSet)?;
        game_manager.require_auth();
        if payout < 0 || rake < 0 {
            return Err(Error::InvalidAmount);
        }
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::ConfigNotSet)?;
        let token_client = token::Client::new(&env, &token_addr);
        if payout > 0 {
            token_client.transfer(&env.current_contract_address(), &winner, &payout);
        }
        if rake > 0 {
            let treasury: Address = env
                .storage()
                .instance()
                .get(&DataKey::Treasury)
                .ok_or(Error::ConfigNotSet)?;
            token_client.transfer(&env.current_contract_address(), &treasury, &rake);
        }
        env.events().publish((symbol_short!("PAYOUT"), payout, rake), winner);
        Ok(())
    }

    /// Refund player on timeout/cancel. Only game-manager may call.
    pub fn refund_on_timeout(env: Env, player: Address, amount: i128) -> Result<(), Error> {
        let game_manager: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameManager)
            .ok_or(Error::ConfigNotSet)?;
        game_manager.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Escrow(player.clone());
        let balance: i128 = env.storage().instance().get(&key).unwrap_or(0);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::ConfigNotSet)?;
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &player, &amount);
        env.storage().instance().set(&key, &(balance - amount));
        env.events().publish((symbol_short!("REFUND"), amount), player);
        Ok(())
    }

    pub fn get_escrow_balance(env: Env, player: Address) -> Result<i128, Error> {
        let key = DataKey::Escrow(player);
        Ok(env.storage().instance().get(&key).unwrap_or(0))
    }
}

#[cfg(test)]
mod test;
