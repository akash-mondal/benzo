// benzo sign approve — Phase 5 part 1 §11 H3 (gate Y, R3 item 8), run ON a signer host for one batch attempt.
// The coordinator delivers a packet (the published public dir, the recorded claims, the proven candidate PCZT and
// its plan_version = SHA-256(candidate)); this signer then decides from its OWN data only:
//   1. the full public check (`benzo verify`) on the packet's dir must pass;
//   2. it derives every payable row itself — leaves from the published result and its own fresh tlock openings,
//      destinations through ITS OWN envelope key (claim envelopes first), strays from ITS OWN vault scan — and the
//      seller payout amount from the result;
//   3. every non-change output of the candidate must be one of those (recipient, amount) rows (change returns to
//      the vault); the seller payout is checked by amount only (its destination is operator routing — stated limit);
//   4. it computes the sighash itself with zcash-sign.
// Only then it records approvals/<id>/batch-<n>.json {plan_version, sighash}; `benzo sign join` signs nothing else.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { QUICKNET, requireThat } from "../../manifest/schema";
import { tleDecryptFailover } from "../../manifest/reserve";
import { pcztBin, scanBin, ufvkFile, vaultDir } from "../../manifest/paths";
import { repoRoot } from "../../manifest/root";
import { loadPublicAuction } from "../../api/public-auction";
import { verifyStatement } from "../../envelope/index";
import { deriveRows } from "../host-derive";

export const noun = "sign", verb = "approve";
export const help = "benzo sign approve --id AUCTION_ID --batch N --packet DIR --name SIGNER — on a signer host: verify the packet's public dir, derive every payable row from this signer's own openings, envelope key and vault scan, check the candidate PCZT against them, compute the sighash, record the approval";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");

async function sighashOf(zcashSign: string, network: string, candidate: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(zcashSign, ["sign", "-n", network, "-i", candidate, "-o", path.join(os.tmpdir(), `benzo-approve-${process.pid}.pczt`)], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const done = (v: string | null, e?: Error) => { p.kill(); v ? resolve(v) : reject(e ?? new Error("zcash-sign printed no SIGHASH")); };
    p.stdout!.on("data", d => { out += d; const m = out.match(/^SIGHASH: ([0-9a-f]{64})$/m); if (m) done(m[1]); });
    p.on("error", e => done(null, e));
    p.on("close", () => { const m = out.match(/^SIGHASH: ([0-9a-f]{64})$/m); m ? resolve(m[1]) : reject(new Error("zcash-sign printed no SIGHASH")); });
  });
}

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--batch", "--packet", "--name"].includes(argv[i]) || argv[i + 1] === undefined) { process.stderr.write(`ERROR sign approve usage: ${help}\n`); return 2; }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? ""), "auction id");
    requireThat(/^[0-9]+$/.test(o.batch ?? ""), "batch");
    requireThat(["alice", "bob", "carol"].includes(o.name ?? ""), "signer name");
    process.env.BNZ_AUCTION_ID = o.id;
    const st = state(), root = repoRoot(), packet = path.resolve(o.packet);
    const meta = JSON.parse(readFileSync(path.join(packet, "packet.json"), "utf8"));
    requireThat(meta.auction_id === o.id && String(meta.batch) === o.batch, "packet is for another auction or batch");
    const candidate = path.join(packet, "candidate.pczt"), publicDir = path.join(packet, "public");
    const planVersion = sha(readFileSync(candidate));
    requireThat(meta.plan_version === planVersion, "candidate PCZT differs from the packet's plan_version");

    // 1–2. Public check and every payable row, derived by this signer (cli/host-derive.ts).
    const { expected, payout } = await deriveRows({ id: o.id, name: o.name }, st, root, packet, meta);
    // 3. The candidate's outputs must be exactly rows this signer derived (change returns to the vault).
    const info = JSON.parse(execFileSync(pcztBin(root, st), ["inspect", candidate, ufvkFile(st, o.id)], { encoding: "utf8" }));
    const pool = [...expected];
    let sellerSeen = false;
    const outputs = (info.outputs ?? []).filter((x: any) => !x.is_change);
    requireThat(outputs.length > 0, "candidate pays nobody");
    for (const out of outputs) {
      const i = pool.findIndex(e => e.recipient === out.recipient && e.amount_zats === String(out.amount_zats));
      if (i >= 0) { pool.splice(i, 1); continue; }
      if (!sellerSeen && payout !== "0" && String(out.amount_zats) === payout) { sellerSeen = true; continue; }
      throw new Error(`output ${out.index} (${String(out.amount_zats)} zats) is not a row this signer derived`);
    }

    // 4. The sighash, computed here.
    const sighash = await sighashOf(path.join(st, "bin", "zcash-sign"), process.env.BNZ_NETWORK ?? "test", candidate);
    const approval = { auction_id: o.id, batch: Number(o.batch), name: o.name, plan_version: planVersion, sighash, outputs: outputs.length, approved_at: Math.floor(Date.now() / 1000) };
    const dir = path.join(st, "approvals", o.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dir, `batch-${o.batch}.json`), JSON.stringify(approval) + "\n", { mode: 0o600 });
    return approval;
  } catch (e) {
    process.stderr.write(`ERROR sign approve ${(e as Error).message}\n`);
    return 1;
  }
}
