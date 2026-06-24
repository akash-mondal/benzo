#![no_std]

//! Benzo private audit-root registry.
//!
//! Product facts stay encrypted off-chain. This contract stores only opaque
//! commitments to private audit packets: an org hash, Merkle root, event-log head,
//! packet hash, count, and monotonically increasing sequence. Auditors can verify
//! that a ciphertext packet existed at a ledger time and was not replaced without
//! learning invoice, payroll, counterparty, rate, handle, KYB, or approval facts.

use soroban_sdk::{
    Address, Bytes, BytesN, Env, contract, contracterror, contractevent, contractimpl, contracttype,
};

soroban_sdk::contractmeta!(key = "binver", val = "0.1.0");
soroban_sdk::contractmeta!(key = "name", val = "benzo-audit-root");

/// Ledgers/day at ~5s close. Keep anchors alive long enough for delayed audits.
const DAY_IN_LEDGERS: u32 = 17_280;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract has no admin.
    NotInitialized = 1,
    /// Event count must be non-zero for a committed audit packet.
    EmptyPacket = 2,
    /// Sequence must equal `next_sequence(org_hash)`.
    BadSequence = 3,
    /// This `(org_hash, sequence)` anchor already exists.
    AlreadyAnchored = 4,
    /// No such anchored sequence.
    NotFound = 5,
    /// Sequence overflow.
    Overflow = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditRoot {
    /// Hash of the org identifier/scope, never the plaintext org name.
    pub org_hash: BytesN<32>,
    /// Monotonic per-org root sequence.
    pub sequence: u64,
    /// Merkle root over encrypted event envelopes.
    pub merkle_root: BytesN<32>,
    /// Hash-chain head of encrypted event envelopes.
    pub head_hash: BytesN<32>,
    /// Hash of the full audit packet/export bytes.
    pub packet_hash: BytesN<32>,
    /// Number of events committed into this root.
    pub event_count: u32,
    /// Previous root's anchor hash for the same org, or zero hash for genesis.
    pub prev_anchor_hash: BytesN<32>,
    /// Hash of this record's canonical fields.
    pub anchor_hash: BytesN<32>,
    /// Ledger sequence at which this root was anchored.
    pub ledger: u32,
    /// Ledger timestamp at which this root was anchored.
    pub anchored_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Admin,
    NextSeq(BytesN<32>),
    Latest(BytesN<32>),
    Anchor(BytesN<32>, u64),
}

#[contractevent(topics = ["audit_root"])]
#[derive(Clone)]
pub struct AuditRootAnchoredEvent {
    #[topic]
    pub org_hash: BytesN<32>,
    pub sequence: u64,
    pub merkle_root: BytesN<32>,
    pub head_hash: BytesN<32>,
    pub packet_hash: BytesN<32>,
    pub event_count: u32,
    pub anchor_hash: BytesN<32>,
}

struct AnchorHashInput<'a> {
    org_hash: &'a BytesN<32>,
    sequence: u64,
    merkle_root: &'a BytesN<32>,
    head_hash: &'a BytesN<32>,
    packet_hash: &'a BytesN<32>,
    event_count: u32,
    prev_anchor_hash: &'a BytesN<32>,
}

#[contract]
pub struct BenzoAuditRoot;

