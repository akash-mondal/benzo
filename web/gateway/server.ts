// The site's gateway: serves the built site, and a JSON API over the operator's published auction directories.
// Read-only routes use the repo's own public-auction checks (the same checks `benzo verify` runs). Write routes are
// the bid intake (sealed records only; the gateway never sees a price or a refund address) and are served only for
// the auctions this site's operator runs (gateway/runner.ts).
// Build: node gateway/build.mjs   Run: node gateway/dist/server.mjs [--port 8790] [--host 127.0.0.1] [--runner]
import http from "node:http";
import { existsSync, readFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkPublicAuction, freezeBoard, loadPublicAuction, receiptShow, resultHash } from "../../api/public-auction";
import { deriveClaimOpenings } from "../../cli/published-beacon";
import { tarDirectory } from "./tar";
import { Intake } from "./intake";
import { Runner } from "./runner";
import { Requests } from "./requests";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(HERE, "../.."); // web/
export const ROOT = path.resolve(WEB, ".."); // the benzo checkout
// The checkout's .env (BNZ_STATE_DIR, lightwalletd, drand relays); values already in the environment win.
if (existsSync(path.join(ROOT, ".env")))
  for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
export const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR ?? ".benzo");
const QUICKNET = { genesis: 1692803367, period: 3 };

const argv = process.argv.slice(2), arg = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(arg("--port", process.env.BNZ_WEB_PORT ?? "8790")), HOST = arg("--host", process.env.BNZ_WEB_HOST ?? "127.0.0.1");
const DIST = path.join(WEB, "dist");

// ---------- the registry: every auction the operator published ----------
type Entry = { id: string; dir: string; mtime: number; summary: any; detail?: any; detailMtime?: number };
const cache = new Map<string, Entry>();
const MODE = (m: any) => { const mode = m.clearing?.mode ?? "uniform"; return mode === "uniform" && Array.isArray(m.lots) ? "drop" : mode; };
const release = (R: number) => QUICKNET.genesis + (R - 1) * QUICKNET.period;

function registry(): { id: string; dir: string }[] {
  const prod = path.join(STATE, "product");
  if (!existsSync(prod)) return [];
  const out: { id: string; dir: string }[] = [];
  for (const f of readdirSync(prod)) {
    if (!/^[0-9a-f]{64}\.json$/.test(f)) continue;
    try { const cfg = JSON.parse(readFileSync(path.join(prod, f), "utf8")); if (cfg.public_dir && existsSync(path.join(cfg.public_dir, "auction.json"))) out.push({ id: f.slice(0, 64), dir: cfg.public_dir }); } catch { /* skip */ }
  }
  return out;
}

function load(id: string, dir: string): Entry | null {
  const doc = path.join(dir, "auction.json");
  if (!existsSync(doc)) return null;
  const mtime = statSync(doc).mtimeMs, old = cache.get(id);
  if (old && old.mtime === mtime) return old;
  try {
    const pub = loadPublicAuction(dir);
    const m: any = pub.manifest;
    const summary = {
      id, mode: MODE(m), state: pub.state, lot: m.lot ?? runner?.title(id) ?? (Array.isArray(m.lots) ? `${m.lots.length} lots` : null), lots: Array.isArray(m.lots) ? m.lots.length : 1,
      supply: m.supply, C_zats: m.C_zats, T_submit: m.T_submit, T_freeze: m.T_freeze, R: m.drand.R, release: release(m.drand.R),
      leaf_count: pub.frozen?.leaf_count ?? null, clearing_price_zats: (pub.result as any)?.clearing_price_zats ?? null,
      settled: Boolean(pub.settlement), live: runner?.isLive(id) ?? false, updated: Math.floor(mtime / 1000),
      // The outcome as published: units (or lots) filled out of how many, and what the winners paid in total. A drop
      // clears each lot at its own price, so its scalar clearing price is 0; "filled" says what actually sold.
      outcome: pub.result ? (() => { const al: any[] = ((pub.result as any).allocations ?? []).filter((x: any) => MODE(m) !== "otc" || x.side === "buyer"); return { filled: al.reduce((n, x) => n + Number(x.fill ?? 0), 0), of: Array.isArray(m.lots) ? m.lots.length : m.supply, paid_zats: String(al.reduce((n, x) => n + (Number(x.fill ?? 0) ? Number(x.payment_zats ?? 0) : 0), 0)) }; })() : null,
    };
    const e: Entry = { id, dir, mtime, summary };
    cache.set(id, e);
    return e;
  } catch { return null; }
}

