// benzo sign derivable — Reviewer G's G-5 (liveness), run ON a signer host before the coordinator allocates batches:
// which rows can THIS signer derive from its own data (the same deriveRows as build/approve)? It prints party names
// and amounts only, never a recipient, so the coordinator pins the rest to the exception queue with a reason instead of
// allocating a row no host can build (which used to deadlock the batch).
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { repoRoot } from "../../manifest/root";
import { deriveRows } from "../host-derive";

export const noun = "sign", verb = "derivable";
export const help = "benzo sign derivable --id AUCTION_ID --packet DIR --name SIGNER — on a signer host: list the {party, amount_zats} rows this signer derives from its own data (no recipients)";
const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--packet", "--name"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR sign derivable usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? "") && ["alice", "bob", "carol"].includes(o.name ?? ""), "usage");
    process.env.BNZ_AUCTION_ID = o.id;
    const packet = path.resolve(o.packet), meta = JSON.parse(readFileSync(path.join(packet, "packet.json"), "utf8"));
    requireThat(meta.auction_id === o.id, "packet is for another auction");
    const { expected, payout, balanceRefunds } = await deriveRows({ id: o.id, name: o.name }, state(), repoRoot(), packet, meta);
    const rows = expected.map(e => ({ party: e.party, amount_zats: e.amount_zats }));
    if (payout !== "0" && typeof meta.seller_ua === "string") rows.push({ party: "seller", amount_zats: payout });
    // Ruling R40 item 2 (F2): this host's own per-note late-refund counts (party names and amounts, no
    // recipients and no addresses) — the same derivation the plan publishes as settlement.balance_refunds.
    return { auction_id: o.id, name: o.name, rows, balance_refunds: balanceRefunds };
  } catch (e) {
    process.stderr.write(`ERROR sign derivable ${(e as Error).message}\n`);
    return 1;
  }
}
