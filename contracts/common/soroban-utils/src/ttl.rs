//! Persistent-entry TTL maintenance (CAP-0078 state archival).
//!
//! Soroban persistent entries are archived once their TTL lapses; an archived
//! entry must be restored before it can be read again. For a shielded pool that
//! is a correctness/availability risk: an archived spent-nullifier could
//! re-enable a double-spend, and an archived VK or config entry would break
//! verification until restored. The official Stellar/OpenZeppelin guidance is to
//! proactively bump the TTL of long-lived state on the hot path.
//!
//! `bump_persistent` is threshold-gated: it only extends when the remaining TTL
//! has dropped below `PERSISTENT_TTL_THRESHOLD`, so calling it on every
//! read/write is cheap and is a no-op for freshly-written entries.

use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

/// Ledgers per day at the ~5s testnet/mainnet close time.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// Bump when an entry's remaining TTL falls below ~30 days.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// Bump long-lived entries back up to ~90 days of TTL.
pub const PERSISTENT_TTL_EXTEND: u32 = 90 * DAY_IN_LEDGERS;

/// Extend a persistent entry's TTL when it is within `PERSISTENT_TTL_THRESHOLD`
/// of expiry, keeping long-lived state (nullifiers, merkle frontier/roots,
/// config singletons, verification keys) from being archived. Safe and cheap to
/// call on every read or write of the key.
pub fn bump_persistent<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}
