// Public auction directory model shared by `benzo verify`, operator view, receipt show and the read-only API.
// Reads only public files; never loads BNZ_STATE_DIR secrets or bid-side keys.
import { checkMissingDeposits } from "./missing-deposits";
import { checkDeliveryExceptions } from "../adapters/zilkroad";
import { checkBuybackReport } from "../adapters/buyback-report";
import { treasuryBlock } from "../clear/mode-b";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hash, jsonBytes, requireThat, verifyRecord, type Manifest, type Signed } from "../manifest/schema";
import { checkFrozen, member, receiptMember, type Deposit, type Frozen, type Path } from "../clear/merkle";
import { type ClearBody, type Opened } from "../clear/core";
import { clientForMode, clearForMode, modeEntry } from "../clear/registry";
import { isBalanceLateParty } from "../clear/features";
import { deliveryRowOrder } from "../clear/launch";
import { envelopeRecordValid, settlementCommitment, verifyEnvelope, verifyStatement } from "../envelope/index";
import { sealedBidPlaintext, memoBindsEnvelope, memoSealedBid } from "../settle/envelopes";
import { isAnyDepositParty, isDepositParty } from "../settle/deposits";
import { checkCertificates, checkStraysCerts, freezeStatement, validateWitnessSet, verifyApprovalMap, verifyDeliveryListSig, witnessSetHash, type StraysCert, type WitnessCert, type WitnessSet } from "../witness";

// Gate EN: manifest validation and clearing dispatch through the mode registry (one code path per mode).
// The witness set rides in a separate signed packet, not in the manifest.
function readClient(packet: Signed, signer: string): { manifest_hash: string; manifest: Manifest } {
  return clientForMode(packet, signer) as { manifest_hash: string; manifest: Manifest };
}
export type EnvelopeRecord = { ciphertext_hash: string; envelope_ct: string; owner_sig: string };

export type SettlementReceipt = { auction_id: string; party: string; txid: string; pool: string; output_index: number; amount_zats: string };
export type Beacon = { round: number; signature: string; chain_hash: string };
export type SettlementSummary = {
  auction_id?: string;
  rows?: { party: string; amount_zats: string; state?: string }[];
  receipts?: SettlementReceipt[];
  // R26 item 1: zero-value deposit notes are never obligations; the plan lists them here and verify's
  // accounting counts each as ignored — never a row, never a receipt.
  ignored?: { party: string; amount_zats: string }[];
  // Gate CF bond-then-pay: winner leaves that missed the balance window (forfeit to the seller net of fees).
  defaults?: number[];
  // R38 item 4 (N4) + R40 item 2 (F2): out-of-window balance notes refund to the slot's own leaf — one
  // immutable row per note (party `balance-late:<txid>:<pool>:<action_index>`), published as counts only,
  // never addresses.
  balance_refunds?: import("../clear/features").BalanceRefund[];
  delivery_defaults?: Signed[];
  // R33 item 3: the signer hosts' G-4 approval maps (each carrying the defaults list that host derived from its
  // own scan), published with the settlement so anyone can check `settlement.defaults` against host signatures.
  approval_maps?: import("../witness").ApprovalMap[];
};
export type PublicResult = ClearBody;
// Lifecycle-safe (R21 item 5): a DRAFT/OPEN/SEALED-WAIT canonical document carries no frozen/opened/result
// yet. Readers that must run past freeze (benzo verify) use loadCompletePublicAuction instead.
export type PublicAuction = {
  dir: string;
  signer: string;
  legacy: boolean;
  state: string;
  manifestPacket: Signed;
  manifest: Manifest;
  manifest_hash: string;
  frozen: Frozen | null;
  opened: Opened[];
  beacon: Beacon | null;
  serialBeacon: { round: number; signature: string } | null;
  launchInput: import("../clear/launch").LaunchInput | undefined;
  // Ruling R40 item 3 (F4): the launch delivery list — only the canonical allocation.json and two host
  // signatures (`benzo-delivery-list-v1` over allocation_file_hash) are ever published; the sealed delivery
  // records themselves never are.
  deliveryList: { allocation_file_hash: string; signatures: import("../witness").DeliveryListSig[] } | undefined;
  result: PublicResult | null;
  resultBytes: Buffer | null;
  receipts: Signed[];
  envelopes: EnvelopeRecord[];
  witnessSet: Signed | null;
  witnessCerts: WitnessCert[];
  // R13: the owner-signed claims the signers used for paid rows (party, destination commit, owner signature;
  // a stray entry carries the scanned deposit's memo ciphertext — the claim publishes it and every verifier
  // derives the owner key from it and the published beacon itself; there is no operator-supplied opening).
  claims: { party: string; claim_envelope_sha256: string; owner_sig: string; memo_hex?: string }[];
  // R23 item 1: witness-certified strays statements (q_w-of-n_w under the pinned witness set), binding
  // every published stray claim's memo to the witnesses' own scans.
  straysCerts: StraysCert[];
  settlement: SettlementSummary | null;
  // Gate CF: the published opening of the manifest's tlock-sealed price bound (plaintext hex), present iff the
  // manifest carries `sealed_reserve`; benzo verify re-derives it with tle like the bid openings.
  reserveOpening: string | null;
};
export type CompletePublicAuction = PublicAuction & { frozen: Frozen; result: PublicResult; resultBytes: Buffer };
export type Check = { id: string; error?: string; warn?: string };

// Canonical document keys, per schemas/public-auction.schema.json (additionalProperties: false).
const canonicalKeys = new Set(["version", "auction_id", "signer", "manifest", "state", "receipts", "frozen", "result", "settlement", "opened", "beacon", "envelopes", "witness_set", "witness_cert", "strays_cert", "reserve_opening", "serial_beacon", "launch_input", "delivery_list", "claims"]);
const states = new Set(["DRAFT", "OPEN", "SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED", "CANCELLED", "REFUNDING"]);
// The schema requires opened + beacon once the state reaches OPENED.
const openedStates = new Set(["OPENED", "CLEARED", "SETTLED"]);
const frozenStates = new Set(["SEALED-WAIT", "OPENED", "CLEARED", "SETTLING", "SETTLED"]);
const resultStates = new Set(["CLEARED", "SETTLING", "SETTLED"]);

