// The house operator. It runs every round this site hosts, in all six markets, through the operator guide's lifecycle
// (the commands tools/doc-walk.sh and tools/repro/markets.ts run, in the same order): DKG on the three hosts,
// addresses, pinned keys, witness set, round R, create, sign, publish, admission (through the intake), freeze, witness
// certificates, open at R, clear, the hosts' envelope-opening reports, settle, verify.
// Two sources of rounds: house rounds (one always taking bids in each house market, with two house bids so it never
// clears against nothing) and rounds people start on the site (gateway/requests.ts). State survives restarts
// (STATE/web/runner.json). Off unless the gateway runs with --runner.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { benzo } from "./cli";
import type { Intake } from "./intake";

export type Mode = "uniform" | "drop" | "launch" | "buyback" | "otc" | "rfq";
export const MODES: Mode[] = ["uniform", "drop", "launch", "buyback", "otc", "rfq"];
// What a round is: everything the manifest needs that is not the operator's own (keys, addresses, times).
export type Spec = {
  mode: Mode; lot: string; lots?: string[]; supply: number; reserve_zats: string; B_max_zats: string; tick_zats: string; C_zats: string;
  submit_min: number; payout_ua?: string; house_bids: number;
  launch?: { minimum_raise_zats: string };
  buyback?: { budget_zats: string; max_price_zats: string; treasury_ua?: string };
  otc?: { buyer_key: string; seller_key: string };
  rfq?: { dealer_keys: string[]; budget_zats: string; max_price_zats: string; treasury_ua: string };
  request?: string; // the site request that asked for it
};
type Phase = "setup" | "accepting" | "frozen" | "witnessed" | "settling" | "done" | "failed";
type Live = {
  id: string; phase: Phase; spec: Spec; lot: string; signer?: string; pub: string; slots: string[]; fee?: string; funding_ua?: string; house: number;
  T_submit: number; T_freeze: number; R: number; release: number; created: number;
  reserved: Record<string, number>; log: string[]; error?: string; retries: number;
};

// The house wallet under the state dir (and its age identity, <name>.age): "bidder" unless BNZ_WEB_HOUSE_WALLET names
// another, so a live drive of the site can run beside other testnet runs without two writers on one wallet.
const HOUSE_WALLET = process.env.BNZ_WEB_HOUSE_WALLET ?? "bidder";
// The CLI pays house bids (`bid deposit --pay`) from the same house wallet.
process.env.BNZ_PAY_WALLET ??= HOUSE_WALLET;
const QUICKNET = { genesis: 1692803367, period: 3 };
// A drop's lots, as the manifest names them: one 64-hex id per lot (the schema's rule), from its place and its name.
// The names stay with the round here (the site shows the round's title; the bid page shows "Lot 1", "Lot 2", …).
const lotIds = (lots: string[]) => lots.map((name, i) => createHash("sha256").update(`benzo lot ${i + 1}: ${name}`).digest("hex"));
const env = (k: string, d: number) => Number(process.env[k] ?? d);
const SUBMIT_MIN = env("BNZ_WEB_SUBMIT_MIN", 40), CONFIRM_MIN = env("BNZ_WEB_CONFIRM_MIN", 25), SLOTS = env("BNZ_WEB_SLOTS", 8);
const HOUSE = env("BNZ_WEB_HOUSE_BIDS", 2), MAX_ROUNDS = env("BNZ_WEB_MAX_ROUNDS", 1000), MAX_SETUP_TRIES = 3;
const HOUSE_MARKETS = (process.env.BNZ_WEB_HOUSE_MARKETS ?? "uniform,launch,drop,buyback").split(",").filter(Boolean) as Mode[];
const NAMES = ["Night", "Silver", "Chrome", "Quiet", "Moon", "Comet", "Dust", "Orbit", "Mirror", "Ember"];

