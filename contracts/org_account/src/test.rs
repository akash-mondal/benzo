
use super::*;
use soroban_sdk::{Address, BytesN, Env, Symbol, U256, Vec, testutils::Address as _, vec};

fn setup() -> (Env, BenzoOrgAccountClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(BenzoOrgAccount, (admin,));
    let client = BenzoOrgAccountClient::new(&env, &contract_id);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    (env, client, a, b, c)
}

fn members(env: &Env, a: &Address, b: &Address, c: &Address) -> Vec<Address> {
    vec![env, a.clone(), b.clone(), c.clone()]
}

#[test]
fn register_and_read_org() {
    let (env, client, a, b, c) = setup();
    let gk = U256::from_u32(&env, 999);
    client.register_org(&1u64, &gk, &2u32, &members(&env, &a, &b, &c));
    let org = client.get_org(&1u64);
    assert_eq!(org.threshold, 2);
    assert_eq!(org.epoch, 0);
    assert_eq!(org.members.len(), 3);
    assert_eq!(org.group_pubkey, gk);
}

#[test]
fn member_root_round_trips_for_in_circuit_m_of_n() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
    // an off-chain-computed (circomlib-Poseidon) root of members' BabyJubJub key-ids
    let root = U256::from_u32(&env, 0xdead_beef);
    client.set_member_root(&1u64, &root);
    assert_eq!(client.member_root(&1u64), root);
    assert!(client.try_member_root(&2u64).is_err()); // unset for an unknown org
    assert!(client.try_set_member_root(&9u64, &root).is_err()); // can't set for a non-existent org
}

#[test]
fn dual_control_reaches_threshold_with_distinct_members() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));

    // a proposes.
    client.propose(&1u64, &7u64, &U256::from_u32(&env, 0xabc), &a);
    assert_eq!(client.approval_count(&1u64, &7u64), 0);
    assert!(!client.is_approved(&1u64, &7u64));

    // b approves -> 1, not yet approved.
    assert_eq!(client.approve(&1u64, &7u64, &b), 1);
    assert!(!client.is_approved(&1u64, &7u64));

    // c approves -> 2 distinct, threshold met.
    assert_eq!(client.approve(&1u64, &7u64, &c), 2);
    assert!(client.is_approved(&1u64, &7u64));
}

#[test]
fn proposer_cannot_approve_own_proposal() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
    client.propose(&1u64, &7u64, &U256::from_u32(&env, 1), &a);
    // Segregation of duties: the proposer (a) cannot approve.
    assert!(client.try_approve(&1u64, &7u64, &a).is_err());
}

#[test]
fn duplicate_approval_is_rejected() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
    client.propose(&1u64, &7u64, &U256::from_u32(&env, 1), &a);
    client.approve(&1u64, &7u64, &b);
    // b cannot approve twice (the count must reflect DISTINCT members).
    assert!(client.try_approve(&1u64, &7u64, &b).is_err());
    assert_eq!(client.approval_count(&1u64, &7u64), 1);
}

#[test]
fn non_member_cannot_propose_or_approve() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
    let outsider = Address::generate(&env);
    assert!(client.try_propose(&1u64, &7u64, &U256::from_u32(&env, 1), &outsider).is_err());
    client.propose(&1u64, &8u64, &U256::from_u32(&env, 1), &a);
    assert!(client.try_approve(&1u64, &8u64, &outsider).is_err());
}

#[test]
fn rejects_bad_threshold() {
    let (env, client, a, b, c) = setup();
    let m = members(&env, &a, &b, &c);
    // threshold 0 and threshold > members are both invalid.
    assert!(client.try_register_org(&1u64, &U256::from_u32(&env, 1), &0u32, &m).is_err());
    assert!(client.try_register_org(&2u64, &U256::from_u32(&env, 1), &4u32, &m).is_err());
}

#[test]
fn kyb_attestation_is_on_chain_and_issuer_gated() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));

    // default: Unverified, no backend decided anything
    assert_eq!(client.kyb_status(&1u64).0, KybStatus::Unverified);

    // designate an on-chain KYB issuer (the seam for a real provider's key)
    let issuer = Address::generate(&env);
    client.set_kyb_issuer(&issuer);

    // the issuer posts an Approved attestation on-chain (signed, not fabricated)
    client.attest_kyb(&1u64, &KybStatus::Approved, &U256::from_u32(&env, 0xABC));
    let (status, inquiry) = client.kyb_status(&1u64);
    assert_eq!(status, KybStatus::Approved);
    assert_eq!(inquiry, U256::from_u32(&env, 0xABC));
}

