import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("./google-oidc.js", () => ({
  googleConfigured: () => true,
  verifyGoogleIdToken: vi.fn(async () => ({
    sub: "user-wallet-idem",
    iss: "https://accounts.google.com",
    aud: "google-client",
    email: "wallet-idem@example.com",
    name: "Wallet Idem",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
}));

const ENV_KEYS = ["VERCEL", "GOOGLE_CLIENT_ID", "BENZO_ACCOUNT_SALT"] as const;
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

async function request(handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const req = Readable.from(init.body ? [Buffer.from(init.body)] : []) as IncomingMessage;
  req.method = init.method ?? "GET";
  req.url = path;
  req.headers = init.headers ?? {};

  let status = 200;
  let text = "";
  const res = {
    setHeader() {
      return this;
    },
    writeHead(code: number) {
      status = code;
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
  return { status, json: async () => JSON.parse(text) as unknown };
}

test("hosted wallet writes require an idempotency key after auth and before tenant storage", async () => {
  process.env.VERCEL = "1";
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.BENZO_ACCOUNT_SALT = "stable-account-salt";
  const { handle } = await import("./server.js");

  const res = await request(handle, `/api/rpc?path=${encodeURIComponent("/send")}`, {
    method: "POST",
    headers: { authorization: "Bearer verified-google-token", "content-type": "application/json" },
    body: JSON.stringify({ to: "@alice", amount: "1" }),
  });

  expect(res.status).toBe(428);
  await expect(res.json()).resolves.toMatchObject({ error: "Idempotency-Key header is required for hosted wallet writes." });
});
