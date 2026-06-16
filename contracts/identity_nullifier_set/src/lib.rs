#![no_std]

//! Benzo identity-nullifier set — sybil resistance (one human, one account).
//!
//! Sibling of the spend `nullifier_set`, but with the OPPOSITE retry semantics.
//! The spend set is idempotent (an honest relayer may resubmit the same spend).
//! Here a duplicate is an ATTACK: an identity nullifier
//! `idNullifier = Poseidon2(idSecret, APP_SCOPE)` is emitted once per KYC'd human
//! per scope by the `kyc_credential` circuit, so a second registration under the
//! same nullifier means someone is trying to farm multiple accounts from one
//! verified identity. `register` therefore REJECTS a repeat with
//! `AlreadyRegistered` rather than returning a benign `false`.
//!
//! The set stores no PII and no link to any account — only the opaque,
//! scope-bound nullifier — so it gives Sybil resistance without
//! de-anonymizing the holder. Entries are **persistent** (never temporary:
//! a TTL-reaped entry would silently re-enable account farming — CAP-0078).

use soroban_sdk::{
    Address, Env, U256, contract, contracterror, contractevent, contractimpl, contracttype,
};

soroban_sdk::contractmeta!(key = "binver", val = "0.1.0");
soroban_sdk::contractmeta!(key = "name", val = "benzo-identity-nullifier-set");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract is not initialized
    NotInitialized = 1,
    /// This identity nullifier is already registered (sybil attempt)
    AlreadyRegistered = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
enum DataKey {
    /// Administrator (may set the operator)
    Admin,
    /// Operator (the admission flow / pool) allowed to register nullifiers
    Operator,
    /// A registered identity nullifier (presence == used); persistent only
    Identity(U256),
}

/// Emitted when an identity nullifier is registered for the first time.
#[contractevent]
#[derive(Clone)]
pub struct IdentityRegisteredEvent {
    /// The identity nullifier value (scope-bound; no PII, no account link)
    #[topic]
    pub identity_nullifier: U256,
}

// CAP-0078 TTL maintenance: identity nullifiers are write-once / read-later
// (anti-sybil), so keep an actively-checked entry from being archived.
const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const TTL_EXTEND: u32 = 90 * DAY_IN_LEDGERS;

#[contract]
pub struct BenzoIdentityNullifierSet;

#[contractimpl]
impl BenzoIdentityNullifierSet {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    /// Set the operator (the admission flow / pool). Admin-only.
    pub fn set_operator(env: Env, operator: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Operator, &operator);
        Ok(())
    }

    /// True if the identity nullifier has already been registered.
    pub fn is_registered(env: Env, identity_nullifier: U256) -> bool {
        let key = DataKey::Identity(identity_nullifier);
        let used = env.storage().persistent().has(&key);
        if used {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
        }
        used
    }

    /// Register an identity nullifier. NOT idempotent: a repeat is rejected with
    /// `AlreadyRegistered` (the sybil guard). Operator-only.
    pub fn register(env: Env, identity_nullifier: U256) -> Result<(), Error> {
        let operator: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Operator)
            .ok_or(Error::NotInitialized)?;
        operator.require_auth();

        let key = DataKey::Identity(identity_nullifier.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyRegistered);
        }
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
        IdentityRegisteredEvent { identity_nullifier }.publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
