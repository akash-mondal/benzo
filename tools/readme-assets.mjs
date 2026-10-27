#!/usr/bin/env node
// readme-assets.mjs — draws the README's pictures (docs/assets/*.svg) in the site's own look: the green-black night,
// sand type, the doodles (web/public/doodles) in their sand chrome, and a lit gold for what is live. Each SVG carries its
// own small CSS animation (GitHub plays it inside <img>) and stands still for readers who ask for reduced motion.
//   node tools/readme-assets.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "docs/assets");
const C = { ground: "#141a10", ground2: "#1b2316", panel: "#1b2216", line: "#ddd6c6", text: "#ebe5d6", muted: "#b9b3a3", faint: "#938e80", gold: "#e9cd84", lime: "#c4e09a", bad: "#f0939a" };
const SANS = `'Libre Franklin','Helvetica Neue',Helvetica,Arial,sans-serif`, MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`, SERIF = `Georgia,'Times New Roman',serif`;

// ---- doodles: the site's SVGs, re-inked. A doodle's own mask stays black/white; only the shape it masks is painted.
let uid = 0;
function doodle(name, x, y, size, paint = "url(#chrome)", extra = "") {
  const src = readFileSync(path.join(ROOT, "web/public/doodles", `${name}.svg`), "utf8");
  const inner = src.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const n = ++uid;
  const ided = inner.replace(/id="([^"]+)"/g, `id="$1-${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`);
  const cut = ided.lastIndexOf("</defs>");
  const head = cut >= 0 ? ided.slice(0, cut + 7) : "", body = cut >= 0 ? ided.slice(cut + 7) : ided;
  const painted = body.replace(/fill="#fff(fff)?"/gi, `fill="${paint}"`).replace(/stroke="#fff(fff)?"/gi, `stroke="${paint}"`);
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 200 200" ${extra}>${head}${painted}</svg>`;
}
const DEFS = `<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="0.36"><stop offset="0" stop-color="#a99f86"/><stop offset=".3" stop-color="#fbf6e8"/><stop offset=".52" stop-color="#c2b799"/><stop offset=".74" stop-color="#f4eedd"/><stop offset="1" stop-color="#a99f86"/></linearGradient>
<linearGradient id="goldc" x1="0" y1="0" x2="1" y2="0.36"><stop offset="0" stop-color="#b89a52"/><stop offset=".35" stop-color="#f6e2a6"/><stop offset=".6" stop-color="#d9b866"/><stop offset="1" stop-color="#b89a52"/></linearGradient>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${C.gold}" stop-opacity=".35"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>
<radialGradient id="night" cx="72%" cy="18%" r="85%"><stop offset="0" stop-color="#1f2a19"/><stop offset=".6" stop-color="${C.ground}"/></radialGradient>`;
const STILL = `@media (prefers-reduced-motion: reduce){*{animation:none!important}}`;
const svg = (w, h, title, body, css = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}" font-family="${SANS}"><title>${title}</title><defs>${DEFS}</defs><style>${css}${STILL}</style>${body}</svg>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x, y, s, size, fill = C.text, more = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${more}>${esc(s)}</text>`;

// A seeded doodle sea, like the landing's sky: small doodles, low and slow.
function sea(w, h, count, seed, names) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let out = "";
  for (let i = 0; i < count; i++) {
    const n = names[Math.floor(rnd() * names.length)], sz = 14 + rnd() * 22, x = rnd() * (w - sz), y = rnd() * (h - sz);
    const dur = (14 + rnd() * 16).toFixed(1), delay = (-rnd() * 20).toFixed(1), op = (0.10 + rnd() * 0.16).toFixed(2);
    out += `<g class="drift" style="animation-duration:${dur}s;animation-delay:${delay}s" opacity="${op}">${doodle(n, x.toFixed(0), y.toFixed(0), sz.toFixed(0))}</g>`;
  }
  return out;
}
const DRIFT = `.drift{animation:drift 20s ease-in-out infinite alternate}@keyframes drift{from{transform:translateY(-6px)}to{transform:translateY(6px)}}`;
const SEA = ["sparkle", "star-five", "crescent", "dot-ring", "pebble", "cloud", "open-ring", "plus", "thin-star", "raindrop", "asterisk", "bean", "comma-swirl", "donut", "dice", "daisy", "orbit-dots"];
const frame = (w, h) => `<rect width="${w}" height="${h}" rx="22" fill="url(#night)"/>`;
const border = (w, h) => `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="22" fill="none" stroke="${C.line}" stroke-opacity=".12"/>`;

