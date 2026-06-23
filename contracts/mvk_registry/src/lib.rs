#![no_std]

//! Benzo authorized-MVK registry.
//!
//! An append-only, root-history Merkle accumulator of the **master viewing keys
//! (MVKs) authorized to receive shielded notes**. Each money path
//! (shield/transfer/unshield) proves, in-circuit, that the MVK it tags a note
//! with is a member of this registry under a recent root (`registeredMvkRoot`,
//! the circuit's `BenzoMvkRegistryLeaf` + Merkle membership). That turns "every
//! note is bound to a REAL registered viewing key" from a comment into an
//! enforced invariant — closing the audit P0 where a prover could bind a note
//! to a junk/unregistered key and defeat compliance/recovery.
//!
//! Leaf = `Poseidon2(mvk_pub, key_meta, domain = 0x08)`, byte-identical to the
//! circuit's `BenzoMvkRegistryLeaf` and the SDK's `mvkRegistryLeaf`. The tree is
//! a twin of `benzo-merkle` (Poseidon2 compression, frontier + 128-root ring),
//! so the pool's `MerkleClient.is_known_root` works against it unchanged.
//!
//! Registration is admin-gated (the operator vets an MVK off-chain — KYC of the
//! key holder, org onboarding — before authorizing it). Append-only by design:
//! "revocation" is key rotation under a new `key_meta` epoch, not leaf removal
//! (an incremental Merkle tree cannot delete), mirroring the ASP allow-set.

use soroban_sdk::{
    Address, Env, U256, Vec, contract, contracterror, contractevent, contractimpl, contracttype,
};
use soroban_utils::{get_zeroes, poseidon2_compress, poseidon2_hash2};

soroban_sdk::contractmeta!(key = "binver", val = "0.1.0");
soroban_sdk::contractmeta!(key = "name", val = "benzo-mvk-registry");

/// Number of recent roots accepted (canonical ROOT_HISTORY = 128) — a proof
/// built against a slightly stale registry root still verifies.
pub const ROOT_HISTORY_SIZE: u32 = 128;

/// Domain separation for the registry leaf — MUST equal the circuit's
/// `MVK_REGISTRY_LEAF_DOMAIN()` and the SDK's `MVK_REGISTRY_LEAF_DOMAIN` (0x08).
pub const MVK_LEAF_DOMAIN: u32 = 0x08;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Caller is not authorized to perform this operation
    NotAuthorized = 1,
    /// Registry has reached maximum capacity
    RegistryFull = 2,
    /// Invalid tree levels configuration (must be 1..=32)
    WrongLevels = 3,
    /// Contract is not initialized
    NotInitialized = 4,
    /// Arithmetic overflow occurred
    Overflow = 5,
    /// This MVK public key is already registered
    DuplicateMvk = 6,
    /// `mvk_pub` is zero — the circuit forbids the zero key (an unbound note)
    ZeroMvk = 7,
}

/// Storage keys for the registry state (all persistent).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    /// Administrator (vets + authorizes MVKs)
    Admin,
    /// Number of levels in the Merkle tree
    Levels,
    /// Current position in the root history ring buffer
    CurrentRootIndex,
    /// Next available leaf index
    NextIndex,
    /// Right-frontier subtree hash at each level
    FilledSubtree(u32),
    /// Cached zero hash at each level
    Zeroes(u32),
    /// Historical roots ring buffer (slot -> root)
    Root(u32),
    /// Membership index for the ring buffer (root -> present): O(1) is_known_root
    KnownRoot(U256),
    /// Presence index for registered MVK pubkeys (mvk_pub -> present): rejects a
    /// double-registration before it takes a second leaf slot.
    MvkSeen(U256),
}

/// Emitted on every registration so indexers can mirror the registry. The
/// event NAME is the single topic ("MvkRegistered"); `mvk_pub`/`leaf`/`index`/
/// `root` ride in the data map so a replay can reconstruct the ordered leaf set
/// (mirrors `asp_membership`'s `LeafAdded`).
#[contractevent(topics = ["MvkRegistered"])]
#[derive(Clone)]
pub struct MvkRegisteredEvent {
    /// The registered MVK public key (scalar)
    pub mvk_pub: U256,
    /// The leaf inserted (Poseidon2(mvk_pub, key_meta, 0x08))
    pub leaf: U256,
    /// Index position in the tree
    pub index: u32,
    /// New registry root after insertion
    pub root: U256,
}

#[contract]
pub struct BenzoMvkRegistry;

#[contractimpl]
impl BenzoMvkRegistry {
    /// Initialize the registry.
    ///
    /// * `admin` — authorizes MVKs (after off-chain vetting).
    /// * `levels` — tree depth (1..=32; Benzo canonical default is 32).
    pub fn __constructor(env: Env, admin: Address, levels: u32) -> Result<(), Error> {
        if levels == 0 || levels > 32 {
            return Err(Error::WrongLevels);
        }
        let storage = env.storage().persistent();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Levels, &levels);

