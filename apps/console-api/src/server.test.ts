import { createServer } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";

let baseUrl = "";
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  process.env.VERCEL = "1";
  const { handle } = await import("./server.js");
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("test server did not bind to a port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("routes nested console endpoints through the Vercel rpc shim", async () => {
  const res = await fetch(`${baseUrl}/api/rpc?path=${encodeURIComponent("/ledger/verify")}`);
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ ok: true });
});
