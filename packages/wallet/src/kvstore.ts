/**
 * `KVStore` — the tiny async key→bytes persistence seam the keychain writes its
 * sealed blob to. Abstracted so the same `Keychain` runs on the user's device
 * (IndexedDB) and headlessly in Node/tests (in-memory), and so a host app can
 * plug its own store (Capacitor, React Native, OPFS) without touching wallet
 * logic.
 */

export interface KVStore {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** In-memory store — Node, tests, and ephemeral sessions. Never persisted. */
export class MemoryKVStore implements KVStore {
  private readonly map = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> {
    const v = this.map.get(key);
    return v ? v.slice() : null;
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value.slice());
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/**
 * IndexedDB-backed store for the browser. A single object store of
 * `Uint8Array` values keyed by string. Kept dependency-free (raw IndexedDB) so
 * it adds nothing to the bundle. Construct with `await IndexedDbKVStore.open()`.
 */
export class IndexedDbKVStore implements KVStore {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly storeName: string,
  ) {}

  static async open(dbName = "benzo-wallet", storeName = "keychain"): Promise<IndexedDbKVStore> {
    const idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) throw new Error("IndexedDbKVStore: no IndexedDB in this environment (use MemoryKVStore)");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new IndexedDbKVStore(db, storeName);
  }

  private tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = this.db.transaction(this.storeName, mode);
      const req = run(t.objectStore(this.storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const v = await this.tx<unknown>("readonly", (s) => s.get(key));
    return v instanceof Uint8Array ? v : v == null ? null : new Uint8Array(v as ArrayBuffer);
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    await this.tx("readwrite", (s) => s.put(value, key));
  }
  async delete(key: string): Promise<void> {
    await this.tx("readwrite", (s) => s.delete(key));
  }
  async keys(): Promise<string[]> {
    const ks = await this.tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    return ks.map(String);
  }
}