#[test]
fn kyb_attest_requires_an_issuer_to_be_set() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
    // no issuer designated yet -> cannot attest
    assert!(client.try_attest_kyb(&1u64, &KybStatus::Approved, &U256::from_u32(&env, 1)).is_err());
}

#[test]
fn kyb_attest_unknown_org_fails() {
    let (env, client, _a, _b, _c) = setup();
    let issuer = Address::generate(&env);
    client.set_kyb_issuer(&issuer);
    assert!(client.try_attest_kyb(&9u64, &KybStatus::Approved, &U256::from_u32(&env, 1)).is_err());
}

#[test]
fn rotate_bumps_epoch_for_offboarding() {
    let (env, client, a, b, c) = setup();
    client.register_org(&1u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
    // Offboard c: rotate to [a, b], threshold 2, new key.
    client.rotate(&1u64, &U256::from_u32(&env, 2), &2u32, &vec![&env, a.clone(), b.clone()]);
    let org = client.get_org(&1u64);
    assert_eq!(org.epoch, 1);
    assert_eq!(org.members.len(), 2);
    assert_eq!(org.group_pubkey, U256::from_u32(&env, 2));
}

// ---- FIX #7: verify_org_proof pins orgMemberRoot + threshold to the org ----
//
// The pinning gate is independent of the Groth16 math, so we mock the verifier
// to ALWAYS return Ok(true) — this isolates the test to the policy check: if the
// proof "would verify", the ONLY thing that may still reject a self-minted root
// or a lowered threshold is `verify_org_proof`'s pinning. (A separately-tested
// verifier handles the cryptographic soundness; here we test that a valid-looking
// proof over the WRONG policy is refused.)
mod org_verify {
    use super::*;

    /// A stand-in verifier whose `verify_proof` always succeeds — so the test
    /// exercises ONLY the public-input pinning in `verify_org_proof`.
    #[contract]
    struct AlwaysOkVerifier;

    #[contractimpl]
    impl AlwaysOkVerifier {
        #[allow(unused_variables)]
        pub fn verify_proof(
            env: Env,
            vk_id: Symbol,
            proof: Groth16Proof,
            public_inputs: Vec<Bn254Fr>,
        ) -> Result<bool, Error> {
            Ok(true)
        }
    }

    /// A stand-in verifier whose `verify_proof` always FAILS — to show that, with
    /// the policy pins satisfied, a non-verifying proof is still rejected.
    #[contract]
    struct AlwaysFailVerifier;

    #[contractimpl]
    impl AlwaysFailVerifier {
        #[allow(unused_variables)]
        pub fn verify_proof(
            env: Env,
            vk_id: Symbol,
            proof: Groth16Proof,
            public_inputs: Vec<Bn254Fr>,
        ) -> Result<bool, Error> {
            Err(Error::ProofRejected)
        }
    }

    /// A dummy proof — the mock verifier ignores it, and the pinning gate runs
    /// before the verifier is ever called.
    fn dummy_proof(env: &Env) -> Groth16Proof {
        use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine};
        Groth16Proof {
            a: Bn254G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 64])),
            b: Bn254G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 128])),
            c: Bn254G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 64])),
        }
    }

    fn fr_u32(env: &Env, v: u32) -> Bn254Fr {
        let mut buf = [0u8; 32];
        buf[28..32].copy_from_slice(&v.to_be_bytes());
        Bn254Fr::from_bytes(BytesN::from_array(env, &buf))
    }

    fn fr_u256(env: &Env, v: &U256) -> Bn254Fr {
        let mut buf = [0u8; 32];
        v.to_be_bytes().copy_into_slice(&mut buf);
        Bn254Fr::from_bytes(BytesN::from_array(env, &buf))
    }

    // ORGAUTH public order: [orgMemberRoot, threshold, spendMessage, authTag].
    fn org_publics(env: &Env, member_root: &U256, threshold: u32) -> Vec<Bn254Fr> {
        let mut v = Vec::new(env);
        v.push_back(fr_u256(env, member_root));
        v.push_back(fr_u32(env, threshold));
        v.push_back(fr_u32(env, 0x5eed)); // spendMessage (prover-supplied)
        v.push_back(fr_u32(env, 0xa11)); // authTag (prover-supplied)
        v
    }

    /// Register an org with threshold 2 + a registered member root, and wire the
    /// always-ok verifier. Returns (env, client, registered_root).
    fn org_setup() -> (Env, BenzoOrgAccountClient<'static>, U256) {
        let (env, client, a, b, c) = setup();
        client.register_org(&1u64, &U256::from_u32(&env, 7), &2u32, &members(&env, &a, &b, &c));
        let registered_root = U256::from_u32(&env, 0xc0ffee);
        client.set_member_root(&1u64, &registered_root);
        let verifier_id = env.register(AlwaysOkVerifier, ());
        client.set_verifier(&verifier_id);
        (env, client, registered_root)
    }

    #[test]
    fn accepts_registered_root_and_threshold() {
        let (env, client, root) = org_setup();
        // Correct registered root + the registered threshold (2) → passes.
        let publics = org_publics(&env, &root, 2);
        let vk = Symbol::new(&env, "ORGAUTH");
        assert!(client.verify_org_proof(&1u64, &vk, &dummy_proof(&env), &publics));
    }

    #[test]
    fn rejects_self_minted_member_root() {
        let (env, client, _root) = org_setup();
        // A prover-chosen member set (NOT the registered root) — even with the
        // correct threshold and a "verifying" proof — must be rejected.
        let self_minted = U256::from_u32(&env, 0xbad_5e7);
        let publics = org_publics(&env, &self_minted, 2);
        let vk = Symbol::new(&env, "ORGAUTH");
        let res = client.try_verify_org_proof(&1u64, &vk, &dummy_proof(&env), &publics);
        assert!(res.is_err(), "a self-minted orgMemberRoot must be rejected");
    }

    #[test]
    fn rejects_threshold_below_registered() {
        let (env, client, root) = org_setup();
        // The registered threshold is 2; a proof claiming threshold = 1 (a lowered
        // M-of-N bar, e.g. a single self-controlled signer) must be rejected.
        let publics = org_publics(&env, &root, 1);
        let vk = Symbol::new(&env, "ORGAUTH");
        let res = client.try_verify_org_proof(&1u64, &vk, &dummy_proof(&env), &publics);
        assert!(res.is_err(), "a threshold below the registered M-of-N must be rejected");
    }

    #[test]
    fn rejects_when_no_member_root_registered() {
        let (env, client, a, b, c) = setup();
        // Org exists but no member root has been set — fail closed.
        client.register_org(&2u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
        let verifier_id = env.register(AlwaysOkVerifier, ());
        client.set_verifier(&verifier_id);
        let publics = org_publics(&env, &U256::from_u32(&env, 0xc0ffee), 2);
        let vk = Symbol::new(&env, "ORGAUTH");
        assert!(client.try_verify_org_proof(&2u64, &vk, &dummy_proof(&env), &publics).is_err());
    }

    #[test]
    fn rejects_when_no_verifier_configured() {
        let (env, client, a, b, c) = setup();
        client.register_org(&3u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
        client.set_member_root(&3u64, &U256::from_u32(&env, 0xc0ffee));
        // No verifier wired → fail closed.
        let publics = org_publics(&env, &U256::from_u32(&env, 0xc0ffee), 2);
        let vk = Symbol::new(&env, "ORGAUTH");
        assert!(client.try_verify_org_proof(&3u64, &vk, &dummy_proof(&env), &publics).is_err());
    }

    #[test]
    fn rejects_a_non_verifying_proof_even_with_correct_policy() {
        // Same as the happy path but with a verifier that ALWAYS fails: the policy
        // pins pass, yet the proof itself is rejected → fail closed.
        let (env, client, a, b, c) = setup();
        client.register_org(&4u64, &U256::from_u32(&env, 1), &2u32, &members(&env, &a, &b, &c));
        let root = U256::from_u32(&env, 0xc0ffee);
        client.set_member_root(&4u64, &root);
        let verifier_id = env.register(AlwaysFailVerifier, ());
        client.set_verifier(&verifier_id);
        let publics = org_publics(&env, &root, 2);
        let vk = Symbol::new(&env, "ORGAUTH");
        assert!(client.try_verify_org_proof(&4u64, &vk, &dummy_proof(&env), &publics).is_err());
    }
}
