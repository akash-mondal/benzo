// Shared by `benzo sign approve` and `benzo sign build` (§11 H3/H6, signer hosts): the full public check on a packet's
// public dir, then every payable row derived from THIS signer's own data — fresh tlock openings from the published
// beacon, its own envelope key (claim envelopes first), its own per-auction vault scan for strays — plus the seller
// payout amount from the result. No recipient ever comes from the coordinator.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUICKNET, jsonBytes, requireThat, sellerUaCommitment } from "../manifest/schema";
import { fetchVerifiedBeacon, publishedClient } from "../cli/published-beacon";
import { openSealedBid } from "../envelope/opening";
import { beaconSha256, loadOpenings, saveOpenings } from "./openings-cache";
import type { ChainClient } from "tlock-js";
import { pcztBin, scanBin, ufvkFile, vaultDir } from "../manifest/paths";
import { loadPublicAuction } from "../api/public-auction";
import { openEnvelopeRefundUnchecked, verifyStatement } from "../envelope/index";
import { classifyAddresses, useClassifyCache, type Classified } from "../envelope/destination";
import { Destination, authenticatedMemoEnvelope, memoSealedBid, openDestination, ownEnvelopePrivate, requireOwnEnvelopeKey, validEnvelope } from "../settle/envelopes";
import { depositParty, isSlotCollision, refundable, strayNotes } from "../settle/deposits";
import { treasuryBlock, treasuryFunded, treasuryRequired, treasuryReturn } from "../clear/mode-b";
import { balanceAddressMap, balanceDefaults, balanceSettlement, balanceWindow, bondVoidAt, isRefundRowParty, type BalanceRefund } from "../clear/features";
import { blockHeader, chainTip } from "./host-chain";
import { recomputeFrozen } from "../witness/recompute";
import { modeEntry } from "../clear/registry";
import { lwdBound, lwdTimedOut } from "../settle/bounded";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// This machine's own view of the auction's vault: sync and enhance it against its own lightwalletd (transient errors
// retried), then scan it. Used by host approvals/builds and by witnesses recomputing the frozen root (design §5).
export async function ownScan(st: string, root: string, id: string, net: string): Promise<any[]> {
  const devtool = path.join(st, "bin", "zcash-devtool"), lwd = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
  for (const verb of ["sync", "enhance"]) {
    for (let attempt = 1; ; attempt++) {
      const args = ["wallet", "-w", vaultDir(st, id), verb, "-s", lwd];
      const r = spawnSync(devtool, args, { encoding: "utf8", ...lwdBound(devtool, args) });
      if (r.status === 0) break;
      const err = lwdTimedOut(devtool, r)?.message ?? r.stderr ?? ""; // R48: a stalled stream is transient
      requireThat(attempt < 4 && /newer than the latest block|past the valid range|Internal|Unavailable|backing node|stalled lightwalletd stream|NonSequentialBlocks/.test(err), `vault ${verb} failed: ${err.trim().slice(-160)}`);
      await new Promise(res => setTimeout(res, 5000 * attempt));
    }
  }
  return execFileSync(scanBin(root, st), ["scan", net, vaultDir(st, id)], { encoding: "utf8", maxBuffer: 64 << 20 }).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}
// `source` is the vault note (or sink) a row pays from (Ruling R28 item 3): a leaf is keyed by its frozen deposit's note,
// a deposit by itself, so one deposit can never be approved twice under two party names.
export type DerivedRow = { party: string; recipient: string; amount_zats: string; source: string };

