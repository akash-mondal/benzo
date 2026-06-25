import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { accountFromOidc, type BenzoAccount } from "@benzo/core";
import { verifyGoogleIdToken, type GoogleClaims } from "./google-oidc.js";

export interface AuthContext {
  key: string;
  account: BenzoAccount;
  claims: GoogleClaims;
}

const storage = new AsyncLocalStorage<AuthContext>();

function accountSalt(): string {
  const salt = process.env.BENZO_ACCOUNT_SALT || process.env.BENZO_AUTH_SALT;
  if (!salt && process.env.VERCEL === "1") throw new Error("BENZO_ACCOUNT_SALT is required for hosted account derivation");
  return salt || "benzo-local-dev";
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(h) ? h[0] : h);
  return m?.[1]?.trim() || null;
}

export async function authFromRequest(req: IncomingMessage): Promise<AuthContext | null> {
  const token = bearer(req);
  if (!token) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is required for hosted Google accounts");
  const claims = await verifyGoogleIdToken(token, clientId);
  const key = createHash("sha256").update(`wallet|${claims.iss}|${claims.aud}|${claims.sub}`).digest("hex").slice(0, 32);
  const account = accountFromOidc(
    { iss: claims.iss, aud: claims.aud, sub: claims.sub },
    { app: "consumer", salt: accountSalt() },
  );
  account.label = `wallet-${key.slice(0, 8)}`;
  return { key, account, claims };
}

export function runWithAuth<T>(ctx: AuthContext | null, fn: () => Promise<T>): Promise<T> {
  return ctx ? storage.run(ctx, fn) : fn();
}

export function currentAuth(): AuthContext | null {
  return storage.getStore() ?? null;
}
