#![no_std]

//! Benzo org account — the on-chain organization primitive + dual control.
//!
//! An organization owns shielded value under ONE canonical spend identity: the
//! FROST group key `ak` (mirrors circuits/groth16/note.circom BenzoSpendKeys —
//! the consumer N=1 case is just an org of one). This contract holds the org's
//! authority set (group key, threshold, members, rotation epoch) and enforces
//! **cryptographic dual control** over money-movement proposals — the thing the
//! BFF currently only fakes (it settled on the first `approve`).
//!
//! Flow: a member `propose`s a money movement, binding the plaintext proposal as
//! a hiding `proposal_hash`; distinct OTHER members `approve` it (segregation of
//! duties — the proposer cannot approve their own proposal); once `threshold`
//! distinct approvals are collected the proposal reads as approved, and the pool
//! can gate settlement on `is_approved` plus the FROST-aggregated signature.
//!
//! Spend authority itself lives in the circuit (knowledge of the org spend
//! identity) and in the off-circuit FROST coalition — this contract enforces the
//! POLICY (who may initiate vs approve vs how many), not the cryptography.

use contract_types::Groth16Proof;
use soroban_sdk::{
    Address, BytesN, Env, Symbol, U256, Vec, contract, contractclient, contracterror,
    contractevent, contractimpl, contracttype, crypto::bn254::Bn254Fr,
};

soroban_sdk::contractmeta!(key = "binver", val = "0.1.0");
soroban_sdk::contractmeta!(key = "name", val = "benzo-org-account");

/// Cross-contract interface to the Groth16 verifier. The standalone org verifies
/// (ORGAUTH and the Z-suite org proofs) must run through `verify_org_proof`,
/// which pins the prover-chosen `orgMemberRoot`/`threshold` public inputs to THIS
/// org's REGISTERED policy before delegating here — so a self-minted member set
/// with `threshold = 1` can no longer produce `approved = true`.
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify_proof(
        env: Env,
        vk_id: Symbol,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, soroban_sdk::Error>;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract is not initialized
    NotInitialized = 1,
    /// An org with this id already exists
    OrgExists = 2,
    /// No such org
    OrgNotFound = 3,
    /// threshold must be in 1..=members.len()
    BadThreshold = 4,
    /// member set must be non-empty
    NoMembers = 5,
    /// A proposal with this id already exists for the org
    ProposalExists = 6,
    /// No such proposal
    ProposalNotFound = 7,
    /// Caller is not a member of the org
    NotMember = 8,
    /// The proposer cannot approve their own proposal (segregation of duties)
    SelfApproval = 9,
    /// This member has already approved the proposal
    DuplicateApproval = 10,
    /// Caller is not the designated on-chain KYB issuer
    NotIssuer = 11,
    /// No KYB issuer has been designated yet
    NoIssuer = 12,
    /// No Groth16 verifier has been configured for `verify_org_proof`
    VerifierNotConfigured = 13,
    /// This org has no registered member-set root to pin the proof to
    MemberRootNotSet = 14,
    /// The proof's `orgMemberRoot` / `threshold` public inputs do not match the
    /// org's REGISTERED policy — a prover-chosen (self-minted) member set or a
    /// lower threshold is rejected fail-closed
    PolicyMismatch = 15,
    /// The proof did not verify against the verifier for the given `vk_id`
    ProofRejected = 16,
}

/// On-chain KYB lifecycle for the business entity. The attestation is posted by a
/// DESIGNATED ISSUER key (us today; a real provider's key later — the same seam
/// the fiat ramp uses for MoneyGram), NOT fabricated by a backend.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KybStatus {
    Unverified,
    Pending,
    Approved,
    Rejected,
}

/// An organization's authority set.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrgRecord {
    /// FROST group spend-auth key `ak` (the org's canonical spend identity).
    pub group_pubkey: U256,
    /// M of N: distinct member approvals required to authorize a proposal.
    pub threshold: u32,
    /// The current authorized members (the N).
    pub members: Vec<Address>,
    /// Rotation epoch — bumped on every membership/key change (offboarding).
    pub epoch: u32,
}

