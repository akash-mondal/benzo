import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const originalEnv = new Map<string, string | undefined>();
for (const k of [
  "VERCEL",
  "BENZO_HOSTED_RUNTIME",
  "BENZO_ACCOUNT_SALT",
  "BENZO_TEST_AUTH_SECRET",
  "BENZO_TENANT_STORE_MEMORY",
  "BENZO_DATA_ENCRYPTION_SECRET",
  "BENZO_DISABLE_TENANT_LEGACY_DECRYPT",
] as const) originalEnv.set(k, process.env[k]);

let privateBalance = "0";
let publicBalanceStroops = "0";
let pendingInvites: Array<{ status: string }> = [];

beforeEach(() => {
  vi.resetModules();
  privateBalance = "0";
  publicBalanceStroops = "0";
  pendingInvites = [];
  process.env.VERCEL = "1";
  process.env.BENZO_ACCOUNT_SALT = "wallet-delete-test-salt";
  process.env.BENZO_TEST_AUTH_SECRET = "wallet-delete-test-secret";
  process.env.BENZO_TENANT_STORE_MEMORY = "1";
  process.env.BENZO_DATA_ENCRYPTION_SECRET = "tenant-store-delete-test-secret";
  process.env.BENZO_DISABLE_TENANT_LEGACY_DECRYPT = "1";
  const documents = new Map<string, unknown>();
  vi.doMock("./tenantData.js", () => ({
    loadTenantDocument: vi.fn(async (app: string, tenantKey: string) => documents.get(`${app}:${tenantKey}`) ?? null),
    saveTenantDocument: vi.fn(async (app: string, tenantKey: string, value: unknown) => {
      documents.set(`${app}:${tenantKey}`, structuredClone(value));
    }),
    deleteTenantDocument: vi.fn(async (app: string, tenantKey: string) => {
      documents.delete(`${app}:${tenantKey}`);
    }),
    tenantStorageMissing: vi.fn(() => []),
    takeTenantRateLimit: vi.fn(async () => ({ ok: true })),
  }));
  vi.doMock("./chain.js", () => {
    class RampError extends Error {
      constructor(public code: string, message: string) {
        super(message);
      }
    }
    return {
      addMoney: vi.fn(),
      cashOut: vi.fn(),
      claimHandle: vi.fn(),
      claimInvite: vi.fn(),
      createInvite: vi.fn(),
      createRequest: vi.fn(),
      listInvites: vi.fn(() => pendingInvites),
      refundInvite: vi.fn(),
      getActivity: vi.fn(() => []),
      getBalanceStroops: vi.fn(async () => ({ stroops: privateBalance, live: true })),
      getRampReserve: vi.fn(async () => ({ reserve: "0", live: true })),
      getDepositInfo: vi.fn(async () => ({ address: "G".padEnd(56, "A"), liquid: publicBalanceStroops, asset: "USDC", issuer: "G".padEnd(56, "B"), live: true })),
      importDeposit: vi.fn(),
      publicBalance: vi.fn(async () => ({ stroops: publicBalanceStroops, address: "G".padEnd(56, "A"), asset: "USDC", issuer: "G".padEnd(56, "B"), live: true })),
      makePublic: vi.fn(),
      getKycTier: vi.fn(() => 1),
      handleAvailable: vi.fn(async () => true),
      isLive: vi.fn(() => true),
      liveStatus: vi.fn(() => ({ live: true, mode: "live", missing: [] })),
      proverInfo: vi.fn(() => ({ available: ["tee"], tee: { endpoint: "https://tee.example", measurement: "test" } })),
      send: vi.fn(),
      classifyRecipient: vi.fn(() => "handle"),
      shareProof: vi.fn(),
      walletVerifierId: vi.fn(() => "wallet-verifier"),
      exportAccountForDevice: vi.fn(() => null),
      relaySubmit: vi.fn(),
      sendPublic: vi.fn(async (_to: string, amount: string) => {
        const requested = BigInt(Math.max(0, Math.round(Number(amount) * 1e7)));
        if (requested <= 0n) throw new RampError("amount", "Enter an amount.");
        if (requested > BigInt(publicBalanceStroops)) throw new RampError("insufficient_public_balance", "Not enough Public balance.");
        publicBalanceStroops = (BigInt(publicBalanceStroops) - requested).toString();
        return { txHash: "tx_send_public", onChain: true, amount: requested.toString() };
      }),
      RampError,
    };
  });
});

