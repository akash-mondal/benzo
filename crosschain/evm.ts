// EVM escrow client (ethers): deploy/lock/release/refund/status against a local or testnet EVM
// chain. The ABI/bytecode come from the Foundry build of contracts/evm (npm run xchain builds it
// first via the demo script; forge build output is the shipped artifact).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress } from "ethers";
import type { InterfaceAbi } from "ethers";
import { AttestationFields, evmTypedData } from "./attestation";

export interface EvmPayout {
  index: number;
  lotCount: number;
  destinationKind: number;
  destination: string; // 0x-hex20
  leafCount: number;
  proof: string[]; // 0x-hex32
}

export function escrowArtifactPath(repoRoot: string): string {
  return path.join(repoRoot, "contracts/evm/out/BenzoEscrow.sol/BenzoEscrow.json");
}

// bin/benzo runs from the repo root (cli/dist is bundled, so no import.meta path tricks)
export const repoRoot = (): string => process.env.BNZ_REPO_ROOT ?? process.cwd();

export function loadArtifact(repoRoot: string): { abi: InterfaceAbi; bytecode: string } {
  const p = escrowArtifactPath(repoRoot);
  if (!existsSync(p)) throw new Error(`escrow artifact missing at ${p}; run: (cd contracts/evm && forge build)`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  return { abi: j.abi as InterfaceAbi, bytecode: j.bytecode.object };
}

export function evmProvider(rpc: string): JsonRpcProvider {
  return new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
}

export function evmWallet(rpc: string, keyHex: string): Wallet {
  return new Wallet(keyHex.startsWith("0x") ? keyHex : "0x" + keyHex, evmProvider(rpc));
}

export async function deployEscrow(rpc: string, keyHex: string, repoRoot: string): Promise<string> {
  const { abi, bytecode } = loadArtifact(repoRoot);
  const factory = new ContractFactory(abi, bytecode, evmWallet(rpc, keyHex));
  const c = await factory.deploy();
  await c.waitForDeployment();
  return getAddress(await c.getAddress());
}

export function escrowContract(rpc: string, keyHex: string | null, escrow: string): Contract {
  const { abi } = loadArtifact(repoRoot());
  return new Contract(escrow, abi, keyHex ? evmWallet(rpc, keyHex) : evmProvider(rpc));
}

export async function evmLock(args: {
  rpc: string; keyHex: string; escrow: string; auctionId: string; asset: string;
  amount: bigint; lot: bigint; lockUntil: number; deadline: number; signers: string[]; returnTo: string;
}): Promise<string> {
  const c = escrowContract(args.rpc, args.keyHex, args.escrow);
  const tx = await c.lock(
    args.auctionId, args.asset, args.amount, args.lot,
    args.lockUntil, args.deadline, args.signers.map(getAddress), getAddress(args.returnTo),
    args.asset === "0x0000000000000000000000000000000000000000" ? { value: args.amount } : {},
  );
  const rec = await tx.wait();
  return rec.hash;
}

export async function evmSubmitAttestation(args: {
  rpc: string; keyHex: string; escrow: string; chainId: bigint;
  fields: AttestationFields; signatures: string[];
}): Promise<string> {
  const c = escrowContract(args.rpc, args.keyHex, args.escrow);
  const tx = await c.submitAttestation(
    {
      auctionId: "0x" + Buffer.from(args.fields.auctionId).toString("hex"),
      resultHash: "0x" + Buffer.from(args.fields.resultHash).toString("hex"),
      allocationRoot: "0x" + Buffer.from(args.fields.allocationRoot).toString("hex"),
      batchIndex: args.fields.batchIndex,
      nonce: args.fields.nonce,
      expiry: args.fields.expiry,
    },
    args.signatures,
  );
  const rec = await tx.wait();
  return rec.hash;
}

// R9 item 3 (Solana's model): pay against the stored approval — crankable repeatedly; a partial
// or failed release never consumes it
export async function evmReleaseApproved(args: {
  rpc: string; keyHex: string; escrow: string; auctionId: string; batchIndex: number; payouts: EvmPayout[];
}): Promise<string> {
  const c = escrowContract(args.rpc, args.keyHex, args.escrow);
  const tx = await c.releaseApproved(
    args.auctionId,
    args.batchIndex,
    args.payouts.map((p) => ({
      index: p.index, lotCount: p.lotCount, destinationKind: p.destinationKind,
      destination: p.destination, leafCount: p.leafCount, proof: p.proof,
    })),
  );
  const rec = await tx.wait();
  return rec.hash;
}

export async function evmRefund(rpc: string, keyHex: string, escrow: string, auctionId: string): Promise<string> {
  const c = escrowContract(rpc, keyHex, escrow);
  const tx = await c.refund(auctionId);
  const rec = await tx.wait();
  return rec.hash;
}

export interface EvmStatus {
  returnTo: string; asset: string; standardLot: string; locked: string; paid: string;
  lockUntil: number; deadline: number; signers: string[]; refunded: boolean;
  batchesUsed: Record<string, boolean>; paidLeaves: Record<string, boolean>;
}

export async function evmStatus(rpc: string, escrow: string, auctionId: string, leaves: string[]): Promise<EvmStatus> {
  const c = escrowContract(rpc, null, escrow);
  const a = await c.auction(auctionId);
  const batchesUsed: Record<string, boolean> = {};
  const paidLeaves: Record<string, boolean> = {};
  for (const leaf of leaves) paidLeaves[leaf] = await c.isPaid(auctionId, leaf);
  return {
    returnTo: a[0], asset: a[1], standardLot: a[2].toString(), locked: a[3].toString(), paid: a[4].toString(),
    lockUntil: Number(a[5]), deadline: Number(a[6]), signers: [a[7], a[8], a[9]], refunded: a[10],
    batchesUsed, paidLeaves,
  };
}

export async function evmApproved(rpc: string, escrow: string, auctionId: string, batchIndex: number): Promise<boolean> {
  const c = escrowContract(rpc, null, escrow);
  return await c.isApproved(auctionId, batchIndex);
}

/** R14 item 4 (reviewer R F3): the stored approval in full, via the `approval()` view — the
 *  settled root, the attested result hash and the release window, for the result-vs-settlement
 *  comparison. */
export interface EvmApproval {
  allocationRoot: string; resultHash: string; expiry: number; exists: boolean;
}

export async function evmApproval(rpc: string, escrow: string, auctionId: string, batchIndex: number): Promise<EvmApproval> {
  const c = escrowContract(rpc, null, escrow);
  const a = await c.approval(auctionId, batchIndex);
  return { allocationRoot: a[0], resultHash: a[1], expiry: Number(a[2]), exists: a[3] };
}

export { evmTypedData };
