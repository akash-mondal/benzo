// demo.ts: the demo wallet, for visitors (judges) with no testnet wallet. The bid page still seals the order in the
// visitor's browser; it then hands this server only the payment link it built (deposit address, the fixed deposit C
// and the sealed memo), and the demo wallet pays it. The server never sees the price: the memo is sealed to a future
// drand round. It does learn which deposit it paid for, which the page says. Refunds go back to the demo wallet when
// the visitor uses its address. Payments take a minute (sync, then a proof), so a request returns a job to poll.
// Limits: BNZ_DEMO_PER_IP_HOUR per address (default 8: judges at one venue share a network) and BNZ_DEMO_PER_DAY in all (default 300).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

type Job = { state: "paying" | "paid" | "failed"; txid?: string; error?: string; at: number };
const PER_IP = Number(process.env.BNZ_DEMO_PER_IP_HOUR ?? 8), PER_DAY = Number(process.env.BNZ_DEMO_PER_DAY ?? 300);

export class DemoWallet {
  private jobs = new Map<string, Job>();
  private ips = new Map<string, number[]>();
  private day: number[] = [];
  private lock: Promise<unknown> = Promise.resolve();
  private address: string | null = null;
  private balance = { spendable: 0, at: 0 };
  constructor(private state: string, private name = process.env.BNZ_DEMO_WALLET ?? "demo") {
    // The balance the page is shown is refreshed in the background, so no visitor waits for a wallet sync.
    const tick = () => { void this.refresh().finally(() => setTimeout(tick, 120_000).unref()); };
    setTimeout(tick, 20_000).unref();
  }
  private async refresh() {
    if (!this.ready) return;
    try {
      this.address ??= (await this.dev(["wallet", "-w", this.wallet, "list-addresses"])).match(/utest1[0-9a-z]+/)?.[0] ?? null;
      await this.dev(["wallet", "-w", this.wallet, "sync", "-s", this.lwd()]);
      const b = JSON.parse(await this.dev(["wallet", "-w", this.wallet, "balance", "--json"]));
      this.balance = { spendable: Number(b.sapling_spendable) + Number(b.orchard_spendable) + Number(b.ironwood_spendable ?? 0), at: Date.now() };
    } catch { /* keep the last figure */ }
  }

  private get wallet() { return path.join(this.state, this.name); }
  get ready() { return existsSync(path.join(this.wallet, "keys.toml")); }
  // One wallet command at a time; stdin closed (zcash-devtool waits on an open one).
  private dev(args: string[], timeout = 5 * 60_000): Promise<string> {
    const run = this.lock.then(() => new Promise<string>((ok, no) => execFile(path.join(this.state, "bin", "zcash-devtool"), args, { encoding: "utf8", timeout, maxBuffer: 16 << 20 },
      (e, out, err) => e ? no(new Error(String(err || e.message).replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => l.trim() && !/ INFO /.test(l)).slice(-2).join(" ").slice(0, 300))) : ok(out)).stdin?.end()));
    this.lock = run.catch(() => {});
    return run;
  }
  private lwd() { return process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443"; }

  // What the bid page shows: whether the demo wallet can pay now, and the address refunds can go back to.
  async info(ip: string) {
    if (!this.ready) return { available: false, reason: "The demo wallet isn't set up on this server." };
    if (!this.address) return { available: false, reason: "The demo wallet is starting. Try again in a minute." };
    const left = Math.max(0, PER_IP - this.recent(ip).length);
    const funded = this.balance.spendable >= 260_000;
    // low: the test fleet (deploy/fleet/lite-bot.ts) tops the demo wallet up when it says so.
    return { available: funded && left > 0 && this.dayLeft() > 0, address: this.address, left_this_hour: left, low: this.balance.at > 0 && this.balance.spendable < 3_000_000,
      reason: !funded ? "The demo wallet is waiting for its coins to confirm. Try again in a few minutes." : left === 0 ? `It has paid the ${PER_IP} deposits it allows per network each hour; the next frees up at ${new Date(Math.min(...this.recent(ip)) + 3600_000).toISOString().slice(11, 16)} UTC.` : this.dayLeft() === 0 ? "Today's demo deposits are used up. Pay from your own wallet." : undefined };
  }
  private recent(ip: string) { const t = Date.now() - 3600_000, v = (this.ips.get(ip) ?? []).filter((x) => x > t); this.ips.set(ip, v); return v; }
  private dayLeft() { const t = Date.now() - 86_400_000; this.day = this.day.filter((x) => x > t); return PER_DAY - this.day.length; }

  // Pay one deposit link for a round that is taking bids. The link must pay exactly the round's deposit C to one of the
  // round's own deposit addresses and carry a sealed memo (framing v2); anything else is refused, so the demo wallet
  // can't be pointed at another address.
  pay(manifest: any, uri: string, ip: string): { job: string } {
    if (!this.ready) throw Object.assign(new Error("the demo wallet isn't set up on this server"), { status: 503 });
    if (this.recent(ip).length >= PER_IP) throw Object.assign(new Error(`the demo wallet has paid this network's ${PER_IP} deposits for this hour`), { status: 429 });
    if (this.dayLeft() <= 0) throw Object.assign(new Error("today's demo deposits are used up"), { status: 429 });
    let u: URL;
    try { u = new URL(uri); } catch { throw Object.assign(new Error("that isn't a payment link"), { status: 400 }); }
    const memo = u.searchParams.get("memo") ?? "", hex = Buffer.from(memo, "base64url").toString("hex");
    const ok = u.protocol === "zcash:" && manifest.deposit_addresses.includes(u.pathname) && Math.round(Number(u.searchParams.get("amount")) * 1e8) === Number(manifest.C_zats)
      && [...u.searchParams.keys()].every((k) => ["amount", "memo"].includes(k)) && hex.length === 1024 && hex.startsWith("ff424e5a02");
    if (!ok) throw Object.assign(new Error("the demo wallet pays only this round's own deposit link, with its sealed memo"), { status: 400 });
    if (Date.now() / 1000 > Number(manifest.T_submit) - 60) throw Object.assign(new Error("bids for this round close too soon for a demo payment"), { status: 409 });
    this.recent(ip).push(Date.now()); this.day.push(Date.now());
    const id = randomBytes(12).toString("hex"), job: Job = { state: "paying", at: Date.now() };
    this.jobs.set(id, job);
    for (const [k, j] of this.jobs) if (Date.now() - j.at > 6 * 3600_000) this.jobs.delete(k);
    void (async () => {
      for (let i = 0; ; i++) {
        try {
          await this.dev(["wallet", "-w", this.wallet, "sync", "-s", this.lwd()]);
          const out = await this.dev(["wallet", "-w", this.wallet, "pay", "-i", `${this.wallet}.age`, "--disable-confirmation", "-s", this.lwd(), "--payment-uri", uri]);
          const txid = out.match(/^[0-9a-f]{64}$/gm)?.at(-1);
          if (!txid) throw new Error("the payment produced no transaction id");
          Object.assign(job, { state: "paid", txid }); this.balance.at = 0; return;
        } catch (e) {
          // Change from the last payment may not be spendable yet: wait for a block and try again, for a few minutes.
          if (i < 6 && /insufficient|InsufficientFunds|not enough|spendable/i.test((e as Error).message)) { await new Promise((r) => setTimeout(r, 30_000)); continue; }
          Object.assign(job, { state: "failed", error: (e as Error).message }); return;
        }
      }
    })();
    return { job: id };
  }
  job(id: string) { return this.jobs.get(id) ?? null; }
}
