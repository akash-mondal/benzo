#![no_std]

//! Benzo request registry — payment requests & invoices (the pull primitive).
//!
//! Benzo's send path is push-only. This contract is the optional on-chain status
//! anchor for a PAYMENT REQUEST / INVOICE: a "pay me X" intent that escrows no
//! funds, that a payer fulfills with an ordinary shielded transfer, and that the
//! requester tracks as Open -> PartiallyPaid -> Paid, or Open -> Expired /
//! Cancelled.
//!
//! Privacy by reuse: the request itself lives off-chain in a signed BenzoLink;
//! only a hiding `commitment` and the status live here. The fulfilling payment is
//! an ordinary private transfer, so the chain never links payer to request. A
//! paid transition is bound to a REAL on-chain spend — `mark_paid` checks the
//! payment's nullifier is present in the nullifier_set and records it once (no
//! double-count). v1 is requester-attested (payee `require_auth`); a later v2 can
//! swap that auth for a zero-knowledge request-match proof.

use soroban_sdk::{
    Address, Env, U256, contract, contractclient, contracterror, contractevent, contractimpl,
    contracttype,
};

soroban_sdk::contractmeta!(key = "binver", val = "0.1.0");
soroban_sdk::contractmeta!(key = "name", val = "benzo-request-registry");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract not initialized
    NotInitialized = 1,
    /// A request with this commitment already exists
    AlreadyExists = 2,
    /// No such request
    NotFound = 3,
    /// The request deadline has passed
    Expired = 4,
    /// expire() called before the deadline
    NotExpired = 5,
    /// Operation not valid for the current status
    WrongStatus = 6,
    /// This payment nullifier already marked a request
    NullifierAlreadyUsed = 7,
    /// The nullifier is not present in the nullifier set (no real payment)
    PaymentNotFound = 8,
    /// expiry is in the past
    BadExpiry = 9,
    /// negative or non-positive amount
    BadAmount = 10,
}

/// Request lifecycle. A request escrows no funds, so there is no Refunded state.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Open,
    PartiallyPaid,
    Paid,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestEntry {
    /// The requester (only they may cancel / attest payment in v1)
    pub payee: Address,
    /// Target amount in base units; 0 = hidden/variable (no fixed target)
    pub amount: i128,
    /// Minimum acceptable amount (0 = none)
    pub min_amount: i128,
    /// Sum of matched payments so far
    pub paid_total: i128,
    /// Deadline (unix seconds)
    pub expiry: u64,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    NullifierSet,
    /// commitment -> RequestEntry
    Request(U256),
    /// payment nullifier -> already counted (idempotency / anti double-count)
    NullUsed(U256),
}

/// Cross-contract view into the nullifier set — proves a payment really happened.
#[contractclient(name = "NullifierSetClient")]
pub trait NullifierSetInterface {
    fn is_spent(env: Env, nullifier: U256) -> bool;
}

/// Emitted when a request is opened.
#[contractevent]
#[derive(Clone)]
pub struct RequestCreatedEvent {
    #[topic]
    pub commitment: U256,
    pub payee: Address,
    pub expiry: u64,
}

/// Emitted on each matched payment.
#[contractevent]
#[derive(Clone)]
pub struct RequestPaidEvent {
    #[topic]
    pub commitment: U256,
    pub nullifier: U256,
    pub paid_total: i128,
    pub fully_paid: bool,
}

/// Emitted on expire/cancel (cancelled = true for cancel, false for expire).
#[contractevent]
#[derive(Clone)]
pub struct RequestClosedEvent {
    #[topic]
    pub commitment: U256,
    pub cancelled: bool,
}

fn bump(env: &Env, key: &DataKey) {
    soroban_utils::bump_persistent(env, key);
}

fn load(env: &Env, commitment: &U256) -> Result<RequestEntry, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Request(commitment.clone()))
        .ok_or(Error::NotFound)
}

#[contract]
pub struct BenzoRequestRegistry;