// The house round of each market: small zat amounts, so a deposit of C = 200,000 covers any order (no bond).
export function houseSpec(mode: Mode, n: number): Spec {
  const name = `${NAMES[n % NAMES.length]} ${Math.floor(n / NAMES.length) + 1}`;
  const base = { reserve_zats: "100", B_max_zats: "3000", tick_zats: "10", C_zats: "200000", submit_min: SUBMIT_MIN, house_bids: HOUSE };
  if (mode === "drop") return { ...base, mode, lot: `${name} drop`, lots: ["Lot A", "Lot B", "Lot C"], supply: 1 };
  if (mode === "launch") return { ...base, mode, lot: `${name} launch`, supply: 3, launch: { minimum_raise_zats: "900" } };
  if (mode === "buyback") return { ...base, mode, lot: `${name} buyback`, supply: 2, reserve_zats: "10", buyback: { budget_zats: "600", max_price_zats: "300" } };
  return { ...base, mode: "uniform", lot: `${name} lot`, supply: 2 };
}
// A house bid's price, inside the round's limits (asks for a buyback sit under its maximum price).
const housePrice = (s: Spec) => s.mode === "buyback" ? 150 + 10 * Math.floor(Math.random() * 14) : 400 + 10 * Math.floor(Math.random() * 40);
const spki = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("hex");

