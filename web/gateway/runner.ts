// The house operator: keeps one uniform-price auction open for bids on Zcash testnet at all times, and walks each one
// through the operator guide's lifecycle (the same commands, in the same order, as tools/doc-walk.sh): DKG on the
// three hosts, addresses, pinned keys, witness set, round R, create, sign, publish, two house bids so a round is never
// empty, admission (through the intake), freeze, witness certificates, open at R, clear, the hosts' envelope-opening
// reports, settle, verify. State survives restarts (STATE/web/runner.json). Off unless the gateway runs with --runner.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { benzo } from "./cli";
import type { Intake } from "./intake";

type Phase = "setup" | "accepting" | "frozen" | "witnessed" | "settling" | "done" | "failed";
type Live = {
  id: string; phase: Phase; lot: string; signer?: string; pub: string; slots: string[]; fee?: string; house: number;
  T_submit: number; T_freeze: number; R: number; release: number; created: number;
  reserved: Record<string, number>; log: string[]; error?: string; retries: number;
};

const QUICKNET = { genesis: 1692803367, period: 3 };
const env = (k: string, d: number) => Number(process.env[k] ?? d);
const SUBMIT_MIN = env("BNZ_WEB_SUBMIT_MIN", 40), CONFIRM_MIN = env("BNZ_WEB_CONFIRM_MIN", 25), SLOTS = env("BNZ_WEB_SLOTS", 8);
const HOUSE = env("BNZ_WEB_HOUSE_BIDS", 2), SUPPLY = env("BNZ_WEB_SUPPLY", 2), MAX_ROUNDS = env("BNZ_WEB_MAX_ROUNDS", 1000);
const LOTS = ["Night Lot", "Silver Lot", "Chrome Lot", "Quiet Lot", "Moon Lot", "Comet Lot", "Dust Lot", "Orbit Lot", "Mirror Lot", "Ember Lot"];

export class Runner {
  private file: string;
  private auctions: Live[] = [];
  private busy = false;
  private frostd: ChildProcess | null = null;
  private timer: NodeJS.Timeout;
  constructor(private root: string, private state: string, private intake: Intake) {
    this.file = path.join(state, "web", "runner.json");
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (existsSync(this.file)) this.auctions = JSON.parse(readFileSync(this.file, "utf8"));
    // A round interrupted during setup has a half-made state on the hosts; it is never resumed blindly.
    for (const a of this.auctions) if (a.phase === "setup") { a.phase = "failed"; a.error = "interrupted during setup"; }
    this.timer = setInterval(() => void this.tick(), 20_000);
    void this.tick();
  }

  private save() { writeFileSync(this.file, JSON.stringify(this.auctions, null, 1), { mode: 0o600 }); }
  private say(a: Live, line: string) { a.log.push(`${new Date().toISOString()} ${line}`); a.log = a.log.slice(-60); this.save(); process.stdout.write(`[runner ${a.id.slice(0, 8)}] ${line}\n`); }
  private run(args: string[], input?: unknown) { return benzo(this.root, this.state, args, input); }

  isLive(id: string) { return this.auctions.some((a) => a.id === id && a.phase === "accepting" && Date.now() / 1000 < a.T_submit); }
  freeSlots(id: string) { const a = this.auctions.find((x) => x.id === id); return a ? this.openSlots(a).length : null; }
  list() { return this.auctions.map(({ log, reserved, ...a }) => a); }

