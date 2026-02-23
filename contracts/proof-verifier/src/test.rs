#![cfg(test)]

use crate::{ProofVerifier, ProofVerifierClient};
use soroban_sdk::{BytesN, Env};

fn setup(env: &Env) -> ProofVerifierClient<'static> {
    let contract_id = env.register(ProofVerifier, ());
    ProofVerifierClient::new(env, &contract_id)
}

#[test]
fn test_verify_hand_valid_accepts_any_input() {
    let env = Env::default();
    let client = setup(&env);
    let proof = BytesN::from_array(&env, &[0u8; 256]);
    let board_hash = BytesN::from_array(&env, &[1u8; 32]);
    let commitment = BytesN::from_array(&env, &[2u8; 32]);
    let result = client.verify_hand_valid(&proof, &board_hash, &commitment);
    assert!(result);
}

#[test]
fn test_verify_hand_rank_accepts_valid_rank() {
    let env = Env::default();
    let client = setup(&env);
    let proof = BytesN::from_array(&env, &[0u8; 256]);
    let board_hash = BytesN::from_array(&env, &[1u8; 32]);
    let commitment = BytesN::from_array(&env, &[2u8; 32]);
    for rank in 1u32..=10 {
        let result = client.verify_hand_rank(&proof, &board_hash, &rank, &commitment);
        assert!(result, "rank {} should be accepted", rank);
    }
}

#[test]
#[should_panic]
fn test_verify_hand_rank_rejects_zero_rank() {
    let env = Env::default();
    let client = setup(&env);
    let proof = BytesN::from_array(&env, &[0u8; 256]);
    let board_hash = BytesN::from_array(&env, &[1u8; 32]);
    let commitment = BytesN::from_array(&env, &[2u8; 32]);
    let _ = client.verify_hand_rank(&proof, &board_hash, &0u32, &commitment);
}

#[test]
#[should_panic]
fn test_verify_hand_rank_rejects_rank_over_10() {
    let env = Env::default();
    let client = setup(&env);
    let proof = BytesN::from_array(&env, &[0u8; 256]);
    let board_hash = BytesN::from_array(&env, &[1u8; 32]);
    let commitment = BytesN::from_array(&env, &[2u8; 32]);
    let _ = client.verify_hand_rank(&proof, &board_hash, &11u32, &commitment);
}