// ---- 1. banner
function banner() {
  const W = 1280, H = 440;
  const body = `${frame(W, H)}${sea(W, H, 46, 7, SEA)}
  <circle cx="1010" cy="214" r="170" fill="url(#glow)" class="breathe"/>
  <circle cx="1010" cy="214" r="150" fill="none" stroke="${C.line}" stroke-opacity=".14" stroke-dasharray="3 9" class="spin"/>
  <circle cx="1010" cy="214" r="112" fill="none" stroke="${C.gold}" stroke-opacity=".28"/>
  <g class="bob">${doodle("sealed-envelope", 920, 124, 180)}</g>
  <g class="orbit"><g transform="translate(1010 214)">${doodle("beacon", -14 + 150 - 22, -22, 44, "url(#goldc)")}</g></g>
  ${text(80, 150, "benzo", 104, "url(#chrome)", `font-family="${SERIF}" font-weight="700" letter-spacing="-3"`)}
  ${text(84, 222, "Sealed-bid markets on Zcash.", 38, C.text, `font-weight="600" letter-spacing="-.6"`)}
  ${text(84, 270, "Nobody reads a bid before the opening. Not even us.", 30, C.gold, `font-weight="500" letter-spacing="-.4"`)}
  ${text(86, 352, "TESTNET LIVE  ·  DRAND TIMELOCK  ·  2-OF-3 FROST  ·  CHECK IT YOURSELF", 14, C.faint, `font-family="${MONO}" letter-spacing="2.4"`)}
  ${border(W, H)}`;
  const css = `${DRIFT}.bob{animation:bob 6s ease-in-out infinite alternate}@keyframes bob{from{transform:translateY(-5px)}to{transform:translateY(5px)}}
  .spin{transform-origin:1010px 214px;animation:spin 60s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  .orbit{transform-origin:1010px 214px;animation:spin 24s linear infinite}
  .breathe{transform-origin:1010px 214px;animation:breathe 5s ease-in-out infinite alternate}@keyframes breathe{from{opacity:.55;transform:scale(.96)}to{opacity:1;transform:scale(1.04)}}`;
  return svg(W, H, "Benzo: sealed-bid markets on Zcash. Nobody reads a bid before the opening, not even us.", body, css);
}

// ---- 2. a round, step by step: a light walks the six steps and each lights as it passes.
function round() {
  const W = 1280, H = 360, steps = [
    ["sealed-envelope", "Bid", "a sealed order rides", "a fixed shielded deposit"],
    ["padlock", "Freeze", "the set of sealed bids", "is locked and signed"],
    ["beacon", "Open", "drand's round R", "unlocks every bid at once"],
    ["scales", "Clear", "public rules set fills,", "the price and refunds"],
    ["vault-door", "Settle", "2 of 3 signers check", "every payment, then pay"],
    ["magnifier", "Check", "anyone recomputes", "the round from public files"],
  ];
  const x0 = 120, dx = 208, cy = 128, T = 12;
  let body = `${frame(W, H)}${sea(W, H, 22, 3, SEA)}
  <line x1="${x0}" y1="${cy}" x2="${x0 + dx * 5}" y2="${cy}" stroke="${C.line}" stroke-opacity=".18" stroke-width="2"/>
  <line x1="${x0}" y1="${cy}" x2="${x0 + dx * 5}" y2="${cy}" stroke="${C.gold}" stroke-width="2" class="trace"/>`;
  steps.forEach(([d, name, a, b], i) => {
    const x = x0 + dx * i, delay = ((i / 6) * T).toFixed(2);
    body += `<g class="st" style="animation-delay:${delay}s">
      <circle cx="${x}" cy="${cy}" r="52" fill="${C.ground2}" stroke="${C.line}" stroke-opacity=".16"/>
      <circle cx="${x}" cy="${cy}" r="52" fill="none" stroke="${C.gold}" stroke-width="2" class="ring" style="animation-delay:${delay}s"/>
      ${doodle(d, x - 30, cy - 30, 60)}
      ${text(x, cy + 92, `${i + 1}  ${name}`, 22, C.text, `text-anchor="middle" font-weight="600"`)}
      ${text(x, cy + 120, a, 15, C.muted, `text-anchor="middle"`)}${text(x, cy + 140, b, 15, C.muted, `text-anchor="middle"`)}</g>`;
  });
  body += `<circle r="7" fill="${C.gold}" class="dot"/>${text(W / 2, 330, "before R, nobody can read a bid: not the operator, not the signers, not the chain", 15, C.faint, `text-anchor="middle" font-family="${MONO}"`)}${border(W, H)}`;
  const css = `${DRIFT}
  .dot{animation:walk ${T}s linear infinite}@keyframes walk{0%{transform:translate(${x0}px,${cy}px)}83.3%{transform:translate(${x0 + dx * 5}px,${cy}px)}100%{transform:translate(${x0 + dx * 5}px,${cy}px);opacity:0}}
  .trace{stroke-dasharray:${dx * 5};stroke-dashoffset:${dx * 5};animation:trace ${T}s linear infinite}@keyframes trace{0%{stroke-dashoffset:${dx * 5}}83.3%{stroke-dashoffset:0}95%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
  .ring{opacity:0;animation:ring ${T}s ease-out infinite}@keyframes ring{0%{opacity:1}14%{opacity:.25}100%{opacity:.25}}`;
  return svg(W, H, "A Benzo round: bid, freeze, open at drand round R, clear, settle with 2 of 3 signers, check.", body, css);
}