// `signer`, when given, is the out-of-band trust anchor (R20): the document's own signer claim must match it.
export function loadPublicAuction(dir: string, opts: { signer?: string } = {}): PublicAuction {
  const root = path.resolve(dir);
  const file = (name: string): Buffer => {
    const p = path.join(root, name);
    requireThat(existsSync(p), `missing ${name}`);
    return readFileSync(p);
  };
  const text = (name: string) => file(name).toString("utf8");
  const anchor = (claimed: string): string => {
    requireThat(/^[0-9a-f]{88}$/.test(claimed), "signer");
    if (opts.signer) requireThat(claimed === opts.signer, "signer mismatch");
    return opts.signer ?? claimed;
  };
  const legacy = !existsSync(path.join(root, "auction.json"));
  let signer: string, manifestPacket: Signed, manifest: Manifest, manifest_hash: string, state: string;
  let frozen: Frozen | null, opened: Opened[], beacon: Beacon | null;
  let launchInput: import("../clear/launch").LaunchInput | undefined;
  let deliveryList: { allocation_file_hash: string; signatures: import("../witness").DeliveryListSig[] } | undefined;
  let serialBeacon: { round: number; signature: string } | null = null;
  let resultBytes: Buffer | null, result: PublicResult | null, receipts: Signed[], envelopes: EnvelopeRecord[], witnessSet: Signed | null, witnessCerts: WitnessCert[], straysCerts: StraysCert[], settlement: SettlementSummary | null, reserveOpening: string | null, claims: any[] = [];
  if (!legacy) {
    // Canonical auction.json is the public document (R20/Q13); the per-file projections are not a source here.
    const doc = JSON.parse(text("auction.json"));
    requireThat(doc && typeof doc === "object" && !Array.isArray(doc), "auction.json");
    requireThat(Object.keys(doc).every(k => canonicalKeys.has(k)) && doc.version === 1, "auction.json schema");
    requireThat(/^[0-9a-f]{64}$/.test(String(doc.auction_id)), "auction id");
    requireThat(typeof doc.state === "string" && states.has(doc.state), "state");
    state = doc.state;
    signer = anchor(String(doc.signer));
    manifestPacket = doc.manifest as Signed;
    ({ manifest, manifest_hash } = readClient(manifestPacket, signer));
    requireThat(doc.auction_id === manifest.auction_id, "auction id binding");
    requireThat(Array.isArray(doc.receipts), "receipts");
    requireThat(doc.frozen === undefined || (doc.frozen && typeof doc.frozen === "object"), "frozen");
    requireThat(doc.result === undefined || (doc.result && typeof doc.result === "object"), "result");
    frozen = (doc.frozen ?? null) as Frozen | null;
    result = (doc.result ?? null) as PublicResult | null;
    // A state past freeze/clear must carry what it claims, or readers would report a stripped document as valid.
    requireThat(!frozenStates.has(doc.state) || frozen, `state ${doc.state} requires frozen`);
    requireThat(!resultStates.has(doc.state) || result, `state ${doc.state} requires result`);
    if (openedStates.has(doc.state)) requireThat(Array.isArray(doc.opened) && doc.beacon, "opened/beacon required from OPENED");
    opened = Array.isArray(doc.opened) ? (doc.opened as Opened[]) : [];
    beacon = readBeacon(doc.beacon ?? null, manifest);
    launchInput = doc.launch_input;
    deliveryList = doc.delivery_list;
    if (deliveryList !== undefined) requireThat(deliveryList && typeof deliveryList === "object" && !Array.isArray(deliveryList) &&
      Object.keys(deliveryList).sort().join(",") === "allocation_file_hash,signatures" && /^[0-9a-f]{64}$/.test(String(deliveryList.allocation_file_hash)) &&
      Array.isArray(deliveryList.signatures) && deliveryList.signatures.every((s: any) => s && typeof s === "object" && Object.keys(s).sort().join(",") === "signature,witness" &&
        /^[0-9a-f]{64}$/.test(String(s.witness)) && /^[0-9a-f]{128}$/.test(String(s.signature))), "delivery list shape");
    serialBeacon = doc.serial_beacon ?? null;
    if (serialBeacon) {
      requireThat(Object.keys(serialBeacon).sort().join(",") === "round,signature" &&
        /^[0-9a-f]{96}$/.test(serialBeacon.signature), "serial beacon");
      requireThat(manifest.serials && serialBeacon.round === manifest.drand.R + manifest.serials.seed_round_offset, "serial beacon round");
    }
    resultBytes = result ? jsonBytes(doc.result) : null;
    receipts = doc.receipts as Signed[];
    requireThat(doc.envelopes === undefined || Array.isArray(doc.envelopes), "envelopes");
    envelopes = (doc.envelopes ?? []) as EnvelopeRecord[];
    requireThat(doc.witness_set === undefined || (doc.witness_set && typeof doc.witness_set === "object"), "witness_set");
    witnessSet = (doc.witness_set ?? null) as Signed | null;
    requireThat(doc.witness_cert === undefined || Array.isArray(doc.witness_cert), "witness_cert");
    witnessCerts = (doc.witness_cert ?? []) as WitnessCert[];
    requireThat(doc.strays_cert === undefined || Array.isArray(doc.strays_cert), "strays_cert");
    straysCerts = (doc.strays_cert ?? []) as StraysCert[];
    requireThat(doc.claims === undefined || Array.isArray(doc.claims), "claims");
    claims = (doc.claims ?? []) as any[];
    settlement = (doc.settlement ?? null) as SettlementSummary | null;
    requireThat(doc.reserve_opening === undefined || (doc.reserve_opening && typeof doc.reserve_opening === "object" &&
      Object.keys(doc.reserve_opening).sort().join(",") === "plaintext_hex" && typeof doc.reserve_opening.plaintext_hex === "string"), "reserve_opening");
    reserveOpening = doc.reserve_opening ? (doc.reserve_opening as { plaintext_hex: string }).plaintext_hex : null;
  } else {
    // Legacy projections (signer.json, opened.json, summary.json, ...) — fallback only for the Phase 2/3 evidence dirs.
    signer = anchor(String(JSON.parse(text("signer.json")).signer));
    manifestPacket = JSON.parse(text("manifest.json")) as Signed;
    ({ manifest, manifest_hash } = readClient(manifestPacket, signer));
    frozen = JSON.parse(text("frozen.json")) as Frozen;
    opened = existsSync(path.join(root, "opened.json"))
      ? (JSON.parse(text("opened.json")) as Opened[])
      : [];
    beacon = readBeacon(
      existsSync(path.join(root, "beacon.json")) ? JSON.parse(text("beacon.json")) : null,
      manifest,
    );
    resultBytes = file("result.json");
    result = JSON.parse(resultBytes.toString("utf8")) as PublicResult;
    receipts = existsSync(path.join(root, "receipts.json"))
      ? (JSON.parse(text("receipts.json")) as Signed[])
      : [];
    envelopes = existsSync(path.join(root, "envelope.json"))
      ? (JSON.parse(text("envelope.json")) as EnvelopeRecord[])
      : [];
    witnessSet = existsSync(path.join(root, "witness-set.json"))
      ? (JSON.parse(text("witness-set.json")) as Signed)
      : null;
    witnessCerts = existsSync(path.join(root, "witness.json"))
      ? (JSON.parse(text("witness.json")) as WitnessCert[])
      : [];
    straysCerts = [];
    settlement = existsSync(path.join(root, "summary.json"))
      ? (JSON.parse(text("summary.json")) as SettlementSummary)
      : null;
    // Legacy evidence dirs carry no state field; derive it from the artifacts they do carry.
    state = settlement ? "SETTLED" : result ? "CLEARED" : frozen ? "SEALED-WAIT" : "OPEN";
    reserveOpening = existsSync(path.join(root, "reserve.json"))
      ? String((JSON.parse(text("reserve.json")) as { plaintext_hex?: unknown }).plaintext_hex ?? "")
      : null;
  }
  return { dir: root, signer, legacy, state, manifestPacket, manifest, manifest_hash, frozen, opened, beacon, serialBeacon, launchInput, deliveryList, result, resultBytes, receipts, envelopes, witnessSet, witnessCerts, straysCerts, claims, settlement, reserveOpening };
}

