// Rounds people start on the site. A request is checked here, then queued for the house operator (runner.ts), which
// builds the round on the signer hosts. OTC and RFQ rounds pin their parties' keys in the signed manifest, so those
// wait until every invited party has opened its link (the party's browser makes its key; only the public half
// comes here). The creator holds a manage token; each invite has its own token. Nothing secret is stored.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Mode, Spec } from "./runner";

type Invite = { label: string; token: string; key?: string };
export type Request = {
  rid: string; token: string; mode: Mode; spec: Spec; status: "waiting" | "queued" | "open" | "failed";
  invites: Invite[]; auction_id?: string; error?: string; created: number; ip: string; side?: "buyer" | "seller";
};

const UA = /^utest1[a-z0-9]{60,}$/, KEY = /^[0-9a-f]{64}$/, NAME = /^[\p{L}\p{N} .,'&#:()-]{1,40}$/u;
const int = (v: unknown, lo: number, hi: number, what: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new Error(`${what.charAt(0).toUpperCase() + what.slice(1)} must be a whole number from ${lo.toLocaleString("en-US")} to ${hi.toLocaleString("en-US")}.`);
  return n;
};
const C = 200_000, LIMIT = Number(process.env.BNZ_WEB_REQUEST_LIMIT ?? 8), PER_IP_HOUR = Number(process.env.BNZ_WEB_REQUEST_PER_IP ?? 4);

// The form, as sent: checked and turned into the operator's round spec. Prices are whole zats; C covers any order.
export function specFrom(f: any): { spec: Spec; invites: string[]; side?: "buyer" | "seller" } {
  const mode = f.mode as Mode;
  if (!["uniform", "drop", "launch", "buyback", "otc", "rfq"].includes(mode)) throw new Error("unknown market");
  const lot = String(f.lot ?? "").trim();
  if (!NAME.test(lot)) throw new Error("Give it a name: up to 40 letters, digits or simple punctuation.");
  const submit_min = int(f.minutes ?? 40, 20, 120, "bidding time (minutes)");
  const B_max = int(f.max_price ?? 3000, 20, C, "maximum price");
  const reserve = int(f.reserve ?? 10, 1, B_max, "reserve");
  const base = { mode, lot, supply: 1, reserve_zats: String(reserve), B_max_zats: String(B_max), tick_zats: "10", C_zats: String(C), submit_min, house_bids: 0 } as Spec;
  if (B_max % 10 || reserve % 10) throw new Error("Prices go in steps of 10 zats.");
  const payout = String(f.payout_ua ?? "").trim();
  if (mode === "uniform" || mode === "launch" || mode === "drop") {
    if (!UA.test(payout)) throw new Error("The payout address should be a shielded testnet address (utest1…).");
    base.payout_ua = payout;
  }
  if (mode === "uniform") return { spec: { ...base, supply: int(f.supply ?? 1, 1, 6, "units") }, invites: [] };
  if (mode === "launch") return { spec: { ...base, supply: int(f.supply ?? 3, 1, 6, "units"), launch: { minimum_raise_zats: String(int(f.minimum_raise ?? 0, 1, 6 * B_max, "minimum raise")) } }, invites: [] };
  if (mode === "drop") {
    const lots = (Array.isArray(f.lots) ? f.lots : String(f.lots ?? "").split(",")).map((x: string) => String(x).trim()).filter(Boolean);
    if (lots.length < 2 || lots.length > 5 || !lots.every((l: string) => NAME.test(l)) || new Set(lots).size !== lots.length) throw new Error("Give 2 to 5 different lot names.");
    return { spec: { ...base, lots }, invites: [] };
  }
  if (mode === "otc") {
    const side = f.side === "buyer" ? "buyer" : "seller", key = String(f.creator_key ?? "");
    if (!KEY.test(key)) throw new Error("Your party key is missing. Reload the page and try again.");
    return { spec: { ...base, reserve_zats: "0", otc: side === "buyer" ? { buyer_key: key, seller_key: "" } : { buyer_key: "", seller_key: key } }, invites: [side === "buyer" ? "Seller" : "Buyer"], side };
  }
  const treasury = String(f.treasury_ua ?? "").trim();
  if (!UA.test(treasury)) throw new Error("The return address should be a shielded testnet address (utest1…).");
  if (mode === "buyback") {
    const max = int(f.max_price ?? 300, 20, B_max, "maximum ask");
    return { spec: { ...base, supply: int(f.supply ?? 2, 1, 6, "units"), reserve_zats: "10", buyback: { budget_zats: String(int(f.budget ?? 600, 20, 6 * max, "budget")), max_price_zats: String(max), treasury_ua: treasury } }, invites: [] };
  }
  const dealers = int(f.dealers ?? 2, 2, 4, "dealers");
  const max = int(f.max_price ?? 500, 20, B_max, "maximum quote");
  return { spec: { ...base, rfq: { dealer_keys: [], budget_zats: String(int(f.budget ?? max, max, 6 * max, "budget")), max_price_zats: String(max), treasury_ua: treasury } },
    invites: Array.from({ length: dealers }, (_, i) => `Dealer ${i + 1}`) };
}

export class Requests {
  private dir: string;
  constructor(state: string, private enqueue: (spec: Spec) => number | null) {
    this.dir = process.env.BNZ_WEB_REQUESTS_DIR ? path.resolve(process.env.BNZ_WEB_REQUESTS_DIR) : path.join(state, "web", "requests");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  private file(rid: string) { return path.join(this.dir, `${rid}.json`); }
  private read(rid: string): Request | null { return /^[0-9a-f]{16}$/.test(rid) && existsSync(this.file(rid)) ? JSON.parse(readFileSync(this.file(rid), "utf8")) : null; }
  private save(r: Request) { writeFileSync(this.file(r.rid), JSON.stringify(r), { mode: 0o600 }); }
  private all(): Request[] { return readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(this.dir, f), "utf8"))); }

  create(form: any, ip: string) {
    const now = Date.now() / 1000, all = this.all();
    if (all.filter((r) => r.status === "waiting" || r.status === "queued").length >= LIMIT) throw new Error("Too many rounds are waiting to start. Try again in a few minutes.");
    if (all.filter((r) => r.ip === ip && now - r.created < 3600).length >= PER_IP_HOUR) throw new Error("You've started several rounds this hour. Try again later.");
    const { spec, invites, side } = specFrom(form);
    const r: Request = { rid: randomBytes(8).toString("hex"), token: randomBytes(16).toString("hex"), mode: spec.mode, spec, status: "waiting",
      invites: invites.map((label) => ({ label, token: randomBytes(16).toString("hex") })), created: now, ip, side };
    spec.request = r.rid;
    this.ready(r);
    return { rid: r.rid, token: r.token, invites: r.invites.map(({ label, token }) => ({ label, token })) };
  }

  // Every party is in: the spec is complete and goes to the operator.
  private ready(r: Request) {
    if (r.status === "waiting" && r.invites.every((i) => i.key)) {
      if (r.spec.otc) { const k = r.invites[0].key!; if (!r.spec.otc.buyer_key) r.spec.otc.buyer_key = k; else r.spec.otc.seller_key = k; }
      if (r.spec.rfq) r.spec.rfq.dealer_keys = r.invites.map((i) => i.key!);
      const pos = this.enqueue(r.spec);
      r.status = "queued";
      if (pos === null) r.error = "the operator is not running on this server";
    }
    this.save(r);
  }

  // What an invite link is for, before anyone joins: its side and whether it's still open. The token is the bearer
  // secret; the label shown comes from here, so editing the link can't change the side.
  invite(rid: string, invite: string) {
    const r = this.read(rid), i = r?.invites.find((x) => x.token === invite);
    if (!r || !i) return null;
    return { label: i.label, claimed: Boolean(i.key) };
  }
  join(rid: string, invite: string, key: string) {
    const r = this.read(rid);
    if (!r) throw new Error("unknown round request");
    const i = r.invites.find((x) => x.token === invite);
    if (!i) throw new Error("This invite link isn't valid. Ask the round's creator for a new one.");
    if (!KEY.test(key)) throw new Error("party key");
    if (i.key && i.key !== key) throw new Error("This invite has already been claimed. If that was you, reopen it in the browser you joined with; otherwise ask the round's creator.");
    const taken = [r.spec.otc?.buyer_key, r.spec.otc?.seller_key, ...r.invites.filter((x) => x !== i).map((x) => x.key)].filter(Boolean);
    if (taken.includes(key)) throw new Error("that key is already a party of this round");
    if (r.status !== "waiting" && !i.key) throw new Error("this round already started");
    i.key = key;
    this.ready(r);
    // The joiner's side comes from the invite itself (never from anything in the link they opened).
    return { ...this.view(r, null)!, you: i.label };
  }

  created(rid: string, id: string | null, error?: string) {
    const r = this.read(rid);
    if (!r) return;
    if (id) { r.status = "open"; r.auction_id = id; delete r.error; } else { r.status = "failed"; r.error = error ?? "the round could not be set up"; }
    this.save(r);
  }

  // What anyone with the link sees; the creator (manage token) also gets the invite links to send.
  view(r: Request | string, token: string | null) {
    const q = typeof r === "string" ? this.read(r) : r;
    if (!q) return null;
    const owner = token !== null && token === q.token;
    const s = q.spec;
    return {
      rid: q.rid, mode: q.mode, lot: s.lot, lots: s.lots ?? null, supply: s.supply, status: q.status, auction_id: q.auction_id ?? null, error: q.error ?? null,
      minutes: s.submit_min, max_price_zats: s.B_max_zats, reserve_zats: s.reserve_zats,
      side: q.side ?? null,
      invites: q.invites.map((i) => ({ label: i.label, joined: Boolean(i.key), ...(owner ? { token: i.token } : {}) })),
      budget_zats: s.buyback?.budget_zats ?? s.rfq?.budget_zats ?? null, manage: owner,
    };
  }
  // The pinned party keys of a round, with their slot index (OTC: 0 buyer, 1 seller; RFQ: dealer i).
  partyOf(rid: string, key: string): number | null {
    const r = this.read(rid);
    if (!r) return null;
    if (r.spec.otc) return r.spec.otc.buyer_key === key ? 0 : r.spec.otc.seller_key === key ? 1 : null;
    if (r.spec.rfq) { const i = r.spec.rfq.dealer_keys.indexOf(key); return i >= 0 ? i : null; }
    return null;
  }
  byAuction(id: string) { return this.all().find((r) => r.auction_id === id) ?? null; }
}