afterEach(() => {
  for (const [k, v] of originalEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

async function importServer() {
  return await import("./server.js");
}

async function request(
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const req = Readable.from(init.body ? [Buffer.from(init.body)] : []) as IncomingMessage;
  req.method = init.method ?? "GET";
  req.url = path;
  req.headers = init.headers ?? {};

  let status = 200;
  let text = "";
  const headers: Record<string, string | number | readonly string[]> = {};
  const setHeader = (name: string, value: string | number | readonly string[]) => {
    headers[name.toLowerCase()] = Array.isArray(value) ? [...value] : value;
  };
  const res = {
    setHeader(name: string, value: string | number | readonly string[]) {
      setHeader(name, value);
      return this;
    },
    writeHead(code: number, nextHeaders?: Record<string, string | number | readonly string[]>) {
      status = code;
      for (const [name, value] of Object.entries(nextHeaders ?? {})) setHeader(name, value);
      return this;
    },
    write(chunk: string | Buffer) {
      text += chunk.toString();
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) text += chunk.toString();
      return this;
    },
  } as unknown as ServerResponse;

  await handle(req, res);
  return {
    status,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

async function authHeaders(handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>, subject = "delete-user") {
  const minted = await request(handle, "/api/auth/test", {
    method: "POST",
    headers: { "content-type": "application/json", "x-benzo-test-secret": "wallet-delete-test-secret" },
    body: JSON.stringify({ subject, email: `${subject}@benzo.local`, ttlSeconds: 900 }),
  });
  expect(minted.status).toBe(200);
  const body = await minted.json() as { token: string };
  return {
    authorization: `Bearer ${body.token}`,
    "content-type": "application/json",
    "idempotency-key": `test-${subject}-${Date.now()}-${Math.random()}`,
  };
}

function authOnlyRequest(headers: Record<string, string>): IncomingMessage {
  return {
    headers,
  } as IncomingMessage;
}

test("hosted wallet account deletion refuses private, public, and invite balances", async () => {
  const { default: handle } = await importServer();
  const headers = await authHeaders(handle);

  privateBalance = "1000000";
  publicBalanceStroops = "2000000";
  pendingInvites = [{ status: "pending" }];

  const res = await request(handle, "/api/account", { method: "DELETE", headers, body: "{}" });

  expect(res.status).toBe(409);
  await expect(res.json()).resolves.toMatchObject({
    error: "Move or refund all funds before deleting this Benzo account.",
    blockers: ["private_balance", "public_balance", "pending_invites"],
    balances: { private: "1000000", public: "2000000" },
  });
});

test("hosted wallet account deletion clears profile state only after wallet is empty", async () => {
  const { default: handle } = await importServer();
  const headers = await authHeaders(handle, "delete-empty");

  const before = await request(handle, "/api/session", { headers });
  expect(before.status).toBe(200);
  const beforeBody = await before.json() as { profile: { handle: string } };
  expect(beforeBody.profile.handle).toBe("@you");

  const deleted = await request(handle, "/api/account", { method: "DELETE", headers, body: "{}" });
  expect(deleted.status).toBe(200);
  await expect(deleted.json()).resolves.toMatchObject({ deleted: true });

  const nextHeaders = await authHeaders(handle, "delete-empty");
  const after = await request(handle, "/api/session", { headers: nextHeaders });
  expect(after.status).toBe(200);
  const afterBody = await after.json() as { profile: { handle: string } };
  expect(afterBody.profile.handle).toBe("@you");
  const contacts = await request(handle, "/api/contacts", { headers: nextHeaders });
  const history = await request(handle, "/api/history", { headers: nextHeaders });
  await expect(contacts.json()).resolves.toEqual([]);
  await expect(history.json()).resolves.toEqual([]);
});

test("hosted wallet can move public funds out before account deletion", async () => {
  const { default: handle } = await importServer();
  const headers = await authHeaders(handle, "delete-after-public-send");

  publicBalanceStroops = "2000000";
  const blocked = await request(handle, "/api/account", { method: "DELETE", headers, body: "{}" });
  expect(blocked.status).toBe(409);
  await expect(blocked.json()).resolves.toMatchObject({ blockers: ["public_balance"] });

  const sent = await request(handle, "/api/send-public", {
    method: "POST",
    headers: {
      ...headers,
      "idempotency-key": `move-out-${Date.now()}-${Math.random()}`,
    },
    body: JSON.stringify({ to: "G".padEnd(56, "C"), amount: "0.2" }),
  });
  expect(sent.status).toBe(200);
  await expect(sent.json()).resolves.toMatchObject({ txHash: "tx_send_public", onChain: true, amount: "2000000" });

  const deleted = await request(handle, "/api/account", {
    method: "DELETE",
    headers: {
      ...headers,
      "idempotency-key": `delete-after-move-out-${Date.now()}-${Math.random()}`,
    },
    body: "{}",
  });
  expect(deleted.status).toBe(200);
  await expect(deleted.json()).resolves.toMatchObject({ deleted: true });
});

test("hosted wallet account deletion rotates the derived wallet account", async () => {
  const { default: handle } = await importServer();
  const { accountFingerprint, authFromRequest } = await import("./auth.js");
  const firstHeaders = await authHeaders(handle, "delete-rotates-account");

  const created = await request(handle, "/api/session", { headers: firstHeaders });
  expect(created.status).toBe(200);
  const beforeAuth = await authFromRequest(authOnlyRequest(firstHeaders));
  expect(beforeAuth).not.toBeNull();
  const beforeFingerprint = accountFingerprint(beforeAuth!.account);

  const deleted = await request(handle, "/api/account", { method: "DELETE", headers: firstHeaders, body: "{}" });
  expect(deleted.status).toBe(200);

  const nextHeaders = await authHeaders(handle, "delete-rotates-account");
  const afterAuth = await authFromRequest(authOnlyRequest(nextHeaders));
  expect(afterAuth).not.toBeNull();
  const afterFingerprint = accountFingerprint(afterAuth!.account);

  expect(afterFingerprint).not.toBe(beforeFingerprint);
});