// Gate R targets post-freeze dirs: verify keeps requiring frozen and result (R21 item 5).
export function loadCompletePublicAuction(dir: string, opts: { signer?: string } = {}): CompletePublicAuction {
  const pub = loadPublicAuction(dir, opts);
  requireThat(pub.frozen, "missing frozen");
  requireThat(pub.result, "missing result");
  return pub as CompletePublicAuction;
}

// The published drand beacon (R16) is a public input; bind it to the signed manifest before any use.
function readBeacon(raw: unknown, manifest: Manifest): Beacon | null {
  if (raw === null || raw === undefined) return null;
  const b = raw as Beacon;
  requireThat(
    b && typeof b.round === "number" && /^[0-9a-f]{96}$/.test(String(b.signature)) && /^[0-9a-f]{64}$/.test(String(b.chain_hash)),
    "beacon",
  );
  requireThat(b.round === manifest.drand.R && b.chain_hash === manifest.drand.chain_hash, "beacon binding");
  return b;
}

const settlementKeys = ["auction_id", "party", "txid", "pool", "output_index", "amount_zats"].sort().join(",");

// R16 item 4 (Reviewer R F3): every stray claim's owner key is derived by the verifier itself, from the
// stray memo the claim publishes (`memo_hex` — the scanned deposit's memo, as the signer plan attaches it)
// and the published beacon. `claims[].opening` is gone: nothing the operator supplies ever enters the
// derivation. The one derivation lives in cli/published-beacon.ts (this module must stay free of the tlock
// runtime — it is bundled into settle/plan.mjs through the adapters); checkPublicAuction takes its result
// and fails closed for a stray claim whose memo does not open.