export class Runner {
  private file: string;
  private auctions: Live[] = [];
  private busy = false;
  private frostd: ChildProcess | null = null;
  private timer: NodeJS.Timeout;
  private queue: Spec[] = [];
  private lastWait = "";
  constructor(private root: string, private state: string, private intake: Intake, private onCreated: (request: string, id: string | null, error?: string) => void = () => {}) {
    this.file = path.join(state, "web", "runner.json");
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, "utf8"));
      this.auctions = (Array.isArray(saved) ? saved : saved.auctions).map((a: any) => ({ ...a, spec: a.spec ?? houseSpec("uniform", 0) }));
      this.queue = Array.isArray(saved) ? [] : saved.queue ?? [];
    }
    // A round interrupted during setup has a half-made state on the hosts; it is never resumed blindly.
    for (const a of this.auctions) if (a.phase === "setup") { a.phase = "failed"; a.error = "interrupted during setup"; if (a.spec.request) this.onCreated(a.spec.request, null, a.error); }
    this.timer = setInterval(() => void this.tick(), 20_000);
    void this.tick();
  }

  private save() { writeFileSync(this.file, JSON.stringify({ auctions: this.auctions, queue: this.queue }, null, 1), { mode: 0o600 }); }
  private say(a: Live, line: string) { a.log.push(`${new Date().toISOString()} ${line}`); a.log = a.log.slice(-60); this.save(); process.stdout.write(`[runner ${a.id.slice(0, 8)} ${a.spec.mode}] ${line}\n`); }
  private run(args: string[], input?: unknown) { return benzo(this.root, this.state, args, input); }

  isLive(id: string) { return this.auctions.some((a) => a.id === id && a.phase === "accepting" && Date.now() / 1000 < a.T_submit); }
  // The round's own title (a drop's manifest names its lots, not the round).
  title(id: string) { return this.auctions.find((x) => x.id === id)?.lot ?? null; }
  freeSlots(id: string) { const a = this.auctions.find((x) => x.id === id); return a ? this.openSlots(a).length : null; }
  list() { return this.auctions.map(({ log, reserved, ...a }) => a); }
  queued() { return this.queue.length; }
  // A round the runner gave up on ("FAILED; needs the operator") before it paid out: the site says so.
  stopped(id: string) { return this.auctions.some((a) => a.id === id && a.phase === "failed"); }
  // Settled and verified by the runner (a round with nothing to pay keeps the state CLEARED).
  finished(id: string) { return this.auctions.some((a) => a.id === id && a.phase === "done"); }
  // The operator's view (/api/ops/runner): every round's phase, last error and last log lines.
  opsList() { return this.auctions.map((a) => ({ id: a.id, mode: a.spec.mode, phase: a.phase, retries: a.retries, error: a.error, log: a.log.slice(-6) })); }
  // Put a round that gave up ("FAILED; needs the operator") back at the step it reached, for another six tries. Each
  // step refuses to run twice, so a step that already happened is skipped (the "settling" resume path).
  retry(id: string) {
    const a = this.auctions.find((x) => x.id === id);
    if (!a || a.phase !== "failed") return { ok: false, error: a ? `phase is ${a.phase}` : "unknown round" };
    const did = (w: string) => a.log.some((l) => l.includes(w));
    const phase = did("opened at round R") || did("cleared") || did("in settling") ? "settling" : did("witness certificates published") ? "witnessed" : did("frozen") ? "frozen" : null;
    if (!phase) return { ok: false, error: "it failed before it was frozen; nothing to resume" };
    a.phase = phase as Live["phase"]; a.retries = 0; this.say(a, `operator retry from ${phase}`);
    return { ok: true, phase };
  }
  // The treasury funding a round needs before its sellers can be admitted (buyback, RFQ): pay `budget` to `address`.
  funding(id: string) {
    const a = this.auctions.find((x) => x.id === id);
    const budget = a?.spec.buyback?.budget_zats ?? a?.spec.rfq?.budget_zats;
    return a?.funding_ua && budget ? { address: a.funding_ua, amount_zats: budget, house: !a.spec.request } : null;
  }
  // A round someone started on the site: built in turn, after the rounds already queued.
  enqueue(spec: Spec) { this.queue.push(spec); this.save(); void this.tick(); return this.queue.length; }

  // Web slots: the deposit addresses after the house bids', not used by a submitted record, not held by another visitor.
  // OTC and RFQ rounds give each pinned party its own slot (slot i belongs to party i).
  private openSlots(a: Live) {
    const now = Date.now() / 1000, used = new Set(this.usedAddresses(a.id));
    return a.slots.slice(a.house).filter((s) => !used.has(s) && !((a.reserved[s] ?? 0) > now));
  }
  private usedAddresses(id: string): string[] {
    const d = path.join(this.state, "web", "intake", id);
    if (!existsSync(d)) return [];
    return readdirSync(d).map((f: string) => JSON.parse(readFileSync(path.join(d, f), "utf8"))).filter((i: any) => i.status !== "refused").map((i: any) => i.address);
  }
  reserveSlot(id: string, party?: number) {
    const a = this.auctions.find((x) => x.id === id);
    if (!a || !this.isLive(id)) throw new Error("this round is not taking bids");
    const pinned = a.spec.mode === "otc" || a.spec.mode === "rfq";
    const free = pinned ? (party !== undefined && a.slots[party] && this.openSlots(a).includes(a.slots[party]) ? [a.slots[party]] : []) : this.openSlots(a);
    if (!free.length) throw new Error(pinned ? "this party's slot is taken or unknown" : "every deposit slot of this round is taken");
    const held_until = Math.min(a.T_submit, Math.floor(Date.now() / 1000) + 30 * 60);
    a.reserved[free[0]] = held_until; this.save();
    return { address: free[0], slot: a.slots.indexOf(free[0]), held_until };
  }

  private async ensureFrostd() {
    const port = Number((process.env.BNZ_FROSTD_ADDR ?? "localhost:2744").split(":").at(-1));
    const open = await new Promise<boolean>((r) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); r(true); }); s.on("error", () => r(false)); });
    if (open || this.frostd) return;
    const S = this.state;
    this.frostd = spawn(path.join(S, "bin/frostd"), ["-i", process.env.BNZ_FROSTD_BIND ?? "127.0.0.1", "-p", String(port), "-c", path.join(S, "tls/frostd.pem"), "-k", path.join(S, "tls/frostd.key")], { stdio: "ignore" });
    this.frostd.on("exit", () => { this.frostd = null; });
    await new Promise((r) => setTimeout(r, 2000));
  }

  private walletUa() {
    return execFileSync(path.join(this.root, "settle/target/release/benzo-pczt"), ["address", path.join(this.state, HOUSE_WALLET), "--network", "test"], { encoding: "utf8" }).trim().split("\n").at(-1)!;
  }
  // The house wallet's spendable balance: a round is set up only when its funding can be paid now.
  private spendable(): number {
    try {
      const S = this.state, lwd = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
      execFileSync(path.join(S, "bin/zcash-devtool"), ["wallet", "-w", path.join(S, HOUSE_WALLET), "sync", "-s", lwd], { stdio: "ignore", timeout: 10 * 60_000 });
      const b = JSON.parse(execFileSync(path.join(S, "bin/zcash-devtool"), ["wallet", "-w", path.join(S, HOUSE_WALLET), "balance", "--json"], { encoding: "utf8", timeout: 60_000 }));
      return Number(b.ironwood_spendable ?? 0) + Number(b.orchard_spendable ?? 0) + Number(b.sapling_spendable ?? 0);
    } catch { return 0; }
  }
  private pay(uri: string): string {
    const S = this.state, lwd = process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443";
    const out = execFileSync(path.join(S, "bin/zcash-devtool"), ["wallet", "-w", path.join(S, HOUSE_WALLET), "pay", "-i", path.join(S, `${HOUSE_WALLET}.age`), "--disable-confirmation", "-s", lwd, "--payment-uri", uri], { encoding: "utf8", timeout: 15 * 60_000 });
    const txid = out.match(/^[0-9a-f]{64}$/gm)?.at(-1);
    if (!txid) throw new Error("the house wallet produced no txid");
    return txid;
  }
  private async latestRound(): Promise<number> {
    const hashHex = process.env.BNZ_DRAND_CHAIN_HASH ?? "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
    for (const u of [...(process.env.BNZ_DRAND_URLS ?? "").split(",").filter(Boolean), "https://api.drand.sh"]) {
      try { const r = await fetch(`${u}/${hashHex}/public/latest`, { signal: AbortSignal.timeout(8000) }); if (r.ok) return (await r.json()).round; } catch { /* next relay */ }
    }
    return 0; // a failed poll means "not yet", never "released"
  }
  private chainTip(): number {
    const S = this.state;
    const out = execFileSync(path.join(S, "bin/grpcurl"), ["-max-time", "8", "-import-path", path.join(S, "proto"), "-proto", "service.proto", process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443", "cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock"], { encoding: "utf8", timeout: 15_000 });
    return Number(JSON.parse(out).height);
  }

  // How much the house pays to set a round up: its house bids' deposits, the fee reserve, a house treasury budget.
  private cost(s: Spec) {
    const notes = SLOTS + 2, rows = SLOTS + 1, reserve = Math.max(60_000, 5000 * (notes + rows + 2 * Math.ceil(rows / 13)) + 5000);
    const treasury = !s.request && s.buyback ? Number(s.buyback.budget_zats) : 0;
    return { reserve, treasury, total: s.house_bids * Number(s.C_zats) + reserve + treasury + 5000 * (s.house_bids + 3) + 3 * Number(s.C_zats) + 40_000 };
  }

  private async create(spec: Spec) {
    const id = randomBytes(32).toString("hex"), mode = spec.mode;
    const slotCount = mode === "otc" ? 2 : mode === "rfq" ? spec.rfq!.dealer_keys.length : Math.max(SLOTS, spec.house_bids + 2);
    const a: Live = { id, phase: "setup", spec, lot: spec.lot, pub: path.join(this.root, "tmp/web/public", id), slots: [], house: spec.house_bids,
      T_submit: 0, T_freeze: 0, R: 0, release: 0, created: Math.floor(Date.now() / 1000), reserved: {}, log: [], retries: 0 };
    this.auctions.push(a); this.save();
    const priv = path.join(this.state, "web", "run", id);
    mkdirSync(priv, { recursive: true, mode: 0o700 });
    try {
      await this.ensureFrostd();
      this.say(a, "hosts dkg");
      const dkg = await this.run(["hosts", "dkg", "--id", id]);
      const treasuryMode = mode === "buyback" || mode === "rfq";
      const addr = await this.run(["auction", "addresses", "--id", id, "--count", String(slotCount + (treasuryMode ? 1 : 0))]);
      a.slots = [dkg.escrow_ua, ...addr.addresses.slice(0, slotCount - 1)]; a.fee = addr.addresses[slotCount - 1];
      if (treasuryMode) a.funding_ua = addr.addresses[slotCount];
      const keys = await this.run(["hosts", "keys"]);
      const ws = await this.run(["witness", "set", "--id", id, "--q", "2", "--keys", keys.witness_keys.join(",")]);
      const now = Math.floor(Date.now() / 1000);
      a.T_submit = now + spec.submit_min * 60; a.T_freeze = a.T_submit + CONFIRM_MIN * 60;
      const round = await this.run(["drand", "round", "--at", new Date((a.T_freeze + 3 * 60) * 1000).toISOString()]);
      a.R = round.round; a.release = QUICKNET.genesis + (a.R - 1) * QUICKNET.period;
      const house = this.walletUa(), payout = spec.payout_ua ?? house;
      const m = JSON.parse(readFileSync(path.join(this.root, "docs/examples/unsigned-manifest.json"), "utf8"));
      Object.assign(m, { network: "test", auction_id: id, escrow_ua: dkg.escrow_ua, frost_group_key: dkg.group_key, supply: spec.supply, reserve_zats: spec.reserve_zats, tick_zats: spec.tick_zats,
        B_max_zats: spec.B_max_zats, q_max: 1, C_zats: spec.C_zats, fee_zats: "0", deposit_addresses: a.slots, envelope_keys: keys.envelope_keys, witness_set_hash: ws.witness_set_hash, T_submit: a.T_submit, T_freeze: a.T_freeze });
      m.drand.R = a.R;
      m.clearing = { ...m.clearing, mode: mode === "drop" ? "uniform" : mode };
      if (spec.lots) { delete m.lot; m.lots = lotIds(spec.lots); } else m.lot = spec.lot;
      if (mode === "launch") m.launch = { standard_lot_size: 1, minimum_raise_zats: spec.launch!.minimum_raise_zats };
      if (mode === "buyback") m.buyback = { budget_zats: spec.buyback!.budget_zats, max_price_zats: spec.buyback!.max_price_zats, treasury_ua: spec.buyback!.treasury_ua ?? house, funding_ua: a.funding_ua };
      if (mode === "otc") { m.otc = { ...spec.otc! }; m.reserve_zats = "0"; m.supply = 1; }
      if (mode === "rfq") m.rfq = { dealer_keys: spec.rfq!.dealer_keys, max_price_zats: spec.rfq!.max_price_zats, budget_zats: spec.rfq!.budget_zats, delivery_deadline_height: this.chainTip() + 20000,
        delivery_signers: [spki(), spki(), spki()], treasury_ua: spec.rfq!.treasury_ua, funding_ua: a.funding_ua };
      for (const k of Object.keys(m)) if (/_commitment$/.test(k)) delete m[k];
      const cfg = JSON.parse(readFileSync(path.join(this.root, "docs/examples/private-operator.json"), "utf8"));
      const { reserve, treasury } = this.cost(spec);
      cfg.routing.bidders = a.slots.map((deposit_ua) => ({ deposit_ua })); cfg.routing.seller_ua = payout; cfg.routing.fee_reserve_ua = a.fee; cfg.routing.reserve_return_ua = house;
      writeFileSync(path.join(priv, "unsigned-manifest.json"), JSON.stringify(m, null, 2), { mode: 0o600 });
      writeFileSync(path.join(priv, "private-operator.json"), JSON.stringify(cfg, null, 2), { mode: 0o600 });
      this.say(a, `create (R ${a.R}, bids until ${new Date(a.T_submit * 1000).toISOString()})`);
      await this.run(["auction", "create", "--file", path.join(priv, "unsigned-manifest.json"), "--witness-set", ws.file, "--config", path.join(priv, "private-operator.json")]);
      a.signer = (await this.run(["auction", "sign", "--id", id])).signer;
      mkdirSync(path.dirname(a.pub), { recursive: true });
      await this.run(["auction", "publish", "--id", id, "--dir", a.pub, "--config", path.join(priv, "private-operator.json")]);
      // The house bids (and the fee reserve, and a house round's treasury budget) in one funding transaction.
      const sealed: any[] = [];
      for (let i = 0; i < a.house; i++) {
        const input: any = { price_zats: String(housePrice(spec)), quantity: 1, address: a.slots[i], refund_ua: house };
        if (spec.lots) input.lot = lotIds(spec.lots)[i % spec.lots.length];
        const s = await this.run(["bid", "seal", "--manifest", path.join(a.pub, "manifest.json"), "--signer", a.signer!], input);
        sealed.push({ ...s, address: a.slots[i] });
      }
      // No house bids (OTC, RFQ, a started round): the fee reserve is paid alone, straight from the house wallet.
      const paid = sealed.length ? await this.run(["bid", "deposit", "--id", id, "--pay"], { bids: sealed.map((s) => ({ uri: s.uri, address: s.address, envelope_hex: s.envelope_hex })),
        reserve: { address: a.fee, amount_zats: String(reserve) }, ...(treasury ? { treasury: { amount_zats: String(treasury) } } : {}) })
        : { txid: this.pay(`zcash:${a.fee}?amount=${(reserve / 1e8).toFixed(8)}`) };
      for (const s of sealed) this.intake.submit(id, { address: s.address, txid: paid.txid, envelope_hex: s.envelope_hex, envelope_ct_hex: s.envelope_ct_hex, owner_sig_hex: s.owner_sig_hex, ciphertext_hash: s.ciphertext_hash }, true);
      a.phase = "accepting";
      this.say(a, `taking bids (house funding ${paid.txid.slice(0, 12)}…)`);
      if (spec.request) this.onCreated(spec.request, id);
    } catch (e) {
      a.phase = "failed"; a.error = String((e as Error).message).slice(0, 400); this.say(a, `FAILED in setup: ${a.error}`);
      if (spec.request) this.onCreated(spec.request, null, a.error);
    }
  }

  private async advance(a: Live) {
    const now = Math.floor(Date.now() / 1000);
    try {
      if (a.phase === "accepting" && now >= a.T_submit + 5) {
        // Freeze once every submitted record is admitted or refused, and always before the cutoff (T_freeze).
        if (this.intake.pending(a.id) > 0 && now < a.T_freeze - 150) return;
        await this.run(["freeze", "--id", a.id]);
        this.intake.close(a.id, "the round froze before this deposit was admitted; it refunds through its owner key");
        a.phase = "frozen"; this.say(a, "frozen");
      }
      if (a.phase === "frozen") {
        await this.run(["hosts", "witness", "--id", a.id, "--names", "alice,bob"]);
        a.phase = "witnessed"; this.say(a, "witness certificates published");
      }
      if (a.phase === "witnessed" && (await this.latestRound()) >= a.R) {
        a.phase = "settling"; this.save();
        await this.run(["open", "--id", a.id]); this.say(a, "opened at round R");
        await this.run(["clear", "--id", a.id]); this.say(a, "cleared");
        await this.run(["hosts", "envelope-opens", "--id", a.id]);
        await this.run(["settle", "--id", a.id]); this.say(a, "settled");
        await this.run(["verify", "--dir", a.pub, "--signer", a.signer!]); this.say(a, "verified");
        a.phase = "done"; this.save();
      } else if (a.phase === "settling") {
        // A settle interrupted by a restart: open/clear refuse a second run, so pick up where the ledger is.
        for (const step of [["open"], ["clear"], ["hosts", "envelope-opens"], ["settle"]]) await this.run([...step, "--id", a.id]).catch((e: Error) => { if (!/already|state|OPENED|CLEARED|SETTLED|refus/i.test(e.message)) throw e; });
        await this.run(["verify", "--dir", a.pub, "--signer", a.signer!]); this.say(a, "settled and verified");
        a.phase = "done"; this.save();
      }
      a.retries = 0;
    } catch (e) {
      a.retries++; a.error = String((e as Error).message).slice(0, 400);
      this.say(a, `retry ${a.retries} in ${a.phase}: ${a.error}`);
      if (a.retries >= 6) { a.phase = "failed"; this.say(a, "FAILED; needs the operator"); }
    }
  }

  async tick() {
    if (this.busy || process.env.BNZ_WEB_RUNNER_PAUSE === "1") return;
    this.busy = true;
    try {
      for (const a of this.auctions.filter((x) => ["accepting", "frozen", "witnessed", "settling"].includes(x.phase))) {
        const t0 = Date.now(); await this.advance(a);
        if (Date.now() - t0 > 60_000) console.log(`[runner ${a.id.slice(0, 8)} ${a.spec.mode}] ${a.phase}: one step took ${Math.round((Date.now() - t0) / 1000)} s`);
      }
      if (this.auctions.length >= MAX_ROUNDS) return;
      // Next round to build: a queued request first, else the first house market with no round taking bids.
      const taking = (m: Mode) => this.auctions.some((a) => !a.spec.request && a.spec.mode === m && (a.phase === "setup" || (a.phase === "accepting" && Date.now() / 1000 < a.T_submit)));
      const recentFails = (m: Mode) => this.auctions.filter((a) => !a.spec.request && a.spec.mode === m && a.phase === "failed" && Date.now() / 1000 - a.created < 3600).length;
      const houseNext = HOUSE_MARKETS.find((m) => !taking(m) && recentFails(m) < MAX_SETUP_TRIES);
      const next = this.queue[0] ?? (houseNext ? houseSpec(houseNext, this.auctions.filter((a) => !a.spec.request).length) : null);
      if (!next) return;
      const have = this.spendable(), need = this.cost(next).total;
      if (have < need) { // wait for the house wallet's change to mature (said once per change, so the log shows why a round waits)
        const why = `waiting for house funds: spendable ${have}, the next round (${next.mode}${next.request ? ", requested" : ""}) needs ${need}; ${this.queue.length} queued`;
        if (why !== this.lastWait) { console.log(`[runner] ${why}`); this.lastWait = why; }
        return;
      }
      this.lastWait = "";
      if (this.queue[0] === next) { this.queue.shift(); this.save(); }
      await this.create(next);
    } finally { this.busy = false; }
  }

  stop() { clearInterval(this.timer); this.frostd?.kill(); }
}
