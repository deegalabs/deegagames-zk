#![no_std]

//! Stub Game Hub for Poker ZK: implements start_game and end_game as no-ops.
//! The game-manager calls this when a game starts/ends; use a real hub later for standings/sessions.

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct GameHub;

#[contractimpl]
impl GameHub {
    /// Called by game-manager when a 2-player game starts. No-op for stub.
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

    /// Called by game-manager when a game ends. No-op for stub.
    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
    }
}
