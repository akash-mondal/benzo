import { afterEach, describe, expect, it } from "vitest";
import { collectEvents, type RpcEvent } from "../src/scanner.js";

// collectEvents talks to Soroban RPC via the global `fetch`; mock it with a
// queue of canned JSON-RPC envelopes so the two most failure-prone branches —
// the retention-aged-out restart and the multi-page drain — get unit coverage
// (previously only exercised indirectly by live-testnet e2e).

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function queueFetch(responses: Array<{ status?: number; body: unknown }>): void {
  let i = 0;
  globalThis.fetch = (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { status: r.status ?? 200, json: async () => r.body } as unknown as Response;
  }) as typeof fetch;
}

const ev = (ledger: number, tag: string): RpcEvent => ({
  ledger,
  txHash: tag,
  topic: ["topic"],
  value: "value",
});

// The RPC cursor encodes the ledger in the high 32 bits (see cursorLedger()).
const cur = (ledger: number) => `${(BigInt(ledger) << 32n).toString()}-0`;

describe("collectEvents pagination", () => {
  it("restarts from the oldest retained ledger on a range error", async () => {
    queueFetch([
      { body: { error: { message: "startLedger before retention window: 1234 - 5678" } } },
      { body: { result: { events: [ev(1300, "a")], latestLedger: 5678 } } },
    ]);
    const out = await collectEvents("http://rpc", ["C"], 5);
    expect(out.map((e) => e.txHash)).toEqual(["a"]);
  });

  it("concatenates cursor-linked pages and stops at latestLedger", async () => {
    queueFetch([
      { body: { result: { events: [ev(100, "a")], cursor: cur(100), latestLedger: 5678 } } },
      // cursor ledger (6000) >= latestLedger (5678) ⇒ drained, stop.
      { body: { result: { events: [ev(200, "b")], cursor: cur(6000), latestLedger: 5678 } } },
    ]);
    const out = await collectEvents("http://rpc", ["C"], 1);
    expect(out.map((e) => e.txHash)).toEqual(["a", "b"]);
  });

  it("throws (does not silently truncate) on a mid-pagination error", async () => {
    queueFetch([
      { body: { result: { events: [ev(100, "a")], cursor: cur(100), latestLedger: 5678 } } },
      { body: { error: { message: "boom" } } },
    ]);
    await expect(collectEvents("http://rpc", ["C"], 1)).rejects.toThrow(/pagination/);
  });
});