export function checkPublicAuction(pub: PublicAuction, opts: { claimOpenings?: Map<number, string | null> } = {}): Check[] {
  const checks: Check[] = [];
  const run = (id: string, fn: () => string | void) => {
    try {
      const warn = fn();
      checks.push(warn ? { id, warn } : { id });
    } catch (e) {
      checks.push({ id, error: (e as Error).message });
    }
  };
  // Canonical dirs carry byte-identical manifest.json, frozen.json and result.json projections (schema description).
  // A projection for a field the document does not carry is refused as loudly as a differing one.
  const projection = (name: string, value: unknown): void => {
    if (pub.legacy) return;
    const p = path.join(pub.dir, name);
    if (value === null || value === undefined) {
      requireThat(!existsSync(p), `${name} projection without document field`);
      return;
    }
    if (existsSync(p)) requireThat(jsonBytes(value).equals(readFileSync(p)), `${name} projection differs`);
  };
  // R26 item 3 (Reviewer R F5): the projection files a publisher writes beside the canonical
  // auction.json must agree with the document — a divergence (including a projection for a field the
  // document does not carry) is an ERROR, never a silent preference for one side. The four checked
  // here (opened/beacon/receipts/summary) are the projections only a legacy dir treats as a source.
  run("projection", () => {
    if (pub.legacy) return;
    const doc = JSON.parse(readFileSync(path.join(pub.dir, "auction.json"), "utf8")) as Record<string, unknown>;
    const problems: string[] = [];
    for (const [name, key] of [["opened.json", "opened"], ["beacon.json", "beacon"], ["receipts.json", "receipts"], ["summary.json", "settlement"]]) {
      const p = path.join(pub.dir, name), value = doc[key];
      try {
        if (value === null || value === undefined) requireThat(!existsSync(p), `${name} projection without document field`);
        else if (existsSync(p)) requireThat(jsonBytes(value).equals(readFileSync(p)), `${name} projection differs`);
      } catch (e) { problems.push((e as Error).message); }
    }
    if (problems.length) throw new Error(problems.join("; "));
  });
  // Checks apply to the fields the current state carries (R21 item 5): manifest always, freeze/receipts
  // once frozen, clear/accounting once result. A pre-freeze dir is valid when its manifest is.
  run("missing-deposits", () => checkMissingDeposits(pub));
  run("delivery", () => checkDeliveryExceptions(pub));
  run("report", () => { if (pub.frozen && pub.result) checkBuybackReport(pub as CompletePublicAuction); });
  run("manifest", () => {
    const again = readClient(pub.manifestPacket, pub.signer);
    requireThat(again.manifest_hash === pub.manifest_hash, "manifest hash changed");
    if (pub.result) requireThat(pub.result.auction_id === pub.manifest.auction_id && pub.result.manifest_hash === pub.manifest_hash, "result manifest binding");
    projection("manifest.json", pub.manifestPacket);
  });
  run("freeze", () => {
    const frozen = pub.frozen;
    if (!frozen) return projection("frozen.json", null);
    checkFrozen(frozen, pub.manifest.auction_id, pub.manifest_hash);
    requireThat(frozen.published_at < pub.manifest.T_freeze, "freeze published too late");
    requireThat(frozen.published_at < releaseTime(pub.manifest), "freeze published after release");
    for (const [i, l] of frozen.leaves.entries()) {
      requireThat(l.leaf_index === i, `leaf order ${i}`);
      requireThat(
        member(l.ciphertext_hash, l.deposit, i, frozen.leaf_count, frozen.paths[i] ?? [], frozen.root),
        `witness ${i}`,
      );
    }
    if (pub.result) requireThat(frozen.root === pub.result.freeze_root, "result freeze root");
    projection("frozen.json", frozen);
  });
  // Gate X: the frozen root must carry a q_w-of-n_w witness certificate over the released statement, and one root
  // per auction — two certificates for different roots are refused (threat #5, #6). The set is a signed side-packet
  // from the manifest signer (the same --signer anchor). R4 item 2: when the signed manifest carries
  // `witness_set_hash`, the side-packet must hash exactly to it (a removed or substituted set is refused) and a
  // valid certificate is required; manifests without the field are pre-Phase-5 — warn and continue.
  run("witness", () => {
    const frozen = pub.frozen;
    if (!frozen) {
      // Root certificates need a root. The witness SET is auction-scoped material the signed manifest
      // commits to, and a cancelled-before-freeze auction still certifies its strays statements with it
      // (R23 item 1), so the set may be published without a frozen root — it must hash to the manifest's pin.
      requireThat(pub.witnessCerts.length === 0, "witness certificates without frozen root");
      if (pub.witnessSet) {
        requireThat(pub.manifest.witness_set_hash, "witness set without a pinned hash");
        requireThat(witnessSetHash(pub.witnessSet) === pub.manifest.witness_set_hash, "witness set hash mismatch");
        projection("witness-set.json", pub.witnessSet);
      }
      return projection("witness.json", null);
    }
    const bound = pub.manifest.witness_set_hash;
    if (!bound) return "no witness set (pre-Phase-5 manifest)";
    requireThat(pub.witnessSet, "missing witness set");
    const set = verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer);
    requireThat(witnessSetHash(pub.witnessSet!) === bound, "witness set hash mismatch");
    checkCertificates(pub.witnessCerts, validateWitnessSet(set, pub.manifest.auction_id), freezeStatement(pub.manifest, frozen));
    projection("witness-set.json", pub.witnessSet);
    projection("witness.json", pub.witnessCerts);
  });
  run("receipts", () => {
    if (!pub.frozen) return;
    for (const [i, packet] of pub.receipts.entries()) {
      requireThat(receiptMember(packet, pub.frozen, pub.signer), `receipt ${i} not a member`);
    }
  });
  run("clear", () => {
    const result = pub.result, resultBytes = pub.resultBytes;
    if (!result || !resultBytes) return projection("result.json", null);
    requireThat(pub.frozen, "missing frozen");
    const fresh = clearForMode({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen!, opened: pub.opened, reserve_opening: pub.reserveOpening, serial_beacon: pub.serialBeacon, launch: pub.launchInput });
    requireThat(jsonBytes(fresh).equals(resultBytes), "canonical result differs");
    if ((fresh as any).allocation_file_hash) {
      // Pre-F4 historical reading (immutable evidence): those docs publish their plaintext delivery records,
      // so the recomputation above also re-checks their owner signatures and commits to the allocation file —
      // which is checked here, including the R34.2 canonical sort. New docs are checked by run("delivery").
      const file = path.join(pub.dir, "allocation.json");
      requireThat(existsSync(file), "launch allocation file missing");
      const bytes = readFileSync(file);
      let rows: { destination: string; amount: number }[] = [];
      try { rows = JSON.parse(bytes.toString("utf8")).rows ?? []; } catch { /* refused below */ }
      requireThat(Array.isArray(rows) && rows.every(r => r && typeof r.destination === "string" && typeof r.amount === "number") &&
        rows.every((r, i) => i === 0 || deliveryRowOrder(rows[i - 1], r) <= 0), "launch allocation rows not in canonical order");
      requireThat(hash(bytes) === (fresh as any).allocation_file_hash, "launch allocation file hash");
    }
    projection("result.json", result);
  });
  // Ruling R40 item 3 (F4): launch delivery records stay private. The published doc carries only the canonical
  // allocation.json and two host signatures (`benzo-delivery-list-v1` over allocation_file_hash). verify holds
  // the file to the public invariants — row count = Σ fill/lot, every amount = standard_lot_size, distinct
  // destinations, canonical (destination bytes, then amount) order, hash — and the signatures to two distinct
  // pinned signers (the manifest's witness set). Integrity rests on the same 2-of-3 trust as settlement; the
  // per-winner owner signatures are checked by the hosts against their own openings, never publicly re-derivable
  // (that join is exactly what must not be published).
  run("delivery", () => {
    const result = pub.result;
    if (!result || (pub.manifest as any).clearing?.mode !== "launch") return;
    if ((result as any).allocation_file_hash !== undefined) return; // pre-F4 historical docs: checked with the clear recompute
    if (result.cancelled) {
      requireThat(pub.deliveryList === undefined && !existsSync(path.join(pub.dir, "allocation.json")), "launch delivery artifacts on a cancelled round");
      return;
    }
    requireThat(pub.deliveryList, "launch delivery list missing");
    const file = path.join(pub.dir, "allocation.json");
    requireThat(existsSync(file), "launch allocation file missing");
    const bytes = readFileSync(file);
    let rows: { destination: string; amount: number }[] = [];
    try { rows = JSON.parse(bytes.toString("utf8")).rows ?? []; } catch { /* refused below */ }
    const lot = (pub.manifest as any).launch?.standard_lot_size;
    requireThat(Number.isSafeInteger(lot) && lot > 0, "launch standard lot size");
    requireThat(Array.isArray(rows) && rows.every(r => r && typeof r === "object" && Object.keys(r).sort().join(",") === "amount,destination" &&
      typeof r.destination === "string" && r.destination.length > 0 && r.destination.length <= 256 && r.amount === lot), "launch allocation rows");
    requireThat(new Set(rows.map(r => r.destination)).size === rows.length, "launch allocation destinations not distinct");
    requireThat(rows.every((r, i) => i === 0 || deliveryRowOrder(rows[i - 1], r) <= 0), "launch allocation rows not in canonical order");
    requireThat(hash(bytes) === pub.deliveryList!.allocation_file_hash, "launch allocation file hash");
    const want = result.allocations.reduce((n, a) => n + a.fill, 0) / lot!;
    requireThat(rows.length === want, "launch delivery count");
    requireThat(pub.witnessSet && pub.manifest.witness_set_hash === witnessSetHash(pub.witnessSet), "launch delivery signatures need a pinned witness set");
    const keys = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer), pub.manifest.auction_id).keys;
    const body = { version: 1 as const, auction_id: pub.manifest.auction_id, allocation_file_hash: pub.deliveryList!.allocation_file_hash };
    const signed = new Set<string>();
    for (const s of pub.deliveryList!.signatures) if (verifyDeliveryListSig(s, body, keys)) signed.add(s.witness);
    requireThat(signed.size >= 2, "launch delivery list is not carried by two host signatures");
  });
  // Gate W: published envelope records verify against the owner pubkey inside each opening, and the opening's
  // salted settlement commitment binds the same envelope ciphertext (threat #7, #32). Dirs without records are pre-W.
  // R12 item 1: every published record must satisfy the one shared format/recipient rule
  // (envelope/index.ts envelopeRecordValid) — the operator admitted it, so a record that breaks it is an ERROR,
  // not a settleable state. Pre-v2 (572-byte) records pass only where the manifest pins no `envelope_keys`.
  // R7 item 4 (R F-5 = G5): a leaf with no valid record is a correct state only as an explicit exception-queued
  // row that was never paid to an unauthenticated destination — anything else refuses.
  run("envelope", () => {
    const records = pub.envelopes;
    const frozen = pub.frozen;
    // R15 item 1 (R F4): when the manifest pins envelope_keys the leaf state machine runs for EVERY frozen
    // leaf even when zero envelope records are published (recordless bids are admitted legally), so a row or
    // receipt that misstates a leaf can never hide behind an omitted envelope.json. Dirs from before envelopes
    // (no pinned keys, no records) keep the old reading and stay verifiable.
    if (!records.length && !(frozen && pub.manifest.envelope_keys)) return projection("envelope.json", null);
    requireThat(frozen, "missing frozen");
    const rows = pub.settlement?.rows ?? [], receipts = pub.settlement?.receipts ?? [];
    // R15 item 2 (R F5): only a result-obligation-bearing leaf needs a row. The clear puts a leaf in the
    // obligations map only when its refund is positive and the ledger refuses zero-amount rows, so a leaf with
    // zero refund and no envelope record is a correct no-op state — "missing row" for it is a false error.
    // Without a result there are no result obligations at all (the CANCELLED path refunds deposits, checked by
    // the stray rules), so the machine has no row to demand there either.
    const expected = pub.result ? modeEntry(pub.manifestPacket).obligations(pub.result as ClearBody, pub.settlement) : null;
    const settleable = (leaf: number, reason: string): string | void => {
      const party = `leaf:${leaf}`;
      if (!expected || !expected.has(party)) return undefined;
      if (!pub.settlement) return `${reason} ${leaf}; refund goes to the exception queue`;
      const row = rows.find(r => r.party === party);
      requireThat(row, `${reason} ${leaf}: missing row`);
      const paid = receipts.some(r => r.party === party);
      // R7 item 4: the correct settled states for a leaf with no valid envelope record are exactly the unpaid
      // exception row (claimable later) and the paid row whose refund came from an owner-signed claim the
      // signing quorum checked at signing time; anything else is refused.
      if (row!.state === "exception") requireThat(!paid, `${reason} ${leaf}: exception row with receipt`);
      else requireThat(paid, `${reason} ${leaf}: neither an unpaid exception row nor a receipt-backed payment`);
      return paid ? `${reason} ${leaf}; paid through an owner-signed claim` : `${reason} ${leaf}; in the exception queue`;
    };
    const byLeaf = new Map<number, EnvelopeRecord>();
    for (const rec of records) {
      requireThat(rec && typeof rec === "object" && Object.keys(rec).sort().join(",") === "ciphertext_hash,envelope_ct,owner_sig", "envelope record shape");
      requireThat(envelopeRecordValid(rec, pub.manifest.envelope_keys), "envelope record format");
      const leaf = frozen!.leaves.find(l => l.ciphertext_hash === rec.ciphertext_hash);
      requireThat(leaf, "envelope for unknown ciphertext");
      // R16 item 2: verify checks the same rule as intake — the record must be the envelope the depositor's
      // memo committed to (the leaf carries the scanned memo's envelope tag, first 18 bytes of
      // SHA-256(envelope_ct), set at intake from framing v2). A record whose tag differs from it is an ERROR;
      // v1-era leaves carry no tag and stay readable.
      if (leaf!.memo_envelope_tag !== undefined) requireThat(memoBindsEnvelope(leaf!.memo_envelope_tag, rec.envelope_ct), `envelope ${leaf!.leaf_index} not bound to the deposit memo`);
      requireThat(!byLeaf.has(leaf!.leaf_index), `duplicate envelope ${leaf!.leaf_index}`);
      byLeaf.set(leaf!.leaf_index, rec);
    }
    const warnings: (string | void)[] = [];
    for (const l of frozen!.leaves) if (!byLeaf.has(l.leaf_index)) warnings.push(settleable(l.leaf_index, "missing envelope"));
    if (pub.opened.length) for (const l of frozen!.leaves) {
      const rec = byLeaf.get(l.leaf_index);
      if (!rec) continue;
      const opening = pub.opened.find(o => o.leaf_index === l.leaf_index);
      let valid = !!opening && /^[0-9a-f]{256}$/.test(opening!.plaintext_hex ?? "");
      if (valid) {
        const pt = Buffer.from(opening!.plaintext_hex!, "hex");
        try {
          valid = verifyEnvelope(pt.subarray(61, 93).toString("hex"), pub.manifest.auction_id, rec.ciphertext_hash, rec.envelope_ct, rec.owner_sig)
            && pt.subarray(93, 125).toString("hex") === settlementCommitment(pt.subarray(45, 61).toString("hex"), rec.envelope_ct);
        } catch { valid = false; }
      }
      if (!valid) warnings.push(settleable(l.leaf_index, "invalid envelope"));
    }
    projection("envelope.json", records);
    return warnings.filter(Boolean).join("; ") || undefined;
  });
  // R13: every claim the signers used is published with its owner signature, checkable against the owner key
  // in the re-derived opening (a leaf's own opening; a stray's memo opening derived from the published memo
  // ciphertext), and every claim-paid row carries one — so "paid through an owner-signed claim" is never
  // taken on the quorum's word alone.
  run("claims", () => {
    const records = pub.claims ?? [];
    const rows = pub.settlement?.rows ?? [], receipts = pub.settlement?.receipts ?? [];
    // R23 item 1 (Reviewer G G1): the strays certificates are validated whenever present; every stray
    // claim additionally requires its memo to be in the certified statement (below).
    let certified: Map<string, string> | null = null;
    if (pub.straysCerts?.length) {
      requireThat(pub.manifest.witness_set_hash, "strays certification requires a pinned witness set");
      requireThat(pub.witnessSet, "strays certification requires the witness set");
      requireThat(witnessSetHash(pub.witnessSet!) === pub.manifest.witness_set_hash, "witness set hash mismatch");
      const spec = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer), pub.manifest.auction_id);
      const statement = checkStraysCerts(pub.straysCerts, spec);
      requireThat(statement.auction_id === pub.manifest.auction_id, "strays statement auction");
      certified = new Map(statement.strays.map(e => [`${e.party}\u0000${e.memo_sha256}`, e.value_zats]));
    }
    for (const [i, c] of records.entries()) {
      requireThat(c && typeof c === "object" && ["party", "claim_envelope_sha256", "owner_sig"].every(k => typeof (c as any)[k] === "string") && Object.keys(c).every(k => ["party", "claim_envelope_sha256", "owner_sig", "memo_hex"].includes(k)), `claim ${i} shape`);
      requireThat(/^leaf:[0-9]+$/.test(c.party) || isAnyDepositParty(c.party), `claim ${i} party`);
      requireThat(/^[0-9a-f]{64}$/.test(c.claim_envelope_sha256) && /^[0-9a-f]{128}$/.test(c.owner_sig), `claim ${i} fields`);
      let owner: string | null = null;
      if (c.party.startsWith("leaf:")) {
        const opening = pub.opened.find(o => o.leaf_index === Number(c.party.slice(5)));
        owner = opening && /^[0-9a-f]{256}$/.test(opening.plaintext_hex ?? "") ? Buffer.from(opening.plaintext_hex!, "hex").subarray(61, 93).toString("hex") : null;
      } else if (isBalanceLateParty(c.party)) {
        // Ruling R40 items 2/5: a balance-late row refunds to the deposit slot's own leaf — the published,
        // host-derived mapping (settlement.balance_refunds, one row per note) names it — so the claim's owner
        // key is that leaf's key, from the re-derived opening.
        const entry = (pub.settlement?.balance_refunds ?? []).find(r => r.party === c.party);
        requireThat(entry, `claim ${i} balance-late row not in the published counts`);
        const opening = pub.opened.find(o => o.leaf_index === entry!.leaf_index);
        owner = opening && /^[0-9a-f]{256}$/.test(opening.plaintext_hex ?? "") ? Buffer.from(opening.plaintext_hex!, "hex").subarray(61, 93).toString("hex") : null;
      } else {
        // R16 item 4: the memo the claim publishes must be an openable sealed bid of THIS auction (the same
        // 128-byte layout rule the signer plan enforces against the scanned deposit) and the owner key comes
        // only from its beacon-anchored opening — never from a `claims[].opening` the operator supplies.
        requireThat(typeof c.memo_hex === "string" && /^[0-9a-f]{1024}$/.test(c.memo_hex) && memoSealedBid(c.memo_hex) !== null, `claim ${i} memo_hex`);
        // R23 item 1 (Reviewer G G1): the public cannot see the encrypted memo on chain, so the published
        // memo is only the operator's word — bind it to the chain through the witnesses' own scans: the
        // claim's SHA-256(memo_hex) must appear with the same party in a q_w-certified strays statement.
        requireThat(certified?.has(`${c.party}\u0000${hash(Buffer.from(c.memo_hex!, "hex"))}`), `claim ${i} memo not in a certified strays statement`);
        const derived = opts.claimOpenings?.get(i), pt = derived ? Buffer.from(derived, "hex") : null;
        requireThat(pt && sealedBidPlaintext(pt, pub.manifestPacket), `claim ${i} memo opening`);
        owner = pt!.subarray(61, 93).toString("hex");
      }
      requireThat(owner && verifyStatement(owner!, { kind: "claim-refund", auction_id: pub.manifest.auction_id, party: c.party, claim_envelope_sha256: c.claim_envelope_sha256 }, c.owner_sig), `claim ${i} owner signature`);
    }
    for (const row of rows) {
      if (!receipts.some(r => r.party === row.party)) continue;
      // The seller payout is the documented operator-pinned sink (Q18); claim evidence is required only for
      // bid leaves, per-note late-refund rows and stray deposits.
      if (!row.party.startsWith("leaf:") && !row.party.startsWith("deposit:") && !isBalanceLateParty(row.party)) continue;
      // R13 proves claim-paid rows. Only Phase 5 product dirs (manifest pinning envelope_keys) have the
      // claim path at all — a pre-Phase-5 row was paid by the pre-W route and is not a claim-paid row — so
      // the requirement is skipped there (the R4.2 pre-Phase-5 reading; merge regression that broke the
      // Phase 3 evidence, caught by the r15/r16 phase2-4 checks).
      if (!pub.manifest.envelope_keys) continue;
      const stray = row.party.startsWith("deposit:");
      const rec = stray ? undefined : (pub.envelopes ?? []).find(e => {
        const leaf = pub.frozen?.leaves.find(l => l.leaf_index === Number(row.party.slice(5)));
        return leaf && e.ciphertext_hash === leaf.ciphertext_hash;
      });
      let valid = !!rec;
      if (valid) {
        const opening = pub.opened.find(o => o.leaf_index === Number(row.party.slice(5)));
        try {
          const pt = Buffer.from(opening?.plaintext_hex ?? "", "hex");
          valid = pt.length === 128 && verifyEnvelope(pt.subarray(61, 93).toString("hex"), pub.manifest.auction_id, rec!.ciphertext_hash, rec!.envelope_ct, rec!.owner_sig)
            && pt.subarray(93, 125).toString("hex") === settlementCommitment(pt.subarray(45, 61).toString("hex"), rec!.envelope_ct);
        } catch { valid = false; }
      }
      if (!valid) requireThat(records.some(c => c.party === row.party), `claim-paid row ${row.party} without a published claim`);
    }
  });
  // R20c: result obligations and stray-deposit obligations (T1) are checked in separate passes, so one
  // class can never mask the other. Strays never gate the result checks and vice versa.
  run("accounting", () => {
    const result = pub.result;
    if (!result) return;
    const c = result.conservation;
    // Bond-then-pay adds incoming winner balances to the deposits; without bond balances_zats is absent (= 0).
    requireThat(
      BigInt(c.input_zats) + BigInt(c.balances_zats ?? "0") === BigInt(c.payout_zats) + BigInt(c.refund_zats) + BigInt(c.fees_zats),
      "conservation",
    );
    // Per-mode money rules live with the mode (checkResultModeA / checkResultBuyback) and are reached through the
    // registry — Mode B adds treasury_zats = payout + fees and the budget/fill/ask invariants (R4 item 3).
    modeEntry(pub.manifestPacket).checkResult(pub.manifest, result as ClearBody);
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    for (const [i, r] of receipts.entries()) {
      requireThat(Object.keys(r).sort().join(",") === settlementKeys, `settlement receipt ${i} shape`);
    }
    // Settlement obligations per mode live with the mode (obligationsModeA / obligationsModeB) via the registry;
    // gate CF bond-then-pay accounts balances and forfeits from the settlement's `defaults` list.
    const expected = modeEntry(pub.manifestPacket).obligations(result as ClearBody, pub.settlement);
    for (const [party, amount] of expected) {
      const rs = receipts.filter(r => r.party === party);
      const row = rows.find(r => r.party === party);
      if (rs.length === 0) {
        // R7 item 4 (R F-5 = G5): the only accepted unpaid state is a correct exception row — the refund was
        // never paid to an unauthenticated destination and awaits an owner-signed claim.
        requireThat(row && row.state === "exception" && row.amount_zats === amount, `settlement missing obligation ${party}`);
        continue;
      }
      requireThat(!(row && row.state === "exception"), `exception row ${party} with receipt`);
      requireThat(rs.length === 1, `duplicate settlement ${party}`);
      requireThat(rs[0].amount_zats === amount, `settlement ${party} amount`);
    }
    for (const row of rows) {
      if (!expected.has(row.party)) continue;
      requireThat(row.amount_zats === expected.get(row.party), `row ${row.party} amount`);
      const rs = receipts.filter(r => r.party === row.party && r.amount_zats === row.amount_zats);
      if (row.state === "exception") requireThat(rs.length === 0, `exception row ${row.party} with receipt`);
      else requireThat(rs.length > 0, `row ${row.party} without receipt`);
    }
  });
  // Part 2, collection drop (bond-then-pay): the balance window and the balance addresses are manifest-fixed
  // before bidding (R33 items 1-2) and held to their exact shape at manifest read (manifest/schema.ts
  // checkBalanceAddresses). Each signer host adds the chain-side checks from its own lightwalletd (`owns`, the
  // deposit/escrow/treasury exclusions, the start block's header time at or after R, and no note at or below the
  // window start) and derives the defaults from its own scan; never operator input. What remains public here is
  // that a settled bond auction publishes its defaults list at all (the host-signed-map rule is item 3's).
  run("balances", () => {
    const m = pub.manifest;
    const refunds = pub.settlement?.balance_refunds;
    // Ruling R38 item 4 (N4) + Ruling R40 item 2 (F2): published counts only, never addresses — one
    // {party, leaf_index, amount_zats} per late note (its own immutable `balance-late:` row, refunds to the
    // slot's own leaf), and only for a bond auction with a result. The rows themselves are held to the
    // row/receipt accounting below.
    if (refunds !== undefined) requireThat(Array.isArray(refunds) &&
      refunds.every(r => r && typeof r === "object" && Object.keys(r).sort().join(",") === "amount_zats,leaf_index,party" && isBalanceLateParty((r as any).party) && Number.isSafeInteger((r as any).leaf_index) && /^[1-9][0-9]*$/.test((r as any).amount_zats)) &&
      new Set(refunds.map(r => r.party)).size === refunds.length, "balance refunds shape");
    if (!m.bond) { requireThat(refunds === undefined, "balance refunds without bond"); return; }
    if (!pub.result) { requireThat(refunds === undefined, "balance refunds without a result"); return; } // cancelled before the clear: there are no balances to bind
    if (pub.settlement) {
      requireThat(pub.settlement.defaults !== undefined, "settled bond auction lacks the defaults list");
      // Ruling R40 item 4 (F3): the counts are host-signed data — a settled bond auction always publishes
      // them, so a coordinator can never omit real refunds silently.
      requireThat(pub.settlement.balance_refunds !== undefined, "settled bond auction lacks the balance refund counts");
    }
  });
  // Ruling R40 item 4 (F3): `settlement.balance_refunds` is bound to what the signer hosts signed, exactly
  // like `defaults`. verify requires it to equal the per-note list in two VERIFIED approval maps from
  // distinct pinned signers. A coordinator-only list — the reviewer's fabricated (20,000→25,000) or omitted
  // counts, for which rows and receipts can be regenerated to agree — is refused here with its own error.
  run("balance-refs", () => {
    const m = pub.manifest;
    if (!m.bond || !pub.settlement || pub.settlement.balance_refunds === undefined) return;
    requireThat(pub.witnessSet && m.witness_set_hash === witnessSetHash(pub.witnessSet!), "host-signed balance refunds need a pinned witness set");
    const keys = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer), m.auction_id).keys;
    const maps = (pub.settlement.approval_maps ?? []).filter(mp => !!mp && (mp as any).auction_id === m.auction_id && verifyApprovalMap(mp, keys));
    const same = (mp: { balance_refunds?: import("../clear/features").BalanceRefund[] }) => jsonBytes(mp.balance_refunds ?? null).equals(jsonBytes(pub.settlement!.balance_refunds!));
    if (maps.length > 0 && !maps.some(same)) requireThat(false, "settlement balance_refunds differ from the host-signed approval maps");
    requireThat(new Set(maps.filter(same).map(mp => mp.witness)).size >= 2,
      "settlement balance_refunds are not carried by two agreeing host-signed approval maps");
  });
  // R33 item 3 (P1-3): `settlement.defaults` is bound to what the signer hosts signed. verify requires it to
  // equal the defaults list in two VERIFIED approval maps from distinct pinned signers (the manifest's witness
  // set). A coordinator-only list — the reviewer's equal-balance swap, for which obligations, rows and receipts
  // are identical for two default sets with the same balance total — is refused here with its own error.
  run("defaults", () => {
    const m = pub.manifest;
    if (!m.bond || !pub.settlement || pub.settlement.defaults === undefined) return;
    requireThat(pub.witnessSet && m.witness_set_hash === witnessSetHash(pub.witnessSet!), "host-signed defaults need a pinned witness set");
    const keys = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, pub.signer), m.auction_id).keys;
    const maps = (pub.settlement.approval_maps ?? []).filter(mp => !!mp && (mp as any).auction_id === m.auction_id && verifyApprovalMap(mp, keys));
    const same = (mp: { defaults?: number[] }) => jsonBytes(mp.defaults ?? null).equals(jsonBytes(pub.settlement!.defaults!));
    if (maps.length > 0 && !maps.some(same)) requireThat(false, "settlement defaults differ from the host-signed approval maps");
    requireThat(new Set(maps.filter(same).map(mp => mp.witness)).size >= 2,
      "settlement defaults are not carried by two agreeing host-signed approval maps");
  });
  run("accounting-strays", () => {
    if (!pub.settlement) return;
    const receipts = pub.settlement.receipts ?? [];
    const rows = pub.settlement.rows ?? [];
    // R15 item 1 (R F4): every published row and receipt must name a recomputed result obligation or a
    // stray deposit — enforced whenever a settlement is published, including the CANCELLED path where no
    // result exists and every party must therefore be a deposit refund.
    const expected = pub.result ? modeEntry(pub.manifestPacket).obligations(pub.result as ClearBody, pub.settlement) : new Map<string, string>();
    const stray = (party: string): void => {
      // Design §6.1: a buyback's one `treasury` row returns unspent budget to the signed treasury_ua. Its amount
      // (funded − treasury_zats) rests on shielded funding notes only the signers see; they derive it from their
      // own scans before approving. Publicly it is held to the stray rules: positive, one receipt, matching amount.
      if (party === "treasury") { requireThat(treasuryBlock(pub.manifest) !== null, "treasury row outside a mode with a treasury block"); return; }
      requireThat(isAnyDepositParty(party), `party ${party} is neither a result obligation nor a stray deposit`);
    };
    // T1: each stray note ends refunded at its received value, or as an explicit exception row. Nothing is silently stranded.
    for (const r of receipts) {
      if (expected.has(r.party)) continue;
      stray(r.party);
      // R26 item 1: a zero-value note is never an obligation (it is counted as ignored below).
      requireThat(/^[1-9][0-9]*$/.test(r.amount_zats), `stray ${r.party} amount`);
      const row = rows.find(x => x.party === r.party);
      requireThat(row, `stray receipt ${r.party} without row`);
      requireThat(row!.amount_zats === r.amount_zats, `stray ${r.party} amount`);
    }
    for (const row of rows) {
      if (expected.has(row.party)) continue;
      stray(row.party);
      requireThat(/^[1-9][0-9]*$/.test(row.amount_zats), `stray ${row.party} amount`);
      const rs = receipts.filter(r => r.party === row.party);
      if (row.state === "exception") requireThat(rs.length === 0, `stray ${row.party} exception row with receipt`);
      else {
        requireThat(rs.length > 0, `stray ${row.party} not refunded or exception`);
        requireThat(rs.length === 1, `duplicate stray ${row.party}`);
        requireThat(rs[0].amount_zats === row.amount_zats, `stray ${row.party} amount`);
      }
    }
    // R26 item 1: the zero-value notes the plan ignored are counted here — each is a distinct deposit
    // party at amount 0, with no row and no receipt ever paying it.
    const ignored = pub.settlement.ignored ?? [];
    for (const [i, ig] of ignored.entries()) {
      requireThat(ig && typeof ig === "object" && Object.keys(ig).sort().join(",") === "amount_zats,party", `ignored ${i} shape`);
      requireThat(isDepositParty(ig.party), `ignored ${i} party`);
      requireThat(ig.amount_zats === "0", `ignored ${i} amount`);
    }
    requireThat(new Set(ignored.map(i => i.party)).size === ignored.length, "duplicate ignored zero-value note");
    for (const ig of ignored) {
      requireThat(!rows.some(r => r.party === ig.party) && !receipts.some(r => r.party === ig.party),
        `ignored zero-value note ${ig.party} paid`);
    }
  });
  return checks;
}