// ---- 3. the opening: the same five bids before and after drand round R.
function opening() {
  const W = 1280, H = 470, bids = [
    ["#1", 420, "winner", "pays 380"], ["#2", 380, "winner", "pays 380"], ["#3", 360, "refunded", "out"],
    ["#4", 330, "refunded", "out"], ["#5", 300, "refunded", "out"]];
  const T = 10, bx = 120, bw = 196, gap = 18, by = 170;
  let body = `${frame(W, H)}${sea(W, H, 20, 11, SEA)}
  ${text(80, 74, "The same five bids, before and after the opening", 30, C.text, `font-weight="600" letter-spacing="-.4"`)}
  <g class="before">${text(80, 116, "BEFORE ROUND R  ·  every bid is a sealed memo on the same 0.005 ZEC deposit", 14, C.faint, `font-family="${MONO}" letter-spacing="1.6"`)}</g>
  <g class="after">${text(80, 116, "AFTER ROUND R  ·  anyone opens every bid; the rules set one price", 14, C.gold, `font-family="${MONO}" letter-spacing="1.6"`)}</g>`;
  bids.forEach(([id, p, out, pay], i) => {
    const x = bx + i * (bw + gap), win = out === "winner";
    body += `<rect x="${x}" y="${by}" width="${bw}" height="196" rx="16" fill="${C.panel}" stroke="${C.line}" stroke-opacity=".14"/>
    ${text(x + 20, by + 36, `bid ${id}`, 15, C.faint, `font-family="${MONO}"`)}
    <g class="before">${doodle("padlock", x + bw / 2 - 30, by + 58, 60)}${text(x + bw / 2, by + 160, "sealed to round R", 15, C.muted, `text-anchor="middle"`)}</g>
    <g class="after">${text(x + 20, by + 104, `${p}`, 52, win ? "url(#goldc)" : C.text, `font-weight="700" letter-spacing="-1.5"`)}${text(x + 20 + String(p).length * 30 + 6, by + 104, "zats/unit", 14, C.faint)}
      ${text(x + 20, by + 160, win ? `wins · ${pay}` : "deposit refunded", 16, win ? C.lime : C.muted, `font-weight="600"`)}</g>`;
  });
  body += `<g class="after"><line x1="${bx - 20}" y1="${by + 236}" x2="${bx + 5 * (bw + gap) - gap + 20}" y2="${by + 236}" stroke="${C.gold}" stroke-opacity=".5" stroke-dasharray="4 6"/>
    ${text(bx - 20, by + 266, "2 units for sale  →  the two highest bids win and both pay the lowest winning price, 380", 16, C.muted)}</g>
  <g class="before">${text(bx - 20, by + 266, "same size, same memo length, shielded: nothing on chain says which bid is high", 16, C.muted)}</g>${border(W, H)}`;
  const css = `${DRIFT}.before{animation:b ${T}s ease-in-out infinite}.after{opacity:0;animation:a ${T}s ease-in-out infinite}
  @keyframes b{0%,42%{opacity:1}50%,92%{opacity:0}100%{opacity:1}}@keyframes a{0%,42%{opacity:0}50%,92%{opacity:1}100%{opacity:0}}`;
  return svg(W, H, "Five sealed bids look identical before drand round R; after R anyone opens them and the clearing price is public.", body, css);
}

