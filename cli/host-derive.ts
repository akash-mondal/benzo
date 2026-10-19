// Shared by `benzo sign approve` and `benzo sign build` (§11 H3/H6, signer hosts): the full public check on a packet's
// public dir, then every payable row derived from THIS signer's own data — fresh tlock openings from the published
// beacon, its own envelope key (claim envelopes first), its own per-auction vault scan for strays — plus the seller
// payout amount from the result. No recipient ever comes from the coordinator.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QUICKNET, jsonBytes, requireThat, sellerUaCommitment, reserveReturnUaCommitment } from "../manifest/schema";
import { fetchVerifiedBeacon, publishedClient } from "../cli/published-beacon";
import { openSealedBid } from "../envelope/opening";
import { beaconSha256, loadOpenings, saveOpenings } from "./openings-cache";
import type { ChainClient } from "tlock-js";
import { pcztBin, scanBin, ufvkFile, vaultDir } from "../manifest/paths";
import { loadPublicAuction } from "../api/public-auction";
import { openEnvelopeRefundUnchecked, verifyStatement } from "../envelope/index";
import { classifyAddresses, useClassifyCache, type Classified } from "../envelope/destination";
import { Destination, authenticatedMemoEnvelope, memoSealedBid, openDestination, ownEnvelopePrivate, requireOwnEnvelopeKey, validEnvelope } from "../settle/envelopes";
import { depositParty, isSlotCollision, paidByOwnLedger, refundable, reserveUnspent, reserveReturnOutstanding, strayNotes } from "../settle/deposits";
import { quoteSweep } from "../settle/quote";
import { treasuryBlock, treasuryFunded, treasuryRequired, treasuryReturn } from "../clear/mode-b";
import { balanceAddressMap, balanceDefaults, balanceSettlement, balanceWindow, bondVoidAt, isRefundRowParty, type BalanceRefund } from "../clear/features";
import { blockHeader, chainTip, minedHeight } from "./host-chain";
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

