// benzo sign derivable — Reviewer G's G-5 (liveness), run ON a signer host before the coordinator allocates batches:
// which rows can THIS signer derive from its own data (the same deriveRows as build/approve)? It prints party names
// and amounts only, never a recipient, so the coordinator pins the rest to the exception queue with a reason instead of
// allocating a row no host can build (which used to deadlock the batch).
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { repoRoot } from "../../manifest/root";
import { deriveRows, deriveReserveReturn } from "../host-derive";

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
    // B46 (H15, Revision R103): the reserve-return row this signer derives — planned alone, only when the
    // auction owes nothing, and paying the vault's whole unspent value minus the ZIP-317 fee. Checked first:
    // a packet whose return UA does not hash to the manifest commitment is refused typedly (exit 3, named
    // rows) exactly like H10's seller row.
    const reserve = await deriveReserveReturn({ id: o.id, name: o.name }, state(), repoRoot(), packet, meta, null);
    if (reserve.refusal) { process.stderr.write(`ERROR sign derivable refused-rows ${JSON.stringify(["reserve-return"])}: ${reserve.refusal}\n`); return 3; }
    const { expected, payout, balanceRefunds, sellerBinding } = await deriveRows({ id: o.id, name: o.name }, state(), repoRoot(), packet, meta);
    // H10 (docs/design/phase7-h10-h11.md): when the signed manifest commits the seller payout address, the
    // packet's seller_ua must hash to it — otherwise the seller row is refused, a typed refusal (named rows,
    // exit 3), never a silent pass. A manifest without the field predates H10: the row is listed as before and
    // one WARN line says the address is not bound.
    // B48 (H18 P3-1): the mismatch refuses only the seller row, and only when this listing has one — the
    // listing below carries a seller row exactly when the auction owes the seller and the packet names a
    // seller_ua. A listing without a seller row ignores seller_ua entirely, so an inconsistent config can
    // never stall the refund rows this signer does derive.
    if (sellerBinding === "mismatch" && payout !== "0" && typeof meta.seller_ua === "string") { process.stderr.write(`ERROR sign derivable refused-rows ${JSON.stringify(["seller"])}: seller payout address does not match the manifest seller_ua_commitment (H10)\n`); return 3; }
    if (sellerBinding === "legacy") process.stderr.write("WARN legacy manifest: seller payout address not bound (H10)\n");
    const rows = expected.map(e => ({ party: e.party, amount_zats: e.amount_zats }));
    if (payout !== "0" && typeof meta.seller_ua === "string") rows.push({ party: "seller", amount_zats: payout });
    // B46 (H15): list the reserve-return row when this signer derives one (party name and amount, no
    // recipient).
    if (reserve.row) rows.push({ party: reserve.row.party, amount_zats: reserve.row.amount_zats });
    // Ruling R40 item 2 (F2): this host's own per-note late-refund counts (party names and amounts, no
    // recipients and no addresses) — the same derivation the plan publishes as settlement.balance_refunds.
    return { auction_id: o.id, name: o.name, rows, balance_refunds: balanceRefunds };
  } catch (e) {
    process.stderr.write(`ERROR sign derivable ${(e as Error).message}\n`);
    return 1;
  }
}
