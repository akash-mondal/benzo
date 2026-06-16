#![allow(clippy::expect_used)]

use super::*;
use benzo_merkle::{BenzoMerkleTree, BenzoMerkleTreeClient};
use soroban_sdk::{Address, Env, U256, testutils::Address as _};

fn setup(levels: u32) -> (Env, Address, BenzoMvkRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(BenzoMvkRegistry, (admin.clone(), levels));
    let client = BenzoMvkRegistryClient::new(&env, &id);
    (env, admin, client)
}

#[test]
fn init_state() {
    let (env, _admin, c) = setup(8);
    assert_ne!(c.current_root(), U256::from_u32(&env, 0));
    assert_eq!(c.next_index(), 0u32);
    assert_eq!(c.levels(), 8u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn rejects_bad_levels() {
    let env = Env::default();
    let admin = Address::generate(&env);
    env.register(BenzoMvkRegistry, (admin, 33u32));
}

#[test]
fn register_appends_and_tracks_history() {
    let (env, _admin, c) = setup(8);
    let root0 = c.current_root();

    let idx = c.register_mvk(&U256::from_u32(&env, 1111), &U256::from_u32(&env, 7));
    assert_eq!(idx, 0u32);
    let root1 = c.current_root();
    assert_ne!(root1, root0);
    assert!(c.is_registered(&U256::from_u32(&env, 1111)));

    let idx2 = c.register_mvk(&U256::from_u32(&env, 2222), &U256::from_u32(&env, 7));
    assert_eq!(idx2, 1u32);
    let root2 = c.current_root();

    // Root history: a proof against any recent root still verifies.
    assert!(c.is_known_root(&root0));
    assert!(c.is_known_root(&root1));
    assert!(c.is_known_root(&root2));
    // Zero / unknown roots are rejected.
    assert!(!c.is_known_root(&U256::from_u32(&env, 0)));
    assert!(!c.is_known_root(&U256::from_u32(&env, 999_999)));
    assert_eq!(c.next_index(), 2u32);
}

#[test]
fn rejects_duplicate_mvk() {
    let (env, _admin, c) = setup(8);
    c.register_mvk(&U256::from_u32(&env, 42), &U256::from_u32(&env, 1));
    let res = c.try_register_mvk(&U256::from_u32(&env, 42), &U256::from_u32(&env, 2));
    assert_eq!(res, Err(Ok(Error::DuplicateMvk)));
}

#[test]
fn rejects_zero_mvk() {
    let (env, _admin, c) = setup(8);
    let res = c.try_register_mvk(&U256::from_u32(&env, 0), &U256::from_u32(&env, 1));
    assert_eq!(res, Err(Ok(Error::ZeroMvk)));
}

#[test]
fn full_registry_rejects_registration() {
    let (env, _admin, c) = setup(1); // capacity 2
    c.register_mvk(&U256::from_u32(&env, 1), &U256::from_u32(&env, 0));
    c.register_mvk(&U256::from_u32(&env, 2), &U256::from_u32(&env, 0));
    let res = c.try_register_mvk(&U256::from_u32(&env, 3), &U256::from_u32(&env, 0));
    assert_eq!(res, Err(Ok(Error::RegistryFull)));
}

#[test]
fn register_requires_admin_auth() {
    let (env, _admin, c) = setup(8);
    env.mock_auths(&[]); // revoke blanket auth
    let res = c.try_register_mvk(&U256::from_u32(&env, 5), &U256::from_u32(&env, 0));
    assert!(res.is_err(), "register_mvk without admin auth must fail");
}

/// Cross-contract equivalence: `register_mvk(mvk, meta)` must produce exactly the
/// same root as inserting `leaf_of(mvk, meta)` into the audited `benzo-merkle`
/// incremental tree. This proves the registry wraps the registry-leaf domain
/// (0x08, the circuit's `BenzoMvkRegistryLeaf`) in the identical, byte-validated
/// tree mechanics — without re-deriving Poseidon2 here (that's gated separately).
#[test]
fn root_matches_reference_merkle_over_leaf_of() {
    let levels = 6u32;
    let (env, _admin, reg) = setup(levels);

    // Reference merkle tree of the same depth.
    let operator = Address::generate(&env);
    let madmin = Address::generate(&env);
    let mid = env.register(BenzoMerkleTree, (madmin, levels));
    let merkle = BenzoMerkleTreeClient::new(&env, &mid);
    merkle.set_operator(&operator);

    let mvks: [(u32, u32); 4] = [(1001, 1), (1002, 2), (1003, 3), (1004, 4)];
    for (mvk, meta) in mvks {
        let mvk = U256::from_u32(&env, mvk);
        let meta = U256::from_u32(&env, meta);
        // The leaf the registry will insert, taken as ground truth from the same
        // host hash the circuit pins.
        let leaf = reg.leaf_of(&mvk, &meta);
        reg.register_mvk(&mvk, &meta);
        merkle.insert_leaf(&leaf);
    }
    assert_eq!(
        reg.current_root(),
        merkle.current_root(),
        "register_mvk must wrap leaf_of in the same tree as benzo-merkle",
    );
}
