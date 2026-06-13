/**
 * Stellar client — wraps the `stellar` CLI for deploys/invokes (so every
 * transaction is reproducible from a shell) and the Soroban JSON-RPC for
 * reads (events, ledger entries).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface StellarConfig {
  network: string; // e.g. "testnet"
  rpcUrl: string;
  networkPassphrase: string;
  /** stellar CLI binary */
  bin?: string;
}

export interface InvokeResult {
  /** parsed JSON return value of the contract fn (or raw string) */
  result: unknown;
  /** transaction hash if one was submitted */
  txHash?: string;
  raw: string;
}

export class StellarCli {
  constructor(readonly cfg: StellarConfig) {}

  private env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      STELLAR_NETWORK_PASSPHRASE: this.cfg.networkPassphrase,
      SOROBAN_RPC_URL: this.cfg.rpcUrl,
      STELLAR_RPC_URL: this.cfg.rpcUrl,
    };
  }

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const bin = this.cfg.bin ?? "stellar";
    return execFileP(bin, args, {
      env: this.env(),
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  async deploy(opts: {
    wasmPath: string;
    source: string;
    constructorArgs?: string[];
  }): Promise<{ contractId: string; txHash?: string }> {
    const args = [
      "contract",
      "deploy",
      "--wasm",
      opts.wasmPath,
      "--source",
      opts.source,
      "--network",
      this.cfg.network,
    ];
    if (opts.constructorArgs?.length) args.push("--", ...opts.constructorArgs);
    const { stdout, stderr } = await this.run(args);
    const contractId = stdout.trim().split("\n").pop()!.trim();
    const txHash = /Signing transaction: ([0-9a-f]{64})/.exec(stderr)?.[1];
    return { contractId, txHash };
  }

  /**
   * Invoke a contract function. `send` forces submission even for reads.
   * Function args go in `fnArgs` as ["fn_name", "--arg", "value", ...].
   */
  async invoke(opts: {
    contractId: string;
    source: string;
    fnArgs: string[];
    send?: boolean;
  }): Promise<InvokeResult> {
    const args = [
      "contract",
      "invoke",
      "--id",
      opts.contractId,
      "--source",
      opts.source,
      "--network",
      this.cfg.network,
    ];
    if (opts.send) args.push("--send=yes");
    args.push("--", ...opts.fnArgs);
    const { stdout, stderr } = await this.run(args);
    const raw = stdout.trim();
    let result: unknown = raw;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      /* keep raw string */
    }
    const txHash = /Signing transaction: ([0-9a-f]{64})/.exec(stderr)?.[1];
    return { result, txHash, raw };
  }

  /** Read-only simulation invoke (no submission). */
  async view(contractId: string, source: string, fnArgs: string[]): Promise<unknown> {
    const r = await this.invoke({ contractId, source, fnArgs, send: false });
    return r.result;
  }

  async keyAddress(name: string): Promise<string> {
    const { stdout } = await this.run(["keys", "address", name]);
    return stdout.trim();
  }

  /** Raw JSON-RPC call against Soroban RPC. */
  async rpc<T = unknown>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.cfg.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
    return body.result as T;
  }

  async latestLedger(): Promise<number> {
    const r = await this.rpc<{ sequence: number }>("getLatestLedger", {});
    return r.sequence;
  }

  /** Fetch contract events (used by the indexer). */
  async getEvents(opts: {
    startLedger: number;
    contractIds: string[];
    limit?: number;
  }): Promise<{
    events: Array<{
      ledger: number;
      id: string;
      contractId: string;
      topic: string[];
      value: string;
      txHash: string;
    }>;
    latestLedger: number;
  }> {
    type RawEvents = {
      events: Array<{
        ledger: number;
        id: string;
        contractId: string;
        topic: string[];
        value: string;
        txHash: string;
      }>;
      latestLedger: number;
    };
    return this.rpc<RawEvents>("getEvents", {
      startLedger: opts.startLedger,
      filters: [{ type: "contract", contractIds: opts.contractIds }],
      pagination: { limit: opts.limit ?? 1000 },
    });
  }
}

/** Build a StellarConfig from the standard Benzo .env variables. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): StellarConfig {
  return {
    network: env.STELLAR_NETWORK ?? "testnet",
    rpcUrl: env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase:
      env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  };
}
