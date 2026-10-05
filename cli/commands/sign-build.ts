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
import { pcztBin, ufvkFile, vaultDir } from "../../manifest/paths";
import { repoRoot } from "../../manifest/root";
import { deriveRows, redactCandidate } from "../host-derive";
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
    const rows: { party: string; kind: string; amount_zats: string }[] = JSON.parse(readFileSync(path.join(packet, "rows.json"), "utf8"));
    requireThat(Array.isArray(rows) && rows.length >= 1 && rows.length <= 13, "rows (1-13)");
    const { expected, payout, envelopeKeys } = await deriveRows({ id: o.id, name: o.name }, st, root, packet, meta);
    // Each allocated row gets the recipient THIS signer derived; the seller payout goes to the operator routing UA
    // (stated limit: hosts check its amount against the result, not its address).
    const pool = [...expected];
    const payment = rows.map(r => {
      if (r.party === "seller") {
        requireThat(r.amount_zats === payout && /^utest1[0-9a-z]+$/.test(meta.seller_ua ?? ""), "seller row differs from the result payout or has no routing UA");
        return { party: r.party, recipient: meta.seller_ua as string, amount_zats: r.amount_zats };
      }
      const i = pool.findIndex(e => e.party === r.party && e.amount_zats === r.amount_zats);
      requireThat(i >= 0, `row ${r.party} (${r.amount_zats} zats) is not one this signer derived`);
      const [e] = pool.splice(i, 1);
      return { party: r.party, recipient: e.recipient, amount_zats: r.amount_zats };
    });
    const created = path.join(packet, "created.pczt"), proven = path.join(packet, "proven.pczt");
    execFileSync(pcztBin(root, st), ["create", vaultDir(st, o.id), created, String(meta.expiry_blocks)], { input: JSON.stringify(payment.map(p => ({ recipient: p.recipient, amount_zats: p.amount_zats }))), encoding: "utf8" });
    const prove = spawnSync(path.join(st, "bin", "zcash-devtool"), ["pczt", "-w", vaultDir(st, o.id), "prove", created, "--output", proven], { encoding: "utf8", maxBuffer: 64 << 20 });
    requireThat(prove.status === 0, `prove failed: ${(prove.stderr ?? "").trim().slice(-200)}`);
    // Map each row to its output index by inspecting the proven candidate here (the builder may shuffle actions).
    const info = JSON.parse(execFileSync(pcztBin(root, st), ["inspect", proven, ufvkFile(st, o.id)], { encoding: "utf8" }));
    const avail = (info.outputs ?? []).filter((x: any) => !x.is_change);
    const outputs = payment.map(p => {
      const k = avail.findIndex((x: any) => x.recipient === p.recipient && String(x.amount_zats) === p.amount_zats);
      requireThat(k >= 0, `built candidate lacks the output for ${p.party}`);
      const [x] = avail.splice(k, 1);
      return { party: p.party, output_index: x.index, pool: x.pool, amount_zats: p.amount_zats };
    });
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
