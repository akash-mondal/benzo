// Shared by `benzo sign approve` and `benzo sign build` (§11 H3/H6, signer hosts): the full public check on a packet's
// public dir, then every payable row derived from THIS signer's own data — fresh tlock openings from the published
// beacon, its own envelope key (claim envelopes first), its own per-auction vault scan for strays — plus the seller
// payout amount from the result. No recipient ever comes from the coordinator.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { QUICKNET, requireThat } from "../manifest/schema";
import { tleDecryptFailover } from "../manifest/reserve";
import { scanBin, vaultDir } from "../manifest/paths";
import { loadPublicAuction } from "../api/public-auction";
import { verifyStatement } from "../envelope/index";
import { authenticatedMemoEnvelope, openDestination, ownEnvelopePrivate, requireOwnEnvelopeKey, validEnvelope } from "../settle/envelopes";
import { depositParty, refundable, strayNotes } from "../settle/deposits";
import { treasuryFunded, treasuryReturn } from "../clear/mode-b";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// This machine's own view of the auction's vault: sync and enhance it against its own lightwalletd (transient errors
// retried), then scan it. Used by host approvals/builds and by witnesses recomputing the frozen root (design §5).
export async function ownScan(st: string, root: string, id: string): Promise<any[]> {
  const devtool = path.join(st, "bin", "zcash-devtool"), lwd = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
  for (const verb of ["sync", "enhance"]) {
    for (let attempt = 1; ; attempt++) {
      const r = spawnSync(devtool, ["wallet", "-w", vaultDir(st, id), verb, "-s", lwd], { encoding: "utf8" });
      if (r.status === 0) break;
      requireThat(attempt < 4 && /newer than the latest block|past the valid range|Internal|Unavailable|backing node/.test(r.stderr ?? ""), `vault ${verb} failed: ${(r.stderr ?? "").trim().slice(-160)}`);
      await new Promise(res => setTimeout(res, 5000 * attempt));
    }
  }
  return execFileSync(scanBin(root, st), ["scan", "test", vaultDir(st, id)], { encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}
export type DerivedRow = { party: string; recipient: string; amount_zats: string };
export async function deriveRows(o: { id: string; name: string }, st: string, root: string, packet: string, meta: { signer: string }): Promise<{ expected: DerivedRow[]; payout: string; envelopeKeys: string[] }> {
    const publicDir = path.join(packet, "public");
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
    // Design §6.1: a buyback leaf is owed its exact-C refund plus its payment (obligationsModeB); Mode A leaves are
    // owed the refund and the payments go to the seller row.
    const buyback = (pub.manifest as any).clearing?.mode === "buyback";
    for (const a of (pub.result as any).allocations ?? []) {
      const owed = BigInt(a.refund_zats ?? "0") + (buyback ? BigInt(a.payment_zats ?? "0") : 0n);
      if (!(owed > 0n)) continue;
      const party = `leaf:${a.leaf_index}`;
      const rec = validEnvelope(view, a.leaf_index);
      const dest = claimDest(party, ownerOf(a.leaf_index)) ?? (rec ? openDestination(rec, key!) : null);
      if (dest) expected.push({ party, recipient: dest, amount_zats: owed.toString() });
    }
    // Strays from this signer's own scan of its own per-auction vault (synced and enhanced here, so memos are present).
    const notes = await ownScan(st, root, o.id);
    const deposits = notes.filter((n: any) => pub.manifest.deposit_addresses.includes(n.address));
    for (const n of refundable(strayNotes(deposits, pub.manifest.deposit_addresses, pub.frozen) as any).payable as any[]) {
      const party = depositParty(n);
      const rec = authenticatedMemoEnvelope(deposits as any, party, pub.manifestPacket, pub.envelopes, tle);
      const dest = (rec ? openDestination(rec, key!) : null);
      if (dest) expected.push({ party, recipient: dest, amount_zats: String(n.value_zats) });
    }
    // A buyback has no seller row (winners are paid on their leaves); its treasury return is derived here from the
    // signed treasury_ua/funding_ua and this signer's own scan.
    const payout = buyback ? "0" : String((pub.result as any).conservation?.payout_zats ?? "0");
    if (buyback) {
      const back = treasuryReturn(pub.manifest as any, pub.result as any, treasuryFunded(pub.manifest as any, notes));
      if (back > 0n) expected.push({ party: "treasury", recipient: (pub.manifest as any).buyback.treasury_ua, amount_zats: back.toString() });
    }

    return { expected, payout, envelopeKeys: (pub.manifest as any).envelope_keys };
}

// §11 H7: the coordinator's copy of a candidate — every non-change output's recipient, rseed, ock, user address and
// derivation redacted with zcash-devtool `pczt redact` (deterministic: each approving host recomputes it from the full
// candidate sealed to it and requires the same bytes). Sighash and extraction need none of those fields.
export function redactCandidate(st: string, full: string, out: string, info: { outputs: { index: number; pool: string; is_change: boolean }[] }): void {
  const keys = info.outputs.filter(x => !x.is_change).flatMap(x => ["recipient", "rseed", "ock", "user_address", "zip32_derivation"].flatMap(f => ["-k", `${x.pool}.action.${x.index}.output.${f}`]));
  requireThat(keys.length > 0, "candidate has no output to redact");
  execFileSync(path.join(st, "bin", "zcash-devtool"), ["pczt", "redact", ...keys, full, "--output", out], { stdio: ["ignore", "ignore", "pipe"] });
}
