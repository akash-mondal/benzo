import { afterEach, expect, test, vi } from "vitest";

const ENV_KEYS = ["VERCEL", "BENZO_TENANT_STORE_MEMORY", "BENZO_DATA_ENCRYPTION_SECRET"] as const;
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

test("hosted wallet UX state is encrypted and partitioned by auth key", async () => {
  process.env.VERCEL = "1";
  process.env.BENZO_TENANT_STORE_MEMORY = "1";
  process.env.BENZO_DATA_ENCRYPTION_SECRET = "tenant-store-test-secret";
  const { db, runWithWalletTenant } = await import("./store.js");

  await runWithWalletTenant("alice", { name: "Alice" }, async () => {
    db.profile.handle = "@alice";
    db.contacts.push({ handle: "@bob", name: "Bob" });
  });

  await runWithWalletTenant("bob", { name: "Bob" }, async () => {
    expect(db.profile.handle).toBe("@you");
    expect(db.contacts).toEqual([]);
    db.profile.handle = "@bob";
  });

  await runWithWalletTenant("alice", null, async () => {
    expect(db.profile.handle).toBe("@alice");
    expect(db.contacts).toHaveLength(1);
  });
});
