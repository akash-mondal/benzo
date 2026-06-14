/**
 * KVStore — the minimal durable key/value port the client persists wallet state
 * to (note-discovery snapshot, ASP allow-set, transaction journal). Structurally
 * compatible with `@benzo/platform`'s `KVStorage`, but declared here so core
 * never depends on the platform package (no dependency cycle).
 *
 * A surface supplies a backing store: the CLI a JSON file, the web IndexedDB.
 * When no store is configured the client falls back to a full re-scan each sync
 * (correct, just not incremental and not restart-durable).
 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** A trivial in-memory KVStore (tests / ephemeral sessions). */
export class MemoryStore implements KVStore {
  private readonly mem = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}