function releaseTime(m: Manifest): number {
  return m.drand.genesis + (m.drand.R - 1) * m.drand.period;
}

export function operatorView(pub: PublicAuction): {
  auction_id: string; C_zats: string; count: number; total_collateral_zats: string;
  blobs: { leaf_index: number; ciphertext_hash: string; ciphertext_hex: string }[];
} {
  // Pre-freeze there is no frozen set to take blobs from; counts track admitted receipts instead (R21 item 5).
  const leaves = pub.frozen?.leaves ?? [];
  const count = pub.frozen ? pub.frozen.leaf_count : pub.receipts.length;
  return {
    auction_id: pub.manifest.auction_id,
    C_zats: pub.manifest.C_zats,
    count,
    total_collateral_zats: (BigInt(pub.manifest.C_zats) * BigInt(count)).toString(),
    blobs: leaves.map(l => ({
      leaf_index: l.leaf_index,
      ciphertext_hash: l.ciphertext_hash,
      ciphertext_hex: l.ciphertext_hex,
    })),
  };
}

export function freezeBoard(pub: PublicAuction): {
  auction_id: string; manifest_hash: string; frozen: boolean; root: string | null; leaf_count: number;
  cutoff: number | null; published_at: number | null;
  leaves: { leaf_index: number; ciphertext_hash: string }[];
  paths: { side: string; hash: string }[][];
} {
  const frozen = pub.frozen;
  if (!frozen) return {
    auction_id: pub.manifest.auction_id, manifest_hash: pub.manifest_hash, frozen: false,
    root: null, leaf_count: 0, cutoff: null, published_at: null, leaves: [], paths: [],
  };
  return {
    auction_id: frozen.auction_id,
    manifest_hash: frozen.manifest_hash,
    frozen: true,
    root: frozen.root,
    leaf_count: frozen.leaf_count,
    cutoff: frozen.cutoff,
    published_at: frozen.published_at,
    leaves: frozen.leaves.map(l => ({ leaf_index: l.leaf_index, ciphertext_hash: l.ciphertext_hash })),
    paths: frozen.paths,
  };
}

