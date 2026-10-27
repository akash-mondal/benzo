#!/usr/bin/env node
// readme-assets.mjs — draws the README's figures (docs/assets/*.svg) in the site's look: the green-black night, sand
// type, the site's doodles in sand chrome, gold for what each figure is about. Every figure is still (no motion) and
// drawn from the real formats: byte counts, fields and steps come from the code they describe.
//   node tools/readme-assets.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "docs/assets");
const C = { ground: "#141a10", panel: "#1c2417", panel2: "#232d1d", hot: "#2a2a18", line: "#ddd6c6", text: "#ebe5d6", muted: "#b9b3a3", faint: "#8f8a7c", gold: "#e9cd84" };
const SANS = `'Helvetica Neue',Helvetica,Arial,sans-serif`, MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`, SERIF = `Georgia,'Times New Roman',serif`;

let uid = 0;
// A site doodle (web/public/doodles), centred on (cx, cy), painted in chrome or gold.
function doodle(name, cx, cy, size, paint = "url(#chrome)") {
  const src = readFileSync(path.join(ROOT, "web/public/doodles", `${name}.svg`), "utf8");
  const inner = src.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const n = ++uid;
  const ided = inner.replace(/id="([^"]+)"/g, `id="$1-${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`);
  const cut = ided.lastIndexOf("</defs>");
  const head = cut >= 0 ? ided.slice(0, cut + 7) : "", body = cut >= 0 ? ided.slice(cut + 7) : ided;
  const painted = body.replace(/fill="#fff(fff)?"/gi, `fill="${paint}"`).replace(/stroke="#fff(fff)?"/gi, `stroke="${paint}"`);
  return `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" viewBox="0 0 200 200">${head}${painted}</svg>`;
}
const DEFS = `<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="0.36"><stop offset="0" stop-color="#a99f86"/><stop offset=".3" stop-color="#fbf6e8"/><stop offset=".52" stop-color="#c2b799"/><stop offset=".74" stop-color="#f4eedd"/><stop offset="1" stop-color="#a99f86"/></linearGradient>
<linearGradient id="goldc" x1="0" y1="0" x2="1" y2="0.36"><stop offset="0" stop-color="#b89a52"/><stop offset=".35" stop-color="#f6e2a6"/><stop offset=".6" stop-color="#d9b866"/><stop offset="1" stop-color="#b89a52"/></linearGradient>
<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4efe2"/><stop offset="1" stop-color="#d9d1bd"/></linearGradient>
<radialGradient id="night" cx="72%" cy="18%" r="85%"><stop offset="0" stop-color="#1f2a19"/><stop offset=".6" stop-color="${C.ground}"/></radialGradient>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.muted}"/></marker>
<marker id="arrowg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.gold}"/></marker>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A figure has no title of its own (the README heading above it says what it is): content drawn below the old title
// line is lifted by LIFT, and the frame shrinks to match. The banner keeps its full height (lift 0).
const LIFT = 50;
const svg = (w, h0, title, body, lift = LIFT) => { const h = h0 - lift; return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" font-family="${SANS}"><title>${esc(title)}</title><defs>${DEFS}</defs><rect width="${w}" height="${h}" rx="22" fill="url(#night)"/><g transform="translate(0 ${-lift})">${body}</g><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="22" fill="none" stroke="${C.line}" stroke-opacity=".12"/></svg>`; };
const T = (x, y, s, size, fill = C.text, more = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${more}>${esc(s)}</text>`;
const H2 = () => "";
const box = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.panel}" stroke="${C.line}" stroke-opacity=".16"/>`;
const arrow = (x1, y1, x2, y2, gold = false) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${gold ? C.gold : C.muted}" stroke-width="2" marker-end="url(#${gold ? "arrowg" : "arrow"})"/>`;
const chip = (x, y, w, h, label, sub, hot = false, mono = false) => `<rect x="${x + 1}" y="${y}" width="${w - 2}" height="${h}" rx="8" fill="${hot ? C.hot : C.panel2}" stroke="${hot ? C.gold : C.line}" stroke-opacity="${hot ? .9 : .2}"/>`
  + T(x + w / 2, y + h / 2 - 3, label, 15.5, hot ? C.gold : C.text, `text-anchor="middle" font-weight="600" ${mono ? `font-family="${MONO}"` : ""}`)
  + (sub ? T(x + w / 2, y + h / 2 + 19, sub, 14.5, C.muted, `text-anchor="middle"`) : "");

// ---- 1. banner: the name, the claim, and a sealed envelope whose seal sits cleanly on the flap's point.
function banner() {
  const W = 1200, H = 380;
  // The flap's two lines meet at the seal's centre; the seal is opaque and drawn after them, so nothing crosses the letter.
  const ex = 790, ey = 92, ew = 300, eh = 196, sx = ex + ew / 2, sy = ey + 104, r = 34;
  const env = `<rect x="${ex}" y="${ey}" width="${ew}" height="${eh}" rx="16" fill="url(#paper)"/>
    <path d="M${ex + 12} ${ey + eh - 12} L${sx - 54} ${sy + 22} M${ex + ew - 12} ${ey + eh - 12} L${sx + 54} ${sy + 22}" fill="none" stroke="#a39b85" stroke-width="4" stroke-linecap="round"/>
    <path d="M${ex + 10} ${ey + 12} L${sx} ${sy} L${ex + ew - 10} ${ey + 12}" fill="none" stroke="#6c6553" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${sx}" cy="${sy}" r="${r + 7}" fill="#e3dccb"/>
    <circle cx="${sx}" cy="${sy}" r="${r}" fill="url(#goldc)" stroke="#8c7440" stroke-width="2.5"/>
    <circle cx="${sx}" cy="${sy}" r="${r - 7}" fill="none" stroke="#8c7440" stroke-opacity=".5" stroke-width="1.5"/>
    ${T(sx, sy + 11, "B", 32, "#4a3c1c", `text-anchor="middle" font-family="${SERIF}" font-weight="700"`)}`;
  const body = `<circle cx="${sx}" cy="${ey + eh / 2}" r="172" fill="none" stroke="${C.line}" stroke-opacity=".07"/>
    <circle cx="${sx}" cy="${ey + eh / 2}" r="130" fill="none" stroke="${C.gold}" stroke-opacity=".16"/>
    ${env}
    ${T(80, 168, "Benzo", 92, C.text, `font-family="${SERIF}" font-style="italic" letter-spacing="-1"`)}
    ${T(84, 226, "Sealed-bid markets on Zcash.", 30, C.text, `font-weight="500"`)}
    ${T(84, 270, "Bids are locked to a future drand round.", 22, C.muted)}
    ${T(84, 302, "Nobody can read one before it, not even the operator.", 22, C.muted)}`;
  return svg(W, H, "Benzo: sealed-bid markets on Zcash. Bids are locked to a future drand round; nobody can read one before it, not even the operator.", body, 0);
}

// ---- 2. a round on the clock: six steps on one line; the line runs behind solid circles.
function lifecycle() {
  const W = 1200, H = 440, y = 184, R = 50;
  const steps = [
    ["sealed-envelope", "Seal & pay", ["sealed to round R in", "the browser; a fixed", "shielded deposit"], "until T_submit"],
    ["padlock", "Freeze", ["confirmed deposits", "form a Merkle tree;", "2 of 3 sign the root"], "before R"],
    ["beacon", "Open", ["drand publishes R;", "its signature opens", "every bid at once"], "drand round R"],
    ["scales", "Clear", ["the market's rule", "turns bids into fills,", "a price, refunds"], "right after R"],
    ["shield-z", "Settle", ["2 of 3 signers", "recheck it all, then", "sign one FROST spend"], "a few blocks"],
    ["magnifier", "Verify", ["one file rebuilds", "the round from the", "public record"], "any time"],
  ];
  const x0 = 120, dx = (W - 2 * x0) / (steps.length - 1);
  let body = `${H2(64, 64, "A round, from first bid to proof")}
    <line x1="${x0}" y1="${y}" x2="${x0 + dx * 2}" y2="${y}" stroke="${C.gold}" stroke-opacity=".6" stroke-width="3"/>
    <line x1="${x0 + dx * 2}" y1="${y}" x2="${W - x0}" y2="${y}" stroke="${C.line}" stroke-opacity=".25" stroke-width="3"/>
    ${T(x0 + dx, y - R - 22, "sealed: nobody can read a bid", 17, C.gold, `text-anchor="middle" font-weight="600"`)}
    ${T(x0 + dx * 3.5, y - R - 20, "opened: prices public, bidders still private", 17, C.muted, `text-anchor="middle" font-weight="600"`)}`;
  steps.forEach(([d, name, lines, when], i) => {
    const x = x0 + dx * i, key = i === 2;
    body += `<circle cx="${x}" cy="${y}" r="${R}" fill="${C.ground}"/>
      <circle cx="${x}" cy="${y}" r="${R}" fill="${key ? C.hot : C.panel}" stroke="${key ? C.gold : C.line}" stroke-opacity="${key ? 1 : .3}" stroke-width="${key ? 3 : 2}"/>
      ${doodle(d, x, y, 60, key ? "url(#goldc)" : "url(#chrome)")}
      ${T(x, y + R + 42, `${i + 1}  ${name}`, 21, C.text, `text-anchor="middle" font-weight="600"`)}
      ${lines.map((l, k) => T(x, y + R + 72 + k * 23, l, 16, C.muted, `text-anchor="middle"`)).join("")}
      ${T(x, y + R + 158, when, 16, key ? C.gold : C.faint, `text-anchor="middle" font-weight="600"`)}`;
  });
  return svg(W, H, "A round in six steps: seal and pay, freeze, open at drand round R, clear, settle with 2 of 3 signers, verify.", body);
}

// ---- 3. tlock: why nobody can open a bid before round R.
function tlock() {
  const W = 1200, H = 450;
  let body = H2(64, 64, "Sealing to a moment, not to a person");
  body += `${box(64, 104, 340, 286)}
    ${T(92, 146, "Your browser", 22, C.text, `font-weight="600"`)}
    ${T(92, 182, "knows the order and drand's", 17, C.muted)}${T(92, 206, "public key, and encrypts to the", 17, C.muted)}
    ${T(92, 230, "identity “round R”:", 17, C.muted)}
    <rect x="92" y="250" width="284" height="56" rx="10" fill="${C.panel2}"/>
    ${T(234, 285, "c = Enc(pk, R, order)", 19, C.gold, `text-anchor="middle" font-family="${MONO}"`)}
    ${T(92, 342, "No one keeps a secret key:", 17, C.muted)}${T(92, 366, "it doesn't exist yet.", 17, C.text, `font-weight="600"`)}`;
  const cx0 = 470, cy = 236, n = 7, gap = 96;
  body += T(cx0, 136, "drand quicknet: a new round every 3 seconds", 19, C.text, `font-weight="600"`);
  body += T(cx0, 164, "Each round's value is a BLS12-381 signature on its number, made only", 16, C.muted);
  body += T(cx0, 186, "when a threshold of the League of Entropy's nodes sign together.", 16, C.muted);
  for (let i = 0; i < n; i++) {
    const x = cx0 + 24 + i * gap, isR = i === n - 2, past = i < n - 2;
    if (i < n - 1) body += `<line x1="${x + 24}" y1="${cy}" x2="${x + gap - 24}" y2="${cy}" stroke="${C.line}" stroke-opacity="${past ? .35 : .15}" stroke-width="2" ${past ? "" : `stroke-dasharray="5 5"`}/>`;
    body += `<rect x="${x - 24}" y="${cy - 22}" width="48" height="44" rx="9" fill="${isR ? C.hot : past ? C.panel2 : C.ground}" stroke="${isR ? C.gold : C.line}" stroke-opacity="${isR ? 1 : past ? .35 : .2}" stroke-width="${isR ? 2.5 : 1.5}" ${past || isR ? "" : `stroke-dasharray="4 4"`}/>`;
    body += T(x, cy + 6, isR ? "R" : i === n - 1 ? "R+1" : `R−${n - 2 - i}`, 14.5, isR ? C.gold : past ? C.muted : C.faint, `text-anchor="middle" font-family="${MONO}" font-weight="600"`);
  }
  const rx = cx0 + 24 + (n - 2) * gap;
  body += arrow(rx, cy + 30, rx, cy + 70, true);
  body += T(rx, cy + 96, "σ_R = the key", 17, C.gold, `text-anchor="middle" font-weight="600"`);
  body += T(cx0, 372, "Before R, opening c means forging a drand signature. At R, σ_R is published", 17, C.text);
  body += T(cx0, 398, "for everyone, so every bid in the round opens at the same moment.", 17, C.text);
  return svg(W, H, "tlock: the browser encrypts to drand round R; the key is drand's threshold signature on R, which only exists once round R is published.", body);
}

// ---- 4. the bytes: the 128-byte order and the 512-byte memo that carries it (envelope/bid.ts, seal/src/main.ts).
function bytes() {
  const W = 1200, H = 500, x0 = 64, bw = W - 2 * x0;
  let body = H2(64, 64, "A sealed bid, byte for byte");
  // Widths are drawn for reading, not to scale; each chip says its size.
  const order = [["v", "1 B", 56], ["round or lot id", "32 B", 200], ["price", "8 B · u64", 120], ["qty", "4 B", 76], ["nonce", "16 B", 110], ["owner key", "32 B · Ed25519", 170], ["settlement commitment", "32 B · salted", 236], ["flag", "3 B", 104]];
  const s1 = bw / order.reduce((a, o) => a + o[2], 0);
  let x = x0; const y1 = 128;
  body += T(x0, y1 - 18, "The order: 128 bytes, built in your browser", 19, C.text, `font-weight="600"`);
  order.forEach(([name, sub, w], i) => { body += chip(x, y1, w * s1, 62, name, sub, i === 2); x += w * s1; });
  body += arrow(W / 2, y1 + 80, W / 2, y1 + 140, true);
  body += T(W / 2 + 20, y1 + 116, "tlock-encrypt to drand round R: an age ciphertext of at most 487 bytes", 17, C.gold);
  const y2 = y1 + 196;
  body += T(x0, y2 - 18, "The memo: exactly 512 bytes, inside a shielded payment", 19, C.text, `font-weight="600"`);
  const memo = [["ff 42 4e 5a 02", "5 B · “BNZ” v2", 160, true], ["len", "2 B", 76], ["tlock ciphertext", "≤ 487 B · the sealed order", 520], ["envelope tag", "18 B", 160], ["zeros", "to 512", 136]];
  const s2 = bw / memo.reduce((a, m) => a + m[2], 0);
  x = x0;
  memo.forEach(([name, sub, w, mono], i) => { body += chip(x, y2, w * s2, 62, name, sub, i === 2, mono); x += w * s2; });
  body += T(x0, y2 + 112, "Every memo is the same length and every deposit the same amount: on chain, a high bid and a low bid look identical.", 17, C.text);
  body += T(x0, y2 + 138, "The tag is the first 18 bytes of SHA-256 of the bid's refund envelope, so that envelope can't be swapped for another.", 17, C.muted);
  return svg(W, H, "The 128-byte order (version, round id, price, quantity, nonce, owner key, settlement commitment, flag) is tlock-encrypted and carried in a 512-byte memo: magic, length, ciphertext, envelope tag, zero padding.", body);
}

// ---- 5. the deposit: what the chain sees, and the refund envelope only the signers can open.
function deposit() {
  const W = 1200, H = 520;
  let body = H2(64, 64, "Three bids, as the chain sees them");
  ["d₁", "d₂", "d₃"].forEach((d, i) => {
    const x = 64 + i * 238, y = 104;
    body += `${box(x, y, 218, 176)}
      ${T(x + 22, y + 36, "shielded payment", 16, C.faint, `font-weight="600"`)}
      ${T(x + 22, y + 72, "200,000 zats", 24, C.text, `font-weight="600"`)}
      ${T(x + 22, y + 106, `to deposit address ${d}`, 16, C.muted)}
      ${T(x + 22, y + 134, "memo: 512 sealed bytes", 16, C.muted)}
      ${T(x + 22, y + 160, "sender: not on chain", 16, C.muted)}`;
  });
  body += T(64, 326, "Same amount, same memo length, a fresh address each:", 18, C.text, `font-weight="600"`);
  body += T(64, 352, "nothing on chain ranks them.", 18, C.text, `font-weight="600"`);
  body += T(64, 390, "Every deposit address belongs to the round's vault: a 2-of-3", 16.5, C.muted);
  body += T(64, 414, "FROST key the three signers made for this round only.", 16.5, C.muted);
  const ex = 828, ey = 104;
  body += `${box(ex, ey, 308, 380)}
    ${T(ex + 22, ey + 38, "The refund envelope", 21, C.text, `font-weight="600"`)}
    ${T(ex + 22, ey + 66, "public, but readable only", 16, C.muted)}${T(ex + 22, ey + 88, "with a signer's own key", 16, C.muted)}`;
  ["alice", "bob", "carol"].forEach((n, i) => {
    const y = ey + 110 + i * 50;
    body += `<rect x="${ex + 22}" y="${y}" width="264" height="40" rx="8" fill="${C.panel2}"/>${T(ex + 36, y + 26, n, 16, C.gold, `font-weight="600"`)}${T(ex + 272, y + 26, "X25519 sealed box", 15.5, C.muted, `text-anchor="end"`)}`;
  });
  body += `<rect x="${ex + 22}" y="${ey + 266}" width="264" height="40" rx="8" fill="${C.hot}" stroke="${C.gold}" stroke-opacity=".7"/>
    ${T(ex + 154, ey + 292, "your refund address", 16, C.text, `text-anchor="middle" font-weight="600"`)}`;
  body += T(ex + 22, ey + 336, "Bound to its deposit by the", 15.5, C.muted);
  body += T(ex + 22, ey + 358, "memo's envelope tag.", 15.5, C.muted);
  return svg(W, H, "Three bids on chain: each a shielded payment of 200,000 zats to its own deposit address with a 512-byte sealed memo. The refund address travels in an envelope sealed to the three signers.", body);
}

// ---- 6. freeze: the admitted set becomes one Merkle root, signed by witnesses before R (clear/merkle.ts, witness/).
function freeze() {
  const W = 1200, H = 480;
  let body = H2(64, 64, "Freezing the set before anyone can read it");
  const lxs = Array.from({ length: 6 }, (_, i) => 104 + i * 100), ly = 376;
  const l1 = [0, 1, 2].map((i) => (lxs[2 * i] + lxs[2 * i + 1]) / 2), l2 = [(l1[0] + l1[1]) / 2, l1[2]], root = (l2[0] + l2[1]) / 2;
  const y1 = 296, y2 = 216, yr = 136;
  const edge = (xa, ya, xb, yb) => `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" stroke="${C.line}" stroke-opacity=".28" stroke-width="2"/>`;
  lxs.forEach((x, i) => { body += edge(x, ly - 16, l1[Math.floor(i / 2)], y1 + 16); });
  l1.forEach((x, i) => { body += edge(x, y1 - 16, l2[i === 2 ? 1 : 0], y2 + 16); });
  l2.forEach((x) => { body += edge(x, y2 - 16, root, yr + 16); });
  const node = (x, y, label, w, gold = false) => `<rect x="${x - w / 2}" y="${y - 16}" width="${w}" height="32" rx="8" fill="${gold ? C.hot : C.panel2}" stroke="${gold ? C.gold : C.line}" stroke-opacity="${gold ? 1 : .25}"/>${T(x, y + 5, label, 15, gold ? C.gold : C.muted, `text-anchor="middle" font-family="${MONO}"`)}`;
  lxs.forEach((x, i) => { body += node(x, ly, `bid ${i}`, 76); });
  l1.forEach((x) => { body += node(x, y1, "H(01‖l‖r)", 104); });
  l2.forEach((x) => { body += node(x, y2, "H(01‖l‖r)", 104); });
  body += node(root, yr, "frozen root", 132, true);
  body += T(64, ly + 52, "leaf = SHA-256(00 ‖ SHA-256(ciphertext) ‖ the deposit's txid and address)", 16.5, C.muted);
  const bx = 726;
  body += `${box(bx, 104, 410, 330)}
    ${T(bx + 26, 144, "Witness statement", 21, C.text, `font-weight="600"`)}
    ${["auction id", "frozen root", "leaf count", "T_freeze", "a recent block hash"].map((f, i) => T(bx + 26, 180 + i * 25, `· ${f}`, 16, C.muted)).join("")}
    ${T(bx + 26, 330, "signed by 2 of 3 witness keys", 17, C.text, `font-weight="600"`)}
    ${["alice", "bob", "carol"].map((n, i) => `<rect x="${bx + 26 + i * 122}" y="350" width="110" height="40" rx="9" fill="${i < 2 ? C.hot : C.panel2}" stroke="${i < 2 ? C.gold : C.line}" stroke-opacity="${i < 2 ? .8 : .2}"/>${T(bx + 81 + i * 122, 376, i < 2 ? `${n} ✓` : n, 15.5, i < 2 ? C.gold : C.faint, `text-anchor="middle" font-weight="600"`)}`).join("")}
    ${T(bx + 26, 418, "A second root for the same round is refused.", 16, C.muted)}`;
  body += arrow(root + 74, yr, bx - 12, yr + 40, true);
  return svg(W, H, "Freeze: the admitted bids become the leaves of a Merkle tree; its root, leaf count, T_freeze and a recent block hash are signed by 2 of 3 witnesses before round R.", body);
}

// ---- 7. settle: the operator proposes; each signer checks everything itself; any two sign (settle/, cli/hosts.ts).
function settle() {
  const W = 1200, H = 520;
  let body = H2(64, 64, "Settling with a key nobody holds alone");
  const mid = (x, w) => x + w / 2;
  body += `${box(64, 110, 260, 330)}
    ${doodle("ledger-sheet", mid(64, 260), 176, 70)}
    ${T(mid(64, 260), 250, "Operator", 22, C.text, `text-anchor="middle" font-weight="600"`)}
    ${["builds one unsigned Zcash", "transaction (a PCZT): pay", "the winners and sellers,", "refund everyone else"].map((l, i) => T(mid(64, 260), 284 + i * 24, l, 16, C.muted, `text-anchor="middle"`)).join("")}
    ${T(mid(64, 260), 410, "can propose, can't sign", 16, C.gold, `text-anchor="middle" font-weight="600"`)}`;
  const checks = ["fetches σ_R and opens every bid", "re-runs the market's clearing rule", "opens refund envelopes with its own key", "finds the deposits on chain itself", "checks every output, amount and fee"];
  const sx = 382, sw = 476;
  body += `${box(sx, 110, sw, 330)}
    ${T(sx + 28, 150, "Each signer, on its own", 21, C.text, `font-weight="600"`)}
    ${checks.map((c, i) => `<circle cx="${sx + 42}" cy="${192 + i * 44}" r="12" fill="${C.hot}" stroke="${C.gold}" stroke-opacity=".8"/>${T(sx + 42, 197 + i * 44, String(i + 1), 13, C.gold, `text-anchor="middle" font-weight="700"`)}${T(sx + 68, 198 + i * 44, c, 17, C.muted)}`).join("")}
    ${T(sx + 28, 420, "Any mismatch, and it refuses to sign.", 17, C.text, `font-weight="600"`)}`;
  body += arrow(334, 275, sx - 10, 275);
  const fx = 916, fw = 220;
  body += `${box(fx, 110, fw, 330)}
    ${doodle("shield-z", mid(fx, fw), 176, 72, "url(#goldc)")}
    ${T(mid(fx, fw), 250, "FROST, 2 of 3", 21, C.gold, `text-anchor="middle" font-weight="600"`)}
    ${["two signers run one", "signing session; their", "shares combine into one", "ordinary signature"].map((l, i) => T(mid(fx, fw), 284 + i * 24, l, 16, C.muted, `text-anchor="middle"`)).join("")}
    ${T(mid(fx, fw), 410, "the vault is spent", 16, C.text, `text-anchor="middle" font-weight="600"`)}`;
  body += arrow(sx + sw + 10, 275, fx - 10, 275, true);
  body += T(64, 478, "The key came from a dealerless DKG for this round only. No machine ever holds it whole; one signer alone can't move a zatoshi.", 17, C.text);
  return svg(W, H, "Settlement: the operator proposes an unsigned transaction; each signer independently opens the bids, re-runs clearing, opens refund envelopes, finds the deposits and checks every output; two of three sign one FROST spend.", body);
}

// ---- 8. the markets: one registry, six clearing rules (clear/registry.ts).
function markets() {
  const W = 1200, H = 540;
  const ms = [
    ["gavel", "Uniform auction", "k units go to the k highest bids;", "all pay the lowest winning bid"],
    ["gift-box", "Collection drop", "one winner per numbered lot;", "drand orders the serials"],
    ["rocket", "Token launch", "one price if the minimum raise", "is met, otherwise full refunds"],
    ["return-coin", "Buyback", "the cheapest asks are bought", "until the budget runs out"],
    ["quote-bubble", "RFQ", "the lowest quote wins; the", "second lowest sets the price"],
    ["pact", "Blind OTC", "two sealed limits; if they", "cross, trade at the midpoint"],
  ];
  const cw = 336, ch = 164, gx = 24, gy = 24, x0 = 64, y0 = 104;
  let body = H2(64, 64, "Six markets, one engine");
  ms.forEach(([d, name, a, b], i) => {
    const x = x0 + (i % 3) * (cw + gx), y = y0 + Math.floor(i / 3) * (ch + gy);
    body += `${box(x, y, cw, ch)}${doodle(d, x + 50, y + 52, 56)}
      ${T(x + 94, y + 60, name, 22, C.text, `font-weight="600"`)}
      ${T(x + 24, y + 114, a, 16.5, C.muted)}${T(x + 24, y + 138, b, 16.5, C.muted)}`;
  });
  body += T(64, H - 30, "Same deposit, same freeze, same opening. A market is one entry in clear/registry.ts: a layout, a rule, a result check.", 17, C.text);
  return svg(W, H, "Six markets on one engine: uniform auction, collection drop, token launch, buyback, RFQ and blind OTC, each a clearing rule in one registry.", body);
}

mkdirSync(OUT, { recursive: true });
for (const old of ["round.svg", "opening.svg", "system.svg"]) if (existsSync(path.join(OUT, old))) rmSync(path.join(OUT, old));
for (const [f, make] of [["banner.svg", banner], ["lifecycle.svg", lifecycle], ["tlock.svg", tlock], ["bytes.svg", bytes], ["deposit.svg", deposit], ["freeze.svg", freeze], ["settle.svg", settle], ["markets.svg", markets]]) {
  uid = 0; const s = make(); writeFileSync(path.join(OUT, f), s); console.log(`${f} ${(s.length / 1024).toFixed(1)} KB`);
}