async function detail(e: Entry) {
  if (e.detail && e.detailMtime === e.mtime) return { ...e.detail, live: runner?.isLive(e.id) ?? false, free_slots: runner?.freeSlots(e.id) ?? null };
  const pub = loadPublicAuction(e.dir);
  let openings: Map<number, string | null>;
  try { openings = await deriveClaimOpenings(pub.claims ?? [], pub.beacon); } catch { openings = new Map(); }
  // Each check with what it concluded: passed, failed, a warning, or not applicable to this round (a launch-only or
  // bond-only check on a round without one returns early in the verifier; it proves nothing here and says so).
  const pm: any = pub.manifest, launch = (pm.clearing?.mode ?? "uniform") === "launch", bond = Boolean(pm.bond);
  const notApplicable = (id: string) => ((id === "delivery" || id === "delivery-list") && !launch) || ((id === "balances" || id === "balance-refs" || id === "defaults") && !bond);
  const checks = checkPublicAuction(pub, { claimOpenings: openings }).map((c) => ({ id: c.id, ok: !c.error, detail: c.error ?? c.warn ?? "",
    status: c.error ? "failed" : notApplicable(c.id) ? "not_applicable" : c.warn ? "warning" : "passed" }));
  const s: any = pub.settlement;
  const d = {
    ...e.summary, signer: pub.signer, manifest_hash: pub.manifest_hash, manifest: pub.manifest, freeze_root: pub.frozen?.root ?? null,
    result: pub.result ?? null, result_hash: resultHash(pub),
    receipts: (s?.receipts ?? []).map((r: any) => ({ party: r.party, amount_zats: r.amount_zats, txid: r.txid ?? null })),
    witness_certificates: pub.witnessCerts.length, checks, valid: checks.every((c) => c.ok),
    deposit_addresses: (pub.manifest as any).deposit_addresses ?? [], freeze: pub.frozen ? freezeBoard(pub) : null,
    free_slots: runner?.freeSlots(e.id) ?? null,
    funding: runner?.funding(e.id) ?? null, request: requests.byAuction(e.id)?.rid ?? null,
  };
  e.detail = d; e.detailMtime = e.mtime;
  return d;
}

// ---------- chain status (tip height and the latest drand round), cached ----------
let chain = { tip: null as number | null, round: null as number | null, at: 0 };
async function chainStatus() {
  const now = Date.now() / 1000;
  if (now - chain.at < 20) return { tip: chain.tip, round: chain.round, now };
  chain.at = now;
  const relays = (process.env.BNZ_DRAND_URLS ?? "https://api.drand.sh").split(",");
  const hashHex = process.env.BNZ_DRAND_CHAIN_HASH ?? "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
  for (const u of relays) {
    try { const r = await fetch(`${u}/${hashHex}/public/latest`, { signal: AbortSignal.timeout(6000) }); if (r.ok) { chain.round = (await r.json()).round; break; } } catch { /* next relay */ }
  }
  chain.tip = await new Promise<number | null>((resolve) => {
    execFile(path.join(STATE, "bin/grpcurl"), ["-max-time", "8", "-import-path", path.join(STATE, "proto"), "-proto", "service.proto", process.env.BNZ_LWD_URL ?? "testnet.zec.rocks:443", "cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock"],
      { timeout: 10_000 }, (err, out) => { try { resolve(err ? chain.tip : Number(JSON.parse(out).height)); } catch { resolve(chain.tip); } });
  });
  return { tip: chain.tip, round: chain.round, now };
}

