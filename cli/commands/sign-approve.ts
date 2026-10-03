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
import { authenticatedMemoEnvelope, openDestination, ownEnvelopePrivate, requireOwnEnvelopeKey, validEnvelope } from "../../settle/envelopes";
import { depositParty, refundable, strayNotes } from "../../settle/deposits";

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

    // 1. The full public check on the packet's directory (the same code as `benzo verify`).
    const verify = spawnSync(process.execPath, [process.argv[1], "verify", "--dir", publicDir, "--signer", meta.signer], { encoding: "utf8", env: process.env });
    requireThat(verify.status === 0, `public check failed: ${(verify.stdout + verify.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 3).join(" | ") || `exit ${verify.status}`}`);
    const pub = loadPublicAuction(publicDir, { signer: meta.signer });
    requireThat(pub.manifest.auction_id === o.id && pub.result && pub.frozen, "packet holds no cleared result for this auction");

    // 2. Every payable row, derived by this signer.
    const key = ownEnvelopePrivate(st, o.name);
    requireThat(key, "this signer's envelope key is missing");
    requireOwnEnvelopeKey(pub.manifest as any, o.name, st); // R10 item 3, checked here under host custody
    const tle = path.join(st, "bin", "tle");
    const opened = pub.frozen!.leaves.map((l: any) => {
      const pt = tleDecryptFailover(tle, QUICKNET.chain_hash, Buffer.from(l.ciphertext_hex, "hex"));
      return { leaf_index: l.leaf_index, plaintext_hex: pt ? pt.toString("hex") : null };
    });
    const ownerOf = (i: number) => { const p = opened.find(x => x.leaf_index === i)?.plaintext_hex; return p ? Buffer.from(p, "hex").subarray(61, 93).toString("hex") : null; };
    const view = { manifest: pub.manifestPacket, frozen: pub.frozen, opened, envelopes: pub.envelopes };
    const claims: any[] = existsSync(path.join(packet, "claims.json")) ? JSON.parse(readFileSync(path.join(packet, "claims.json"), "utf8")) : [];
    const claimDest = (party: string, owner: string | null): string | null => {
      for (const c of claims.filter(c => c.party === party)) {
        try {
          const body = { kind: "claim-refund", auction_id: o.id, party, claim_envelope_sha256: sha(Buffer.from(c.claim_envelope_ct, "hex")) };
          if (owner && verifyStatement(owner, body, c.owner_sig)) { const d = openDestination({ envelope_ct: c.claim_envelope_ct } as any, key!); if (d) return d; }
        } catch { /* an invalid claim is skipped, never fatal */ }
      }
      return null;
    };
    const expected: { party: string; recipient: string; amount_zats: string }[] = [];
    for (const a of (pub.result as any).allocations ?? []) {
      if (!(BigInt(a.refund_zats ?? "0") > 0n)) continue;
      const party = `leaf:${a.leaf_index}`;
      const rec = validEnvelope(view, a.leaf_index);
      const dest = claimDest(party, ownerOf(a.leaf_index)) ?? (rec ? openDestination(rec, key!) : null);
      if (dest) expected.push({ party, recipient: dest, amount_zats: String(a.refund_zats) });
    }
    // Strays from this signer's own scan of its own per-auction vault (synced and enhanced here, so memos are present).
    const devtool = path.join(st, "bin", "zcash-devtool"), lwd = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
    for (const verb of ["sync", "enhance"]) {
      for (let attempt = 1; ; attempt++) {
        const r = spawnSync(devtool, ["wallet", "-w", vaultDir(st, o.id), verb, "-s", lwd], { encoding: "utf8" });
        if (r.status === 0) break;
        requireThat(attempt < 4 && /newer than the latest block|past the valid range|Internal|Unavailable|backing node/.test(r.stderr ?? ""), `vault ${verb} failed: ${(r.stderr ?? "").trim().slice(-160)}`);
        await new Promise(res => setTimeout(res, 5000 * attempt));
      }
    }
    const notes = execFileSync(scanBin(root, st), ["scan", "test", vaultDir(st, o.id)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
    const deposits = notes.filter((n: any) => pub.manifest.deposit_addresses.includes(n.address));
    for (const n of refundable(strayNotes(deposits, pub.manifest.deposit_addresses, pub.frozen) as any).payable as any[]) {
      const party = depositParty(n);
      const rec = authenticatedMemoEnvelope(deposits as any, party, pub.manifestPacket, pub.envelopes, tle);
      const dest = (rec ? openDestination(rec, key!) : null);
      if (dest) expected.push({ party, recipient: dest, amount_zats: String(n.value_zats) });
    }
    const payout = String((pub.result as any).conservation?.payout_zats ?? "0");

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
