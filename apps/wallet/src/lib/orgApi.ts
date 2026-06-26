/**
 * orgApi (P0-B3) - the ONE place the consumer wallet talks to a business's
 * console-api: a contractor accepting an org invite and billing that org. This is
 * a deliberate cross-product interaction (a contractor submitting an invoice to a
 * company), NOT identity sharing - the contractor keeps their own wallet identity;
 * the org just gets an invoice tied to the contractor's @handle. Defaults to the
 * local console-api; override with VITE_CONSOLE_ORIGIN.
 */
function defaultOrgBase(): string {
  if (typeof window === "undefined") return "http://localhost:8790";
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" ? "http://localhost:8790" : "https://console.benzo.space";
}

const ORG_BASE = ((import.meta as { env?: Record<string, string> }).env?.VITE_CONSOLE_ORIGIN) || defaultOrgBase();
const IDEMPOTENCY_PREFIX = "benzo.idempotency.org.v1:";

function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (const ch of input) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function randomIdempotencyKey(): string {
  const uuid = crypto.randomUUID?.();
  if (uuid) return `idem_${uuid}`;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `idem_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function idempotencyKey(path: string, init?: RequestInit): { key: string; clear: () => void } | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const body = typeof init?.body === "string" ? init.body : "";
  const storageKey = `${IDEMPOTENCY_PREFIX}${shortHash(`${method}:${path}:${body}`)}`;
  let key = localStorage.getItem(storageKey);
  if (!key) {
    key = randomIdempotencyKey();
    localStorage.setItem(storageKey, key);
  }
  return { key, clear: () => localStorage.removeItem(storageKey) };
}

async function ohttp<T>(path: string, init?: RequestInit & { inviteToken?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", headers.get("content-type") ?? "application/json");
  if (init?.inviteToken) headers.set("x-benzo-org-invite-token", init.inviteToken);
  const idem = idempotencyKey(path, init);
  if (idem) headers.set("Idempotency-Key", idem.key);
  let res: Response | undefined;
  try {
    res = await fetch(`${ORG_BASE}/api/rpc?path=${encodeURIComponent(path)}`, {
      ...init,
      headers,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const b = (await res.json()) as { error?: string };
        if (b.error) detail = b.error;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return (await res.json()) as T;
  } finally {
    if (res && res.status < 500) idem?.clear();
  }
}

export interface AcceptedInvite {
  ok: boolean;
  orgName: string;
  kind: "member" | "contractor" | "customer";
  counterpartyId?: string;
  orgId?: string;
}
export interface OrgInvoice {
  id: string;
  number: string;
  counterpartyId: string;
  total: { amount: string; assetCode: string };
  status: "draft" | "open" | "paid" | "void" | "cancelled";
  lineItems: Array<{ description: string; quantity: number; unitAmount: string }>;
}

function toStroops(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return BigInt(Math.round(n * 1e7)).toString();
}

export const orgApi = {
  acceptInvite: (body: { token: string; handle?: string; counterpartyId?: string; kind?: "member" | "contractor" | "customer"; orgId?: string; name?: string }) =>
    ohttp<AcceptedInvite>("/invites/accept", { method: "POST", body: JSON.stringify(body) }),
  submitInvoice: (counterpartyId: string, amount: string, description: string, inviteToken?: string) =>
    ohttp<OrgInvoice>("/invoices", {
      method: "POST",
      inviteToken,
      body: JSON.stringify({
        counterpartyId,
        inviteToken,
        lineItems: [{ description, quantity: 1, unitAmount: toStroops(amount) }],
        assetCode: "USDC",
      }),
    }),
  invoices: (inviteToken?: string) => ohttp<OrgInvoice[]>("/invoices", { inviteToken }),
};
