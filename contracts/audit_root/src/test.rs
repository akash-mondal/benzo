use super::*;
use soroban_sdk::{
    Address, BytesN, Env,
    testutils::{Address as _, Ledger},
};

fn b(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

fn setup() -> (Env, BenzoAuditRootClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(123);
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let id = env.register(BenzoAuditRoot, (admin.clone(),));
    let client = BenzoAuditRootClient::new(&env, &id);
    (env, client, admin)
}

#[test]
fn anchors_first_root_and_reads_latest() {
    let (env, client, _admin) = setup();
    let org = b(&env, 1);
    let rec = client.anchor_root(&org, &0u64, &b(&env, 2), &b(&env, 3), &b(&env, 4), &7u32);

    assert_eq!(rec.sequence, 0);
    assert_eq!(rec.event_count, 7);
    assert_eq!(rec.prev_anchor_hash, b(&env, 0));
    assert_eq!(rec.ledger, 123);
    assert_eq!(rec.anchored_at, 1_000);
    assert_eq!(client.next_sequence(&org), 1);
    assert_eq!(client.latest(&org), rec);
    assert_eq!(client.get(&org, &0u64), rec);
    assert_eq!(client.recompute_hash(&rec), rec.anchor_hash);
}

#[test]
fn chains_roots_per_org_without_plaintext_identifiers() {
    let (env, client, _admin) = setup();
    let org = b(&env, 9);
    let first = client.anchor_root(&org, &0u64, &b(&env, 10), &b(&env, 11), &b(&env, 12), &2u32);
    env.ledger().set_sequence_number(124);
    env.ledger().set_timestamp(1_005);
    let second = client.anchor_root(&org, &1u64, &b(&env, 13), &b(&env, 14), &b(&env, 15), &3u32);

    assert_eq!(second.prev_anchor_hash, first.anchor_hash);
    assert_ne!(second.anchor_hash, first.anchor_hash);
    assert_eq!(client.latest(&org), second);
    assert_eq!(client.get(&org, &0u64), first);
}

#[test]
fn rejects_empty_bad_sequence_and_replay() {
    let (env, client, _admin) = setup();
    let org = b(&env, 1);

    assert_eq!(
        client.try_anchor_root(&org, &0u64, &b(&env, 2), &b(&env, 3), &b(&env, 4), &0u32),
        Err(Ok(Error::EmptyPacket)),
    );
    assert_eq!(
        client.try_anchor_root(&org, &2u64, &b(&env, 2), &b(&env, 3), &b(&env, 4), &1u32),
        Err(Ok(Error::BadSequence)),
    );

    client.anchor_root(&org, &0u64, &b(&env, 2), &b(&env, 3), &b(&env, 4), &1u32);
    assert_eq!(
        client.try_anchor_root(&org, &0u64, &b(&env, 5), &b(&env, 6), &b(&env, 7), &1u32),
        Err(Ok(Error::BadSequence)),
    );
}

#[test]
fn get_unknown_root_is_clean_error() {
    let (env, client, _admin) = setup();
    assert_eq!(client.try_latest(&b(&env, 8)), Err(Ok(Error::NotFound)));
    assert_eq!(client.try_get(&b(&env, 8), &0u64), Err(Ok(Error::NotFound)));
}

#[test]
fn anchor_requires_admin_auth() {
    let (env, client, _admin) = setup();
    env.mock_auths(&[]);
    let res = client.try_anchor_root(
        &b(&env, 1),
        &0u64,
        &b(&env, 2),
        &b(&env, 3),
        &b(&env, 4),
        &1u32,
    );
    assert!(res.is_err(), "anchor_root without admin auth must fail");
}
