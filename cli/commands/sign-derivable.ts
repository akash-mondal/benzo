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
    // auction owes nothing, and paying the vault's whole unspent value minus the ZIP-317 fee. A packet that
    // DECLARES the return row and carries a return UA that does not hash to the manifest commitment is
    // refused typedly (exit 3, named rows) exactly like H10's seller row.
    // B51 (P2-1b): R107's rule reaches the listing too — an ordinary packet (one that declares NO return
    // row) is never walled by a mismatched reserve_return_ua. Every other row is listed and only the
    // reserve-return row is left out, tagged as refused in the JSON output. Before this, a stale routing
    // reserve_return_ua refused the whole listing on every host and stalled the whole settlement.
    const reserve = await deriveReserveReturn({ id: o.id, name: o.name }, state(), repoRoot(), packet, meta, (meta as any).reserve_row ?? null);
    const reserveRefused: string[] = [], refusedReasons: Record<string, string> = {};
    if (reserve.refusal) {
      if ((meta as any).reserve_row) { process.stderr.write(`ERROR sign derivable refused-rows ${JSON.stringify(["reserve-return"])}: ${reserve.refusal}\n`); return 3; }
      reserveRefused.push("reserve-return");
      // P3-4 (B52): the refusal's TRUE reason travels with the top-level refused_rows tag, so the
      // coordinator parks the reserve row with it (never "claimable through benzo claim-refund").
      refusedReasons["reserve-return"] = reserve.refusal;
    }
    const { expected, payout, balanceRefunds, sellerBinding, refusedRows } = await deriveRows({ id: o.id, name: o.name }, state(), repoRoot(), packet, meta);
    // H10 (docs/design/phase7-h10-h11.md): when the signed manifest commits the seller payout address, the
    // packet's seller_ua must hash to it — otherwise the seller row is refused, never a silent pass. A
    // manifest without the field predates H10: the row is listed as before and one WARN line says the
    // address is not bound.
    // B48 (H18 P3-1): the mismatch refuses only the seller row, and only when this listing has one.
    // H21 (B50): it no longer refuses the LISTING — the refund rows list (and pay at settle) while only the
    // seller row is tagged refused (typed: the named row carries `refused: true` and its reason), so an
    // inconsistent seller config can never stall the refunds at settle again (B48 Q2).
    const sellerRefused = sellerBinding === "mismatch" && payout !== "0" && typeof meta.seller_ua === "string";
    if (sellerRefused) process.stderr.write("WARN sign derivable seller row refused (H10): seller payout address does not match the manifest seller_ua_commitment; the refund rows still list\n");
    if (sellerBinding === "legacy") process.stderr.write("WARN legacy manifest: seller payout address not bound (H10)\n");
    const rows: any[] = expected.map(e => ({ party: e.party, amount_zats: e.amount_zats }));
    if (payout !== "0" && typeof meta.seller_ua === "string")
      rows.push(sellerRefused
        ? { party: "seller", amount_zats: payout, refused: true, reason: "seller payout address does not match the manifest seller_ua_commitment (H10)" }
        : { party: "seller", amount_zats: payout });
    // B46 (H15): list the reserve-return row when this signer derives one (party name and amount, no
    // recipient).
    if (reserve.row) rows.push({ party: reserve.row.party, amount_zats: reserve.row.amount_zats });
    // Ruling R40 item 2 (F2): this host's own per-note late-refund counts (party names and amounts, no
    // recipients and no addresses) — the same derivation the plan publishes as settlement.balance_refunds.
    // B51: a refused-but-not-declared reserve-return row is tagged here (the listing format allows it).
    // B55 (M1): every pre-R cancelled deposit row that waits rides the listing with its reason — the H21
    // per-row refused tag AND the top-level refused_rows/refused_reasons (the same surfaces the reserve
    // refusal uses) — so the coordinator parks each one with the true reason instead of allocating it.
    for (const r of refusedRows) rows.push({ party: r.party, amount_zats: r.amount_zats, refused: true, reason: r.reason });
    const refusedAll = [...reserveRefused, ...refusedRows.map(r => r.party)];
    const refusedWhy = { ...refusedReasons, ...Object.fromEntries(refusedRows.map(r => [r.party, r.reason])) };
    return { auction_id: o.id, name: o.name, rows, balance_refunds: balanceRefunds, ...(refusedAll.length ? { refused_rows: refusedAll, refused_reasons: refusedWhy } : {}) };
  } catch (e) {
    process.stderr.write(`ERROR sign derivable ${(e as Error).message}\n`);
    return 1;
  }
}
