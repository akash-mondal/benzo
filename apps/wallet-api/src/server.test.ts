import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { accountFromSignedMessage, signWithStellarSecret } from "@benzo/core";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeAll, expect, test } from "vitest";

let handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let proverOf: (url: URL, body?: { prover?: string }) => string;

beforeAll(async () => {
  process.env.VERCEL = "1";
  process.env.BENZO_DEV_EXPORT = "1";
  process.env.BENZO_ACCOUNT_SALT = "wallet-server-test-salt";
  process.env.BENZO_DATA_ENCRYPTION_SECRET = "wallet-server-test-data-secret";
  process.env.BENZO_TEST_AUTH_SECRET = "wallet-server-test-secret";
  ({ handle, proverOf } = await import("./server.js"));
});

async function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
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

test("reports unavailable live status when chain env is absent", async () => {
  const res = await request("/api/live");
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ live: false, mode: "unavailable" });
});

test("reports local prover as live when hosted app env is complete", async () => {
  const prev = new Map(
    [
      "SOROBAN_RPC_URL",
      "GOOGLE_CLIENT_ID",
      "RELAYER_SECRET",
      "BENZO_OPERATOR_ADMIN_SECRET",
      "DATABASE_URL",
      "BENZO_DATA_ENCRYPTION_SECRET",
    ].map((key) => [key, process.env[key]]),
  );
  process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.RELAYER_SECRET = Keypair.random().secret();
  process.env.BENZO_OPERATOR_ADMIN_SECRET = Keypair.random().secret();
  process.env.DATABASE_URL = "postgres://user:pass@example.neon.tech/neondb";
  process.env.BENZO_DATA_ENCRYPTION_SECRET = "wallet-server-test-data-secret";

  try {
    const res = await request("/api/prover");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: ["local"], mode: "local", location: "local", live: true });
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("allows browser idempotency headers", async () => {
  const res = await request("/api/add-money", { method: "OPTIONS" });
  expect(res.status).toBe(204);
  expect(String(res.headers["access-control-allow-headers"])).toContain("idempotency-key");
});

test("fails closed for nested hosted wallet endpoints when user is not signed in", async () => {
  const res = await request(`/api/rpc?path=${encodeURIComponent("/handle/available?h=ab")}`);
  expect(res.status).toBe(401);
  await expect(res.json()).resolves.toMatchObject({
    live: false,
    mode: "unavailable",
    error: "Sign in with Google to unlock this wallet.",
  });
});

test("fails closed before hosted wallet account export can expose anything", async () => {
  const res = await request("/api/dev/account");
  expect(res.status).toBe(401);
  await expect(res.json()).resolves.toMatchObject({
    live: false,
    mode: "unavailable",
    error: "Sign in with Google to unlock this wallet.",
  });
});

test("mints secret-gated wallet test auth for backend smoke tests", async () => {
  const minted = await request("/api/auth/test", {
    method: "POST",
    headers: { "content-type": "application/json", "x-benzo-test-secret": "wallet-server-test-secret" },
    body: JSON.stringify({ subject: "smoke-wallet", email: "smoke-wallet@benzo.local" }),
  });
  expect(minted.status).toBe(200);
  const body = await minted.json() as { token: string };
  expect(body.token).toMatch(/^benzo-test-v1\./);

  const protectedRes = await request(`/api/rpc?path=${encodeURIComponent("/session")}`, {
    headers: { authorization: `Bearer ${body.token}` },
  });
  expect(protectedRes.status).not.toBe(401);
});

function deviceAuthPayload(origin = "https://wallet.benzo.space") {
  const account = accountFromSignedMessage(new Uint8Array(64).fill(13));
  const message = [
    "BENZO-DEVICE-AUTH-v1",
    `origin=${origin}`,
    `address=${account.stellarAddress}`,
    `issuedAt=${Date.now()}`,
    "nonce=wallet-server-test",
  ].join("\n");
  return {
    address: account.stellarAddress!,
    message,
    signature: Buffer.from(signWithStellarSecret(account.stellarSecret!, message)).toString("base64url"),
    ttlSeconds: 3600,
  };
}

test("mints device auth from a signed passkey-derived wallet account", async () => {
  const minted = await request("/api/auth/device", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wallet.benzo.space",
    },
    body: JSON.stringify(deviceAuthPayload()),
  });
  expect(minted.status).toBe(200);
  const body = await minted.json() as { token: string; tokenType: string };
  expect(body).toMatchObject({ tokenType: "Bearer" });
  expect(body.token).toMatch(/^benzo-device-v1\./);

  const protectedRes = await request(`/api/rpc?path=${encodeURIComponent("/session")}`, {
    headers: { authorization: `Bearer ${body.token}` },
  });
  expect(protectedRes.status).not.toBe(401);
});

test("rejects device auth when the signed origin or signature does not match", async () => {
  const wrongOrigin = await request("/api/auth/device", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wallet.benzo.space",
    },
    body: JSON.stringify(deviceAuthPayload("https://evil.example")),
  });
  expect(wrongOrigin.status).toBe(401);

  const body = deviceAuthPayload();
  body.signature = Buffer.from(new Uint8Array(64).fill(1)).toString("base64url");
  const badSignature = await request("/api/auth/device", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wallet.benzo.space",
    },
    body: JSON.stringify(body),
  });
  expect(badSignature.status).toBe(401);
});

test("mints local verification auth only for localhost when explicitly enabled", async () => {
  process.env.BENZO_LOCAL_UI_TEST_AUTH = "1";
  const minted = await request("/api/auth/local", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8791",
      origin: "http://127.0.0.1:5175",
    },
    body: JSON.stringify({ subject: "local-ui-wallet" }),
  });
  expect(minted.status).toBe(200);
  await expect(minted.json()).resolves.toMatchObject({ tokenType: "Bearer" });

  const publicHost = await request("/api/auth/local", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "wallet.benzo.space",
      origin: "https://wallet.benzo.space",
    },
    body: JSON.stringify({ subject: "public-ui-wallet" }),
  });
  expect(publicHost.status).toBe(404);
  delete process.env.BENZO_LOCAL_UI_TEST_AUTH;
});

test("accepts only local prover requests", () => {
  expect(proverOf(new URL("http://localhost/api/send?prover=local"))).toBe("local");
  expect(() => proverOf(new URL("http://localhost/api/send?prover=remote"))).toThrow(
    "Only local proving is enabled",
  );
});