#[contractimpl]
impl BenzoRequestRegistry {
    pub fn __constructor(env: Env, admin: Address, nullifier_set: Address) {
        let s = env.storage().persistent();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::NullifierSet, &nullifier_set);
    }

    /// Open a request/invoice. Requester authorizes; no funds move. The
    /// `commitment` is a hiding Poseidon2 commitment to the off-chain request.
    pub fn register(
        env: Env,
        payee: Address,
        commitment: U256,
        amount: i128,
        min_amount: i128,
        expiry: u64,
    ) -> Result<(), Error> {
        payee.require_auth();
        if amount < 0 || min_amount < 0 {
            return Err(Error::BadAmount);
        }
        if expiry <= env.ledger().timestamp() {
            return Err(Error::BadExpiry);
        }
        let key = DataKey::Request(commitment.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }
        let entry = RequestEntry {
            payee: payee.clone(),
            amount,
            min_amount,
            paid_total: 0,
            expiry,
            status: Status::Open,
        };
        env.storage().persistent().set(&key, &entry);
        bump(&env, &key);
        RequestCreatedEvent {
            commitment,
            payee,
            expiry,
        }
        .publish(&env);
        Ok(())
    }

    /// Mark a request (partly) paid, bound to a real on-chain payment nullifier.
    /// v1: the payee attests (require_auth) AND the nullifier must exist in the
    /// nullifier set and not have been counted before.
    pub fn mark_paid(
        env: Env,
        commitment: U256,
        nullifier: U256,
        paid_amount: i128,
    ) -> Result<Status, Error> {
        if paid_amount <= 0 {
            return Err(Error::BadAmount);
        }
        let mut entry = load(&env, &commitment)?;
        entry.payee.require_auth();
        if entry.status != Status::Open && entry.status != Status::PartiallyPaid {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() > entry.expiry {
            return Err(Error::Expired);
        }
        let null_key = DataKey::NullUsed(nullifier.clone());
        if env.storage().persistent().has(&null_key) {
            return Err(Error::NullifierAlreadyUsed);
        }
        let ns: Address = env
            .storage()
            .persistent()
            .get(&DataKey::NullifierSet)
            .ok_or(Error::NotInitialized)?;
        if !NullifierSetClient::new(&env, &ns).is_spent(&nullifier) {
            return Err(Error::PaymentNotFound);
        }
        env.storage().persistent().set(&null_key, &true);
        bump(&env, &null_key);

        entry.paid_total = entry.paid_total.saturating_add(paid_amount);
        let fully = entry.amount > 0 && entry.paid_total >= entry.amount;
        entry.status = if fully {
            Status::Paid
        } else {
            Status::PartiallyPaid
        };
        let key = DataKey::Request(commitment.clone());
        env.storage().persistent().set(&key, &entry);
        bump(&env, &key);
        RequestPaidEvent {
            commitment,
            nullifier,
            paid_total: entry.paid_total,
            fully_paid: fully,
        }
        .publish(&env);
        Ok(entry.status)
    }

    /// Permissionless close after the deadline. No refund — nothing is escrowed.
    pub fn expire(env: Env, commitment: U256) -> Result<(), Error> {
        let mut entry = load(&env, &commitment)?;
        if entry.status != Status::Open && entry.status != Status::PartiallyPaid {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() <= entry.expiry {
            return Err(Error::NotExpired);
        }
        entry.status = Status::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::Request(commitment.clone()), &entry);
        RequestClosedEvent {
            commitment,
            cancelled: false,
        }
        .publish(&env);
        Ok(())
    }

    /// Requester-only cancel. The entry is retained (audit), not deleted.
    pub fn cancel(env: Env, commitment: U256) -> Result<(), Error> {
        let mut entry = load(&env, &commitment)?;
        entry.payee.require_auth();
        if entry.status != Status::Open && entry.status != Status::PartiallyPaid {
            return Err(Error::WrongStatus);
        }
        entry.status = Status::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Request(commitment.clone()), &entry);
        RequestClosedEvent {
            commitment,
            cancelled: true,
        }
        .publish(&env);
        Ok(())
    }

    /// Fetch a request entry.
    pub fn get(env: Env, commitment: U256) -> Option<RequestEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::Request(commitment))
    }
}

#[cfg(test)]
mod test;
