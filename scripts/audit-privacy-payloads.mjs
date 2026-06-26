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

function assertContains(rel, needles) {
  const src = read(rel);
  for (const needle of needles) {
    if (!src.includes(needle)) fail(`${rel} missing privacy invariant: ${needle}`);
  }
  return src;
}

function assertNotContains(rel, needles) {
  const src = read(rel);
  for (const needle of needles) {
    if (src.includes(needle)) fail(`${rel} contains forbidden privacy payload: ${needle}`);
  }
  return src;
}

function routeMethods(src) {
  return [...src.matchAll(/route\("([A-Z]+)",\s*"([^"]+)"/g)].map((m) => ({ method: m[1], path: m[2] }));
}

function checkHostedWriteGuard(rel, appName) {
  const src = assertContains(rel, [
    "Idempotency-Key header is required for hosted",
    "function requiresIdempotency",
    "runIdempotent(",
  ]);
  const writes = routeMethods(src).filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method));
  const exempt = new Set(["/api/auth/google"]);
  for (const r of writes) {
    if (!r.path.startsWith("/api/")) continue;
    if (exempt.has(r.path)) continue;
    if (!src.includes(`path !== "/api/auth/google"`)) {
      fail(`${appName}: hosted idempotency exemption list is not explicit`);
    }
  }
}

function checkRecoverySanitized(rel) {
  assertContains(rel, ["recoverySummary()"]);
  assertNotContains(rel, ["recovery: db.recovery"]);
}

function checkPrivateEventPublicMeta() {
  const src = assertContains("packages/private-events/src/index.ts", [
    "SENSITIVE_PUBLIC_META_KEY",
    "publicMeta contains sensitive key",
    "amount|balance|counterparty",
    "description|email|handle|memo|name|rate|recipient|salary|tax",
  ]);
  if (!src.includes("createPrivateEvent")) fail("private-events package missing createPrivateEvent");

  const consoleServer = read("apps/console-api/src/server.ts");
  const lines = consoleServer.split(/\r?\n/);
  const risky = /\{[^}]*\b(amount|balance|counterparty|description|email|handle|memo|name|rate|recipient|salary|tax)\b\s*:/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("appendPrivateEvent(")) continue;
    const next = lines.slice(i, i + 12).join(" ");
    const publicMeta = next.match(/,\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\)?;?$/);
    if (publicMeta && risky.test(publicMeta[1])) {
      fail(`apps/console-api/src/server.ts:${i + 1} has sensitive-looking publicMeta`);
    }
  }
}

function checkBrowserLogs() {
  for (const rel of ["apps/wallet/src/lib/errors.ts", "apps/console/src/lib/format.ts"]) {
    assertNotContains(rel, ["console.error"]);
  }
}

function checkServerErrorsAndLogs() {
  for (const rel of [
    "apps/wallet-api/src/server.ts",
    "apps/console-api/src/server.ts",
    "packages/relayer/src/server.ts",
  ]) {
    assertNotContains(rel, [
      "error: String((e as Error)",
      "error: String((e as Error)?.message ?? e)",
      "profile: ${",
      "org: ${",
    ]);
  }
  assertNotContains("apps/wallet-api/src/chain.ts", [
    "live client unavailable; refusing app data:\",",
  ]);
  assertNotContains("apps/console-api/src/chain.ts", [
    "live client unavailable; refusing app data:\",",
    "proveLineCap(${handle})",
    "proveLineInnocence(${handle})",
    "proveAnonymousApproval(${runId})",
    "payment ${po.id}",
    "${(e as Error).message}",
  ]);
  assertNotContains("apps/console-api/src/server.ts", [
    "KYB attestation failed:\",",
  ]);
}

function checkUrlPayloads() {
  const sensitiveQuery = /searchParams\.get\("((amount|balance|counterparty|description|email|handle|memo|name|rate|recipient|salary|subjectIds|tax))"\)/i;
  for (const rel of [
    "apps/wallet-api/src/server.ts",
    "apps/console-api/src/server.ts",
    "packages/anchor/src/server.ts",
    "packages/indexer/src/server.ts",
  ]) {
    const src = read(rel);
    if (sensitiveQuery.test(src)) fail(`${rel} reads sensitive data from URL query params`);
  }
  for (const rel of ["apps/wallet/src/lib/api.ts", "apps/console/src/lib/api.ts", "apps/wallet/src/lib/orgApi.ts"]) {
    assertNotContains(rel, [
      "?amount=",
      "?memo=",
      "?email=",
      "?recipient=",
      "?salary=",
    ]);
  }
}

checkHostedWriteGuard("apps/wallet-api/src/server.ts", "wallet-api");
checkHostedWriteGuard("apps/console-api/src/server.ts", "console-api");
checkRecoverySanitized("apps/wallet-api/src/server.ts");
checkRecoverySanitized("apps/console-api/src/server.ts");
checkPrivateEventPublicMeta();
checkBrowserLogs();
checkServerErrorsAndLogs();
checkUrlPayloads();

if (failed) process.exit(1);
console.log("[privacy] payload, recovery, log, and idempotency invariants passed");
