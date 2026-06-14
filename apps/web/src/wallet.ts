/**
 * createWebWallet — the browser composition root (no UI).
 *
 * Wires the web adapters into a single BenzoClient the UI renders over:
 *   - chain I/O  → StellarRpcClient (reads via simulate; writes POST to the
 *                  relayer/sponsor service so the user needs no XLM)
 *   - proving    → WasmProver (client-side; the witness never leaves the device)
 *   - storage    → IndexedDB (durable, incremental sync survives reloads)
 *
 * Onboarding (non-custodial) and the @handle helpers live here too, so the UI is
 * a thin render layer over `wallet.client`.
 */

import {
  BenzoClient,
  StellarRpcClient,
  type BenzoAccount,
  type BenzoDeployment,
  loginWithSigner,
  type SignMessage,
} from "@benzo/core";
import { onboardViaSponsor, relayerSubmitter } from "@benzo/relayer";
import { WebPlatform } from "./platform.js";

export interface WebWalletConfig {
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  /** base URL of the self-hosted relayer/sponsor service (gasless + onboarding) */
  relayerUrl: string;
  deployment: BenzoDeployment & { handleRegistry?: string; requestRegistry?: string };
  /** base URL the circuit .wasm/.zkey artifacts are served from (for WasmProver) */
  circuitsBaseUrl: string;
  /** the relayer's public G-address (fee recipient + write submitter) */
  relayerAddress: string;
}

export interface WebWallet {
  readonly client: BenzoClient;
  readonly platform: WebPlatform;
  /** Derive the shielded account from a single passkey/wallet signature (no seed phrase). */
  login(signMessage: SignMessage): Promise<BenzoAccount>;
  /** Create a fresh account funded by the sponsor (0 XLM + USDC trustline), non-custodially. */
  onboard(newAccountSecret: string): Promise<{ txHash: string; publicKey: string }>;
}

function circuitArtifacts(base: string) {
  const at = (c: string) => ({
    wasmPath: `${base}/${c}.wasm`,
    zkeyPath: `${base}/${c}.zkey`,
  });
  return {
    shield: at("shield"),
    joinsplit: at("joinsplit"),
    unshield: at("unshield"),
    proofOfBalance: at("proof_of_balance"),
  };
}

export function createWebWallet(config: WebWalletConfig): WebWallet {
  const platform = new WebPlatform();
  // The user's active Stellar address is set by the UI after login/onboard;
  // reads only need a syntactically valid address, the relayer submits writes.
  let activeAddress = config.relayerAddress;

  const cli = new StellarRpcClient({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    addressFor: (name) => (name === "relayer" ? config.relayerAddress : activeAddress),
    submitWrite: relayerSubmitter(config.relayerUrl),
  });

  const client = new BenzoClient({
    cli,
    prover: platform.prover,
    store: platform.storage,
    deployment: config.deployment,
    circuits: circuitArtifacts(config.circuitsBaseUrl),
    rpcUrl: config.rpcUrl,
    txSource: "user",
    relayer: { source: "relayer", address: config.relayerAddress },
    handleRegistry: config.deployment.handleRegistry,
    requestRegistry: config.deployment.requestRegistry,
  });

  return {
    client,
    platform,
    async login(signMessage) {
      const account = await loginWithSigner(signMessage);
      if (account.stellarAddress) activeAddress = account.stellarAddress;
      client.useAccount(account);
      return account;
    },
    onboard(newAccountSecret) {
      return onboardViaSponsor(config.relayerUrl, {
        newAccountSecret,
        horizonUrl: config.horizonUrl,
        networkPassphrase: config.networkPassphrase,
      });
    },
  };
}