export function receiptShow(pub: PublicAuction, ciphertextHash: string, packet?: Signed): {
  inclusion: Record<string, unknown>;
  settlement: SettlementReceipt | null;
} {
  requireThat(pub.frozen, "missing frozen");
  const frozen = pub.frozen as Frozen;
  requireThat(/^[0-9a-f]{64}$/.test(ciphertextHash), "ciphertext hash");
  const leaf = frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  let signed: Record<string, unknown> | null = null;
  if (packet) {
    signed = verifyRecord<Record<string, unknown>>(packet, pub.signer);
    requireThat(signed.ciphertext_hash === ciphertextHash, "receipt ciphertext hash");
    requireThat(signed.leaf_index === leaf!.leaf_index, "receipt leaf index");
  }
  const included = member(leaf!.ciphertext_hash, leaf!.deposit, leaf!.leaf_index, frozen.leaf_count, frozen.paths[leaf!.leaf_index] ?? [], frozen.root);
  const inclusion: Record<string, unknown> = {
    auction_id: leaf!.auction_id,
    manifest_hash: leaf!.manifest_hash,
    ciphertext_hash: leaf!.ciphertext_hash,
    deposit: leaf!.deposit,
    leaf_index: leaf!.leaf_index,
    included,
    receipt_signed: Boolean(packet),
  };
  const party = `leaf:${leaf!.leaf_index}`;
  const settlement = pub.settlement?.receipts?.find(r => r.party === party) ?? null;
  return { inclusion, settlement };
}