export async function deriveRows(o: { id: string; name: string }, st: string, root: string, packet: string, meta: { signer: string; seller_ua?: unknown }): Promise<{ expected: DerivedRow[]; payout: string; envelopeKeys: string[]; network: string; balanceSources: string[]; defaults: number[]; balanceRefunds: BalanceRefund[]; strays: import("../witness").StrayAttestation[] ; bondVoid: boolean; bondStart: import("./host-chain").BlockHeader | null; sellerBinding: "bound" | "legacy" | "mismatch"; refusedRows: { party: string; amount_zats: string; reason: string }[]}> {
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
    if (pub.frozen && pub.result) {
      const verify = spawnSync(process.execPath, [process.argv[1], "verify", "--dir", publicDir, "--signer", meta.signer, "--openings-cache", leafCacheFile], { encoding: "utf8", env: process.env });
      requireThat(verify.status === 0, `public check failed: ${(verify.stdout + verify.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 3).join(" | ") || `exit ${verify.status}`}`);
    } else if (!pub.frozen) requireThat(Date.now() / 1000 > pub.manifest.T_freeze, "an unfrozen auction before T_freeze is not cancelled; refusing");
    // B55 (M1, docs/design/phase7-b55-cancel-before-r-and-rg-harness.md §1): a CANCELLED packet after freeze
    // (frozen, no result) has nothing for `benzo verify` to check — verify requires a frozen set AND a result
    // (cli/commands/verify.ts loadCompletePublicAuction) and the gate used to refuse the packet before any
    // derivation. The frozen set is still re-derived below from this host's own scan (recomputeFrozen) and
    // compared to this host's pinned root, so a fabricated frozen set is refused there exactly as before.
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
    // B55 (M1, the rule): before R (the same `released` predicate settle/plan.ts uses) NO path fetches the
    // beacon. A cancelled packet's rows all resolve through memo-bound claims/envelopes whose owner keys need
    // the round-R beacon — so a pre-R cancelled derive opens NOTHING (no leaf, no memo, no cache key) and every
    // deposit row waits with the plan's own reason in refused_rows below. After R (or with a result) nothing
    // changes: every opening derives exactly as before.
    const released = Date.now() / 1000 >= QUICKNET.genesis + ((pub.manifest as any).drand.R - 1) * QUICKNET.period;
    const preRelease = !pub.result && !released;
    const leafCache = pub.frozen && !preRelease ? loadOpenings(leafCacheFile, ...(await cacheKeys())) : null;
    const freshLeaves: Record<string, string | null> = {};
    const opened: { leaf_index: number; plaintext_hex: string | null }[] = [];
    for (const l of preRelease ? [] : (pub.frozen?.leaves ?? [])) {
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
    // B49 (P1-1): the prefetch passes the classifier ONLY candidate strings that are non-empty and carry no
    // control character. A crafted refund of "" or one with a NUL or newline would make classifyAddresses
    // throw and freeze every host's sign build/approve/derivable — one bad record must never stop settlement.
    // The per-row verdicts are unchanged: openDestination runs the unchanged destination rule per row and
    // refuses such a destination itself (its null contract), so that row is underivable exactly as before.
    const classifiable = (refund: string): boolean => refund.length > 0 && !/[\x00-\x1f\x7f]/.test(refund);
    const derived: string[] = [];
    for (const e of (pub.envelopes ?? []) as { envelope_ct: string }[]) {
      const refund = openEnvelopeRefundUnchecked(e.envelope_ct, key!);
      if (refund !== null && classifiable(refund)) derived.push(refund);
    }
    for (const c of claims as { claim_envelope_ct?: unknown }[]) {
      const refund = typeof c.claim_envelope_ct === "string" ? openEnvelopeRefundUnchecked(c.claim_envelope_ct, key!) : null;
      if (refund !== null && classifiable(refund)) derived.push(refund);
    }
    if (treasuryBlock(pub.manifest)) derived.push(treasuryBlock(pub.manifest)!.treasury_ua);
    // B49 (P1-1): the prefetch is an optimization and decides nothing, so a classifier error here is never
    // fatal — the per-row path classifies or refuses that one row exactly as before.
    try { classifyAddresses(derived); } catch { /* warm the cache only */ }
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
    // B55 (M1): each pre-R cancelled deposit row that waits, with the plan's own reason — the listing surfaces
    // these as refused rows so the coordinator parks them instead of allocating a row no host can build.
    const refusedRows: { party: string; amount_zats: string; reason: string }[] = [];
    for (const n of refundable((cancelled ? deposits : strayNotes(deposits, pub.manifest, pub.frozen)) as any).payable as any[]) {
      const party = depositParty(n);
      // R127: before R nothing is opened (no beacon), but a framing-v2 tag-bound record still authenticates;
      // every other pre-R deposit waits with the plan's reason.
      const rec = await authenticatedMemoEnvelope(deposits as any, party, pub.manifestPacket, pub.envelopes, preRelease ? null : opener, preRelease ? undefined : openMemo);
      // Ruling R40 item 1 (F1): a slot collision refunds through the owner-signed claim path only (the plan
      // never auto-pays it; its record belongs to the frozen leaf's ciphertext) — the same rule on this host.
      const dest = claimDest(party, preRelease ? null : await memoOwner(n)) ?? (!cancelled && isSlotCollision(n, pub.manifest, pub.frozen) ? null : rec ? openDestination(rec, key!, (pub.manifest as any).network) : null);
      if (dest) {
        requireThat(typeof n.memo_hex === "string" && /^[0-9a-f]{1024}$/.test(n.memo_hex), "stray note memo");
        expected.push({ party, recipient: dest.reveal(), amount_zats: String(n.value_zats), source: party });
        strays.push({ party, memo_sha256: sha(Buffer.from(n.memo_hex, "hex")) });
      } else if (preRelease) refusedRows.push({ party, amount_zats: String(n.value_zats), reason: "cancelled before release; refund is claimable after R" });
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
    return { expected, payout, envelopeKeys: (pub.manifest as any).envelope_keys, network: (pub.manifest as any).network, balanceSources, defaults, balanceRefunds, strays, bondVoid, bondStart, refusedRows,
      // H10 (docs/design/phase7-h10-h11.md): the packet's seller_ua checked against the SIGNED manifest this
      // signer just verified — never against packet bytes alone. "bound" when the packet's address hashes to the
      // manifest's seller_ua_commitment; "legacy" when the manifest predates H10 and carries no commitment (the
      // amount-only behaviour stays, with one WARN line); "mismatch" when the manifest binds and the packet does
      // not match — the caller then refuses the seller row typedly (never a silent pass). B48 (H18 P3-1): that
      // refusal is the SELLER ROW's alone, and only when the batch has one — each caller knows its own batch
      // (its rows.json, its candidate, its row listing) and a batch without a seller row ignores seller_ua
      // entirely, so an inconsistent config can never stall the bidder refunds it does not name.
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

// B46 (H15, docs/design/phase7-b46-reserve-return.md, Revision R103): the final `reserve-return` row, derived
// and checked by THIS signer from its own data only. The one function behind `sign build`, `sign approve` and
// `sign derivable`'s reserve-return handling; the callers turn a non-null `refusal` into the typed refusal
// (exit 3, named rows) and check the candidate's `input_zats` against the returned `row.remaining_zats`.
//
// Vault value is FUNGIBLE — the wallet picks every batch's inputs, so an ordinary batch can spend a bidder's
// stray note and return its value as internal change — so the return is never about WHICH notes it spends.
// The checks, in the design's order (R103):
//   1. the packet's `reserve_return_ua` hashes to the SIGNED manifest's reserve_return_ua_commitment (H10's
//      shape for the return address); a legacy manifest (no commitment) plans no row and refuses any packet
//      that carries one;
//   2. the auction owes NOTHING — settle/deposits.ts reserveReturnOutstanding, the one shared gate: every
//      owed row has a published receipt, no published row is unresolved (an exception row or a missing
//      receipt), no published balance refund is unpaid. The owed set is this signer's own derivation, run
//      WITHOUT requiring a destination (a row is owed whether or not anyone claimed it): the money rules'
//      obligations over the published result plus every stray deposit note and late/excess balance note of
//      its own scan. An unclaimed stray therefore delays the return indefinitely (the conservative choice);
//   3. the row pays the vault's WHOLE unspent value minus the TOOL'S OWN fee — `benzo-pczt quote-sweep`
//      (settle/quote.ts) quotes the sweep on this signer's own vault with the same wallet and fee rule the
//      build uses (B52, Reviewer R round 4, P2-1: the fee is the ZIP-317 fee of the transaction's real
//      per-pool action counts, never a prediction from the source count) to the committed
//      `reserve_return_ua`. The built candidate is then checked as the TRANSACTION it is (sign build /
//      sign approve, from `benzo-pczt inspect`'s own figures): its `input_zats` equals `row.remaining_zats`
//      (this signer's own scanned unspent total — nothing left behind), it carries exactly ONE output, not
//      change, to the committed `reserve_return_ua`, that output is `input_zats − fee_zats`, and the
//      packet's declared amount equals it (reserveCandidateVerdict below). Anything else is a typed
//      refusal (exit 3, named rows), never an untyped crash.
// The destination itself is never published — only the manifest commitment.
export async function deriveReserveReturn(o: { id: string; name: string }, st: string, root: string, packet: string,
  meta: { signer: string; reserve_return_ua?: unknown },
  declared?: { amount_zats?: unknown } | null): Promise<{
    row: { party: "reserve-return"; kind: "payout"; amount_zats: string; remaining_zats: string; fee_zats: string; ids: string[] } | null;
    binding: "bound" | "legacy" | "mismatch" | "absent";
    refusal: string | null;
  }> {
  const pub = loadPublicAuction(path.join(packet, "public"), { signer: meta.signer });
  requireThat(pub.manifest.auction_id === o.id, "packet is for another auction");
  const m = pub.manifest as any;
  // "absent": the packet names no return address and no return row (an ordinary batch) — nothing to check.
  const hasUa = typeof meta.reserve_return_ua === "string" && meta.reserve_return_ua.length > 0;
  const binding: "bound" | "legacy" | "mismatch" | "absent" = m.reserve_return_ua_commitment === undefined ? "legacy"
    : (!hasUa && !declared) ? "absent"
    : hasUa && reserveReturnUaCommitment(meta.reserve_return_ua as string) === m.reserve_return_ua_commitment ? "bound" : "mismatch";
  const refuse = (reason: string) => ({ row: null, binding, refusal: reason });
  if (binding === "mismatch") return refuse("reserve return address does not match the manifest reserve_return_ua_commitment (H15)");
  if (binding === "absent") return { row: null, binding, refusal: null };
  if (binding === "legacy") return declared ? refuse("legacy manifest: no reserve_return_ua_commitment, the reserve-return row is never planned (H15)") : { row: null, binding, refusal: null };
  // Check 2 — the "nothing is owed" gate (R103), judged from this signer's own scan and derivation, run
  // without requiring a destination, plus the packet's published accounting.
  const notes = await ownScan(st, root, o.id, m.network);
  const cancelled = !pub.result;
  const allDeposits = notes.filter((n: any) => m.deposit_addresses.includes(n.address));
  // The same strayNotes/refundable rules deriveRows uses — over ALL scanned deposit notes, spent or not: a
  // note a prior batch swept into change is still an unpaid stray until its receipt exists (R103's case).
  const strayOwed = refundable((cancelled ? allDeposits : strayNotes(allDeposits, m, pub.frozen)) as any).payable
    .map((n: any) => ({ party: depositParty(n), amount_zats: String(n.value_zats) }));
  // The money rules' own obligations (leaves, seller, balance rows) over this signer's own balance
  // derivation — the same clear/features.ts rules deriveRows uses — and its own treasury return.
  let extras: any = null;
  if (m.bond && pub.result) {
    const { start } = balanceWindow(m);
    const bondStart = blockHeader(st, start, m.network), tip = chainTip(st);
    const bondVoid = bondVoidAt(m, bondStart.time);
    const settled = balanceSettlement(m, pub.result as any, pub.frozen!.leaves as any, notes as any, tip, bondVoid);
    extras = { defaults: bondVoid ? [] : balanceDefaults(m, pub.result as any, pub.frozen!.leaves as any, notes as any, tip),
      balance_refunds: settled.refunds, ...(bondVoid ? { bond_void: true } : {}) };
  }
  const owedBy: Map<string, string> = pub.result ? modeEntry(pub.manifestPacket).obligations(pub.result as any, extras) : new Map();
  const owed = [...owedBy].map(([party, amount_zats]) => ({ party, amount_zats })).concat(strayOwed);
  if (treasuryBlock(m)) {
    const back = treasuryReturn(m, cancelled ? null : pub.result as any, treasuryFunded(m, notes, chainTip(st)));
    if (back > 0n) owed.push({ party: "treasury", amount_zats: back.toString() });
  }
  // B49 (P0-1/P2-2, docs/design/phase7-b49-paid-means-mined.md): a published receipt counts as paid only
  // when THIS host's own approval ledger approved that txid with the row among its mapped outputs at that
  // amount, and THIS host's own scan shows the paying transaction mined 10 deep (settle/deposits.ts
  // paidByOwnLedger — the one shared rule the plan runs too). Packet receipts are only an index; a row
  // without such a receipt is outstanding, including a row whose receipt's transaction a reorg un-mined.
  const ledgerFile = path.join(st, "approvals", o.id, "ledger.json");
  // B53 (P3-2): a pre-B49 entry carries no `mapped` — heal it on read (backfillMapped, from this host's own
  // stored map of that batch and the amounts this host stored at approval, cross-checked against the row
  // amounts it derives right now — B54, P3-4) so its receipts can count as paid.
  const ledgerEntries: any[] = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : [];
  backfillMapped(ledgerEntries, path.join(st, "approvals", o.id), new Map(owed.map(x => [x.party, x.amount_zats])));
  const ownLedger = ledgerEntries.flatMap(e =>
    Array.isArray(e.mapped) ? e.mapped.map((mm: any) => ({ txid: String(e.txid), party: String(mm.party), output_index: Number(mm.output_index), amount_zats: String(mm.amount_zats) })) : []);
  // B53 (P3-1): the scan's own note is the mined-height evidence when it has one; a zero-change paying
  // batch leaves none, so this host's own chain lookup stands in at the same 10-deep rule (the predicate
  // stays pure — the lookup is injected, and an unreachable endpoint reads as not-yet-counted).
  const counted = paidByOwnLedger((pub.settlement?.receipts ?? []) as any, ownLedger, notes as any, chainTip(st), (txid) => { try { return minedHeight(st, txid) } catch { return 0 } });
  const outstanding = reserveReturnOutstanding({ owed, rows: pub.settlement?.rows ?? [], receipts: counted,
    balance_refunds: pub.settlement?.balance_refunds ?? [] });
  // R107: an ordinary batch's packet carries reserve_return_ua too, so only a packet that DECLARES the return row
  // is refused while something is owed; for any other packet the answer is simply "no return row yet".
  if (outstanding.length > 0) return declared ? refuse(`the auction still owes ${outstanding.length} outstanding (strays/balances/exceptions): ${outstanding.slice(0, 4).join(", ")}; the reserve-return row waits until nothing is owed`) : { row: null, binding, refusal: null };
  // Check 3 (B52, Reviewer R round 4, P2-1) — the amount and fee are the TOOL's own quote, never a
  // formula. This signer runs `benzo-pczt quote-sweep` against its own vault (the same wallet, fee rule
  // and confirmation policy `create` uses) and the row carries the quoted sweep amount at the quoted fee.
  // `remaining_zats` stays this signer's own scanned unspent total — the callers check the BUILT candidate
  // against it (reserveCandidateVerdict). A vault the tool cannot sweep in one transaction (insufficient
  // value, or a note it cannot spend) derives no row: declared, that is a typed refusal carrying the
  // tool's own reason.
  const scanned = reserveUnspent(notes as any);
  const quote = quoteSweep(pcztBin(root, st), vaultDir(st, o.id), meta.reserve_return_ua as string, m.network);
  if ("error" in quote) return refuse(`the vault's value cannot be swept in one transaction (${quote.error})`);
  // B54 (Reviewer R round 5, P2-1): `scanned` counts only the notes the WALLET can spend
  // (settle/deposits.ts walletSpendable — the pinned wallet never selects a note of 5,000 zats or less),
  // the same rule `quote-sweep` and `create` share. A dust note no longer walls this comparison forever:
  // it sits outside both sides and is published as the reserve_return accounting's residue
  // (dust_notes/dust_zats). Unconfirmed or locked notes still diverge and refuse typedly — that recovers
  // on a later run once the note matures or the lock expires.
  if (quote.input_zats !== scanned.total_zats)
    return refuse(`the vault's value cannot be swept in one transaction (the tool's quote spends ${quote.input_zats} zats of this signer's scanned unspent total ${scanned.total_zats})`);
  const row = { party: "reserve-return" as const, kind: "payout" as const,
    amount_zats: quote.amount_zats, remaining_zats: scanned.total_zats, fee_zats: quote.fee_zats, ids: scanned.ids };
  // B52: the declared amount is checked against the BUILT candidate — "the declared row amount equals the
  // candidate's single output, which equals input − fee" (reserveCandidateVerdict) — never against a
  // prediction here.
  return { row, binding, refusal: null };
}

// B53 (P3-2, Reviewer R round 4): the one heal for pre-B49 approval entries. Entries written before B49
// carry no `mapped`, so their receipts could never count as paid at the shared rule (paidByOwnLedger's
// ledger half) and the reserve return waited forever — a re-approve did not heal them either. An entry's
// missing `mapped` is filled from the HOST'S OWN stored approvals/<id>/batch-<n>.json map (the signed
// {party, output_index} map of exactly that batch) — and only when that map's txid matches the entry's,
// so a map of a different candidate can never attest this one.
//
// B54 (P3-4, Reviewer R round 5): the healed AMOUNTS come only from what this host stored when it
// approved — the attested {party, output_index, amount_zats} record `sign approve` keeps next to the
// signed map (cli/commands/sign-approve.ts), or the host's own stored candidate inspect matched to the
// map by output index when one exists. The amount this host DERIVES today is a cross-check that must
// match exactly — never the source: derivation can drift after the batch paid, and the old fill then
// attested an amount the transaction never paid (a doctored receipt at the new amount counted). With
// drift nothing heals (fail closed in both directions: neither the paid amount nor the drifted one ever
// counts), and with no stored amounts (a pre-B54 approval record) there is no heal at all — pre-B49
// test state may therefore stay unhealed; mainnet starts fresh (H26).
// Returns how many entries were healed (the sign-approve migration persists the fill).
export function backfillMapped<T extends { batch: number; txid: string; mapped?: { party: string; output_index: number; amount_zats: string }[] }>(
  entries: T[], dir: string, derivedAmounts: Map<string, string>): number {
  let healed = 0;
  for (const e of entries) {
    if (Array.isArray(e.mapped)) continue;
    let rec: any = null;
    try { rec = JSON.parse(readFileSync(path.join(dir, `batch-${e.batch}.json`), "utf8")) } catch { rec = null }
    const map = rec?.map ?? null;
    if (!map || map.txid !== e.txid || !Array.isArray(map.outputs)) continue;
    // What this host stored at approval time: the attested record first, else its own stored candidate
    // inspect's amount for that output index. Nothing stored, no amount, no heal for that row.
    const storedAmount = (party: string, output_index: number): string | null => {
      const attested = Array.isArray(rec.attested) ? rec.attested.find((x: any) => String(x.party) === party && Number(x.output_index) === output_index) : null;
      const fromRecord = attested ? String(attested.amount_zats) : "";
      if (/^[1-9][0-9]*$/.test(fromRecord)) return fromRecord;
      const inspected = Array.isArray(rec.inspect) ? rec.inspect.find((x: any) => !x.is_change && Number(x.index) === output_index) : null;
      const fromInspect = inspected ? String(inspected.amount_zats) : "";
      return /^[1-9][0-9]*$/.test(fromInspect) ? fromInspect : null;
    };
    const mapped = map.outputs
      .map((mm: any) => ({ party: String(mm.party), output_index: Number(mm.output_index), amount_zats: storedAmount(String(mm.party), Number(mm.output_index)) ?? "" }))
      .filter((mm: any) => /^[1-9][0-9]*$/.test(mm.amount_zats) && mm.amount_zats === (derivedAmounts.get(mm.party) ?? null) && Number.isInteger(mm.output_index) && mm.output_index >= 0);
    if (mapped.length) { e.mapped = mapped; healed++ }
  }
  return healed;
}

// B52 (Reviewer R round 4, P2-1): the ONE check on the built return candidate, shared by `sign build` and
// `sign approve` (docs/design/phase7-b52-return-fee.md item 2) — the candidate must be the one-row sweep
// the row describes, judged from `benzo-pczt inspect`'s own figures and never from a predicted fee:
//   - `input_zats` equals this signer's scanned unspent total (the kept B46 check) — nothing left behind;
//   - exactly ONE output, not change, to the committed return UA;
//   - that output's amount is `input_zats − fee_zats` (inspect already refuses a fee that differs from
//     ZIP-317 for the real action count, so this is the tool's own fee);
//   - the packet's declared row amount equals that output.
// Returns null when the candidate is exactly right, otherwise the typed refusal's reason (exit 3, named
// rows at the callers) — an unbuildable or doctored candidate never crashes a run.
export function reserveCandidateVerdict(info: { input_zats: unknown; fee_zats: unknown; outputs?: unknown }, returnUa: unknown, scannedTotal: string | undefined, declaredAmount: unknown): string | null {
  if (scannedTotal === undefined) return "the reserve-return row is not derivable on this signer";
  if (String(info.input_zats) !== scannedTotal)
    return `the reserve-return candidate must spend every unspent vault note: inspect input_zats ${String(info.input_zats)} differs from this signer's scanned unspent total ${scannedTotal}`;
  const outs = (info.outputs ?? []) as { is_change?: unknown; recipient?: unknown; amount_zats?: unknown }[];
  const single = outs.length === 1 ? outs[0] : null;
  if (!single || single.is_change) return "the reserve-return candidate must pay exactly one output, not change: the committed return UA for the unspent value minus the fee";
  if (typeof returnUa !== "string" || single.recipient !== returnUa) return "the reserve-return candidate's output is not paid to the committed return UA";
  const swept = BigInt(String(info.input_zats)) - BigInt(String(info.fee_zats));
  if (BigInt(String(single.amount_zats)) !== swept)
    return `the reserve-return candidate's output ${String(single.amount_zats)} zats is not the unspent value minus the fee (inspect: ${String(info.input_zats)} − ${String(info.fee_zats)} = ${swept})`;
  if (String(declaredAmount) !== String(single.amount_zats))
    return `the declared reserve-return amount ${String(declaredAmount)} differs from the candidate's single output ${String(single.amount_zats)}`;
  return null;
}