// ---- 4. the markets: six kinds of market, one engine.
function markets() {
  const W = 1280, H = 540, ms = [
    ["gavel", "Uniform auction", "many units; every winner pays", "the same, lowest winning price"],
    ["ticket", "Collection drop", "numbered items; the order of", "serials comes from drand"],
    ["rocket", "Token launch", "holder and public tranches,", "a minimum raise or a full refund"],
    ["return-coin", "Buyback", "a treasury buys back from", "the cheapest sealed asks"],
    ["quote-bubble", "RFQ", "lowest quote wins; the second", "lowest sets what is paid"],
    ["pact", "Blind OTC", "two sealed limits; if they cross,", "they trade at the midpoint"],
  ];
  const cw = 360, ch = 186, gx = 30, gy = 28, x0 = 80, y0 = 110;
  let body = `${frame(W, H)}${sea(W, H, 18, 5, SEA)}
  ${text(80, 74, "Six markets, one engine", 30, C.text, `font-weight="600" letter-spacing="-.4"`)}
  ${text(458, 74, "the same deposit, the same freeze, the same opening, one rules registry", 16, C.faint, `font-family="${MONO}"`)}`;
  ms.forEach(([d, name, a, b], i) => {
    const x = x0 + (i % 3) * (cw + gx), y = y0 + Math.floor(i / 3) * (ch + gy);
    body += `<g class="card" style="animation-delay:${(i * 0.9).toFixed(1)}s"><rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="18" fill="${C.panel}" stroke="${C.line}" stroke-opacity=".14"/>
      <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="18" fill="none" stroke="${C.gold}" stroke-opacity="0" class="lit" style="animation-delay:${(i * 0.9).toFixed(1)}s"/>
      ${doodle(d, x + 24, y + 26, 64)}
      ${text(x + 106, y + 66, name, 24, C.text, `font-weight="600" letter-spacing="-.3"`)}
      ${text(x + 26, y + 130, a, 16, C.muted)}${text(x + 26, y + 154, b, 16, C.muted)}
      ${text(x + cw - 24, y + 36, "testnet", 12, C.lime, `text-anchor="end" font-family="${MONO}" letter-spacing="1.2"`)}</g>`;
  });
  body += border(W, H);
  const css = `${DRIFT}.lit{animation:lit 5.4s ease-in-out infinite}@keyframes lit{0%{stroke-opacity:0}8%{stroke-opacity:.7}30%,100%{stroke-opacity:0}}`;
  return svg(W, H, "Six markets on one engine: uniform auction, collection drop, token launch, buyback, RFQ, blind OTC. All ran on Zcash testnet.", body, css);
}

// ---- 5. the system: who holds what.
function system() {
  const W = 1280, H = 600;
  const box = (x, y, w, h, title, lines, d, accent = C.line, op = ".16") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${C.panel}" stroke="${accent}" stroke-opacity="${op}"/>
    ${d ? doodle(d, x + 20, y + 20, 48) : ""}${text(x + (d ? 82 : 22), y + 52, title, 21, C.text, `font-weight="600"`)}
    ${lines.map((l, i) => text(x + 22, y + 92 + i * 23, l, 15, C.muted)).join("")}`;
  const flow = (d, cls = "flow") => `<path d="${d}" fill="none" stroke="${C.gold}" stroke-opacity=".55" stroke-width="2" stroke-dasharray="6 8" class="${cls}"/>`;
  const body = `${frame(W, H)}${sea(W, H, 16, 13, SEA)}
  ${text(80, 66, "Who holds what", 30, C.text, `font-weight="600" letter-spacing="-.4"`)}
  ${box(80, 100, 300, 170, "Your browser", ["seals your order to round R", "pays the fixed deposit with", "the order in its memo"], "sealed-envelope")}
  ${box(80, 300, 300, 150, "drand", ["a public beacon run by", "independent groups; round R", "is the key that opens bids"], "beacon")}
  ${box(490, 100, 300, 210, "Zcash testnet", ["shielded deposits into a vault", "address held 2-of-3 by the", "signers; memos carry the", "sealed orders"], "shield-z", C.gold, ".4")}
  ${box(490, 340, 300, 186, "Operator", ["runs the round: freezes the", "set, opens it at R, clears,", "proposes payments. It cannot", "pay on its own."], "gavel")}
  ${box(900, 100, 300, 426, "Three signers", ["alice · bob · carol", "", "each one re-opens the bids,", "recomputes the result and", "checks every payment against", "its own scan of the chain", "before it signs.", "", "Any 2 of 3 can pay.", "1 alone cannot."], "vault-door", C.gold, ".4")}
  ${flow("M380 185 H490")}${flow("M380 375 C440 375 440 425 490 425")}${flow("M790 205 H900")}${flow("M790 425 H900")}${flow("M640 340 V310", "flow")}
  ${text(80, 556, "Anyone, afterwards: one file, benzo-verify.mjs, rebuilds the round from the public record.", 16, C.faint, `font-family="${MONO}"`)}
  ${border(W, H)}`;
  const css = `${DRIFT}.flow{animation:flow 1.6s linear infinite}@keyframes flow{to{stroke-dashoffset:-28}}`;
  return svg(W, H, "Benzo's parts: your browser seals the order, drand opens it at round R, deposits sit in a 2-of-3 vault on Zcash, the operator runs the round, three signers check before paying.", body, css);
}

mkdirSync(OUT, { recursive: true });
for (const [f, make] of Object.entries({ "banner.svg": banner, "round.svg": round, "opening.svg": opening, "markets.svg": markets, "system.svg": system })) {
  uid = 0; const s = make(); writeFileSync(path.join(OUT, f), s); console.log(`${f} ${(s.length / 1024).toFixed(1)} KB`);
}
