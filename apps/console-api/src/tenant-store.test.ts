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

test("hosted console starts empty and partitions org documents by auth key", async () => {
  process.env.VERCEL = "1";
  process.env.BENZO_TENANT_STORE_MEMORY = "1";
  process.env.BENZO_DATA_ENCRYPTION_SECRET = "tenant-store-test-secret";
  const { db, runWithConsoleTenant } = await import("./store.js");

  await runWithConsoleTenant("alice", { email: "alice@example.com", name: "Alice" }, async () => {
    expect(db.counterparties).toEqual([]);
    expect(db.invoices).toEqual([]);
    db.org.name = "Alice LLC";
    db.counterparties.push({
      id: "cp_alice",
      orgId: db.org.id,
      name: "Alice Contractor",
      type: "contractor",
      status: "pending_screening",
      externalAccounts: [],
      createdAt: new Date().toISOString(),
    });
  });

  await runWithConsoleTenant("bob", { email: "bob@example.com", name: "Bob" }, async () => {
    expect(db.org.name).toBe("New workspace");
    expect(db.counterparties).toEqual([]);
    expect(db.payments).toEqual([]);
  });

  await runWithConsoleTenant("alice", null, async () => {
    expect(db.org.name).toBe("Alice LLC");
    expect(db.counterparties.map((c) => c.id)).toEqual(["cp_alice"]);
  });
});
