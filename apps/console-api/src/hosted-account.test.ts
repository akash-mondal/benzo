import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, expect, test, vi } from "vitest";

const ENV_KEYS = ["VERCEL", "DEPLOYER_SECRET", "SOROBAN_RPC_URL", "BENZO_PROVER_ENDPOINT", "BENZO_PROVER_MEASUREMENT"] as const;
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

test("hosted console never derives a public org treasury from DEPLOYER_SECRET", async () => {
  vi.resetModules();
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.VERCEL = "1";
  process.env.DEPLOYER_SECRET = Keypair.random().secret();
  process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

  const { getClient } = await import("./chain.js");

  expect(getClient()).toBeNull();
  expect(err).toHaveBeenCalledWith(
    "[console-api] live client unavailable; refusing app data:",
    expect.stringContaining("refusing shared DEPLOYER_SECRET-derived treasury"),
  );
});