  // Web slots: the deposit addresses after the house bids', not used by a submitted record, not held by another visitor.
  private openSlots(a: Live) {
    const now = Date.now() / 1000, used = new Set(this.usedAddresses(a.id));
    return a.slots.slice(a.house).filter((s) => !used.has(s) && !((a.reserved[s] ?? 0) > now));
  }
  private usedAddresses(id: string): string[] {
    const d = path.join(this.state, "web", "intake", id);
    if (!existsSync(d)) return [];
    return readdirSync(d).map((f: string) => JSON.parse(readFileSync(path.join(d, f), "utf8"))).filter((i: any) => i.status !== "refused").map((i: any) => i.address);
  }
  reserveSlot(id: string) {
    const a = this.auctions.find((x) => x.id === id);
    if (!a || !this.isLive(id)) throw new Error("this auction is not taking web bids");
    const free = this.openSlots(a);
    if (!free.length) throw new Error("every deposit slot of this round is taken; the next round opens when this one freezes");
    const held_until = Math.min(a.T_submit, Math.floor(Date.now() / 1000) + 30 * 60);
    a.reserved[free[0]] = held_until; this.save();
    return { address: free[0], slot: a.slots.indexOf(free[0]), held_until };
  }

  private async ensureFrostd() {
    const port = Number((process.env.BNZ_FROSTD_ADDR ?? "localhost:2744").split(":").at(-1));
    const open = await new Promise<boolean>((r) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); r(true); }); s.on("error", () => r(false)); });
    if (open || this.frostd) return;
    const S = this.state;
    this.frostd = spawn(path.join(S, "bin/frostd"), ["-i", "127.0.0.1", "-p", String(port), "-c", path.join(S, "tls/frostd.pem"), "-k", path.join(S, "tls/frostd.key")], { stdio: "ignore" });
    this.frostd.on("exit", () => { this.frostd = null; });
    await new Promise((r) => setTimeout(r, 2000));
  }

  private walletUa() {
    return execFileSync(path.join(this.root, "settle/target/release/benzo-pczt"), ["address", path.join(this.state, "bidder"), "--network", "test"], { encoding: "utf8" }).trim().split("\n").at(-1)!;
  }
  private async latestRound(): Promise<number> {
    const hashHex = process.env.BNZ_DRAND_CHAIN_HASH ?? "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
    for (const u of [...(process.env.BNZ_DRAND_URLS ?? "").split(",").filter(Boolean), "https://api.drand.sh"]) {
      try { const r = await fetch(`${u}/${hashHex}/public/latest`, { signal: AbortSignal.timeout(8000) }); if (r.ok) return (await r.json()).round; } catch { /* next relay */ }
    }
    return 0; // a failed poll means "not yet", never "released"
  }

  private async create() {
    const id = randomBytes(32).toString("hex"), n = this.auctions.length;
    const a: Live = { id, phase: "setup", lot: `${LOTS[n % LOTS.length]} ${Math.floor(n / LOTS.length) + 1}`, pub: path.join(this.root, "tmp/web/public", id), slots: [], house: HOUSE,
      T_submit: 0, T_freeze: 0, R: 0, release: 0, created: Math.floor(Date.now() / 1000), reserved: {}, log: [], retries: 0 };
    this.auctions.push(a); this.save();
    const priv = path.join(this.state, "web", "run", id);
    mkdirSync(priv, { recursive: true, mode: 0o700 });
    try {
      await this.ensureFrostd();
      this.say(a, "hosts dkg");
      const dkg = await this.run(["hosts", "dkg", "--id", id]);
      const addr = await this.run(["auction", "addresses", "--id", id, "--count", String(SLOTS)]);
      a.slots = [dkg.escrow_ua, ...addr.addresses.slice(0, SLOTS - 1)]; a.fee = addr.addresses[SLOTS - 1];
      const keys = await this.run(["hosts", "keys"]);
      const ws = await this.run(["witness", "set", "--id", id, "--q", "2", "--keys", keys.witness_keys.join(",")]);
      const now = Math.floor(Date.now() / 1000);
      a.T_submit = now + SUBMIT_MIN * 60; a.T_freeze = a.T_submit + CONFIRM_MIN * 60;
      const rel = a.T_freeze + 3 * 60;
      const round = await this.run(["drand", "round", "--at", new Date(rel * 1000).toISOString()]);
      a.R = round.round; a.release = QUICKNET.genesis + (a.R - 1) * QUICKNET.period;
      const seller = this.walletUa();
      const m = JSON.parse(readFileSync(path.join(this.root, "docs/examples/unsigned-manifest.json"), "utf8"));
      Object.assign(m, { network: "test", auction_id: id, escrow_ua: dkg.escrow_ua, frost_group_key: dkg.group_key, lot: a.lot, supply: SUPPLY, reserve_zats: "100", tick_zats: "10",
        B_max_zats: "3000", q_max: 1, C_zats: "200000", fee_zats: "0", deposit_addresses: a.slots, envelope_keys: keys.envelope_keys, witness_set_hash: ws.witness_set_hash, T_submit: a.T_submit, T_freeze: a.T_freeze });
      m.drand.R = a.R;
      for (const k of Object.keys(m)) if (/_commitment$/.test(k)) delete m[k];
      const cfg = JSON.parse(readFileSync(path.join(this.root, "docs/examples/private-operator.json"), "utf8"));
      cfg.routing.bidders = a.slots.map((deposit_ua) => ({ deposit_ua })); cfg.routing.seller_ua = seller; cfg.routing.fee_reserve_ua = a.fee; cfg.routing.reserve_return_ua = seller;
      writeFileSync(path.join(priv, "unsigned-manifest.json"), JSON.stringify(m, null, 2), { mode: 0o600 });
      writeFileSync(path.join(priv, "private-operator.json"), JSON.stringify(cfg, null, 2), { mode: 0o600 });
      this.say(a, `create (R ${a.R}, bids until ${new Date(a.T_submit * 1000).toISOString()})`);
      await this.run(["auction", "create", "--file", path.join(priv, "unsigned-manifest.json"), "--witness-set", ws.file, "--config", path.join(priv, "private-operator.json")]);
      a.signer = (await this.run(["auction", "sign", "--id", id])).signer;
      mkdirSync(path.dirname(a.pub), { recursive: true });
      await this.run(["auction", "publish", "--id", id, "--dir", a.pub, "--config", path.join(priv, "private-operator.json")]);
      // Two house bids (and the fee reserve) in one funding transaction, so every round clears against something.
      const sealed: any[] = [];
      for (let i = 0; i < a.house; i++) {
        const price = String(400 + 10 * Math.floor(Math.random() * 40));
        const s = await this.run(["bid", "seal", "--manifest", path.join(a.pub, "manifest.json"), "--signer", a.signer!], { price_zats: price, quantity: 1, address: a.slots[i], refund_ua: seller });
        sealed.push({ ...s, address: a.slots[i] });
      }
      const paid = await this.run(["bid", "deposit", "--id", id, "--pay"], { bids: sealed.map((s) => ({ uri: s.uri, address: s.address, envelope_hex: s.envelope_hex })), reserve: { address: a.fee, amount_zats: "60000" } });
      for (const s of sealed) this.intake.submit(id, { address: s.address, txid: paid.txid, envelope_hex: s.envelope_hex, envelope_ct_hex: s.envelope_ct_hex, owner_sig_hex: s.owner_sig_hex, ciphertext_hash: s.ciphertext_hash }, true);
      a.phase = "accepting";
      this.say(a, `accepting bids (house funding ${paid.txid.slice(0, 12)}…)`);
    } catch (e) {
      a.phase = "failed"; a.error = String((e as Error).message).slice(0, 400); this.say(a, `FAILED in setup: ${a.error}`);
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
      for (const a of this.auctions.filter((x) => ["accepting", "frozen", "witnessed", "settling"].includes(x.phase))) await this.advance(a);
      // Always one round taking bids: start the next as soon as none is accepting.
      const accepting = this.auctions.some((a) => a.phase === "setup" || (a.phase === "accepting" && Date.now() / 1000 < a.T_submit));
      if (!accepting && this.auctions.length < MAX_ROUNDS) await this.create();
    } finally { this.busy = false; }
  }

  stop() { clearInterval(this.timer); this.frostd?.kill(); }
}
