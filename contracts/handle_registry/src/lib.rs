#![no_std]

//! Benzo handle registry — `@handle` → shielded payment address.
//!
//! A username directory for send-by-handle. Maps a human handle to a
//! recipient's PUBLIC payment material: the BN254 spend public key (commitment
//! recipient), the X25519 note-discovery public key (so a sender can seal the
//! discovery ciphertext), and the recipient's MVK scalar. None of this carries
//! spend authority — a handle is a shareable address, not a key.
//!
//! Registration is owner-authorized and first-come (a handle can be updated
//! only by its registering owner), so the registry can't be silently hijacked.

use soroban_sdk::{
    Address, BytesN, Env, String, contract, contracterror, contractevent, contractimpl,
    contracttype,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Handle is registered to a different owner
    HandleTaken = 1,
    /// No such handle
    NotFound = 2,
}

/// Public payment record a handle resolves to (no spend authority).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HandleRecord {
    /// Registering owner (may update the record)
    pub owner: Address,
    /// BN254 spend public key (big-endian field element)
    pub spend_pub: BytesN<32>,
    /// X25519 note-discovery public key
    pub view_pub: BytesN<32>,
    /// MVK scalar (big-endian field element)
    pub mvk_scalar: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Handle(String),
}

#[contractevent]
#[derive(Clone)]
pub struct HandleRegisteredEvent {
    #[topic]
    pub owner: Address,
    pub handle: String,
}

#[contract]
pub struct BenzoHandleRegistry;

#[contractimpl]
impl BenzoHandleRegistry {
    /// Register or update a handle. First registration claims it; updates
    /// require the original owner's authorization.
    pub fn register(
        env: Env,
        handle: String,
        owner: Address,
        spend_pub: BytesN<32>,
        view_pub: BytesN<32>,
        mvk_scalar: BytesN<32>,
    ) -> Result<(), Error> {
        owner.require_auth();
        let key = DataKey::Handle(handle.clone());
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, HandleRecord>(&key)
            && existing.owner != owner
        {
            return Err(Error::HandleTaken);
        }
        env.storage().persistent().set(
            &key,
            &HandleRecord {
                owner: owner.clone(),
                spend_pub,
                view_pub,
                mvk_scalar,
            },
        );
        HandleRegisteredEvent { owner, handle }.publish(&env);
        Ok(())
    }

    /// Resolve a handle to its public payment record.
    pub fn resolve(env: Env, handle: String) -> Result<HandleRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Handle(handle))
            .ok_or(Error::NotFound)
    }

    /// True if a handle is registered.
    pub fn is_registered(env: Env, handle: String) -> bool {
        env.storage().persistent().has(&DataKey::Handle(handle))
    }
}

#[cfg(test)]
mod test;