// Ruling R28 item 1/5 (F1, F4): before deriving anything, bind the packet to THIS host's custody of THIS auction:
//   - the manifest is signed by the operator key pinned on this host at provisioning (state/operator-signer.txt);
//   - the first manifest this host sees for the auction is pinned (state/auctions/<id>/manifest.sha256), any other refused;
//   - its frost_group_key is this host's own DKG key, the vault UFVK's ak equals it, and every manifest address
//     (escrow, deposits, buyback funding) is an external address of that vault.
export function custodyBinding(id: string, st: string, root: string, pub: any, signer: string): void {
  const pin = path.join(st, "operator-signer.txt");
  if (existsSync(pin)) requireThat(signer === readFileSync(pin, "utf8").trim(), "manifest is not signed by this host's pinned operator key");
  const adir = path.join(st, "auctions", id), gk = path.join(adir, "group-key.txt"), mh = path.join(adir, "manifest.sha256");
  requireThat(existsSync(gk), "this host holds no DKG share for this auction");
  const group = readFileSync(gk, "utf8").trim(), m = pub.manifest;
  requireThat(m.frost_group_key === group, "manifest frost_group_key is not this host's DKG group key");
  requireThat(execFileSync(pcztBin(root, st), ["ufvk-ak", ufvkFile(st, id), "--network", m.network], { encoding: "utf8" }).trim() === group, "vault UFVK is not this auction's group key");
  for (const a of [m.escrow_ua, ...m.deposit_addresses, ...(treasuryBlock(m) ? [treasuryBlock(m)!.funding_ua] : [])])
    requireThat(execFileSync(pcztBin(root, st), ["owns", ufvkFile(st, id), a, "--network", m.network], { encoding: "utf8" }).trim() === "external", `manifest address ${String(a).slice(0, 16)}… is not this vault's`);
  if (existsSync(mh)) requireThat(readFileSync(mh, "utf8").trim() === pub.manifest_hash, "a different manifest is pinned for this auction on this host");
  else { mkdirSync(adir, { recursive: true, mode: 0o700 }); writeFileSync(mh, pub.manifest_hash + "\n", { mode: 0o600 }); }
}

