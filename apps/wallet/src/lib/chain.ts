/**
 * Direct browser → Stellar reads. The thesis: the blockchain is the backend.
 *
 * This module talks to the Soroban RPC straight from the browser - no BFF, no
 * server, no secrets - using the plain JSON-RPC wire protocol (so it adds zero
 * bundle weight and no node polyfills). It is the first real slice of the
 * client-side migration: a public, account-free read that proves the data path
 * works device→chain. Shielded balance/history reads need the account's viewing
 * key and are gated on browser-resident keys.
 */

import { StellarRpcClient } from "@benzo/core";
import { RPC_URL, VERIFIER_ID, SIM_SOURCE, NETWORK_PASSPHRASE } from "./network";

export { RPC_URL, VERIFIER_ID }; // re-export for existing importers (network-agnostic)

export interface ChainStatus {
  /** latest closed ledger sequence - proves liveness */
  sequence: number;
  /** network protocol version */
  protocolVersion: number;
  /** unix seconds of the latest ledger close */
  closedAt?: number;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

/**
 * Read the latest closed ledger directly from the chain in the browser.
 * Throws on transport/RPC error so the caller can degrade gracefully.
 * A transient blip (429/503/network) is retried with exponential backoff so the
 * liveness indicator doesn't flap to "Connecting…" on a single hiccup.
 */
export async function getChainStatus(signal?: AbortSignal): Promise<ChainStatus> {
  const res = await fetchRpc(
    { jsonrpc: "2.0", id: 1, method: "getLatestLedger" },
    signal,
  );
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const body = (await res.json()) as JsonRpcResponse<{ sequence: number; protocolVersion: number }>;
  if (!body.result) throw new Error(body.error?.message ?? "no result");
  return { sequence: body.result.sequence, protocolVersion: body.result.protocolVersion };
}

/** POST to the RPC with small exponential backoff on transient (429/503) errors. */
async function fetchRpc(payload: unknown, signal?: AbortSignal, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      // Retry only on rate-limit / temporary-unavailable; surface everything else.
      if ((res.status === 429 || res.status === 503) && i < attempts - 1) {
        await sleep(250 * 2 ** i, signal);
        continue;
      }
      return res;
    } catch (e) {
      if (signal?.aborted) throw e; // an intentional abort isn't a retryable blip
      lastErr = e;
      if (i < attempts - 1) await sleep(250 * 2 ** i, signal);
    }
  }
  throw lastErr ?? new Error("RPC unreachable");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(id); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

/**
 * Independently verify a balance proof ON-CHAIN, FROM THE BROWSER - no BFF, no
 * trust in the server's verdict. The wallet hands the proof + public signals
 * (never the witness) straight to the verifier contract via the Soroban RPC and
 * reads back the chain's pairing-check result. The verifier fails closed, so a
 * bad proof traps → false. This is the trustless half of "prove your balance":
 * the user's own device confirms the statement against the chain.
 */
export async function verifyBalanceProofOnChain(sorobanProof: unknown, sorobanPublics: string[]): Promise<boolean> {
  if (!sorobanProof || !sorobanPublics?.length) return false;
  const cli = new StellarRpcClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    addressFor: () => SIM_SOURCE,
  });
  try {
    const r = await cli.view(VERIFIER_ID, "sim", [
      "verify_proof",
      "--vk_id",
      "BALANCE",
      "--proof",
      JSON.stringify(sorobanProof),
      "--public_inputs",
      JSON.stringify(sorobanPublics),
    ]);
    return r === true;
  } catch {
    return false;
  }
}