/// A money-movement proposal under dual control.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalRecord {
    /// The member who initiated the proposal (cannot also approve it).
    pub proposer: Address,
    /// Hiding commitment to the plaintext proposal (amount/recipient/etc.).
    pub proposal_hash: U256,
    /// Distinct members who have approved so far.
    pub approvers: Vec<Address>,
    /// The org threshold captured at propose time (so a later rotation can't
    /// retroactively change the bar for an in-flight proposal).
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
enum DataKey {
    /// Administrator (may register/rotate orgs)
    Admin,
    /// Org authority set, keyed by org id
    Org(u64),
    /// Proposal, keyed by (org id, proposal id)
    Proposal(u64, u64),
    /// In-circuit M-of-N member-set root, keyed by org id
    MemberRoot(u64),
    /// Designated on-chain KYB issuer (the attestor key)
    KybIssuer,
    /// On-chain KYB status + inquiry ref, keyed by org id
    Kyb(u64),
    /// Groth16 verifier address used by `verify_org_proof`
    Verifier,
}

#[contractevent]
#[derive(Clone)]
pub struct OrgRegisteredEvent {
    #[topic]
    pub org_id: u64,
    pub threshold: u32,
    pub epoch: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct ProposalApprovedEvent {
    #[topic]
    pub org_id: u64,
    #[topic]
    pub proposal_id: u64,
    /// Distinct approvals collected after this approval.
    pub approvals: u32,
    /// True once the threshold is met.
    pub approved: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct KybAttestedEvent {
    #[topic]
    pub org_id: u64,
    pub approved: bool,
}

fn is_member(members: &Vec<Address>, who: &Address) -> bool {
    members.iter().any(|m| &m == who)
}

#[contract]
pub struct BenzoOrgAccount;

#[contractimpl]
impl BenzoOrgAccount {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    fn admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Register an org's authority set. Admin-only.
    pub fn register_org(
        env: Env,
        org_id: u64,
        group_pubkey: U256,
        threshold: u32,
        members: Vec<Address>,
    ) -> Result<(), Error> {
        Self::admin(&env)?.require_auth();
        if members.is_empty() {
            return Err(Error::NoMembers);
        }
        if threshold == 0 || threshold > members.len() {
            return Err(Error::BadThreshold);
        }
        if env.storage().persistent().has(&DataKey::Org(org_id)) {
            return Err(Error::OrgExists);
        }
        let rec = OrgRecord {
            group_pubkey,
            threshold,
            members,
            epoch: 0,
        };
        env.storage().persistent().set(&DataKey::Org(org_id), &rec);
        OrgRegisteredEvent {
            org_id,
            threshold: rec.threshold,
            epoch: 0,
        }
        .publish(&env);
        Ok(())
    }

    /// Rotate an org's key/members/threshold (offboarding, key rotation). Bumps
    /// the epoch so a revocation-aware spend predicate can reject stale members.
    /// Admin-only (a real deployment gates this behind the org's own quorum).
    pub fn rotate(
        env: Env,
        org_id: u64,
        group_pubkey: U256,
        threshold: u32,
        members: Vec<Address>,
    ) -> Result<(), Error> {
        Self::admin(&env)?.require_auth();
        if members.is_empty() {
            return Err(Error::NoMembers);
        }
        if threshold == 0 || threshold > members.len() {
            return Err(Error::BadThreshold);
        }
        let prev: OrgRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Org(org_id))
            .ok_or(Error::OrgNotFound)?;
        let epoch = prev.epoch.saturating_add(1);
        let rec = OrgRecord {
            group_pubkey,
            threshold,
            members,
            epoch,
        };
        env.storage().persistent().set(&DataKey::Org(org_id), &rec);
        OrgRegisteredEvent {
            org_id,
            threshold: rec.threshold,
            epoch,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_org(env: Env, org_id: u64) -> Result<OrgRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Org(org_id))
            .ok_or(Error::OrgNotFound)
    }

    /// Set the org's IN-CIRCUIT M-of-N member-set root — an off-chain-computed
    /// (circomlib-Poseidon) Merkle root of the members' BabyJubJub key-ids. It is
    /// stored OPAQUELY (never recomputed on-chain, so the on-chain Poseidon2 vs
    /// the circuit's Poseidon never has to match), so the pool can bind an
    /// `org_spend_auth` proof's public `orgMemberRoot` to THIS org. Admin-authed;
    /// set at org setup and on every membership rotation.
    pub fn set_member_root(env: Env, org_id: u64, root: U256) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(Error::OrgNotFound)?;
        admin.require_auth();
        if !env.storage().persistent().has(&DataKey::Org(org_id)) {
            return Err(Error::OrgNotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::MemberRoot(org_id), &root);
        Ok(())
    }

    /// The org's M-of-N member-set root, for the pool to bind a spend-auth proof to.
    pub fn member_root(env: Env, org_id: u64) -> Result<U256, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::MemberRoot(org_id))
            .ok_or(Error::OrgNotFound)
    }

    /// Configure the Groth16 verifier used by `verify_org_proof`. Admin-only.
    pub fn set_verifier(env: Env, verifier: Address) -> Result<(), Error> {
        Self::admin(&env)?.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Verifier, &verifier);
        Ok(())
    }

    /// The configured verifier address (if any).
    pub fn verifier(env: Env) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Verifier)
            .ok_or(Error::VerifierNotConfigured)
    }

    /// Verify a STANDALONE org proof (ORGAUTH / Z-suite) with the prover-chosen
    /// `orgMemberRoot` and `threshold` public inputs PINNED to this org's
    /// REGISTERED policy.
    ///
    /// # The soundness gap this closes
    /// The bare `verifier.verify_proof(vk_id, …)` path accepts ANY internally
    /// consistent proof — including one a prover built over a SELF-MINTED member
    /// set with `threshold = 1`, which trivially yields `approved = true`. The
    /// `orgMemberRoot`/`threshold` public inputs were free, never tied to a real
    /// org. This function fixes that: it loads the registered `member_root` +
    /// `threshold` for `org_id` from THIS contract and asserts the proof's public
    /// inputs equal them BEFORE delegating to the verifier. A mismatch (a
    /// self-minted root, or a threshold lower than the org's registered bar) is
    /// rejected fail-closed.
    ///
    /// ORGAUTH public-input order is `[orgMemberRoot, threshold, spendMessage,
    /// authTag]`, so `orgMemberRoot` is index 0 and `threshold` is index 1 — the
    /// two policy fields pinned here. The remaining inputs (spendMessage, authTag)
    /// stay prover-supplied and are checked by the proof itself.
    ///
    /// No `require_auth`: like the proof-gated ASP admission, the proof IS the
    /// authorization, and soundness rests on the fail-closed checks below.
    pub fn verify_org_proof(
        env: Env,
        org_id: u64,
        vk_id: Symbol,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, Error> {
        let store = env.storage().persistent();
        let verifier: Address = store
            .get(&DataKey::Verifier)
            .ok_or(Error::VerifierNotConfigured)?;

        // Load the org's REGISTERED policy: the in-circuit member-set root and the
        // M-of-N threshold captured at registration.
        let registered_root: U256 = store
            .get(&DataKey::MemberRoot(org_id))
            .ok_or(Error::MemberRootNotSet)?;
        let org: OrgRecord = store.get(&DataKey::Org(org_id)).ok_or(Error::OrgNotFound)?;
        let registered_threshold: u32 = org.threshold;

        // Pin public input #0 (orgMemberRoot) to the registered root. Reuse the
        // canonical U256 -> Bn254Fr big-endian encoding so a self-minted member
        // set cannot pass.
        let mut rbuf = [0u8; 32];
        registered_root.to_be_bytes().copy_into_slice(&mut rbuf);
        let root_fr = Bn254Fr::from_bytes(BytesN::from_array(&env, &rbuf));
        let pi0 = public_inputs.get(0).ok_or(Error::PolicyMismatch)?;
        if pi0 != root_fr {
            return Err(Error::PolicyMismatch);
        }

        // Pin public input #1 (threshold) to the registered threshold — so a
        // prover cannot lower the M-of-N bar (e.g. claim threshold = 1).
        let mut tbuf = [0u8; 32];
        tbuf[28..32].copy_from_slice(&registered_threshold.to_be_bytes());
        let threshold_fr = Bn254Fr::from_bytes(BytesN::from_array(&env, &tbuf));
        let pi1 = public_inputs.get(1).ok_or(Error::PolicyMismatch)?;
        if pi1 != threshold_fr {
            return Err(Error::PolicyMismatch);
        }

        // Only now delegate to the verifier. Fail-closed: anything but
        // `Ok(Ok(true))` (a non-verifying proof or any invoke error) is rejected.
        let verified = matches!(
            VerifierClient::new(&env, &verifier).try_verify_proof(&vk_id, &proof, &public_inputs),
            Ok(Ok(true))
        );
        if !verified {
            return Err(Error::ProofRejected);
        }
        Ok(true)
    }

    /// Designate the on-chain KYB issuer — the key allowed to post KYB
    /// attestations. Admin-only. This is the integration seam: today it's our
    /// own key; a real KYB provider (Persona/Sumsub) would hold this key (or be
    /// re-pointed to one) and post decisions on-chain, with NO backend deciding.
    pub fn set_kyb_issuer(env: Env, issuer: Address) -> Result<(), Error> {
        Self::admin(&env)?.require_auth();
        env.storage().persistent().set(&DataKey::KybIssuer, &issuer);
        Ok(())
    }

    /// Post an on-chain KYB attestation for `org_id`. ONLY the designated KYB
    /// issuer may call this — the decision is signed by the issuer key and stored
    /// on-chain, not fabricated in a backend. `inquiry_ref` ties it to the
    /// provider's case file (like the ramp's per-tx ref).
    pub fn attest_kyb(
        env: Env,
        org_id: u64,
        status: KybStatus,
        inquiry_ref: U256,
    ) -> Result<(), Error> {
        let issuer: Address = env
            .storage()
            .persistent()
            .get(&DataKey::KybIssuer)
            .ok_or(Error::NoIssuer)?;
        issuer.require_auth();
        if !env.storage().persistent().has(&DataKey::Org(org_id)) {
            return Err(Error::OrgNotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Kyb(org_id), &(status, inquiry_ref));
        KybAttestedEvent {
            org_id,
            approved: status == KybStatus::Approved,
        }
        .publish(&env);
        Ok(())
    }

    /// The org's on-chain KYB status (+ inquiry ref). Defaults to Unverified.
    /// The console reads THIS, not a backend mock.
    pub fn kyb_status(env: Env, org_id: u64) -> (KybStatus, U256) {
        env.storage()
            .persistent()
            .get(&DataKey::Kyb(org_id))
            .unwrap_or((KybStatus::Unverified, U256::from_u32(&env, 0)))
    }

    /// Initiate a money-movement proposal. `proposer` must be a member and must
    /// authorize. The proposal captures the org threshold at this instant.
    pub fn propose(
        env: Env,
        org_id: u64,
        proposal_id: u64,
        proposal_hash: U256,
        proposer: Address,
    ) -> Result<(), Error> {
        proposer.require_auth();
        let org: OrgRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Org(org_id))
            .ok_or(Error::OrgNotFound)?;
        if !is_member(&org.members, &proposer) {
            return Err(Error::NotMember);
        }
        let key = DataKey::Proposal(org_id, proposal_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::ProposalExists);
        }
        let rec = ProposalRecord {
            proposer,
            proposal_hash,
            approvers: Vec::new(&env),
            threshold: org.threshold,
        };
        env.storage().persistent().set(&key, &rec);
        Ok(())
    }

    /// Approve a proposal. The approver must be a member, must NOT be the
    /// proposer (segregation of duties), and must not have approved already.
    /// Returns the new distinct-approval count.
    pub fn approve(
        env: Env,
        org_id: u64,
        proposal_id: u64,
        approver: Address,
    ) -> Result<u32, Error> {
        approver.require_auth();
        let org: OrgRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Org(org_id))
            .ok_or(Error::OrgNotFound)?;
        if !is_member(&org.members, &approver) {
            return Err(Error::NotMember);
        }
        let key = DataKey::Proposal(org_id, proposal_id);
        let mut rec: ProposalRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::ProposalNotFound)?;
        if rec.proposer == approver {
            return Err(Error::SelfApproval);
        }
        if is_member(&rec.approvers, &approver) {
            return Err(Error::DuplicateApproval);
        }
        rec.approvers.push_back(approver);
        let approvals = rec.approvers.len();
        env.storage().persistent().set(&key, &rec);
        let approved = approvals >= rec.threshold;
        ProposalApprovedEvent {
            org_id,
            proposal_id,
            approvals,
            approved,
        }
        .publish(&env);
        Ok(approvals)
    }

    /// True once the proposal has collected `threshold` distinct approvals.
    pub fn is_approved(env: Env, org_id: u64, proposal_id: u64) -> Result<bool, Error> {
        let rec: ProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(org_id, proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        Ok(rec.approvers.len() >= rec.threshold)
    }

    /// Distinct approvals collected so far.
    pub fn approval_count(env: Env, org_id: u64, proposal_id: u64) -> Result<u32, Error> {
        let rec: ProposalRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(org_id, proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        Ok(rec.approvers.len())
    }
}

#[cfg(test)]
mod test;