// R3 item 6: the inclusion proof is a self-contained bundle — root, path, leaf — so anyone can recheck it offline.
export type InclusionProof = {
  auction_id: string; manifest_hash: string; root: string; leaf_count: number; leaf_index: number;
  ciphertext_hash: string; deposit: Deposit; path: Path; included: boolean;
};
export function inclusionProof(pub: PublicAuction, ciphertextHash: string): InclusionProof {
  requireThat(pub.frozen, "missing frozen");
  const frozen = pub.frozen as Frozen;
  requireThat(/^[0-9a-f]{64}$/.test(ciphertextHash), "ciphertext hash");
  const leaf = frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  const path = frozen.paths[leaf!.leaf_index] ?? [];
  return {
    auction_id: frozen.auction_id, manifest_hash: frozen.manifest_hash, root: frozen.root,
    leaf_count: frozen.leaf_count, leaf_index: leaf!.leaf_index, ciphertext_hash: leaf!.ciphertext_hash,
    deposit: leaf!.deposit, path,
    included: member(leaf!.ciphertext_hash, leaf!.deposit, leaf!.leaf_index, frozen.leaf_count, path, frozen.root),
  };
}
export function checkInclusionProof(proof: InclusionProof): boolean {
  return member(proof.ciphertext_hash, proof.deposit, proof.leaf_index, proof.leaf_count, proof.path, proof.root);
}

