use super::*;
use soroban_sdk::{Address, Env, U256, testutils::Address as _};

fn setup() -> (Env, BenzoIdentityNullifierSetClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);
    let contract_id = env.register(BenzoIdentityNullifierSet, (admin,));
    let client = BenzoIdentityNullifierSetClient::new(&env, &contract_id);
    client.set_operator(&operator);
    (env, client)
}

/// The core sybil invariant: a first registration succeeds, a SECOND under the
/// same identity nullifier is rejected (unlike the idempotent spend set).
#[test]
fn register_is_sybil_resistant() {
    let (env, client) = setup();
    let n = U256::from_u32(&env, 12345);

    assert!(!client.is_registered(&n));
    client.register(&n); // first: ok
    assert!(client.is_registered(&n));

    // Second registration of the same identity must FAIL (account-farming guard).
    let res = client.try_register(&n);
    assert!(
        res.is_err(),
        "duplicate identity registration must be rejected"
    );
}

#[test]
fn distinct_identities_are_independent() {
    let (env, client) = setup();
    let a = U256::from_u32(&env, 1);
    let b = U256::from_u32(&env, 2);
    client.register(&a);
    assert!(!client.is_registered(&b));
    client.register(&b);
    assert!(client.is_registered(&b));
}

/// Identity nullifiers must live in persistent storage (a TTL-reaped entry would
/// silently re-enable account farming).
#[test]
fn identity_stored_persistently() {
    let (env, client) = setup();
    let contract_id = client.address.clone();
    let n = U256::from_u32(&env, 7);
    client.register(&n);

    let in_persistent: bool = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .has(&DataKey::Identity(U256::from_u32(&env, 7)))
    });
    assert!(
        in_persistent,
        "identity nullifier must be in persistent storage"
    );
}

/// Negative auth: `register` is operator-only.
#[test]
fn register_requires_operator_auth() {
    let (env, client) = setup();
    env.mock_auths(&[]); // revoke the blanket auth granted in setup
    let res = client.try_register(&U256::from_u32(&env, 7));
    assert!(res.is_err(), "register without operator auth must fail");
}
