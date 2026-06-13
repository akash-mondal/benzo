/**
 * Minimal HTTP surface for the Benzo indexer (the viewing-key scan API the
 * SDK consumes). Stateless except for the in-memory index; restart re-syncs
 * from `startLedger`. For production this would persist a reorg-safe cursor;
 * for testnet/e2e the in-memory mirror is sufficient and fully real.
 *
 *   GET  /health
 *   GET  /commitments            -> [{leafIndex, commitment, mvkTag, txHash}]
 *   GET  /nullifier/:value       -> {spent: bool}
 *   POST /scan {viewingSecretHex} -> [{leafIndex, commitment, amount,...}]
 *   POST /audit {tvkSecretHex}   -> [{amount, recipientPk, ...}]
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { BenzoIndexer, syncFromRpc } from "./index.js";

const PORT = Number(process.env.INDEXER_PORT ?? 8787);
const RPC = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const DEPLOY_PATH = process.env.BENZO_DEPLOYMENT ?? "deployments/testnet.json";

const dep = JSON.parse(readFileSync(DEPLOY_PATH, "utf8"));
const start = Number(process.env.INDEXER_START_LEDGER ?? 0);
const indexer = new BenzoIndexer(dep.treeLevels, start);

async function resync() {
  try {
    const n = await syncFromRpc(
      indexer,
      RPC,
      [dep.pool, dep.viewkeyAnchor],
      indexer.cursorLedger || (await latestLedger()) - 3000,
    );
    if (n) console.log(`[indexer] ingested ${n} events; cursor=${indexer.cursorLedger}`);
  } catch (e) {
    console.error("[indexer] resync error:", (e as Error).message);
  }
}

async function latestLedger(): Promise<number> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
  });
  return ((await res.json()) as { result: { sequence: number } }).result.sequence;
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  await resync();

  if (url.pathname === "/health") return json(res, 200, { ok: true, cursor: indexer.cursorLedger });

  if (url.pathname === "/commitments") {
    return json(
      res,
      200,
      indexer.commitments
        .filter(Boolean)
        .map((c) => ({ leafIndex: c.leafIndex, commitment: c.commitment, mvkTag: c.mvkTag, txHash: c.txHash })),
    );
  }

  if (url.pathname.startsWith("/nullifier/")) {
    const v = BigInt(url.pathname.split("/")[2]);
    return json(res, 200, { spent: indexer.isSpent(v) });
  }

  if (req.method === "POST" && (url.pathname === "/scan" || url.pathname === "/audit")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (url.pathname === "/scan") {
      const secret = new Uint8Array(Buffer.from(body.viewingSecretHex, "hex"));
      return json(res, 200, indexer.scan(secret));
    }
    const tvk = new Uint8Array(Buffer.from(body.tvkSecretHex, "hex"));
    return json(res, 200, indexer.auditorScan(tvk));
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`[indexer] listening on :${PORT}, rpc=${RPC}`));
