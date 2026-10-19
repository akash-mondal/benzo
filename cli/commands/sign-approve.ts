// benzo sign approve — Phase 5 part 1 §11 H3 (gate Y, R3 item 8), run ON a signer host for one batch attempt.
// The coordinator delivers a packet (the published public dir, the recorded claims, the proven candidate PCZT and
// its plan_version = SHA-256(candidate)); this signer then decides from its OWN data only:
//   1. the full public check (`benzo verify`) on the packet's dir must pass;
//   2. it derives every payable row itself — leaves from the published result and its own fresh tlock openings,
//      destinations through ITS OWN envelope key (claim envelopes first), strays from ITS OWN vault scan — and the
//      seller payout amount from the result;
//   3. every non-change output of the candidate must be one of those (recipient, amount) rows (change returns to
//      the vault); the seller payout is checked against the manifest-committed address (H10) and by amount;
//   4. it computes the sighash itself with zcash-sign.
// Only then it records approvals/<id>/batch-<n>.json {plan_version, sighash}; `benzo sign join` signs nothing else.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { QUICKNET, requireThat } from "../../manifest/schema";
import { pcztBin, scanBin, ufvkFile, vaultDir } from "../../manifest/paths";
import { repoRoot } from "../../manifest/root";
import { loadPublicAuction } from "../../api/public-auction";
import { verifyStatement } from "../../envelope/index";
import { deriveRows, deriveReserveReturn, redactCandidate, backfillMapped } from "../host-derive";
import { onePoolRefusal } from "../../settle/build-outcome";
import { canonicalSourceId } from "../../settle/deposits";
import { chainTip, minedHeight, provenAbsent } from "../host-chain";
import { openBlob } from "../../envelope/index";
import { signApprovalMap } from "../../witness";
import { ownEnvelopePrivate } from "../../settle/envelopes";

export const noun = "sign", verb = "approve";
export const help = "benzo sign approve --id AUCTION_ID --batch N --packet DIR --name SIGNER — on a signer host: verify the packet's public dir, derive every payable row from this signer's own openings, envelope key and vault scan, check the candidate PCZT against them, compute the sighash, record the approval";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const state = () => process.env.BNZ_STATE_DIR ? path.resolve(process.env.BNZ_STATE_DIR) : path.join(os.homedir(), ".benzo");

