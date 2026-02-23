#![no_std]

//! ProofVerifier: on-chain verification of ZK proofs (hand_validator, hand_ranker).
//! Stub implementation: verify_hand_valid and verify_hand_rank return true until
//! Barretenberg or native Soroban verifier is available.

use soroban_sdk::{contract, contracterror, contractimpl, BytesN, Env};

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidInputs = 1,
    InvalidProof = 2,
}

/// Stub: no real verifier yet. Returns true so game flow can run.
/// Production: load VK and call Barretenberg/native verifier.
#[contract]
pub struct ProofVerifier;

#[contractimpl]
impl ProofVerifier {
    /// Verify valid-hand proof. Public inputs: board_hash, commitment.
    /// Stub: always returns true.
    pub fn verify_hand_valid(
        _env: Env,
        _proof: BytesN<256>,
        _board_hash: BytesN<32>,
        _commitment: BytesN<32>,
    ) -> Result<bool, Error> {
        // TODO: Barretenberg/native verifier
        Ok(true)
    }

    /// Verify hand-ranking proof. Public inputs: board_hash, claimed_rank, commitment.
    /// Stub: always returns true.
    pub fn verify_hand_rank(
        _env: Env,
        _proof: BytesN<256>,
        _board_hash: BytesN<32>,
        _claimed_rank: u32,
        _commitment: BytesN<32>,
    ) -> Result<bool, Error> {
        if _claimed_rank == 0 || _claimed_rank > 10 {
            return Err(Error::InvalidInputs);
        }
        // TODO: Barretenberg/native verifier
        Ok(true)
    }
}

#[cfg(test)]
mod test;
