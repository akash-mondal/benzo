import { createServer } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { verifyAuditPacket } from "@benzo/private-events";

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

test("records invoice facts as ciphertext-only private audit packets", async () => {
  const invoice = await fetch(`${baseUrl}/api/rpc?path=${encodeURIComponent("/invoices")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      counterpartyId: "cp_grace",
      number: "INV-PRIVATE-1",
      lineItems: [{ description: "Sensitive inspection work", quantity: 1, unitAmount: "1230000000" }],
      assetCode: "USDC",
    }),
  });
  expect(invoice.status).toBe(201);
  const created = await invoice.json() as { id: string };

  const audit = await fetch(`${baseUrl}/api/rpc?path=${encodeURIComponent("/audit/private-events")}`);
  expect(audit.status).toBe(200);
  const text = await audit.text();
  expect(text).not.toContain("Sensitive inspection work");
  expect(text).not.toContain("INV-PRIVATE-1");
  expect(text).not.toContain("1230000000");

  const body = JSON.parse(text) as {
    packet: Parameters<typeof verifyAuditPacket>[0];
    integrity: { ok: boolean };
  };
  expect(body.integrity.ok).toBe(true);
  expect(verifyAuditPacket(body.packet)).toBe(true);
  expect(body.packet.envelopes.some((e) => e.type === "invoice.created" && e.subjectId === created.id)).toBe(true);
});

test("private audit root anchoring response stays ciphertext-only", async () => {
  const invoice = await fetch(`${baseUrl}/api/rpc?path=${encodeURIComponent("/invoices")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      counterpartyId: "cp_grace",
      number: "INV-ANCHOR-PRIVATE-1",
      lineItems: [{ description: "Anchor packet secret work", quantity: 1, unitAmount: "555000000" }],
      assetCode: "USDC",
    }),
  });
  expect(invoice.status).toBe(201);

  const anchor = await fetch(`${baseUrl}/api/rpc?path=${encodeURIComponent("/audit/private-events/anchor")}`, {
    method: "POST",
    body: "{}",
  });
  expect(anchor.status).toBe(200);
  const text = await anchor.text();
  expect(text).not.toContain("Anchor packet secret work");
  expect(text).not.toContain("INV-ANCHOR-PRIVATE-1");
  expect(text).not.toContain("555000000");
  const body = JSON.parse(text) as { anchor: { onChain: boolean; error?: string }; packetHash: string; orgHash: string };
  expect(body.anchor.onChain).toBe(false);
  expect(body.packetHash).toMatch(/^[0-9a-f]{64}$/);
  expect(body.orgHash).toMatch(/^[0-9a-f]{64}$/);
});
