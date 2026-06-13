#![cfg(test)]

use super::*;
use soroban_sdk::{Address, BytesN, Env, String, testutils::Address as _};

fn rec(env: &Env, b: u8) -> [BytesN<32>; 3] {
    [
        BytesN::from_array(env, &[b; 32]),
        BytesN::from_array(env, &[b.wrapping_add(1); 32]),
        BytesN::from_array(env, &[b.wrapping_add(2); 32]),
    ]
}

#[test]
fn register_and_resolve() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(BenzoHandleRegistry, ());
    let client = BenzoHandleRegistryClient::new(&env, &id);

    let owner = Address::generate(&env);
    let h = String::from_str(&env, "@alice");
    let [sp, vp, mvk] = rec(&env, 10);
    client.register(&h, &owner, &sp, &vp, &mvk);

    assert!(client.is_registered(&h));
    let r = client.resolve(&h);
    assert_eq!(r.owner, owner);
    assert_eq!(r.spend_pub, sp);
    assert_eq!(r.view_pub, vp);
    assert_eq!(r.mvk_scalar, mvk);
}

#[test]
fn unknown_handle_errors() {
    let env = Env::default();
    let id = env.register(BenzoHandleRegistry, ());
    let client = BenzoHandleRegistryClient::new(&env, &id);
    let res = client.try_resolve(&String::from_str(&env, "@nobody"));
    assert_eq!(res, Err(Ok(Error::NotFound)));
}

#[test]
fn owner_can_update_other_cannot_hijack() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(BenzoHandleRegistry, ());
    let client = BenzoHandleRegistryClient::new(&env, &id);

    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let h = String::from_str(&env, "@bob");
    let [sp, vp, mvk] = rec(&env, 1);
    client.register(&h, &owner, &sp, &vp, &mvk);

    // owner updates -> ok
    let [sp2, vp2, mvk2] = rec(&env, 50);
    client.register(&h, &owner, &sp2, &vp2, &mvk2);
    assert_eq!(client.resolve(&h).spend_pub, sp2);

    // attacker tries to claim the same handle -> HandleTaken
    let res = client.try_register(&h, &attacker, &sp, &vp, &mvk);
    assert_eq!(res, Err(Ok(Error::HandleTaken)));
}