#[contractimpl]
impl BenzoAuditRoot {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Update the admin. Current admin only.
    pub fn update_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        Self::admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// Anchor an encrypted private-event packet root.
    ///
    /// `org_hash` is domain-separated off-chain, e.g. sha256("benzo:org:" ||
    /// org_id). The chain never receives the plaintext org or private payload.
    pub fn anchor_root(
        env: Env,
        org_hash: BytesN<32>,
        sequence: u64,
        merkle_root: BytesN<32>,
        head_hash: BytesN<32>,
        packet_hash: BytesN<32>,
        event_count: u32,
    ) -> Result<AuditRoot, Error> {
        Self::admin(&env)?.require_auth();
        if event_count == 0 {
            return Err(Error::EmptyPacket);
        }

        let expected = Self::next_sequence(env.clone(), org_hash.clone());
        if sequence != expected {
            return Err(Error::BadSequence);
        }
        let key = DataKey::Anchor(org_hash.clone(), sequence);
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyAnchored);
        }

        let latest_key = DataKey::Latest(org_hash.clone());
        let prev_anchor_hash = env
            .storage()
            .persistent()
            .get::<DataKey, AuditRoot>(&latest_key)
            .map(|r| r.anchor_hash)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0; 32]));

        let anchor_hash = Self::hash_anchor(
            &env,
            AnchorHashInput {
                org_hash: &org_hash,
                sequence,
                merkle_root: &merkle_root,
                head_hash: &head_hash,
                packet_hash: &packet_hash,
                event_count,
                prev_anchor_hash: &prev_anchor_hash,
            },
        );
        let record = AuditRoot {
            org_hash: org_hash.clone(),
            sequence,
            merkle_root: merkle_root.clone(),
            head_hash: head_hash.clone(),
            packet_hash: packet_hash.clone(),
            event_count,
            prev_anchor_hash,
            anchor_hash: anchor_hash.clone(),
            ledger: env.ledger().sequence(),
            anchored_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().set(&latest_key, &record);
        env.storage().persistent().set(
            &DataKey::NextSeq(org_hash.clone()),
            &(sequence.checked_add(1).ok_or(Error::Overflow)?),
        );
        Self::bump_anchor(&env, &key);
        Self::bump_anchor(&env, &latest_key);

        AuditRootAnchoredEvent {
            org_hash,
            sequence,
            merkle_root,
            head_hash,
            packet_hash,
            event_count,
            anchor_hash,
        }
        .publish(&env);

        Ok(record)
    }

    /// Current expected sequence for the next root of `org_hash`.
    pub fn next_sequence(env: Env, org_hash: BytesN<32>) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextSeq(org_hash))
            .unwrap_or(0)
    }

    /// Latest root anchored for an org.
    pub fn latest(env: Env, org_hash: BytesN<32>) -> Result<AuditRoot, Error> {
        let key = DataKey::Latest(org_hash);
        let record = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        Self::bump_anchor(&env, &key);
        Ok(record)
    }

    /// Fetch one historical root by org + sequence.
    pub fn get(env: Env, org_hash: BytesN<32>, sequence: u64) -> Result<AuditRoot, Error> {
        let key = DataKey::Anchor(org_hash, sequence);
        let record = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;
        Self::bump_anchor(&env, &key);
        Ok(record)
    }

    /// Recompute the hash from a record's public fields.
    pub fn recompute_hash(env: Env, record: AuditRoot) -> BytesN<32> {
        Self::hash_anchor(
            &env,
            AnchorHashInput {
                org_hash: &record.org_hash,
                sequence: record.sequence,
                merkle_root: &record.merkle_root,
                head_hash: &record.head_hash,
                packet_hash: &record.packet_hash,
                event_count: record.event_count,
                prev_anchor_hash: &record.prev_anchor_hash,
            },
        )
    }

    fn admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn bump_anchor(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, 30 * DAY_IN_LEDGERS, 365 * DAY_IN_LEDGERS);
    }

    fn append_hash(_env: &Env, out: &mut Bytes, value: &BytesN<32>) {
        out.append(&Bytes::from(value.clone()));
    }

    fn hash_anchor(env: &Env, input: AnchorHashInput<'_>) -> BytesN<32> {
        let mut pre = Bytes::from_slice(env, b"BENZO_AUDIT_ROOT_V1");
        Self::append_hash(env, &mut pre, input.org_hash);
        pre.append(&Bytes::from_array(env, &input.sequence.to_be_bytes()));
        Self::append_hash(env, &mut pre, input.merkle_root);
        Self::append_hash(env, &mut pre, input.head_hash);
        Self::append_hash(env, &mut pre, input.packet_hash);
        pre.append(&Bytes::from_array(env, &input.event_count.to_be_bytes()));
        Self::append_hash(env, &mut pre, input.prev_anchor_hash);
        env.crypto().sha256(&pre).into()
    }
}

#[cfg(test)]
mod test;
