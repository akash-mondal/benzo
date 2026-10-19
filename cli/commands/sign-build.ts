// benzo sign build — Phase 5 part 1 §11 H6 (host custody), run ON a signer host. The coordinator holds no envelope
// key, so it cannot name refund recipients; this signer derives every row's recipient from its own data (cli/host-derive),
// creates the candidate PCZT on its own per-auction vault, proves it, and returns only {party, output_index} — the
// recipients never leave this machine. The coordinator then has every approving host (this one too) `sign approve` it.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { isUnifiedOn } from "../../envelope/destination";
import { pcztBin, ufvkFile, vaultDir } from "../../manifest/paths";
import { repoRoot } from "../../manifest/root";
import { deriveRows, deriveReserveReturn, redactCandidate, reserveCandidateVerdict } from "../host-derive";
import { onePoolRefusal } from "../../settle/build-outcome";
import { sealBlob } from "../../envelope/index";
import { SIGNER_ENVELOPE_INDEX } from "../../settle/envelopes";

export const noun = "sign", verb = "build";
export const help = "benzo sign build --id AUCTION_ID --batch N --packet DIR --name SIGNER — on a signer host: derive each allocated row's recipient from this signer's own data, create and prove the candidate PCZT on its own vault, write DIR/proven.pczt, the redacted coordinator copy DIR/proven.redacted.pczt and DIR/sealed-<signer>.bin, and print {plan_version, outputs:[{party, output_index, amount_zats}]}";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--batch", "--packet", "--name"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR sign build usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? "") && /^[0-9]+$/.test(o.batch ?? "") && ["alice", "bob", "carol"].includes(o.name ?? ""), "usage");
    process.env.BNZ_AUCTION_ID = o.id;
    const st = state(), root = repoRoot(), packet = path.resolve(o.packet);
    const meta = JSON.parse(readFileSync(path.join(packet, "packet.json"), "utf8"));
    requireThat(meta.auction_id === o.id && String(meta.batch) === o.batch, "packet is for another auction or batch");
    requireThat(Number.isInteger(meta.expiry_blocks) && meta.expiry_blocks >= 1 && meta.expiry_blocks <= 10000, "packet expiry_blocks");
    const rows: { party: string; kind: string; amount_zats: string; sources?: string[] }[] = JSON.parse(readFileSync(path.join(packet, "rows.json"), "utf8"));
    requireThat(Array.isArray(rows) && rows.length >= 1 && rows.length <= 28, "rows (1-28)"); // R30: a 28-output batch stays under 100 KB
    // B46 (H15, Revision R103): the reserve-return row is checked by this signer from its own data
    // (cli/host-derive.ts deriveReserveReturn) BEFORE the other derivations, so a packet naming a different
    // return UA, a return while the auction still owes something, or a wrong amount is refused typedly —
    // exit 3, named rows — exactly like H10's seller row.
    const declaredReserve = rows.find(r => r.party === "reserve-return") ?? null;
    const reserve = declaredReserve || (meta as any).reserve_row
      ? await deriveReserveReturn({ id: o.id, name: o.name }, st, root, packet, meta, (meta as any).reserve_row ?? declaredReserve) : null;
    if (reserve?.refusal) { process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(["reserve-return"])}: ${reserve.refusal}\n`); return 3; }
    const { expected, payout, envelopeKeys, network, sellerBinding } = await deriveRows({ id: o.id, name: o.name }, st, root, packet, meta);
    // H10 (docs/design/phase7-h10-h11.md): when the signed manifest commits the seller payout address, the
    // packet's seller_ua must hash to it — otherwise the seller row is refused, a typed refusal like the other
    // refused rows here (exit 3, named rows), never a silent pass. A manifest without the field predates H10:
    // today's amount-only behaviour stays and one WARN line says so.
    // B48 (H18 P3-1): the mismatch refuses only the seller row, and only when THIS batch has one — this
    // batch's own rows.json says so. A batch without a seller row ignores seller_ua entirely, so an
    // inconsistent config can never stall the bidder refunds this batch actually pays.
    if (sellerBinding === "mismatch" && rows.some(r => r.party === "seller")) { process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(["seller"])}: seller payout address does not match the manifest seller_ua_commitment (H10)\n`); return 3; }
    if (sellerBinding === "legacy") process.stderr.write("WARN legacy manifest: seller payout address not bound (H10)\n");
    // Each allocated row gets the recipient THIS signer derived; the seller payout goes to the operator routing UA,
    // which H10 binds to the signed manifest (checked above) — its amount is checked against the result here.
    const pool = [...expected];
    // R45 (Reviewer R F20): a derivation refusal is TYPED — every row this signer cannot derive is listed and the
    // command exits 3, so the coordinator can tell "these rows are underivable" from a transient failure (exit 1).
    const refusedRows: string[] = [];
    const payment = rows.map(r => {
      // B46 (H15, R103): the reserve-return row pays the whole unspent value minus the fee to the committed
      // return UA (the check above). B52 (P2-1): it pays the DECLARED amount — the plan's own quote of the
      // sweep — and the wallet's proposal is then checked as the transaction it is (below): a proposal that
      // would add change or pay anything but input minus the tool's fee is refused typedly before signing.
      if (r.party === "reserve-return") {
        if (!reserve?.row || typeof meta.reserve_return_ua !== "string") { refusedRows.push(r.party); return null; }
        return { party: r.party, recipient: meta.reserve_return_ua, amount_zats: r.amount_zats };
      }
      if (r.party === "seller") {
        // G-7: the routing UA is checked through the audited classifier on the manifest's OWN network (never a
        // hardcoded testnet shape)
        if (!(r.amount_zats === payout && isUnifiedOn(meta.seller_ua ?? "", network))) { refusedRows.push(r.party); return null; }
        return { party: r.party, recipient: meta.seller_ua as string, amount_zats: r.amount_zats };
      }
      const i = pool.findIndex(e => e.party === r.party && e.amount_zats === r.amount_zats);
      if (i < 0) { refusedRows.push(r.party); return null; }
      const [e] = pool.splice(i, 1);
      return { party: r.party, recipient: e.recipient, amount_zats: r.amount_zats };
    });
    if (refusedRows.length) { process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(refusedRows)}\n`); return 3; }
    const paymentRows = payment as { party: string; recipient: string; amount_zats: string }[];
    const created = path.join(packet, "created.pczt"), proven = path.join(packet, "proven.pczt");
    // B52 (Reviewer R round 4, P2-1): for the return batch the wallet's own proposal is part of the check —
    // a proposal that cannot sweep the vault (the tool's own error) or cannot balance is a TYPED refusal
    // (exit 3, ["reserve-return"]), never an untyped crash at create/inspect. Ordinary batches keep the
    // transient-error behaviour (exit 1).
    const toolTail = (e: unknown) => String((e as { stderr?: string | Buffer }).stderr ?? "").trim() || String((e as Error).message);
    try {
      execFileSync(pcztBin(root, st), ["create", vaultDir(st, o.id), created, String(meta.expiry_blocks), "--network", network], { input: JSON.stringify(paymentRows.map(p => ({ recipient: p.recipient, amount_zats: p.amount_zats }))), encoding: "utf8" });
    } catch (e) {
      if (!declaredReserve) throw e;
      process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(["reserve-return"])}: the vault's value cannot be swept in one transaction (${toolTail(e).split("\n").at(-1)?.slice(0, 200)})\n`);
      return 3;
    }
    const prove = spawnSync(path.join(st, "bin", "zcash-devtool"), ["pczt", "-w", vaultDir(st, o.id), "prove", created, "--output", proven], { encoding: "utf8", maxBuffer: 64 << 20 });
    requireThat(prove.status === 0, `prove failed: ${(prove.stderr ?? "").trim().slice(-200)}`);
    // Map each row to its output index by inspecting the proven candidate here (the builder may shuffle actions).
    let info: any;
    try {
      info = JSON.parse(execFileSync(pcztBin(root, st), ["inspect", proven, ufvkFile(st, o.id), "--network", network], { encoding: "utf8" }));
    } catch (e) {
      if (!declaredReserve) throw e;
      process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(["reserve-return"])}: the vault's value cannot be swept in one transaction (${toolTail(e).split("\n").at(-1)?.slice(0, 200)})\n`);
      return 3;
    }
    // B52 (Reviewer R round 4, P2-1): the return candidate is checked as the TRANSACTION it is, never
    // against a predicted fee — input_zats is this signer's scanned unspent total, exactly one output, not
    // change, to the committed return UA, that output is input_zats minus fee_zats (inspect's own figures),
    // and the declared row amount equals it (cli/host-derive.ts reserveCandidateVerdict).
    if (declaredReserve) {
      const why = reserveCandidateVerdict(info, meta.reserve_return_ua, reserve?.row?.remaining_zats, declaredReserve.amount_zats);
      if (why) { process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(["reserve-return"])}: ${why}\n`); return 3; }
    }
    const avail = (info.outputs ?? []).filter((x: any) => !x.is_change);
    const outputs = paymentRows.map(p => {
      const k = avail.findIndex((x: any) => x.recipient === p.recipient && String(x.amount_zats) === p.amount_zats);
      requireThat(k >= 0, `built candidate lacks the output for ${p.party}`);
      const [x] = avail.splice(k, 1);
      return { party: p.party, output_index: x.index, pool: x.pool, amount_zats: p.amount_zats };
    });
    // H3 (B50): the one-pool rule (R81) on the host build path as a typed refusal (exit 3, named rows) —
    // exactly like H10's seller row. The named rows are the minority pool's: they wait in the exception
    // queue and re-derive on the next settle, and the batch's other rows settle next. A batch whose
    // payments span two pools cannot attribute receipts by {party, output_index} (a per-pool action index).
    const namedPools = onePoolRefusal(outputs.map(o => ({ party: o.party, pool: String(o.pool) })));
    if (namedPools.length) {
      process.stderr.write(`ERROR sign build refused-rows ${JSON.stringify(namedPools)}: the candidate pays more than one pool (one-pool rule, R81); these rows wait in the exception queue and re-derive on the next settle\n`);
      return 3;
    }
    // §11 H7: the coordinator gets only the redacted candidate; the full one goes to each signer sealed to the envelope
    // key the verified manifest pins for it (the coordinator relays blobs it cannot open).
    const redacted = path.join(packet, "proven.redacted.pczt");
    redactCandidate(st, proven, redacted, info);
    requireThat(Array.isArray(envelopeKeys) && envelopeKeys.length === 3, "manifest pins no three envelope keys");
    for (const [n, i] of Object.entries(SIGNER_ENVELOPE_INDEX)) writeFileSync(path.join(packet, `sealed-${n}.bin`), sealBlob(readFileSync(proven), envelopeKeys[i]), { mode: 0o600 });
    // Ruling R28 item 6 (F5): only the redacted copy and the sealed copies stay on disk.
    rmSync(created, { force: true }); rmSync(proven, { force: true });
    const result = { auction_id: o.id, batch: Number(o.batch), builder: o.name, plan_version: sha(readFileSync(redacted)), outputs };
    writeFileSync(path.join(packet, "build.json"), JSON.stringify(result) + "\n", { mode: 0o600 });
    return result;
  } catch (e) {
    process.stderr.write(`ERROR sign build ${(e as Error).message}\n`);
    return 1;
  }
}
