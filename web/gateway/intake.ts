// The bid intake. A bidder's browser sends only the sealed record of a deposit it already paid: the deposit address,
// the txid, the 512-byte memo (the tlock-sealed bid), the settlement envelope sealed to the three signers, and the
// owner's signature. Never a price, never a refund address, never a key. The intake retries `benzo bid deposit`
// (admission) until the deposit has its confirmations, the record is refused, or the auction stops taking records.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { benzo, CliError } from "./cli";

export type BidRecord = { address: string; txid: string; envelope_hex: string; envelope_ct_hex: string; owner_sig_hex: string; ciphertext_hash: string };
type Item = BidRecord & { auction_id: string; status: "queued" | "waiting" | "admitted" | "refused"; detail: string; attempts: number; at: number; leaf_index?: number; house?: boolean; failures?: number; withheld?: boolean; last_output?: string };

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);
// Admission refusals that only mean "not yet": the deposit is not mined, not confirmed, or not scanned.
const NOT_YET = /deposit not unique or absent|deposit confirmation|lightwalletd|transport|timeout|ECONN|sync|treasury funded/i;

export class Intake {
  private dir: string;
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private root: string, private state: string, private live: (id: string) => boolean) {
    this.dir = path.join(state, "web", "intake");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  // Only the operator's gateway admits bids (server.ts starts this with --runner). A read-only gateway on the same
  // state once ran this loop too, with another checkout's tools, and refused every bid it touched.
  start() { this.timer ??= setInterval(() => void this.work(), 30_000); }

  private file(id: string, ct: string) { return path.join(this.dir, id, `${ct}.json`); }
  private read(id: string, ct: string): Item | null { const f = this.file(id, ct); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; }
  private save(it: Item) { mkdirSync(path.join(this.dir, it.auction_id), { recursive: true, mode: 0o700 }); writeFileSync(this.file(it.auction_id, it.ciphertext_hash), JSON.stringify(it), { mode: 0o600 }); }

  submit(id: string, rec: Partial<BidRecord>, house = false) {
    if (!this.live(id) && !house) throw new Error("this auction is not taking web bids");
    if (!(typeof rec.address === "string" && /^utest1[a-z0-9]+$/.test(rec.address))) throw new Error("deposit address");
    if (!(typeof rec.txid === "string" && HEX(64).test(rec.txid))) throw new Error("txid must be 64 hex characters");
    if (!(typeof rec.envelope_hex === "string" && HEX(1024).test(rec.envelope_hex))) throw new Error("memo must be 512 bytes of hex");
    if (!(typeof rec.envelope_ct_hex === "string" && /^([0-9a-f]{2})*$/.test(rec.envelope_ct_hex))) throw new Error("settlement envelope hex");
    if (!(typeof rec.owner_sig_hex === "string" && (rec.owner_sig_hex === "" || HEX(128).test(rec.owner_sig_hex)))) throw new Error("owner signature hex");
    if (!(typeof rec.ciphertext_hash === "string" && HEX(64).test(rec.ciphertext_hash))) throw new Error("ciphertext hash");
    const old = this.read(id, rec.ciphertext_hash);
    if (old && old.status !== "refused") return { status: old.status, detail: old.detail };
    const it: Item = { ...(rec as BidRecord), auction_id: id, status: "queued", detail: "waiting for the deposit's 10 confirmations", attempts: 0, at: Date.now(), house };
    this.save(it);
    void this.work();
    return { status: it.status, detail: it.detail };
  }

  // The excluded-bid demo (docs/demo-excluded-bid.md), operator-only: play a dishonest operator that keeps one paid
  // bid out of the round and tells its bidder it counted. Nothing about the record is admitted; the bid page's own
  // check of the witnessed frozen set, and the signers' own scan of the vault, are what catch it.
  withhold(id: string, ct: string) {
    const it = this.read(id, ct);
    if (!it) throw new Error("no record with this ciphertext hash");
    if (it.status === "admitted") throw new Error("already admitted");
    it.withheld = true; this.save(it);
    return { withheld: true };
  }

  status(id: string, ct: string) {
    const it = this.read(id, ct);
    if (it?.withheld) return { status: "admitted", detail: "admitted" }; // the dishonest operator's claim
    return it ? { status: it.status, detail: it.detail, leaf_index: it.leaf_index, txid: (it as any).txid } : { status: "unknown", detail: "no record with this ciphertext hash" };
  }

  // Bids admitted so far (before the freeze the round's public record has no count yet; the page shows this one).
  admitted(id: string): number {
    const d = path.join(this.dir, id);
    if (!existsSync(d)) return 0;
    return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(d, f), "utf8")) as Item).filter((i) => !i.withheld && i.status === "admitted").length;
  }
  // Records of one auction still waiting to be admitted (the runner freezes only when this is empty, or at the cutoff).
  pending(id: string): number {
    const d = path.join(this.dir, id);
    if (!existsSync(d)) return 0;
    return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(d, f), "utf8")) as Item).filter((i) => !i.withheld && (i.status === "queued" || i.status === "waiting")).length;
  }

  // Close every record still waiting once its auction froze: admission is over.
  close(id: string, reason: string) {
    const d = path.join(this.dir, id);
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const it: Item = JSON.parse(readFileSync(path.join(d, f), "utf8"));
      if (!it.withheld && (it.status === "queued" || it.status === "waiting")) { it.status = "refused"; it.detail = reason; this.save(it); }
    }
  }

  async work() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const id of existsSync(this.dir) ? readdirSync(this.dir) : []) {
        for (const f of readdirSync(path.join(this.dir, id))) {
          const it: Item = JSON.parse(readFileSync(path.join(this.dir, id, f), "utf8"));
          if (it.withheld || (it.status !== "queued" && it.status !== "waiting")) continue;
          it.attempts++;
          try {
            const r = await benzo(this.root, this.state, ["bid", "deposit", "--id", id],
              { txid: it.txid, address: it.address, envelope_hex: it.envelope_hex, envelope_ct_hex: it.envelope_ct_hex, owner_sig_hex: it.owner_sig_hex });
            it.status = "admitted";
            it.leaf_index = r?.receipt?.leaf_index ?? JSON.parse(Buffer.from(r?.receipt?.bytes ?? "", "base64").toString("utf8") || "{}").leaf_index;
            it.detail = `admitted as leaf ${it.leaf_index ?? "?"}`;
          } catch (e) {
            const msg = e instanceof CliError ? e.message : String((e as Error).message);
            // The CLI's own output, kept for the operator: the ERROR line alone can be one fragment of a longer error.
            if (e instanceof CliError) it.last_output = e.output.slice(-3000);
            if (NOT_YET.test(msg)) { it.status = "waiting"; it.detail = `not admissible yet: ${msg.replace(/^ERROR\s*/, "").slice(0, 160)}`; }
            else if (/admission cutoff|round already passed/.test(msg)) { it.status = "refused"; it.detail = "the auction stopped taking records before this deposit confirmed; the deposit refunds through its owner key"; }
            // Only real failures count toward refusal: the "not yet" waits for confirmations above do not, so one
            // failed try (a tool rebuilt mid-run, a busy wallet) can never refuse a deposit that is still confirming.
            else if ((it.failures = (it.failures ?? 0) + 1) >= 4) { it.status = "refused"; it.detail = msg.replace(/^ERROR\s*/, "").slice(0, 240); }
            else { it.status = "waiting"; it.detail = `retrying: ${msg.replace(/^ERROR\s*/, "").slice(0, 160)}`; }
          }
          this.save(it);
        }
      }
    } finally { this.busy = false; }
  }

  stop() { clearInterval(this.timer); }
}
