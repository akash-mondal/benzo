/**
 * Benzo end-to-end test suite — drives goal items 1–5 against Stellar TESTNET.
 *
 * Requires the env loaded (set -a; . ./.env; set +a) and the stack deployed
 * (deployments/testnet.json). Real Groth16 proofs, real Circle testnet USDC,
 * real Soroban contracts. One shared private-payment flow (relayed) backs the
 * shielded-core and compliance assertions; the corridor runs its own flow.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { StellarCli, configFromEnv } from "@benzo/core";

// This suite drives REAL testnet flows; it needs `.env` loaded and the stack
// deployed. Without env it self-skips (matching circuits.test.ts) instead of
// throwing at import, so a bare offline `pnpm -r test` / CI stays green. The
// flow modules are imported lazily because they build a USDC Asset at load.
const HAVE_ENV = Boolean(process.env.USDC_ISSUER && process.env.RELAYER_PUBLIC);
const repo = fileURLToPath(new URL("../..", import.meta.url));

describe.skipIf(!HAVE_ENV)("Benzo testnet e2e (items 1–5)", () => {
  const dep = JSON.parse(readFileSync(`${repo}/deployments/testnet.json`, "utf8"));
  const cli = new StellarCli(configFromEnv());

  // Shared relayed flow for items 2/3/4 (flow modules imported lazily).
  let flow;
  let runCompliance;
  let runCorridor;
  beforeAll(async () => {
    const { runPrivatePaymentFlow } = await import("./flow.mjs");
    ({ runCompliance } = await import("./m2-compliance.mjs"));
    ({ runCorridor } = await import("./m3-corridor.mjs"));
    // gasless relay: the relayer submits the transfer and takes a USDC fee.
    flow = await runPrivatePaymentFlow({
      relayerSource: "benzo-relayer",
      fee: 100_000n, // 0.01 USDC relayer fee out of the shielded pool
      quiet: true,
    });
  }, 300_000);
  it("item 2: deployed BN254 verifier verifies a real Groth16 proof on-chain (returns true)", async () => {
    const proof = readFileSync(`${repo}/circuits/build/trivial/proof_soroban.json`, "utf8").trim();
    const result = await cli.view(
      dep.verifier,
      "benzo-deployer",
      ["verify_proof", "--vk_id", "TRIVIAL", "--proof", proof, "--public_inputs", '["42"]'],
    );
    expect(result).toBe(true);
  }, 60_000);

  it("item 2/3: shield + relayed private transfer + unshield are accepted on-chain (production VKs verify)", () => {
    // Every leg returned a tx hash => the contract accepted each Groth16 proof.
    expect(flow.txs.shield).toMatch(/^[0-9a-f]{64}$/);
    expect(flow.txs.transfer).toMatch(/^[0-9a-f]{64}$/);
    expect(flow.txs.withdraw).toMatch(/^[0-9a-f]{64}$/);
  });

  it("item 3: nullifiers recorded, commitments in the tree, balances moved", async () => {
    expect(flow.state.spent0).toBe(true); // sender's shield-note nullifier spent
    expect(flow.state.spentW).toBe(true); // recipient's note nullifier spent
    expect(Number(flow.state.nextIndex)).toBeGreaterThanOrEqual(4);
    // exit account (different from sender) received the unshielded USDC
    expect(Number(flow.balances.after.exit)).toBeGreaterThan(Number(flow.balances.before.exit));
    // pool custodies the shielded remainder
    expect(Number(flow.balances.after.pool)).toBeGreaterThan(0);
  });

  it("item 4 (relayer): the relayer was compensated in USDC for the gasless transfer", async () => {
    const relayerBal = await cli.view(dep.token, "benzo-deployer", [
      "balance",
      "--id",
      process.env.RELAYER_PUBLIC,
    ]);
    // fee was 0.01 USDC = 100000 stroops; relayer holds at least that
    expect(BigInt(relayerBal)).toBeGreaterThanOrEqual(100_000n);
  }, 60_000);

  it("item 4: compliance — MVK/TVK disclosure + ASP membership + proof-of-innocence", async () => {
    const r = await runCompliance(flow);
    expect(r.disclosure).toBe(true);
    expect(r.aspMembership).toBe(true);
    expect(r.aspNonMembership).toBe(true);
    expect(r.allPass).toBe(true);
  }, 180_000);

  it("item 5: self-hosted SEP-24 corridor runs fiat-sim→shield→transfer→unshield→fiat-sim", async () => {
    const c = await runCorridor();
    expect(c.txs.fiatInSettlement).toMatch(/^[0-9a-f]{64}$/);
    expect(c.txs.shield).toMatch(/^[0-9a-f]{64}$/);
    expect(c.txs.transfer).toMatch(/^[0-9a-f]{64}$/);
    expect(c.txs.unshield).toMatch(/^[0-9a-f]{64}$/);
    expect(c.txs.fiatOutReceipt).toMatch(/^[0-9a-f]{64}$/);
  }, 300_000);
});