async function sighashOf(zcashSign: string, network: string, candidate: string): Promise<string> {
  // R28 item 6 (G-6): zcash-sign's output path lives next to the candidate and is removed, never a shared /tmp name.
  const probe = candidate + ".sign-probe";
  return new Promise<string>((resolve, reject) => {
    const p = spawn(zcashSign, ["sign", "-n", network, "-i", candidate, "-o", probe], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const done = (v: string | null, e?: Error) => { p.kill(); v ? resolve(v) : reject(e ?? new Error("zcash-sign printed no SIGHASH")); };
    p.stdout!.on("data", d => { out += d; const m = out.match(/^SIGHASH: ([0-9a-f]{64})$/m); if (m) done(m[1]); });
    p.on("error", e => done(null, e));
    p.on("close", () => { const m = out.match(/^SIGHASH: ([0-9a-f]{64})$/m); m ? resolve(m[1]) : reject(new Error("zcash-sign printed no SIGHASH")); });
  }).finally(() => rmSync(probe, { force: true }));
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
    const redacted = path.join(packet, "candidate.pczt"), publicDir = path.join(packet, "public");
    const planVersion = sha(readFileSync(redacted));
    requireThat(meta.plan_version === planVersion, "candidate PCZT differs from the packet's plan_version");
    // §11 H7: the coordinator holds only the redacted candidate; the full one arrives sealed to this signer's envelope key.
    const sealed = path.join(packet, `sealed-${o.name}.bin`), own = ownEnvelopePrivate(state(), o.name);
    requireThat(existsSync(sealed) && own, "packet carries no candidate sealed to this signer");
    const candidate = path.join(packet, "candidate.full.pczt");
    writeFileSync(candidate, openBlob(readFileSync(sealed), own!), { mode: 0o600 });

    // 1–2. Public check and every payable row, derived by this signer (cli/host-derive.ts) — including its own
    // defaults list from its own scan (R33 item 3), which joins the signed G-4 map and the approval record.
    // B46 (H15): the reserve-return row is checked FIRST from this signer's own data (deriveReserveReturn), so a
    // packet naming a different return UA, a non-eligible source or a return before all obligation receipts
    // exist is refused typedly (exit 3, named rows) like H10's seller row.
    const reserve = (meta as any).reserve_row
      ? await deriveReserveReturn({ id: o.id, name: o.name }, st, root, packet, meta, (meta as any).reserve_row) : null;
    if (reserve?.refusal) throw Object.assign(new Error(reserve.refusal), { refusedRows: ["reserve-return"] });
    const { expected, payout, network, balanceSources, defaults, balanceRefunds, strays, bondVoid, bondStart, sellerBinding } = await deriveRows({ id: o.id, name: o.name }, st, root, packet, meta);
    // H10 (docs/design/phase7-h10-h11.md): when the signed manifest commits the seller payout address, the
    // packet's seller_ua must hash to it — otherwise the seller row is refused, a typed refusal (named rows,
    // exit 3), never a silent pass. A manifest without the field predates H10: the amount-only behaviour below
    // stays and one WARN line says so.
    // B48 (H18 P3-1): the mismatch refuses only the seller row, and only when THIS batch's candidate has one
    // (checked on the inspected outputs below). A batch without a seller row ignores seller_ua entirely, so an
    // inconsistent config can never stall the bidder refunds this batch actually pays.
    if (sellerBinding === "legacy") process.stderr.write("WARN legacy manifest: seller payout address not bound (H10)\n");
    // 3. The candidate's outputs must be exactly rows this signer derived (change returns to the vault).
    const info = JSON.parse(execFileSync(pcztBin(root, st), ["inspect", candidate, ufvkFile(st, o.id), "--network", network], { encoding: "utf8" }));
    // B46 (H15, Revision R103): the return candidate must spend EVERY unspent vault note — its inspect
    // `input_zats` must equal this signer's own scanned unspent total (deriveReserveReturn's remaining_zats).
    // A candidate below it leaves notes behind and is refused typedly.
    if ((meta as any).reserve_row && reserve?.row && String(info.input_zats) !== reserve.row.remaining_zats)
      throw Object.assign(new Error(`the reserve-return candidate must spend every unspent vault note: inspect input_zats ${String(info.input_zats)} differs from this signer's scanned unspent total ${reserve.row.remaining_zats}`), { refusedRows: ["reserve-return"] });
    // ...and the coordinator's copy must be exactly its redaction (so the coordinator signs this transaction).
    const recomputed = path.join(packet, "candidate.recomputed.pczt");
    redactCandidate(st, candidate, recomputed, info);
    requireThat(sha(readFileSync(recomputed)) === planVersion, "coordinator candidate is not the redaction of the sealed candidate");
    const pool = [...expected];
    let sellerSeen = false, reserveSeen = false;
    const outputs = (info.outputs ?? []).filter((x: any) => !x.is_change);
    requireThat(outputs.length > 0, "candidate pays nobody");
    // B48 (H18 P3-1): the seller row of THIS batch's candidate is exactly the output the mapping below would
    // accept as `seller` (the packet's seller_ua for the result's seller amount). When the batch has one and
    // the manifest binds a different address, that row is refused typedly (exit 3, named rows), as before; a
    // batch without a seller row never consults seller_ua.
    const sellerInBatch = payout !== "0" && typeof meta.seller_ua === "string"
      && outputs.some((x: any) => x.recipient === meta.seller_ua && String(x.amount_zats) === payout);
    if (sellerBinding === "mismatch" && sellerInBatch)
      throw Object.assign(new Error("seller payout address does not match the manifest seller_ua_commitment (H10)"), { refusedRows: ["seller"] });
    const sources: string[] = [], mapped: { party: string; output_index: number }[] = [];
    // B49 (P0-1): this host's own approval record keeps each mapped output at its amount, so the reserve
    // gate (and any later one) can check "this host approved that txid with that row at that amount"
    // against its own ledger — the signed map stays {party, output_index} as before.
    const attested: { party: string; output_index: number; amount_zats: string }[] = [];
    for (const out of outputs) {
      const i = pool.findIndex(e => e.recipient === out.recipient && e.amount_zats === String(out.amount_zats));
      if (i >= 0) {
        const [e] = pool.splice(i, 1);
        // B53 (P3-7, Reviewer R round 4): a `balance-excess:` row's `source` is its party name, so its
        // in-window backing notes (cli/host-derive.ts balanceRefunds) never joined `sources` and a second
        // live candidate (the reserve-return sweep, whose sources are the bare vault-note ids) could
        // re-spend them without the R28-3 refusal. The backing notes join the candidate's sources now —
        // the one canonical note identity, so they collision-check against candidates of every row kind.
        sources.push(canonicalSourceId(e.source), ...(balanceRefunds.find(r => r.party === e.party)?.notes ?? []).map(canonicalSourceId));
        mapped.push({ party: e.party, output_index: out.index }); attested.push({ party: e.party, output_index: out.index, amount_zats: String(out.amount_zats) }); continue;
      }
      // B46 (H15): the reserve-return output pays the whole unspent value minus the fee to the committed
      // return UA (checked above), and its spent notes join this host's approval ledger (Ruling R28 item 3),
      // so a second live candidate can never spend them again.
      if (reserve?.row && typeof meta.reserve_return_ua === "string" && out.recipient === meta.reserve_return_ua && String(out.amount_zats) === reserve.row.amount_zats && !reserveSeen) {
        reserveSeen = true; sources.push(...reserve.row.ids.map(canonicalSourceId)); mapped.push({ party: "reserve-return", output_index: out.index }); attested.push({ party: "reserve-return", output_index: out.index, amount_zats: String(out.amount_zats) }); continue;
      }
      // R28 item 8 (G-2): the seller payout must pay the packet's seller_ua (operator routing), which H10 binds
      // to the signed manifest (checked above); paid at most once by the ledger.
      // Part 2 (bond-then-pay): the balance notes backing that payout are sources too, so no second live candidate can
      // spend them again.
      if (!sellerSeen && payout !== "0" && String(out.amount_zats) === payout && typeof meta.seller_ua === "string" && out.recipient === meta.seller_ua) { sellerSeen = true; sources.push("seller", ...balanceSources.map(canonicalSourceId)); mapped.push({ party: "seller", output_index: out.index }); attested.push({ party: "seller", output_index: out.index, amount_zats: String(out.amount_zats) }); continue; }
      // B46 (H15, R103): a return candidate's every output must be the one return row — an output at any
      // other amount (not the scanned total minus the fee) is a typed refusal, never a silent mismatch.
      if ((meta as any).reserve_row)
        throw Object.assign(new Error(`the reserve-return candidate's output ${out.index} (${String(out.amount_zats)} zats) is not this signer's unspent total minus the fee (${reserve?.row?.amount_zats ?? "not derivable"}) paid to the committed return UA`), { refusedRows: ["reserve-return"] });
      // H21 (B50): an output paying the packet's seller_ua that is NOT the one valid seller payout (the
      // result's seller amount, paid at most once) is a mis-shaped seller output — refused typedly
      // (exit 3, ["seller"]), never an untyped exit 1 (B48 Q3).
      if (typeof meta.seller_ua === "string" && out.recipient === meta.seller_ua)
        throw Object.assign(new Error(`seller output ${out.index} (${String(out.amount_zats)} zats) is not the result's seller payout (${payout} zats) paid at most once`), { refusedRows: ["seller"] });
      throw new Error(`output ${out.index} (${String(out.amount_zats)} zats) is not a row this signer derived`);
    }
    // B46 (H15): a reserve-return candidate pays exactly one output — the committed return UA for the whole
    // unspent value minus the fee.
    if ((meta as any).reserve_row && !(reserveSeen && outputs.length === 1))
      throw Object.assign(new Error("the reserve-return candidate must pay exactly one output: the committed return UA for the unspent value minus the fee"), { refusedRows: ["reserve-return"] });
    // H3 (B50): the one-pool rule (R81) on the approve path — typed like every other row refusal here
    // (exit 3, named rows). The named rows are the minority pool's: they wait in the exception queue and
    // re-derive on the next settle; the batch's other rows settle next.
    {
      const poolOfOut = new Map<number, string>(outputs.map((o: any) => [o.index, String(o.pool)]));
      const namedPools = onePoolRefusal(mapped.map(m => ({ party: m.party, pool: poolOfOut.get(m.output_index) ?? "" })));
      if (namedPools.length)
        throw Object.assign(new Error(`the candidate pays more than one pool (one-pool rule, R81): ${namedPools.join(", ")} wait in the exception queue and re-derive on the next settle`), { refusedRows: namedPools });
    }
    // Ruling R28 item 3 (F2): this host's own approval ledger. A source (deposit note, seller, treasury) already in
    // another approved candidate is approved again only when this host sees from the chain that the earlier
    // transaction never mined and can no longer mine (past its expiry) — the legitimate expired-batch re-plan.
    // B49 (P2-a): every source — ordinary rows and the reserve-return row alike — is the one canonical note
    // identity, so a reserve-return candidate collision-checks against ordinary batches and vice versa.
    // R28 item 9 (F9): the candidate must expire after the tip and within 10,000 blocks.
    const tip = chainTip(st);
    requireThat(info.expiry_height > tip && info.expiry_height <= tip + 10000, `candidate expiry ${info.expiry_height} outside (tip, tip + 10000]`);
    const dir = path.join(st, "approvals", o.id), ledgerFile = path.join(dir, "ledger.json");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ledger: { batch: number; txid: string; expiry_height: number; sources: string[]; approved_tip?: number; mapped?: { party: string; output_index: number; amount_zats: string }[] }[] = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : [];
    // B49 (P2-a): migrate on read — every recorded source is normalized to the one canonical note identity
    // (settle/deposits.ts canonicalSourceId) and the file is rewritten once, so an old mixed-namespace
    // entry collision-checks against candidates of every row kind.
    let migrated = false;
    for (const e of ledger) {
      const normalized = e.sources.map(canonicalSourceId);
      if (normalized.some((x, i) => x !== e.sources[i])) { e.sources = normalized; migrated = true; }
    }
    // B53 (P3-2, Reviewer R round 4): and heal a pre-B49 entry's missing `mapped` (persisted here) — the
    // same fill the paid rule's readers run (cli/host-derive.ts backfillMapped): this host's own stored
    // map of that batch plus this host's OWN derived row amounts, only when that map's txid matches the
    // entry's. Before this, an entry written before B49 kept `mapped: undefined` forever: its receipts
    // could never count as paid and the reserve return waited permanently, not even a re-approve healed it.
    const derivedAmounts = new Map<string, string>([
      ...expected.map(e => [e.party, e.amount_zats] as [string, string]),
      ...(payout !== "0" ? [["seller", payout] as [string, string]] : []),
      ...(reserve?.row ? [["reserve-return", reserve.row.amount_zats] as [string, string]] : []),
    ]);
    if (backfillMapped(ledger, dir, derivedAmounts) > 0) migrated = true;
    if (migrated) writeFileSync(ledgerFile, JSON.stringify(ledger) + "\n", { mode: 0o600 });
    // R60 (Reviewer R P2 on R58): never approve a candidate that has already mined (a late approver would otherwise
    // record an approval tip above its mining height).
    requireThat(minedHeight(st, info.txid) === 0, `candidate ${info.txid} has already mined; refusing a late approval`);
    for (const prior of ledger.filter(e => e.txid !== info.txid && e.sources.some(x => sources.includes(x)))) {
      const src = prior.sources.find(x => sources.includes(x));
      requireThat(tip > prior.expiry_height, `${src} is in batch ${prior.batch}, which can still mine until ${prior.expiry_height}`);
      requireThat(minedHeight(st, prior.txid) === 0, `${src} already paid by mined batch ${prior.batch}`);
      // R58 (Reviewer R F2 on R57): an endpoint's NotFound is not absence. The earlier transaction can only have mined
      // in (its approval tip, its expiry]; R28 item 9 bounds that to 10,000 blocks for a ledger entry from before R58.
      // R60 (P2): 100 blocks of margin below the approval tip for endpoint lag; a candidate already mined is refused below.
      const from = Math.max(1, (prior.approved_tip ?? prior.expiry_height - 10000) - 100 + 1);
      requireThat(provenAbsent(st, prior.txid, from, prior.expiry_height), `${src} already paid by mined batch ${prior.batch} (in blocks ${from}..${prior.expiry_height})`);
    }

    // 4. The sighash, computed here — zcash-sign takes the network from the signed manifest (R33 P2-1),
    // never BNZ_NETWORK or a literal.
    const sighash = await sighashOf(path.join(st, "bin", "zcash-sign"), network, candidate);
    // Ruling R28 item 6 (F5): the full (unredacted) candidate never stays on this machine's disk after the check.
    rmSync(candidate, { force: true }); rmSync(recomputed, { force: true });
    // Reviewer G's G-4: this host's signed {party, output_index} map (party names only), for receipt attribution.
    // R33 item 3 (P1-3): the map carries this host's own defaults list too, so the published settlement's
    // `defaults` can never be a coordinator-only list. R33 P2-4: the approval records the randomizers this
    // host's own inspect reported (in zcash-sign's order), and `sign join --count` must equal their count.
    // Ruling R41 (F7): the map's `balance_refunds` carries ONLY the refund rows this batch pays (among its own
    // outputs — a set fixed here, that no third party can grow). It is the per-row attestation of each paid
    // `balance-late:`/`balance-excess:` row; this host's live row set is never signed. Ruling R42 (F11): the
    // map's `strays` attests each stray deposit row this batch pays — its note identity and this host's own
    // scanned memo hash — and nothing else; the deleted strays statement is replaced exactly here.
    const wkey = path.join(st, "witness", `${o.name}.key`);
    // Ruling R42 (F15): the rows' backing notes are ledger-internal derivation data — the signed and
    // published map carries each row's {party, leaf_index, amount_zats} only (the excess row's in-window
    // note set stays private to the vault scans).
    const paidRefunds = balanceRefunds.filter(r => mapped.some(x => x.party === r.party)).map(({ notes, ...row }) => row);
    const paidStrays = strays.filter(s => mapped.some(x => x.party === s.party));
    const map = existsSync(wkey) ? signApprovalMap({ auction_id: o.id, batch: Number(o.batch), txid: info.txid, outputs: mapped.sort((a, b) => a.output_index - b.output_index), defaults, balance_refunds: paidRefunds as any, strays: paidStrays, ...(bondVoid ? { bond_void: true } : {}), ...(bondStart ? { bond_start: bondStart } : {}) }, readFileSync(wkey, "utf8").trim()) : null;
    const approval = { auction_id: o.id, batch: Number(o.batch), name: o.name, plan_version: planVersion, sighash, txid: info.txid, map, outputs: outputs.length, spends: (info.randomizers ?? []).length, randomizers: info.randomizers ?? [], defaults, approved_at: Math.floor(Date.now() / 1000) };
    writeFileSync(path.join(dir, `batch-${o.batch}.json`), JSON.stringify(approval) + "\n", { mode: 0o600 });
    if (!ledger.some(e => e.txid === info.txid)) ledger.push({ batch: Number(o.batch), txid: info.txid, expiry_height: info.expiry_height, sources, approved_tip: tip, mapped: attested });
    else {
      // B53 (P3-2): a re-approval of a txid that already has a ledger entry merges the new `mapped` into
      // that entry when it has none (a pre-B49 entry) — the missing attestation half is exactly what kept
      // its receipts from ever counting as paid.
      const prior = ledger.find(e => e.txid === info.txid)!;
      if (!Array.isArray(prior.mapped)) prior.mapped = attested;
    }
    writeFileSync(ledgerFile, JSON.stringify(ledger) + "\n", { mode: 0o600 });
    return approval;
  } catch (e) {
    if (o.packet) for (const f of ["candidate.full.pczt", "candidate.recomputed.pczt"]) rmSync(path.join(path.resolve(o.packet), f), { force: true });
    // H10: a typed row refusal (the refusedRows marker) is reported like sign build's refused rows — named and
    // distinguishable from a transient failure.
    const refusedRows = (e as any).refusedRows as string[] | undefined;
    if (refusedRows) { process.stderr.write(`ERROR sign approve refused-rows ${JSON.stringify(refusedRows)}: ${(e as Error).message}\n`); return 3; }
    process.stderr.write(`ERROR sign approve ${(e as Error).message}\n`);
    return 1;
  }
}
