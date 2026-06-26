#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = false;

function fail(message) {
  console.error(`::error::${message}`);
  failed = true;
}

function read(rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    fail(`missing file: ${rel}`);
    return "";
  }
  return readFileSync(abs, "utf8");
}

function routeBlocks(src) {
  const starts = [...src.matchAll(/route\("([A-Z]+)",\s*"([^"]+)"/g)].map((m) => ({
    method: m[1],
    path: m[2],
    index: m.index ?? 0,
  }));
  return starts.map((r, i) => ({
    ...r,
    body: src.slice(r.index, starts[i + 1]?.index ?? src.length),
  }));
}

function requireNeedles(rel, needles) {
  const src = read(rel);
  for (const needle of needles) {
    if (!src.includes(needle)) fail(`${rel} missing required action coverage marker: ${needle}`);
  }
}

function checkConsoleMutations() {
  const rel = "apps/console-api/src/server.ts";
  const src = read(rel);
  const ignored = new Set(["/api/auth/google"]);
  const acceptableMarkers = [
    "appendPrivateEvent(",
    "recordProofReceipt(",
    "recordProofReceiptParts(",
    "writeRunLedger(",
    "anchorPrivateAuditRoot(",
  ];
  const writes = routeBlocks(src).filter((r) => r.path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(r.method));
  for (const r of writes) {
    if (ignored.has(r.path)) continue;
    if (!acceptableMarkers.some((needle) => r.body.includes(needle))) {
      fail(`${rel} ${r.method} ${r.path} does not append a private event, proof receipt, ledger entry, or audit anchor`);
    }
  }
}

function checkWalletMoneyReceipts() {
  const rel = "apps/wallet-api/src/server.ts";
  const src = read(rel);
  const required = new Map([
    ["/api/send", ["recordSettledMovement(", "recordSettlementProof("]],
    ["/api/invite", ["recordSettledMovement(", "appendWalletProofReceipt("]],
    ["/api/invite/refund", ["recordSettledMovement(", "appendWalletProofReceipt("]],
    ["/api/claim", ["recordSettledMovement(", "appendWalletProofReceipt("]],
    ["/api/cash-out", ["recordSettledMovement(", "recordSettlementProof("]],
    ["/api/add-money", ["recordSettledMovement(", "recordSettlementProof("]],
    ["/api/import", ["recordSettledMovement(", "recordSettlementProof("]],
    ["/api/make-public", ["recordSettledMovement(", "recordSettlementProof("]],
    ["/api/send-public", ["recordSettledMovement("]],
    ["/api/share-proof", ["appendWalletProofReceipt("]],
  ]);
  const blocks = routeBlocks(src);
  for (const [path, needles] of required) {
    const block = blocks.find((r) => r.method === "POST" && r.path === path);
    if (!block) {
      fail(`${rel} missing POST ${path}`);
      continue;
    }
    for (const needle of needles) {
      if (!block.body.includes(needle)) fail(`${rel} POST ${path} missing money/proof receipt marker: ${needle}`);
    }
  }
}

function checkClientIdempotencyCoverage() {
  requireNeedles("apps/wallet/src/lib/api.test.ts", [
    "adds idempotency headers to wallet mutation helpers",
    "api.importDeposit",
    "api.makePublic",
    "api.sendPublic",
    "api.send(",
    "api.invite",
    "api.cashOut",
    "api.addMoney",
    "api.shareProof",
  ]);
  requireNeedles("apps/console/src/lib/api.test.ts", [
    "adds idempotency headers to console mutation helpers",
    "api.fundTreasury",
    "api.treasurySendPublic",
    "api.createPayment",
    "api.approvePayment",
    "api.createPayroll",
    "api.approvePayroll",
    "api.payInvoice",
    "api.netInvoices",
    "api.anchorPrivateAuditRoot",
  ]);
}

checkConsoleMutations();
checkWalletMoneyReceipts();
checkClientIdempotencyCoverage();

if (failed) process.exit(1);
console.log("[action-coverage] console audit events, wallet receipts, and client idempotency coverage passed");
