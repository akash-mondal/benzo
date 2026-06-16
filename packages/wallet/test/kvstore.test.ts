/**
 * MemoryKVStore contract test — get/set/delete/keys and value isolation (a
 * mutation of a returned buffer must not corrupt the stored copy). The
 * IndexedDbKVStore shares the interface but needs a browser; it's covered by the
 * keychain round-trip in the app, not here.
 */
import { describe, it, expect } from "vitest";
import { MemoryKVStore } from "../src/kvstore.js";

describe("MemoryKVStore", () => {
  it("round-trips, lists, and deletes keys", async () => {
    const kv = new MemoryKVStore();
    expect(await kv.get("a")).toBeNull();
    await kv.set("a", Uint8Array.of(1, 2, 3));
    await kv.set("b", Uint8Array.of(4));
    expect([...(await kv.keys())].sort()).toEqual(["a", "b"]);
    expect(await kv.get("a")).toEqual(Uint8Array.of(1, 2, 3));
    await kv.delete("a");
    expect(await kv.get("a")).toBeNull();
    expect(await kv.keys()).toEqual(["b"]);
  });

  it("isolates stored bytes from caller mutation", async () => {
    const kv = new MemoryKVStore();
    const v = Uint8Array.of(9, 9);
    await kv.set("k", v);
    v[0] = 0; // mutate the caller's copy after storing
    const got = await kv.get("k");
    expect(got).toEqual(Uint8Array.of(9, 9));
    got![1] = 0; // mutate the returned copy
    expect(await kv.get("k")).toEqual(Uint8Array.of(9, 9));
  });
});