export async function deriveRows(o: { id: string; name: string }, st: string, root: string, packet: string, meta: { signer: string; seller_ua?: unknown }): Promise<{ expected: DerivedRow[]; payout: string; envelopeKeys: string[]; network: string; balanceSources: string[]; defaults: number[]; balanceRefunds: BalanceRefund[]; strays: import("../witness").StrayAttestation[] ; bondVoid: boolean; bondStart: import("./host-chain").BlockHeader | null; sellerBinding: "bound" | "legacy" | "mismatch"}> {
    const publicDir = path.join(packet, "public");
    // 1. The full public check on the packet's directory (the same code as `benzo verify`), or, for an auction that was
    // never frozen, the signed manifest plus the rule that makes it cancelled: freeze must precede the signed T_freeze,
    // so no frozen root after T_freeze means CANCELLED.
    const pub = loadPublicAuction(publicDir, { signer: meta.signer }); // verifies the manifest signature
    requireThat(pub.manifest.auction_id === o.id, "packet is for another auction");
    custodyBinding(o.id, st, root, pub, meta.signer);
    // B43 (H13 items 4-5): this host's own openings cache under its own per-auction state dir (written after
    // every successful derivation below, and reused only when its frozen root AND beacon key match this
    // packet — never packet input). The internal `benzo verify` gets the same file through its host-only
    // --openings-cache flag, so a re-run skips re-decrypting the leaves this host already opened.
    const cacheDir = path.join(st, "auctions", o.id);
    const leafCacheFile = path.join(cacheDir, "openings.json"), memoCacheFile = path.join(cacheDir, "memo-openings.json");
    if (pub.frozen) {
      const verify = spawnSync(process.execPath, [process.argv[1], "verify", "--dir", publicDir, "--signer", meta.signer, "--openings-cache", leafCacheFile], { encoding: "utf8", env: process.env });
      requireThat(verify.status === 0, `public check failed: ${(verify.stdout + verify.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 3).join(" | ") || `exit ${verify.status}`}`);
    } else requireThat(Date.now() / 1000 > pub.manifest.T_freeze, "an unfrozen auction before T_freeze is not cancelled; refusing");
    // Ruling R28 item 2 (G-3): a frozen root this host has seen (as a witness, or in an earlier packet) is pinned; a packet
    // without it, or with another root, is refused — a frozen auction can't be turned into a "cancelled" one.
    const rootPin = path.join(st, "auctions", o.id, "frozen-root.txt");
    if (existsSync(rootPin)) requireThat(pub.frozen?.root === readFileSync(rootPin, "utf8").trim(), "packet lacks the frozen root this host pinned for the auction");
    else if (pub.frozen) writeFileSync(rootPin, pub.frozen.root + "\n", { mode: 0o600 });
    // Ruling R28 item 1 (F1): cancelled means NO RESULT — never the coordinator's state field. With a result, leaves are
    // paid as leaves and only strays as deposits; without one, every deposit refunds through its own claim or envelope.
    const cancelled = !pub.result;

    // 2. Every payable row, derived by this signer.
    const key = ownEnvelopePrivate(st, o.name);
    requireThat(key, "this signer's envelope key is missing");
    requireOwnEnvelopeKey(pub.manifest as any, o.name, st); // R10 item 3, checked here under host custody
    // B43 (H13/H14 items 2-4): every opening derives OFFLINE from the ONE BLS-verified beacon through the one
    // opener (envelope/opening.ts openSealedBid) — the packet's published beacon when it carries one
    // (publishedClient checks it), else the round-R beacon fetched with the shared failover-plus-verify loop.
    // Built lazily so a cancelled-before-R packet with nothing to open never needs it.
    let beaconClient: ChainClient | null = null;
    const beacon = async () => pub.beacon ?? await fetchVerifiedBeacon((pub.manifest as any).drand.R);
    const opener = async (): Promise<ChainClient> => beaconClient ??= publishedClient(await beacon());
    // H13 item 4: the frozen openings come from this host's own cache when its frozen root AND beacon key match
    // this packet; everything freshly opened is written back after the successful open.
    const cacheKeys = async (): Promise<[string, string]> => [pub.frozen?.root ?? "", beaconSha256(await beacon())];
    const leafCache = pub.frozen ? loadOpenings(leafCacheFile, ...(await cacheKeys())) : null;
    const freshLeaves: Record<string, string | null> = {};
    const opened: { leaf_index: number; plaintext_hex: string | null }[] = [];
    for (const l of pub.frozen?.leaves ?? []) {
      const covered = leafCache && Object.hasOwn(leafCache, String(l.leaf_index)) ? leafCache[String(l.leaf_index)] : undefined;
      const pt = covered !== undefined ? covered : await openSealedBid(l.ciphertext_hex, await opener());
      if (covered === undefined) freshLeaves[String(l.leaf_index)] = pt;
      opened.push({ leaf_index: l.leaf_index, plaintext_hex: pt });
    }
    if (Object.keys(freshLeaves).length) saveOpenings(leafCacheFile, ...(await cacheKeys()), { ...(leafCache ?? {}), ...freshLeaves });
    const ownerOf = (i: number) => { const p = opened.find(x => x.leaf_index === i)?.plaintext_hex; return p ? Buffer.from(p, "hex").subarray(61, 93).toString("hex") : null; };
    const view = { manifest: pub.manifestPacket, frozen: pub.frozen, opened, envelopes: pub.envelopes };
    const claims: any[] = existsSync(path.join(packet, "claims.json")) ? JSON.parse(readFileSync(path.join(packet, "claims.json"), "utf8")) : [];
    const claimDest = (party: string, owner: string | null): Destination | null => {
      for (const c of claims.filter(c => c.party === party)) {
        try {
          const body = { kind: "claim-refund", auction_id: o.id, party, claim_envelope_sha256: sha(Buffer.from(c.claim_envelope_ct, "hex")) };
          if (owner && verifyStatement(owner, body, c.owner_sig)) { const d = openDestination({ envelope_ct: c.claim_envelope_ct } as any, key!, (pub.manifest as any).network); if (d) return d; }
        } catch (e) { process.stderr.write(`WARN claim for ${party} skipped: ${(e as Error).message}\n`); } // never fatal; G-5: say why
      }
      return null;
    };
    // B45 (H16, docs/design/phase7-b45-classify.md): the classify cache and the prefetch. The cache is this
    // host's own computation under its own per-auction state dir (next to openings.json): every address this
    // host classified, keyed by sha256(address), with the classifier binary's own sha256 — a different binary
    // discards the whole file, since classification is a pure function of the address string and the binary.
    // A missing or malformed file is a rebuild, never an error (the openings cache rule).
    const classifyFile = path.join(cacheDir, "classify-cache.json");
    const binSha256 = sha(readFileSync(pcztBin(root, st)));
    const wellFormed = (c: any): boolean => !!c && typeof c === "object" && typeof c.kind === "string" && Array.isArray(c.receivers);
    let classified: Record<string, Classified> = {};
    try {
      const doc = JSON.parse(readFileSync(classifyFile, "utf8"));
      if (doc && doc.bin_sha256 === binSha256 && doc.entries && typeof doc.entries === "object" && !Array.isArray(doc.entries))
        classified = Object.fromEntries(Object.entries(doc.entries).filter(([, c]) => wellFormed(c))) as Record<string, Classified>;
    } catch { classified = {}; }
    useClassifyCache({
      get: (address) => classified[sha(Buffer.from(address, "utf8"))],
      set: (address, c) => { classified[sha(Buffer.from(address, "utf8"))] = c; },
    });
    // Before the per-row loop, collect every destination the host derived — each published envelope record's
    // and each claim's refund, opened with this signer's own key (the same derivation openDestination runs per
    // row), plus the buyback treasury return address — and classify them with ONE classifyAddresses call (one
    // bulk classify-address per 2,000 addresses, or zero spawns when the cache covers them). The per-row
    // verdicts are untouched: openDestination still runs the destination rule on every row, now served by the
    // memo, so this prefetch cannot change an answer.
    const derived: string[] = [];
    for (const e of (pub.envelopes ?? []) as { envelope_ct: string }[]) {
      const refund = openEnvelopeRefundUnchecked(e.envelope_ct, key!);
      if (refund !== null) derived.push(refund);
    }
    for (const c of claims as { claim_envelope_ct?: unknown }[]) {
      const refund = typeof c.claim_envelope_ct === "string" ? openEnvelopeRefundUnchecked(c.claim_envelope_ct, key!) : null;
      if (refund !== null) derived.push(refund);
    }
    if (treasuryBlock(pub.manifest)) derived.push(treasuryBlock(pub.manifest)!.treasury_ua);
    classifyAddresses(derived);
    const expected: DerivedRow[] = [];
    const notes = await ownScan(st, root, o.id, (pub.manifest as any).network);
    const deposits = notes.filter((n: any) => pub.manifest.deposit_addresses.includes(n.address));
    // Ruling R28 item 2 (G-1): every frozen leaf must be a deposit THIS host sees on chain whose memo is that leaf's
    // ciphertext (the witness rule, spent-by-settlement allowed) — a signed but fabricated frozen set pays nobody.
    if (pub.frozen) { const own = recomputeFrozen(pub.manifest as any, pub.manifest_hash, pub.frozen, notes, { settled: true }); requireThat(own.root === pub.frozen.root, "frozen root differs from this host's own scan"); }
    const leafSource = (i: number): string => {
      const d = pub.frozen!.leaves[i].deposit, n = deposits.find((x: any) => x.txid === d.txid && x.address === d.address && x.diversifier_index === d.diversifier_index);
      return n ? depositParty(n) : `leaf-deposit:${d.txid}:${d.address}`;
    };
    // Every registry mode (A13 item 3): each party's amount is the mode's own obligations over the published result —
    // the same function verify and the coordinator's plan use — so a new mode can't drift from them. Destinations come
    // only from envelopes/claims (leaves), the routed seller output (`seller`, bound in sign approve) and the signed
    // buyback treasury; any other party has no host-derivable destination and is never paid by a host.
    const buyback = (pub.manifest as any).clearing?.mode === "buyback";
    // Part 2, collection drop (bond-then-pay, R33 items 1-2): the balance window and the balance addresses are
    // manifest-fixed before bidding. Each balance address must be an external address of THIS host's vault
    // (`benzo-pczt owns`) and never a deposit/escrow/treasury address; from THIS host's own lightwalletd the
    // window's start block must have a header time at or after R's release time (winners learn they won before
    // the window opens). The defaults then come from this host's own scan through the shared
    // rule (clear/features.ts balanceDefaults) — never operator input.
    // Ruling R38 item 1 (N2): there is NO settlement-time refusal on chain state a third party can create. A note
    // at a balance address at or below the window start (third-party dust, or an honest early payment) is simply
    // out of window: it never counts as payment and is refunded (R38 item 4). The "fresh address" property is
    // enforced only where it is ours to enforce — `auction create` generates the balance addresses and refuses
    // one that already holds a note.
    const bM: any = pub.manifest;
    let balanceSources: string[] = [], balanceRefunds: BalanceRefund[] = [], bondVoid = false, bondStart: import("./host-chain").BlockHeader | null = null;
    if (bM.bond && pub.result) {
      const byLeaf = balanceAddressMap(pub.result as any, pub.frozen!.leaves as any, bM), uas = new Set(byLeaf.values()), tb = treasuryBlock(pub.manifest);
      const { start } = balanceWindow(bM);
      for (const ua of uas) {
        requireThat(execFileSync(pcztBin(root, st), ["owns", ufvkFile(st, o.id), ua, "--network", bM.network], { encoding: "utf8" }).trim() === "external",
          `balance address ${String(ua).slice(0, 16)}… is not an external address of this vault`);
        requireThat(!bM.deposit_addresses.includes(ua) && ua !== bM.escrow_ua && ua !== tb?.funding_ua && ua !== tb?.treasury_ua,
          "balance address is a deposit, escrow or treasury address");
      }
      // Ruling R61: a window starting before R's release time no longer refuses (that locked every deposit for
      // good — RG attempt 6, drop 75d1ab9d…). The bond is void: nobody defaults, every deposit and every balance
      // note refunds in full, the seller is paid nothing. This host decides it from its own chain view and signs it.
      requireThat(bM.drand.genesis === QUICKNET.genesis && bM.drand.period === QUICKNET.period, "manifest drand is not the pinned quicknet");
      // R63: the start header from every configured endpoint (refused unless they agree), signed into this host's map.
      bondStart = blockHeader(st, start, bM.network);
      bondVoid = bondVoidAt(bM, bondStart.time);
      // Ruling R38 item 4 (N4) + Ruling R40 item 2 (F2): out-of-window balance notes are never settlement
      // sources (never swept into change) — the in-window ones back the seller payout in the approval ledger,
      // and each out-of-window note gets its own immutable refund row to that slot's own leaf. This host derives
      // both from its own scan with the shared rule (clear/features.ts balanceSettlement); only counts are
      // published.
      const settled = balanceSettlement(bM, pub.result as any, pub.frozen!.leaves as any, notes as any, chainTip(st), bondVoid);
      balanceSources = settled.sources;
      balanceRefunds = settled.refunds;
    }
    const defaults = bM.bond && pub.result && !bondVoid ? balanceDefaults(bM, pub.result as any, pub.frozen!.leaves as any, notes as any, chainTip(st)) : [];
    const owedBy = pub.result ? modeEntry(pub.manifestPacket).obligations(pub.result as any, (pub.manifest as any).bond ? { defaults, balance_refunds: balanceRefunds, ...(bondVoid ? { bond_void: true } : {}) } : null) : new Map<string, string>();
    for (const party of owedBy.keys()) requireThat(party === "seller" || /^leaf:[0-9]+$/.test(party) || isRefundRowParty(party), `obligation ${party} has no host-derivable destination`);
    for (const a of (pub.result as any)?.allocations ?? []) {
      const party = `leaf:${a.leaf_index}`, owed = BigInt(owedBy.get(party) ?? "0");
      if (!(owed > 0n)) continue;
      const rec = validEnvelope(view, a.leaf_index);
      const dest = claimDest(party, ownerOf(a.leaf_index)) ?? (rec ? openDestination(rec, key!, (pub.manifest as any).network) : null);
      if (dest) expected.push({ party, recipient: dest.reveal(), amount_zats: owed.toString(), source: leafSource(a.leaf_index) });
    }
    // Ruling R40 item 2 (F2): each per-note late-refund row is claim-paid only — its owner key is the deposit
    // slot's own leaf (this host's own derivation above), and the destination comes only from that owner's
    // claim envelope, exactly like a leaf's claim.
    // Ruling R41 item 3 (F9): a late or excess refund row is PAYABLE only from notes with the same confirmations
    // rule as strays and sources (m.confirmations / ZIP-315's 10) — an immature row is never derived as payable,
    // so a candidate paying it is refused by this host however the coordinator builds it.
    for (const r of balanceRefunds) {
      const owed = BigInt(owedBy.get(r.party) ?? "0");
      if (!(owed > 0n)) continue;
      const dest = claimDest(r.party, ownerOf(r.leaf_index));
      if (dest && r.matured) expected.push({ party: r.party, recipient: dest.reveal(), amount_zats: owed.toString(), source: r.party });
    }
    // Strays come from this signer's own scan of its own per-auction vault (synced and enhanced above).
    // Cancelled: every deposit; cleared: the strays. A deposit's claim is checked against the owner key inside its OWN
    // memo's sealed bid, opened here with the published beacon (settle/plan.ts ownerKeyFor), never operator input.
    // H13 item 4: memo openings cache the same way in memo-openings.json, keyed by sha256(ciphertext) since
    // strays are per note. Lazy: a packet with no stray to open never touches the beacon or the cache.
    let memoCache: Record<string, string | null> | null = null;
    const freshMemos: Record<string, string | null> = {};
    const openMemo = async (ctHex: string): Promise<string | null> => {
      const key = sha(Buffer.from(ctHex, "hex"));
      memoCache ??= loadOpenings(memoCacheFile, ...(await cacheKeys())) ?? {};
      if (Object.hasOwn(memoCache, key)) return memoCache[key];
      const pt = await openSealedBid(ctHex, await opener());
      freshMemos[key] = pt;
      return pt;
    };
    const memoOwner = async (n: any): Promise<string | null> => {
      const ct = n.memo_hex ? memoSealedBid(n.memo_hex)?.ciphertext_hex ?? null : null;
      const pt = ct ? await openMemo(ct) : null;
      return pt ? Buffer.from(pt, "hex").subarray(61, 93).toString("hex") : null;
    };
    // Ruling R42 (F11): every deposit row this host derives also derives its per-row attestation — the note
    // identity and the SHA-256 of its own scanned memo — for the map this host signs when the batch pays it.
    const strays: import("../witness").StrayAttestation[] = [];
    for (const n of refundable((cancelled ? deposits : strayNotes(deposits, pub.manifest, pub.frozen)) as any).payable as any[]) {
      const party = depositParty(n);
      const rec = await authenticatedMemoEnvelope(deposits as any, party, pub.manifestPacket, pub.envelopes, await opener(), openMemo);
      // Ruling R40 item 1 (F1): a slot collision refunds through the owner-signed claim path only (the plan
      // never auto-pays it; its record belongs to the frozen leaf's ciphertext) — the same rule on this host.
      const dest = claimDest(party, await memoOwner(n)) ?? (!cancelled && isSlotCollision(n, pub.manifest, pub.frozen) ? null : rec ? openDestination(rec, key!, (pub.manifest as any).network) : null);
      if (dest) {
        requireThat(typeof n.memo_hex === "string" && /^[0-9a-f]{1024}$/.test(n.memo_hex), "stray note memo");
        expected.push({ party, recipient: dest.reveal(), amount_zats: String(n.value_zats), source: party });
        strays.push({ party, memo_sha256: sha(Buffer.from(n.memo_hex, "hex")) });
      }
    }
    // H13 item 4: write the memo cache back after the successful open of every fresh stray memo.
    if (Object.keys(freshMemos).length) saveOpenings(memoCacheFile, ...(await cacheKeys()), { ...(memoCache ?? {}), ...freshMemos });
    // A buyback has no seller row (winners are paid on their leaves); its treasury return is derived here from the
    // signed treasury_ua/funding_ua and this signer's own scan.
    const payout = cancelled ? "0" : owedBy.get("seller") ?? "0";
    if (treasuryBlock(pub.manifest)) {
      // Ruling R28 item 7 (F6): a cleared buyback settles only if the treasury funded budget × lots, confirmed — the same
      // rule as `open`, checked here from this host's own scan.
      if (!cancelled) requireThat(treasuryFunded(pub.manifest as any, notes, chainTip(st)) >= treasuryRequired(pub.manifest as any), "treasury is not funded (budget × lots, confirmed) on this host's scan; refusing");
      const back = treasuryReturn(pub.manifest as any, cancelled ? null : pub.result as any, treasuryFunded(pub.manifest as any, notes, chainTip(st)));
      if (back > 0n) expected.push({ party: "treasury", recipient: treasuryBlock(pub.manifest)!.treasury_ua, amount_zats: back.toString(), source: "treasury" });
    }

    // B45: write the classify cache back (mode 0600, atomic) with this run's verdicts and the classifier
    // binary's own sha256 — the file is this host's own computation, never packet input.
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    writeFileSync(classifyFile + ".new", jsonBytes({ bin_sha256: binSha256, entries: classified }), { mode: 0o600 });
    renameSync(classifyFile + ".new", classifyFile);
    return { expected, payout, envelopeKeys: (pub.manifest as any).envelope_keys, network: (pub.manifest as any).network, balanceSources, defaults, balanceRefunds, strays, bondVoid, bondStart,
      // H10 (docs/design/phase7-h10-h11.md): the packet's seller_ua checked against the SIGNED manifest this
      // signer just verified — never against packet bytes alone. "bound" when the packet's address hashes to the
      // manifest's seller_ua_commitment; "legacy" when the manifest predates H10 and carries no commitment (the
      // amount-only behaviour stays, with one WARN line); "mismatch" when the manifest binds and the packet does
      // not match — the caller then refuses the seller row typedly (never a silent pass).
      sellerBinding: (pub.manifest as any).seller_ua_commitment === undefined ? "legacy"
        : typeof meta.seller_ua === "string" && sellerUaCommitment(meta.seller_ua) === (pub.manifest as any).seller_ua_commitment ? "bound" : "mismatch" };
}

// §11 H7: the coordinator's copy of a candidate — every non-change output's recipient, rseed, ock, user address and
// derivation redacted with zcash-devtool `pczt redact` (deterministic: each approving host recomputes it from the full
// candidate sealed to it and requires the same bytes). Sighash and extraction need none of those fields.
export function redactCandidate(st: string, full: string, out: string, info: { outputs: { index: number; pool: string; is_change: boolean }[] }): void {
  const keys = info.outputs.filter(x => !x.is_change).flatMap(x => ["recipient", "rseed", "ock", "user_address", "zip32_derivation"].flatMap(f => ["-k", `${x.pool}.action.${x.index}.output.${f}`]));
  requireThat(keys.length > 0, "candidate has no output to redact");
  execFileSync(path.join(st, "bin", "zcash-devtool"), ["pczt", "redact", ...keys, full, "--output", out], { stdio: ["ignore", "ignore", "pipe"] });
}