// ---------- http ----------
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain" };
const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
// A file that vanished between the check and the read (a rebuild in progress) is a 404, never a crash.
function file(res: http.ServerResponse, p: string, cache = "no-cache") {
  const s = createReadStream(p);
  s.on("open", () => { res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream", "cache-control": cache }); s.pipe(res); });
  s.on("error", () => { if (!res.headersSent) json(res, 404, { error: "not found" }); else res.destroy(); });
}
async function body(req: http.IncomingMessage): Promise<any> {
  let s = "";
  for await (const c of req) { s += c; if (s.length > 64_000) throw new Error("request too large"); }
  return s ? JSON.parse(s) : {};
}

let runner: Runner | null = null;
const intake = new Intake(ROOT, STATE, (id) => runner?.isLive(id) ?? false);
const requests = new Requests(STATE, (spec) => runner ? runner.enqueue(spec) : null);
const ipOf = (req: http.IncomingMessage) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}`), parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "api") {
      if (parts[1] === "auctions" && parts.length === 2 && req.method === "GET") {
        const list = registry().map((r) => load(r.id, r.dir)?.summary).filter(Boolean);
        list.sort((a: any, b: any) => Number(b.live) - Number(a.live) || b.updated - a.updated);
        return json(res, 200, list);
      }
      if (parts[1] === "chain") return json(res, 200, await chainStatus());
      // Rounds people start: create, read (the creator's token adds the invite links), and join with a party key.
      if (parts[1] === "rounds" && parts.length === 2 && req.method === "POST") return json(res, 201, requests.create(await body(req), ipOf(req)));
      if (parts[1] === "rounds" && parts.length === 3 && req.method === "GET") {
        const v = requests.view(parts[2], url.searchParams.get("token"));
        return v ? json(res, 200, { ...v, queue: runner?.queued() ?? null, operator: Boolean(runner) }) : json(res, 404, { error: "unknown round request" });
      }
      if (parts[1] === "rounds" && parts[3] === "invite" && req.method === "GET") { const v = requests.invite(parts[2], url.searchParams.get("i") ?? ""); return v ? json(res, 200, v) : json(res, 404, { error: "unknown invite" }); }
            if (parts[1] === "rounds" && parts[3] === "join" && req.method === "POST") { const b = await body(req); return json(res, 200, requests.join(parts[2], String(b.invite ?? ""), String(b.key ?? ""))); }
      if (parts[1] === "auctions" && /^[0-9a-f]{64}$/.test(parts[2] ?? "")) {
        const id = parts[2], reg = registry().find((r) => r.id === id), e = reg && load(id, reg.dir);
        if (!e) return json(res, 404, { error: "unknown auction" });
        if (parts.length === 3 && req.method === "GET") return json(res, 200, await detail(e));
        if (parts[3] === "packet") { const doc = JSON.parse(readFileSync(path.join(e.dir, "auction.json"), "utf8")); return json(res, 200, { manifest: doc.manifest, signer: doc.signer }); }
        if (parts[3] === "doc") return file(res, path.join(e.dir, "auction.json"));
        if (parts[3] === "public.tgz") { res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="public-${id.slice(0, 8)}.tgz"` }); return res.end(tarDirectory(e.dir, `public-${id.slice(0, 8)}`)); }
        if (parts[3] === "receipt" && /^[0-9a-f]{64}$/.test(parts[4] ?? "")) {
          const pub = loadPublicAuction(e.dir);
          if (!pub.frozen) return json(res, 409, { ready: false, state: pub.state });
          try { return json(res, 200, receiptShow(pub, parts[4])); } catch (err) { return json(res, 404, { error: (err as Error).message }); }
        }
        if (parts[3] === "slot" && req.method === "POST") {
          if (!runner?.isLive(id)) return json(res, 409, { error: "this round is not taking bids" });
          // OTC and RFQ: the party key picks the party's own slot.
          const b = await body(req), rq = requests.byAuction(id), party = rq && typeof b.key === "string" ? requests.partyOf(rq.rid, b.key) : null;
          if (rq && (rq.mode === "otc" || rq.mode === "rfq") && party === null) return json(res, 403, { error: "only this round's invited parties can bid" });
          return json(res, 200, runner.reserveSlot(id, party ?? undefined));
        }
        if (parts[3] === "bids" && parts.length === 4 && req.method === "POST") return json(res, 202, intake.submit(id, await body(req)));
        if (parts[3] === "bids" && /^[0-9a-f]{64}$/.test(parts[4] ?? "")) return json(res, 200, intake.status(id, parts[4]));
      }
      return json(res, 404, { error: "not found" });
    }
    // The shipped sealer bundle, unchanged (same origin, so the bid page can drive it in a frame).
    if (parts[0] === "sealer") {
      const name = parts[1] === "main.js" ? "main.js" : "index.html", p = path.join(ROOT, "seal/dist", name);
      return existsSync(p) ? file(res, p) : json(res, 503, { error: "sealer bundle not built (npm run build:seal)" });
    }
    // The packaged CLI (the PK-recorded tarball), for `npx --package=<url> benzo verify`.
    if (parts[0] === "dl" && parts[1] === "benzo-0.1.0.tgz") {
      const p = path.join(ROOT, "dist/benzo-0.1.0.tgz");
      return existsSync(p) ? file(res, p) : json(res, 404, { error: "package not built (npm run package)" });
    }
    // The site: a file, a directory's index.html, or the home page for /doodles/<slug> deep links.
    let p = path.join(DIST, decodeURIComponent(url.pathname));
    if (!p.startsWith(DIST)) return json(res, 400, { error: "bad path" });
    if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (existsSync(p)) return file(res, p, p.includes("/_astro/") || p.endsWith(".svg") ? "public, max-age=86400" : "no-cache");
    return file(res, path.join(DIST, "index.html"));
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
});

// The house operator uses the signer hosts and the bidder wallet: opt-in only (never while another run uses them).
if (argv.includes("--runner")) runner = new Runner(ROOT, STATE, intake, (rid, id, error) => requests.created(rid, id, error));
process.on("uncaughtException", (e) => process.stderr.write(`ERROR gateway ${e.message}\n`));
server.listen(PORT, HOST, () => process.stdout.write(`benzo web gateway http://${HOST}:${PORT} state=${STATE}${runner ? " runner=on" : ""}\n`));