// R3 item 7: owner-key-signed settlement statement (auction, leaf, fill, price, payout/refund txid), checkable
// against result.json and the chain. payout_txid is set only when the mode owes this leaf a payment (via the
// registry's obligations); both txids name the leaf's settlement receipt and stay null until settlement.
export type SettlementStatement = {
  version: 1; auction_id: string; ciphertext_hash: string; leaf_index: number; fill: number;
  price_zats: string | null; clearing_price_zats: string; payment_zats: string; refund_zats: string;
  // Gate CF: the winner's unpaid balance is due within its window (bond-then-pay); "0" without bond.
  balance_due_zats: string;
  payout_txid: string | null; refund_txid: string | null; owner_pubkey: string; signature: string;
};
export type StatementBody = Omit<SettlementStatement, "signature">;
const statementFields = "auction_id,balance_due_zats,ciphertext_hash,clearing_price_zats,fill,leaf_index,owner_pubkey,payment_zats,payout_txid,price_zats,refund_txid,refund_zats,signature,version";
export function settlementStatementBody(pub: PublicAuction, ciphertextHash: string): StatementBody {
  requireThat(pub.frozen && pub.result, "missing frozen or result");
  const frozen = pub.frozen as Frozen, result = pub.result as PublicResult;
  const leaf = frozen.leaves.find(l => l.ciphertext_hash === ciphertextHash);
  requireThat(leaf, "ciphertext not in frozen set");
  const a = result.allocations.find(x => x.leaf_index === leaf!.leaf_index);
  requireThat(a, "allocation missing");
  const opening = pub.opened.find(o => o.leaf_index === leaf!.leaf_index);
  requireThat(opening && /^[0-9a-f]{256}$/.test(opening!.plaintext_hex ?? ""), "opening for statement");
  const owner_pubkey = Buffer.from(opening!.plaintext_hex!, "hex").subarray(61, 93).toString("hex");
  const owed = BigInt(modeEntry(pub.manifestPacket).obligations(result as ClearBody, pub.settlement).get(`leaf:${leaf!.leaf_index}`) ?? "0");
  const receipt = (pub.settlement?.receipts ?? []).find(r => r.party === `leaf:${leaf!.leaf_index}`);
  const clearing_price_zats = a!.tranche === "holder" && result.holder_price_zats !== undefined
    ? result.holder_price_zats
    : a!.lot === undefined
    ? result.clearing_price_zats
    : (result.lots ?? []).find(l => l.lot_id === a!.lot)?.clearing_price_zats ?? result.clearing_price_zats;
  return {
    version: 1, auction_id: frozen.auction_id, ciphertext_hash: ciphertextHash, leaf_index: leaf!.leaf_index,
    fill: a!.fill, price_zats: a!.price_zats, clearing_price_zats,
    payment_zats: a!.payment_zats, refund_zats: a!.refund_zats,
    // Gate CF: the winner's unpaid balance is due within its window (bond-then-pay); "0" without bond.
    balance_due_zats: a!.balance_due_zats ?? "0",
    payout_txid: receipt && owed > BigInt(a!.refund_zats) ? receipt.txid : null,
    refund_txid: receipt ? receipt.txid : null,
    owner_pubkey,
  };
}
export function checkSettlementStatement(pub: PublicAuction, ciphertextHash: string, statement: SettlementStatement): void {
  requireThat(statement && typeof statement === "object" && !Array.isArray(statement), "statement shape");
  requireThat(Object.keys(statement).sort().join(",") === statementFields, "statement field set");
  requireThat(/^[0-9a-f]{128}$/.test(String(statement.signature)), "statement signature");
  const { signature, ...body } = statement;
  const wanted = settlementStatementBody(pub, ciphertextHash);
  requireThat(jsonBytes(body).equals(jsonBytes(wanted)), "statement differs from result/settlement");
  requireThat(verifyStatement(wanted.owner_pubkey, body, signature), "statement signature");
}

export function resultHash(pub: PublicAuction): string | null {
  return pub.resultBytes ? hash(pub.resultBytes) : null;
}
