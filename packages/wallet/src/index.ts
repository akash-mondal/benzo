/**
 * @benzo/wallet — on-device key custody for a Benzo wallet.
 *
 * A `Keychain` seals the wallet's secrets (Stellar key, org spend identity, MVK
 * seed) into a `KVStore` (IndexedDB in the browser, in-memory in Node/tests),
 * unlocked by a passkey PRF or a passphrase. It hands out a `TxSignerPort` so
 * the user's own key signs writes — the client side of the non-custodial
 * signing split in @benzo/core.
 */
export * from "./kvstore.js";
export * from "./seal.js";
export * from "./wrapping-key.js";
export * from "./keychain.js";
