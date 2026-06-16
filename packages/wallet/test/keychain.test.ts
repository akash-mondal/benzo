/**
 * Keychain round-trip — seal → persist → unlock → signer, the on-device custody
 * loop. Exercises seal.ts + wrapping-key.ts + keychain.ts together with no
 * browser and no chain.
 */
import { describe, it, expect } from "vitest";
import { MemoryKVStore } from "../src/kvstore.js";
import { Keychain, type WalletSecrets } from "../src/keychain.js";
import {
  passphraseWrappingKey,
  prfWrappingKey,
  newSalt,
  passkeyWrappingKey,
} from "../src/wrapping-key.js";
import { sealSecret, openSecret } from "../src/seal.js";

// A fixed, valid testnet keypair (random secret + its derived address).
const STELLAR_SECRET = "SBGOETTTZEEO4GBHAXOMUTDHTQVBEZ6BM3KCWE73F7OCJTC7ZOLGNUNG";
const STELLAR_PUBLIC = "GA5CJLSEA6BKCHJ25B7FNXKDAC5YDQUTD3KTPL4OEPRQ6NOJGUT7GSD7";

const secrets: WalletSecrets = {
  stellarSecret: STELLAR_SECRET,
  orgSpendId: "123456789",
  mvkSeedHex: "ab".repeat(32),
};

describe("seal", () => {
  it("round-trips under the right key and rejects the wrong one", () => {
    const key = passphraseWrappingKey("hunter2", newSalt());
    const blob = sealSecret(Uint8Array.of(1, 2, 3, 4), key);
    expect(openSecret(blob, key)).toEqual(Uint8Array.of(1, 2, 3, 4));
    const other = passphraseWrappingKey("different", newSalt());
    expect(openSecret(blob, other)).toBeNull();
  });
});

describe("Keychain", () => {
  it("seals on create and recovers the same secrets on unlock", async () => {
    const kv = new MemoryKVStore();
    const salt = newSalt();
    const wk = passphraseWrappingKey("correct horse", salt);

    expect(await Keychain.exists(kv)).toBe(false);
    const made = await Keychain.create({ kv, wrappingKey: wk, secrets });
    expect(made.secrets).toEqual(secrets);
    expect(await Keychain.exists(kv)).toBe(true);

    // The persisted blob must be ciphertext, never the plaintext secret.
    const raw = await kv.get("benzo/keychain/v1");
    expect(new TextDecoder().decode(raw!)).not.toContain(STELLAR_SECRET);

    const opened = await Keychain.unlock({ kv, wrappingKey: passphraseWrappingKey("correct horse", salt) });
    expect(opened.secrets).toEqual(secrets);
  });

  it("rejects unlock with the wrong passphrase", async () => {
    const kv = new MemoryKVStore();
    const salt = newSalt();
    await Keychain.create({ kv, wrappingKey: passphraseWrappingKey("right", salt), secrets });
    await expect(
      Keychain.unlock({ kv, wrappingKey: passphraseWrappingKey("wrong", salt) }),
    ).rejects.toThrow(/wrong passkey or passphrase/);
  });

  it("hands out a signer for the stored Stellar key", async () => {
    const kv = new MemoryKVStore();
    const kc = await Keychain.create({
      kv,
      wrappingKey: prfWrappingKey(new Uint8Array(32).fill(7)),
      secrets,
    });
    const signer = kc.signer();
    expect(await signer.publicKey()).toBe(STELLAR_PUBLIC);
  });

  it("rewrap rotates the key: old fails, new opens", async () => {
    const kv = new MemoryKVStore();
    const oldWk = passphraseWrappingKey("old", newSalt());
    const newWk = prfWrappingKey(new Uint8Array(32).fill(9));
    const kc = await Keychain.create({ kv, wrappingKey: oldWk, secrets });
    await kc.rewrap(newWk);
    await expect(Keychain.unlock({ kv, wrappingKey: oldWk })).rejects.toThrow();
    const reopened = await Keychain.unlock({ kv, wrappingKey: newWk });
    expect(reopened.secrets.orgSpendId).toBe("123456789");
  });

  it("lock() drops secrets from memory; wipe() removes the blob", async () => {
    const kv = new MemoryKVStore();
    const wk = prfWrappingKey(new Uint8Array(32).fill(1));
    const kc = await Keychain.create({ kv, wrappingKey: wk, secrets });
    kc.lock();
    expect(() => kc.secrets).toThrow(/locked/);
    const re = await Keychain.unlock({ kv, wrappingKey: wk });
    await re.wipe();
    expect(await Keychain.exists(kv)).toBe(false);
  });

  it("refuses to clobber an existing keychain unless overwrite is set", async () => {
    const kv = new MemoryKVStore();
    const wk = prfWrappingKey(new Uint8Array(32).fill(2));
    await Keychain.create({ kv, wrappingKey: wk, secrets });
    await expect(Keychain.create({ kv, wrappingKey: wk, secrets })).rejects.toThrow(/already exists/);
    await expect(
      Keychain.create({ kv, wrappingKey: wk, secrets, overwrite: true }),
    ).resolves.toBeInstanceOf(Keychain);
  });

  it("passkeyWrappingKey routes the assertion's PRF output through prfWrappingKey", async () => {
    const salt = newSalt();
    let sawSalt: Uint8Array | undefined;
    const wk = await passkeyWrappingKey(salt, async (s) => {
      sawSalt = s;
      return new Uint8Array(32).fill(5);
    });
    expect(sawSalt).toEqual(salt);
    expect(wk).toEqual(prfWrappingKey(new Uint8Array(32).fill(5)));
  });
});