        let zeros: Vec<U256> = get_zeroes(&env);
        for i in 0..=levels {
            let z: U256 = zeros.get(i).ok_or(Error::WrongLevels)?;
            storage.set(&DataKey::FilledSubtree(i), &z);
            storage.set(&DataKey::Zeroes(i), &z);
        }
        let root_0: U256 = zeros.get(levels).ok_or(Error::WrongLevels)?;
        storage.set(&DataKey::Root(0), &root_0);
        storage.set(&DataKey::KnownRoot(root_0), &true);
        storage.set(&DataKey::CurrentRootIndex, &0u32);
        storage.set(&DataKey::NextIndex, &0u32);
        Ok(())
    }

    /// Update the administrator. Current-admin-only.
    pub fn update_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// The registry leaf for an `(mvk_pub, key_meta)` pair — the exact value the
    /// circuit and SDK compute. Exposed so a client can predict the leaf without
    /// reimplementing the domain rule.
    pub fn leaf_of(env: Env, mvk_pub: U256, key_meta: U256) -> U256 {
        poseidon2_hash2(
            &env,
            mvk_pub,
            key_meta,
            Some(U256::from_u32(&env, MVK_LEAF_DOMAIN)),
        )
    }

    /// Authorize an MVK: compute its leaf and append it. Admin-only.
    ///
    /// `mvk_pub` must be non-zero (the circuit forbids the zero key) and not
    /// already registered. `key_meta` packs org/scope/expiry/epoch into a single
    /// field for the MVP. Returns the new leaf index.
    pub fn register_mvk(env: Env, mvk_pub: U256, key_meta: U256) -> Result<u32, Error> {
        let storage = env.storage().persistent();
        let admin: Address = storage.get(&DataKey::Admin).ok_or(Error::NotInitialized)?;
        admin.require_auth();

        if mvk_pub == U256::from_u32(&env, 0) {
            return Err(Error::ZeroMvk);
        }
        if storage.has(&DataKey::MvkSeen(mvk_pub.clone())) {
            return Err(Error::DuplicateMvk);
        }

        let levels: u32 = storage.get(&DataKey::Levels).ok_or(Error::NotInitialized)?;
        let next_index: u32 = storage
            .get(&DataKey::NextIndex)
            .ok_or(Error::NotInitialized)?;
        let max_leaves = 1u64.checked_shl(levels).ok_or(Error::WrongLevels)?;
        if u64::from(next_index) >= max_leaves {
            return Err(Error::RegistryFull);
        }

        let leaf = Self::leaf_of(env.clone(), mvk_pub.clone(), key_meta);

        // Classic incremental-tree update along the path to the root.
        let mut current_hash = leaf.clone();
        let mut current_index = next_index;
        for lvl in 0..levels {
            if current_index & 1 == 0 {
                storage.set(&DataKey::FilledSubtree(lvl), &current_hash);
                let zero: U256 = storage
                    .get(&DataKey::Zeroes(lvl))
                    .ok_or(Error::NotInitialized)?;
                current_hash = poseidon2_compress(&env, current_hash, zero);
            } else {
                let left: U256 = storage
                    .get(&DataKey::FilledSubtree(lvl))
                    .ok_or(Error::NotInitialized)?;
                current_hash = poseidon2_compress(&env, left, current_hash);
            }
            current_index >>= 1;
        }

        let root_index: u32 = storage
            .get(&DataKey::CurrentRootIndex)
            .ok_or(Error::NotInitialized)?;
        let new_root_index = root_index.checked_add(1).ok_or(Error::Overflow)? % ROOT_HISTORY_SIZE;
        if let Some(evicted) = storage.get::<DataKey, U256>(&DataKey::Root(new_root_index)) {
            storage.remove(&DataKey::KnownRoot(evicted));
        }
        storage.set(&DataKey::Root(new_root_index), &current_hash);
        storage.set(&DataKey::KnownRoot(current_hash.clone()), &true);
        storage.set(&DataKey::MvkSeen(mvk_pub.clone()), &true);
        storage.set(&DataKey::CurrentRootIndex, &new_root_index);
        storage.set(
            &DataKey::NextIndex,
            &(next_index.checked_add(1).ok_or(Error::Overflow)?),
        );

        MvkRegisteredEvent {
            mvk_pub,
            leaf,
            index: next_index,
            root: current_hash.clone(),
        }
        .publish(&env);
        Ok(next_index)
    }

    /// Current (most recent) registry root.
    pub fn current_root(env: Env) -> Result<U256, Error> {
        let storage = env.storage().persistent();
        let idx: u32 = storage
            .get(&DataKey::CurrentRootIndex)
            .ok_or(Error::NotInitialized)?;
        let root = storage
            .get(&DataKey::Root(idx))
            .ok_or(Error::NotInitialized)?;
        soroban_utils::bump_persistent(&env, &DataKey::Root(idx));
        Ok(root)
    }

    /// True if `root` is in the recent-root ring buffer (zero is never valid).
    /// O(1): a single presence probe — this is what the pool calls per money op.
    pub fn is_known_root(env: Env, root: U256) -> Result<bool, Error> {
        if root == U256::from_u32(&env, 0) {
            return Ok(false);
        }
        let key = DataKey::KnownRoot(root);
        let known = env.storage().persistent().has(&key);
        if known {
            soroban_utils::bump_persistent(&env, &key);
        }
        Ok(known)
    }

    /// Is this MVK public key already registered?
    pub fn is_registered(env: Env, mvk_pub: U256) -> bool {
        env.storage().persistent().has(&DataKey::MvkSeen(mvk_pub))
    }

    /// Next available leaf index (== number of MVKs registered so far).
    pub fn next_index(env: Env) -> Result<u32, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::NextIndex)
            .ok_or(Error::NotInitialized)
    }

    /// Tree depth.
    pub fn levels(env: Env) -> Result<u32, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Levels)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
