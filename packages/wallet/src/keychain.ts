/**
 * `Keychain` — the on-device vault for a Benzo wallet's secrets, sealed at rest
 * in a `KVStore` and unlocked with a passkey or passphrase wrapping key.
 *
 * It holds the three secrets a wallet needs and nothing the chain can derive:
 *   - `stellarSecret` — the `S…` account key that *signs transactions* (the
 *     keychain hands out a `TxSignerPort` over it, closing the loop with the
 *     non-custodial signing split in @benzo/core).
 *   - `orgSpendId` — the in-circuit spend identity (`deriveSpendKeys` splits it
 *     into ak/nk); authorizes shielded spends.
 *   - `mvkSeedHex` — the master viewing-key seed for note discovery.
 *
 * The decrypted secrets live in memory only between `unlock()` and `lock()`.
 */
import { LocalKeypairSigner, type TxSignerPort } from "@benzo/core";
import { utf8ToBytes, bytesToUtf8 } from "@noble/hashes/utils";
import { sealSecret, openSecret } from "./seal.js";
import type { KVStore } from "./kvstore.js";

export interface WalletSecrets {
  /** `S…` Stellar account secret — signs on-chain transactions. */
  stellarSecret: string;
  /** In-circuit org spend identity, decimal field-element string. */
  orgSpendId: string;
  /** Hex master viewing-key seed (MVK secret material). */
  mvkSeedHex: string;
}

const DEFAULT_KEY = "benzo/keychain/v1";

function encode(s: WalletSecrets): Uint8Array {
  for (const f of ["stellarSecret", "orgSpendId", "mvkSeedHex"] as const) {
    if (!s[f]) throw new Error(`WalletSecrets missing "${f}"`);
  }
  return utf8ToBytes(JSON.stringify(s));
}

function decode(bytes: Uint8Array): WalletSecrets {
  return JSON.parse(bytesToUtf8(bytes)) as WalletSecrets;
}

export class Keychain {
  private current: WalletSecrets | null;

  private constructor(
    private readonly kv: KVStore,
    private readonly storeKey: string,
    secrets: WalletSecrets,
  ) {
    this.current = secrets;
  }

  /** Has a wallet ever been sealed into this store? */
  static async exists(kv: KVStore, storeKey = DEFAULT_KEY): Promise<boolean> {
    return (await kv.get(storeKey)) !== null;
  }

  /** Seal `secrets` under `wrappingKey`, persist, and return an unlocked vault. */
  static async create(opts: {
    kv: KVStore;
    wrappingKey: Uint8Array;
    secrets: WalletSecrets;
    storeKey?: string;
    overwrite?: boolean;
  }): Promise<Keychain> {
    const key = opts.storeKey ?? DEFAULT_KEY;
    if (!opts.overwrite && (await opts.kv.get(key)))
      throw new Error("keychain already exists (pass overwrite:true to replace)");
    await opts.kv.set(key, sealSecret(encode(opts.secrets), opts.wrappingKey));
    return new Keychain(opts.kv, key, opts.secrets);
  }

  /** Read the sealed blob and open it; throws on missing blob or wrong key. */
  static async unlock(opts: {
    kv: KVStore;
    wrappingKey: Uint8Array;
    storeKey?: string;
  }): Promise<Keychain> {
    const key = opts.storeKey ?? DEFAULT_KEY;
    const blob = await opts.kv.get(key);
    if (!blob) throw new Error("no keychain in this store");
    const plain = openSecret(blob, opts.wrappingKey);
    if (!plain) throw new Error("unlock failed: wrong passkey or passphrase");
    return new Keychain(opts.kv, key, decode(plain));
  }

  private require(): WalletSecrets {
    if (!this.current) throw new Error("keychain is locked");
    return this.current;
  }

  /** The decrypted secrets (throws if locked). */
  get secrets(): WalletSecrets {
    return { ...this.require() };
  }

  /** A `TxSignerPort` over the stored Stellar key — drop into `StellarRpcClient`. */
  signer(): TxSignerPort {
    return new LocalKeypairSigner(this.require().stellarSecret);
  }

  /** Re-seal the stored secrets under a new wrapping key (rotate passphrase/passkey). */
  async rewrap(newWrappingKey: Uint8Array): Promise<void> {
    await this.kv.set(this.storeKey, sealSecret(encode(this.require()), newWrappingKey));
  }

  /** Drop the decrypted secrets from memory; the sealed blob stays on disk. */
  lock(): void {
    this.current = null;
  }

  /** Permanently remove the sealed blob from the store. */
  async wipe(): Promise<void> {
    await this.kv.delete(this.storeKey);
    this.current = null;
  }
}
