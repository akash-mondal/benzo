// Generates Benzo's doodle library: white-on-transparent SVGs on a 200×200 viewBox, written to public/doodles/<slug>.svg,
// plus src/data/doodles.json (slug, name, category, group). The field shader reads only each doodle's alpha, so every
// doodle is a clean silhouette: thick strokes (round caps and joins) or solid fills.
// Run: node tools/doodles.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/doodles");
mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(ROOT, "src/data"), { recursive: true });

// ---------- helpers ----------
const f = (n) => Number(n.toFixed(2));
// Strokes are set 1.3× heavier than drawn: the chrome bands need body to read at field size (the reference's weight).
const S = (w = 8) => `fill="none" stroke="#fff" stroke-width="${f(w * 1.3)}" stroke-linecap="round" stroke-linejoin="round"`;
const F = `fill="#fff"`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${body}</svg>`;
const poly = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join(" ");
// Closed smooth curve through points (Catmull-Rom to cubic Bézier).
function smooth(pts, closed = true) {
  const n = pts.length, P = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? " Z" : "");
}
const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const circlePts = (cx, cy, r, n, jitter = 0, seed = 1) => { const R = rnd(seed); return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, rr = r * (1 + (R() - 0.5) * jitter); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; }); };
const clip = (id, shape, body) => `<defs><clipPath id="${id}">${shape}</clipPath></defs><g clip-path="url(#${id})">${body}</g>`;

const lib = [];
// mode: the clearing mode a market glyph stands for (an auction picks one of its mode's glyphs by its id).
const add = (slug, name, category, group, body, mode) => lib.push({ slug, name, category, group, mode, svg: svg(body) });

// ---------- market glyphs (one per clearing mode; real auctions use these) ----------
add("gavel", "Gavel", "Uniform price", "market",
  `<g transform="rotate(-38 100 100)"><rect x="52" y="44" width="96" height="40" rx="10" ${F}/><rect x="40" y="38" width="16" height="52" rx="6" ${F}/><rect x="144" y="38" width="16" height="52" rx="6" ${F}/><rect x="92" y="84" width="16" height="92" rx="7" ${F}/></g><path d="M40 178 H128" ${S(10)}/>`, "uniform");
add("swap-arrows", "Swap Arrows", "OTC", "market",
  `<path d="M38 74 H150 M124 48 L150 74 L124 100" ${S(12)}/><path d="M162 128 H50 M76 102 L50 128 L76 154" ${S(12)}/>`, "otc");
add("price-tag", "Price Tag", "RFQ", "market",
  `<path d="M104 26 H170 V92 L96 166 L30 100 Z" ${S(11)}/><circle cx="146" cy="50" r="10" ${F}/><path d="M86 112 l14 -14 M72 98 l30 -30" ${S(8)}/>`, "rfq");
add("rocket", "Rocket", "Launch", "market",
  `<defs><mask id="rk"><rect width="200" height="200" fill="#fff"/><circle cx="100" cy="74" r="14" fill="#000"/></mask></defs><g mask="url(#rk)"><path d="M100 16 C136 46 142 94 128 138 H72 C58 94 64 46 100 16 Z" ${F}/></g><path d="M72 108 L42 148 L74 142 Z M128 108 L158 148 L126 142 Z" ${F}/><path d="M86 152 Q100 188 114 152" ${S(9)}/>`, "launch");
add("loop-arrows", "Loop Arrows", "Buyback", "market",
  `<path d="M150 82 A54 54 0 0 0 52 74" ${S(12)}/><path d="M36 58 L52 76 L72 62" ${S(12)}/><path d="M50 118 A54 54 0 0 0 148 126" ${S(12)}/><path d="M164 142 L148 124 L128 138" ${S(12)}/>`, "buyback");
add("crate", "Drop Crate", "Drop", "market",
  `<path d="M100 26 L168 60 V140 L100 174 L32 140 V60 Z" ${S(9)}/><path d="M32 60 L100 94 L168 60 M100 94 V174" ${S(9)}/><path d="M66 43 L134 77" ${S(9)}/>`, "drop");

// ---------- mechanism glyphs (how a sealed bid stays sealed) ----------
add("sealed-envelope", "Sealed Envelope", "Sealed bid", "mechanism",
  `<rect x="22" y="50" width="156" height="104" rx="12" ${S(9)}/><path d="M26 56 L100 112 L174 56" ${S(9)}/><circle cx="100" cy="118" r="22" ${F}/>`);
add("padlock", "Padlock", "Sealed bid", "mechanism",
  `<path d="M64 90 V66 A36 36 0 0 1 136 66 V90" ${S(13)}/><rect x="44" y="88" width="112" height="88" rx="16" ${F}/>`);
add("time-key", "Time Key", "Round R", "mechanism",
  `<circle cx="62" cy="100" r="34" ${S(12)}/><path d="M96 100 H178 M150 100 V128 M170 100 V122" ${S(12)}/>`);
add("beacon", "Beacon", "drand", "mechanism",
  `<path d="M82 176 L90 82 H110 L118 176 Z" ${F}/><rect x="80" y="62" width="40" height="22" rx="5" ${F}/><path d="M100 44 V30 M70 54 L58 42 M130 54 L142 42 M60 74 H40 M140 74 H160" ${S(9)}/>`);
add("stopwatch", "Stopwatch", "Round R", "mechanism",
  `<circle cx="100" cy="112" r="64" ${S(10)}/><path d="M86 30 H114 M100 30 V48 M100 112 L128 84 M152 54 l10 -10" ${S(10)}/>`);
add("hourglass", "Hourglass", "Submission window", "mechanism",
  `<path d="M52 24 H148 M52 176 H148" ${S(11)}/><path d="M62 28 C62 78 100 86 100 100 C100 114 62 122 62 172 H138 C138 122 100 114 100 100 C100 86 138 78 138 28" ${S(9)}/><path d="M76 160 Q100 128 124 160 Z" ${F}/>`);
add("three-rings", "Three Rings", "2-of-3 custody", "mechanism",
  `<circle cx="100" cy="70" r="42" ${S(9)}/><circle cx="72" cy="122" r="42" ${S(9)}/><circle cx="128" cy="122" r="42" ${S(9)}/>`);
add("shield-z", "Shield Z", "Shielded", "mechanism",
  `<defs><mask id="sz"><rect width="200" height="200" fill="#fff"/><path d="M72 66 H128 L72 128 H128" fill="none" stroke="#000" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><path mask="url(#sz)" d="M100 18 L166 42 V96 C166 140 136 168 100 182 C64 168 34 140 34 96 V42 Z" ${F}/>`);
add("zec-coin", "ZEC Coin", "Zcash", "mechanism",
  `<circle cx="100" cy="100" r="72" ${S(10)}/><path d="M72 72 H128 L72 128 H128 M100 52 V72 M100 128 V148" ${S(11)}/>`);
add("merkle-tree", "Merkle Tree", "Freeze", "mechanism",
  `<path d="M100 46 L56 100 M100 46 L144 100 M56 100 L34 152 M56 100 L78 152 M144 100 L122 152 M144 100 L166 152" ${S(7)}/>${[[100, 42], [56, 100], [144, 100], [34, 156], [78, 156], [122, 156], [166, 156]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="14" ${F}/>`).join("")}`);
add("receipt", "Receipt", "Receipt", "mechanism",
  `<path d="M46 20 H154 V176 L136 162 L118 176 L100 162 L82 176 L64 162 L46 176 Z" ${S(9)}/><path d="M70 58 H130 M70 86 H130 M70 114 H110" ${S(9)}/>`);
add("closed-eye", "Closed Eye", "Operator-blind", "mechanism",
  `<path d="M24 96 Q100 156 176 96" ${S(11)}/><path d="M52 122 L40 144 M82 136 L76 160 M118 136 L124 160 M148 122 L160 144" ${S(10)}/>`);
add("magnifier", "Magnifier", "Verify", "mechanism",
  `<circle cx="84" cy="84" r="52" ${S(12)}/><path d="M122 122 L172 172" ${S(18)}/><path d="M60 86 L78 104 L110 68" ${S(10)}/>`);
add("ballot-box", "Ballot Box", "Deposit", "mechanism",
  `<path d="M36 84 H164 V172 H36 Z" ${S(9)}/><path d="M76 84 H124" ${S(14)}/><path d="M78 26 H122 V80 H78 Z" ${F}/>`);
add("scales", "Scales", "Clearing", "mechanism",
  `<path d="M100 26 V170 M60 170 H140 M40 58 H160" ${S(9)}/><path d="M40 58 L18 112 H62 Z M160 58 L138 112 H182 Z" ${S(7)}/><path d="M18 112 A22 14 0 0 0 62 112 Z M138 112 A22 14 0 0 0 182 112 Z" ${F}/>`);
add("vault-door", "Vault Door", "Escrow", "mechanism",
  `<circle cx="100" cy="100" r="74" ${S(9)}/><circle cx="100" cy="100" r="22" ${F}/>${Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return `<path d="M${f(100 + Math.cos(a) * 30)} ${f(100 + Math.sin(a) * 30)} L${f(100 + Math.cos(a) * 56)} ${f(100 + Math.sin(a) * 56)}" ${S(10)}/>`; }).join("")}`);
add("chain-link", "Chain Link", "Cross-chain", "mechanism",
  `<rect x="24" y="70" width="92" height="56" rx="28" ${S(11)}/><rect x="84" y="74" width="92" height="56" rx="28" ${S(11)}/>`);
add("rosette", "Rosette", "Verified", "mechanism",
  `<path d="${smooth(circlePts(100, 84, 58, 24, 0).map(([x, y], i) => i % 2 ? [100 + (x - 100) * 0.82, 84 + (y - 84) * 0.82] : [x, y]))}" ${F}/><path d="M74 132 L60 184 L86 172 L100 190 L106 140 M126 132 L140 184 L114 172" ${S(8)}/>`);
add("quill", "Quill", "Signed manifest", "mechanism",
  `<path d="M150 22 C96 40 64 88 52 150 C96 136 140 96 150 22 Z" ${F}/><path d="M52 150 L34 182" ${S(9)}/>`);
add("dice", "Dice", "Serial shuffle", "mechanism",
  `<rect x="34" y="34" width="132" height="132" rx="26" ${S(10)}/>${[[68, 68], [132, 68], [100, 100], [68, 132], [132, 132]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" ${F}/>`).join("")}`);
add("bell", "Bell", "Opening", "mechanism",
  `<path d="M56 140 C56 92 62 52 100 48 C138 52 144 92 144 140 L160 156 H40 Z" ${F}/><circle cx="100" cy="170" r="12" ${F}/><path d="M100 30 V46" ${S(9)}/>`);
add("ticket", "Ticket", "Bid ticket", "mechanism",
  `<path d="M26 56 H174 V84 A16 16 0 0 0 174 116 V144 H26 V116 A16 16 0 0 0 26 84 Z" ${S(9)}/><path d="M124 62 V138" stroke="#fff" stroke-width="7" stroke-dasharray="2 12" stroke-linecap="round"/>`);
add("bridge", "Bridge", "Delivery", "mechanism",
  `<path d="M18 132 H182 M30 132 Q100 30 170 132" ${S(9)}/><path d="M58 96 V132 M80 76 V132 M100 70 V132 M120 76 V132 M142 96 V132" ${S(7)}/>`);

// ---------- ornaments (svgdoodles-style, for density; copyable like the rest) ----------
const spiral = (turns, r0, r1) => { const pts = []; for (let t = 0; t <= turns * Math.PI * 2; t += 0.18) { const r = r0 + (r1 - r0) * (t / (turns * Math.PI * 2)); pts.push([100 + Math.cos(t) * r, 100 + Math.sin(t) * r]); } return smooth(pts, false); };
add("spiral", "Spiral", "Swirls", "ornament", `<path d="${spiral(3.2, 4, 74)}" ${S(9)}/>`);
add("tight-spiral", "Tight Spiral", "Swirls", "ornament", `<path d="${spiral(4.5, 2, 70)}" ${S(5)}/>`);
add("rings", "Rings", "Circles", "ornament", [26, 48, 70].map((r) => `<circle cx="100" cy="100" r="${r}" ${S(8)}/>`).join(""));
add("donut", "Donut", "Circles", "ornament", `<circle cx="100" cy="100" r="58" ${S(30)}/>`);
add("open-ring", "Open Ring", "Circles", "ornament", `<path d="M146 64 A62 62 0 1 1 64 46" ${S(22)}/>`);
const burst = (n, ro, ri) => poly(Array.from({ length: n * 2 }, (_, i) => { const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? ri : ro; return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r]; })) + " Z";
add("starburst", "Starburst", "Stars", "ornament", `<path d="${burst(14, 80, 52)}" ${S(6)}/>`);
add("sun-badge", "Sun Badge", "Stars", "ornament", `<path d="${burst(18, 82, 66)}" ${F}/>`);
add("sparkle", "Sparkle", "Stars", "ornament", `<path d="M100 14 C108 78 122 92 186 100 C122 108 108 122 100 186 C92 122 78 108 14 100 C78 92 92 78 100 14 Z" ${F}/>`);
add("asterisk", "Asterisk", "Stars", "ornament", [0, 60, 120].map((a) => `<path d="M100 26 V174" transform="rotate(${a} 100 100)" ${S(16)}/>`).join(""));
add("thin-star", "Thin Star", "Stars", "ornament", Array.from({ length: 8 }, (_, i) => `<path d="M100 100 L100 ${i % 2 ? 40 : 14}" transform="rotate(${i * 45} 100 100)" ${S(5)}/>`).join(""));
add("dot-grid", "Dot Grid", "Dots", "ornament", Array.from({ length: 25 }, (_, i) => `<circle cx="${44 + (i % 5) * 28}" cy="${44 + Math.floor(i / 5) * 28}" r="7" ${F}/>`).join(""));
add("dot-diamond", "Dot Diamond", "Dots", "ornament", Array.from({ length: 49 }, (_, i) => { const x = i % 7, y = Math.floor(i / 7); return Math.abs(x - 3) + Math.abs(y - 3) <= 3 ? `<circle cx="${28 + x * 24}" cy="${28 + y * 24}" r="6" ${F}/>` : ""; }).join(""));
add("dot-ring", "Dot Ring", "Dots", "ornament", Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return `<circle cx="${f(100 + Math.cos(a) * 68)}" cy="${f(100 + Math.sin(a) * 68)}" r="${i % 2 ? 6 : 10}" ${F}/>`; }).join(""));
add("striped-sphere", "Striped Sphere", "Spheres", "ornament", clip("ss", `<circle cx="100" cy="100" r="76"/>`, Array.from({ length: 10 }, (_, i) => `<rect x="0" y="${24 + i * 16}" width="200" height="9" ${F}/>`).join("")));
add("hatched-sphere", "Hatched Sphere", "Spheres", "ornament", clip("hs", `<circle cx="100" cy="100" r="76"/>`, Array.from({ length: 14 }, (_, i) => `<path d="M${-40 + i * 22} 200 L${60 + i * 22} 0" ${S(7)}/>`).join("")));
add("globe-lines", "Globe Lines", "Spheres", "ornament", `<circle cx="100" cy="100" r="74" ${S(6)}/>${[22, 44, 64].map((rx) => `<ellipse cx="100" cy="100" rx="${rx}" ry="74" ${S(5)}/>`).join("")}<path d="M26 100 H174 M38 62 H162 M38 138 H162" ${S(5)}/>`);
add("half-dome", "Half Dome", "Spheres", "ornament", `<path d="M24 120 A76 76 0 0 1 176 120 Z" ${F}/><path d="M24 140 H176" ${S(8)}/>`);
const wave = (y, amp, n, x0 = 22, x1 = 178) => { const pts = []; for (let i = 0; i <= 48; i++) { const t = i / 48; pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 2 * n) * amp]); } return smooth(pts, false); };
add("triple-wave", "Triple Wave", "Squiggles", "ornament", [70, 100, 130].map((y) => `<path d="${wave(y, 9, 3)}" ${S(8)}/>`).join(""));
add("wavy-ribbon", "Wavy Ribbon", "Squiggles", "ornament", `<path d="${wave(100, 26, 2.5, 26, 174)}" ${S(20)}/>`);
add("zigzag", "Zigzag", "Squiggles", "ornament", `<path d="${poly(Array.from({ length: 9 }, (_, i) => [24 + i * 19, i % 2 ? 76 : 124]))}" ${S(10)}/>`);
add("loop-squiggle", "Loop Squiggle", "Squiggles", "ornament", `<path d="${smooth([[18, 120], [50, 80], [70, 120], [46, 128], [62, 84], [100, 70], [120, 116], [96, 124], [112, 78], [150, 72], [182, 110]], false)}" ${S(8)}/>`);
const blob = (seed, r, j) => smooth(circlePts(100, 100, r, 9, j, seed));
add("blob", "Blob", "Blobs", "ornament", `<path d="${blob(7, 66, 0.45)}" ${F}/>`);
add("blob-outline", "Blob Outline", "Blobs", "ornament", `<path d="${blob(19, 64, 0.5)}" ${S(8)}/>`);
add("pebble", "Pebble", "Blobs", "ornament", `<path d="${blob(42, 54, 0.3)}" ${F}/>`);
add("bean", "Bean", "Blobs", "ornament", `<path d="M60 60 C110 30 170 56 160 106 C152 146 110 132 92 150 C70 172 30 150 34 112 C36 88 44 70 60 60 Z" ${F}/>`);
add("clover", "Clover", "Flowers", "ornament", [0, 90, 180, 270].map((a) => `<ellipse cx="100" cy="58" rx="30" ry="44" transform="rotate(${a} 100 100)" ${F}/>`).join(""));
add("daisy", "Daisy", "Flowers", "ornament", Array.from({ length: 8 }, (_, i) => `<ellipse cx="100" cy="52" rx="16" ry="38" transform="rotate(${i * 45} 100 100)" ${S(6)}/>`).join("") + `<circle cx="100" cy="100" r="14" ${F}/>`);
add("plus", "Plus", "Shapes", "ornament", `<path d="M100 30 V170 M30 100 H170" ${S(36)}/>`);
add("triangle-hatch", "Hatched Triangle", "Shapes", "ornament", `<path d="M100 22 L178 166 H22 Z" ${S(9)}/>` + clip("th", `<path d="M100 22 L178 166 H22 Z"/>`, Array.from({ length: 12 }, (_, i) => `<path d="M${-20 + i * 20} 200 L${80 + i * 20} 0" ${S(5)}/>`).join("")));
add("hash-grid", "Hash Grid", "Shapes", "ornament", `<path d="M70 26 V174 M130 26 V174 M26 70 H174 M26 130 H174" ${S(11)}/>`);
add("checker-diamond", "Checker Diamond", "Shapes", "ornament", `<g transform="rotate(45 100 100)">${Array.from({ length: 16 }, (_, i) => ((i % 4) + Math.floor(i / 4)) % 2 ? "" : `<rect x="${44 + (i % 4) * 28}" y="${44 + Math.floor(i / 4) * 28}" width="28" height="28" ${F}/>`).join("")}</g>`);
add("ladder", "Ladder", "Shapes", "ornament", `<g transform="rotate(-24 100 100)"><path d="M72 20 V180 M128 20 V180" ${S(9)}/>${[44, 76, 108, 140].map((y) => `<path d="M72 ${y} H128" ${S(9)}/>`).join("")}</g>`);
add("chevrons", "Chevrons", "Arrows", "ornament", [0, 1, 2].map((i) => `<path d="M${40 + i * 40} 52 L${88 + i * 40} 100 L${40 + i * 40} 148" ${S(12)}/>`).join(""));
add("curvy-arrow", "Curvy Arrow", "Arrows", "ornament", `<path d="${smooth([[24, 150], [60, 110], [96, 136], [120, 92], [168, 52]], false)}" ${S(9)}/><path d="M138 46 L170 50 L162 82" ${S(9)}/>`);
add("loop-arrow", "Loop Arrow", "Arrows", "ornament", `<path d="${smooth([[20, 140], [70, 120], [104, 70], [80, 50], [64, 80], [110, 120], [176, 96]], false)}" ${S(8)}/><path d="M150 82 L178 96 L154 118" ${S(8)}/>`);
add("cloud", "Cloud", "Weather", "ornament", `<path d="M54 140 A30 30 0 0 1 58 80 A42 42 0 0 1 136 68 A34 34 0 0 1 150 140 Z" ${S(9)}/>`);
add("rays", "Rays", "Stars", "ornament", Array.from({ length: 12 }, (_, i) => `<path d="M100 32 V62" transform="rotate(${i * 30} 100 100)" ${S(10)}/>`).join(""));
add("comma-swirl", "Comma Swirl", "Swirls", "ornament", `<path d="M124 48 C172 70 168 144 112 160 C64 172 30 130 50 96 C64 72 100 76 104 102 C108 126 76 130 72 112" ${S(16)}/>`);


// ---------- more market glyphs: three per mode, so a field of real auctions is not one shape repeated ----------
add("podium", "Podium", "Uniform price", "market",
  `<path d="M70 70 H130 V176 H70 Z M24 112 H70 V176 H24 Z M130 132 H176 V176 H130 Z" ${F}/><path d="M100 22 L106 38 L122 38 L109 48 L114 64 L100 54 L86 64 L91 48 L78 38 L94 38 Z" ${F}/>`, "uniform");
add("auction-bell", "Auction Bell", "Uniform price", "market",
  `<path d="M40 150 C40 96 62 64 100 62 C138 64 160 96 160 150 Z" ${F}/><rect x="24" y="150" width="152" height="18" rx="9" ${F}/><circle cx="100" cy="52" r="12" ${F}/><path d="M150 40 L170 22 M162 62 L186 56" ${S(8)}/>`, "uniform");
add("pact", "Pact", "OTC", "market",
  `<circle cx="42" cy="100" r="26" ${F}/><circle cx="158" cy="100" r="26" ${F}/><path d="M68 100 H132" ${S(10)}/><path d="M100 80 L120 100 L100 120 L80 100 Z" ${F}/>`, "otc");
add("two-coins", "Two Coins", "OTC", "market",
  `<circle cx="74" cy="86" r="50" ${S(9)}/><circle cx="126" cy="114" r="50" ${F}/><path d="M74 60 V112" ${S(9)}/>`, "otc");
add("quote-bubble", "Quote Bubble", "RFQ", "market",
  `<path d="M30 40 H170 V132 H86 L48 166 V132 H30 Z" ${S(10)}/><path d="M64 78 H136 M64 102 H116" ${S(10)}/>`, "rfq");
add("ledger-sheet", "Ledger Sheet", "RFQ", "market",
  `<rect x="40" y="22" width="120" height="156" rx="14" ${F}/><defs><mask id="ls"><rect width="200" height="200" fill="#fff"/><path d="M64 60 H136 M64 92 H136 M64 124 H108" stroke="#000" stroke-width="12" stroke-linecap="round"/></mask></defs>`.replace(`rx="14" ${F}/>`, `rx="14" ${F} mask="url(#ls)"/>`), "rfq");
add("sprout", "Sprout", "Launch", "market",
  `<path d="M100 178 V92" ${S(11)}/><path d="M100 104 C60 108 36 82 34 44 C74 44 98 66 100 104 Z M100 92 C112 58 140 40 172 42 C170 80 142 98 100 92 Z" ${F}/>`, "launch");
add("flag", "Flag", "Launch", "market",
  `<path d="M52 20 V182" ${S(11)}/><path d="M58 30 C92 16 116 46 156 32 V108 C116 122 92 92 58 106 Z" ${F}/>`, "launch");
add("return-coin", "Return Coin", "Buyback", "market",
  `<circle cx="100" cy="100" r="44" ${F}/><path d="M164 100 A64 64 0 1 1 132 44" ${S(11)}/><path d="M118 26 L136 46 L114 62" ${S(11)}/>`, "buyback");
add("basket", "Basket", "Buyback", "market",
  `<path d="M22 84 H178 L160 172 H40 Z" ${F}/><path d="M56 84 L86 28 M144 84 L114 28" ${S(11)}/>`, "buyback");
add("gift-box", "Gift Box", "Drop", "market",
  `<rect x="30" y="80" width="140" height="96" rx="8" ${F}/><rect x="22" y="56" width="156" height="30" rx="8" ${F}/><path d="M100 56 C74 18 46 34 64 54 M100 56 C126 18 154 34 136 54" ${S(9)}/>`, "drop");
add("ticket-roll", "Ticket Roll", "Drop", "market",
  `<circle cx="70" cy="100" r="54" ${S(10)}/><circle cx="70" cy="100" r="16" ${F}/><path d="M124 100 H184 V142 H124" ${S(10)}/><path d="M146 108 V134" stroke="#fff" stroke-width="8" stroke-dasharray="1 10" stroke-linecap="round"/>`, "drop");

// ---------- page emblems: one original drawing per page of the site ----------
add("emblem-how", "Sealed Orbit", "How it works", "page",
  `<circle cx="100" cy="100" r="30" ${F}/><ellipse cx="100" cy="100" rx="84" ry="34" transform="rotate(-24 100 100)" ${S(8)}/><circle cx="174" cy="66" r="11" ${F}/>`);
add("emblem-verify", "Check Lens", "Verify", "page",
  `<circle cx="88" cy="88" r="62" ${F}/><defs><mask id="cl"><rect width="200" height="200" fill="#fff"/><path d="M60 90 L82 112 L118 70" stroke="#000" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><path d="M134 134 L178 178" ${S(18)}/>`.replace(`r="62" ${F}/>`, `r="62" ${F} mask="url(#cl)"/>`));
add("emblem-lots", "Lot Stack", "Every lot", "page",
  `<rect x="38" y="30" width="124" height="36" rx="10" ${F}/><rect x="28" y="82" width="144" height="36" rx="10" ${F}/><rect x="18" y="134" width="164" height="36" rx="10" ${F}/>`);
add("emblem-bid", "Sealed Ticket", "Bid", "page",
  `<path d="M24 50 H176 V86 A14 14 0 0 0 176 114 V150 H24 V114 A14 14 0 0 0 24 86 Z" ${F}/><defs><mask id="st"><rect width="200" height="200" fill="#fff"/><circle cx="74" cy="100" r="20" fill="#000"/><path d="M128 58 V142" stroke="#000" stroke-width="6" stroke-dasharray="2 12" stroke-linecap="round"/></mask></defs>`.replace(`Z" ${F}/>`, `Z" ${F} mask="url(#st)"/>`));
add("emblem-receipt", "Folded Receipt", "Receipt", "page",
  `<path d="M50 18 H150 V182 L134 170 L118 182 L100 170 L82 182 L66 170 L50 182 Z" ${F}/><defs><mask id="fr"><rect width="200" height="200" fill="#fff"/><path d="M74 60 H126 M74 90 H126 M74 120 H104" stroke="#000" stroke-width="12" stroke-linecap="round"/></mask></defs>`.replace(`Z" ${F}/>`, `Z" ${F} mask="url(#fr)"/>`));

// ---------- more ornaments ----------
add("pill", "Pill", "Shapes", "ornament", `<rect x="22" y="70" width="156" height="60" rx="30" transform="rotate(-30 100 100)" ${F}/>`);
add("crescent", "Crescent", "Shapes", "ornament", `<defs><mask id="cr"><rect width="200" height="200" fill="#fff"/><circle cx="126" cy="80" r="64" fill="#000"/></mask></defs><circle cx="96" cy="104" r="76" ${F} mask="url(#cr)"/>`);
add("quarter-ring", "Quarter Ring", "Circles", "ornament", `<path d="M30 170 A140 140 0 0 1 170 30" ${S(24)}/>`);
add("orbit-dots", "Orbit Dots", "Dots", "ornament", `<ellipse cx="100" cy="100" rx="80" ry="40" ${S(6)}/><circle cx="20" cy="100" r="12" ${F}/><circle cx="160" cy="72" r="9" ${F}/><circle cx="100" cy="100" r="20" ${F}/>`);
add("dash-circle", "Dash Circle", "Circles", "ornament", `<circle cx="100" cy="100" r="70" fill="none" stroke="#fff" stroke-width="12" stroke-dasharray="16 14" stroke-linecap="round"/>`);
add("star-five", "Five Star", "Stars", "ornament", `<path d="${poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 36 : 84; return [100 + Math.cos(a) * r, 104 + Math.sin(a) * r]; }))} Z" ${F}/>`);
add("star-outline", "Star Outline", "Stars", "ornament", `<path d="${poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 34 : 80; return [100 + Math.cos(a) * r, 104 + Math.sin(a) * r]; }))} Z" ${S(8)}/>`);
add("lightning", "Lightning", "Weather", "ornament", `<path d="M118 14 L48 112 H96 L80 186 L156 82 H106 Z" ${F}/>`);
add("raindrop", "Raindrop", "Weather", "ornament", `<path d="M100 18 C130 64 154 96 154 126 A54 54 0 0 1 46 126 C46 96 70 64 100 18 Z" ${F}/>`);
add("wave-band", "Wave Band", "Squiggles", "ornament", `<path d="${wave(84, 18, 2)}" ${S(12)}/><path d="${wave(122, 18, 2)}" ${S(12)}/>`);
add("scribble", "Scribble", "Squiggles", "ornament", `<path d="${smooth([[30, 60], [150, 50], [40, 100], [170, 92], [36, 142], [160, 140]], false)}" ${S(9)}/>`);
add("arch", "Arch", "Shapes", "ornament", `<path d="M30 180 V100 A70 70 0 0 1 170 100 V180 H138 V104 A38 38 0 0 0 62 104 V180 Z" ${F}/>`);
add("stripe-square", "Stripe Square", "Shapes", "ornament", clip("sq", `<rect x="34" y="34" width="132" height="132" rx="18"/>`, Array.from({ length: 8 }, (_, i) => `<rect x="${34 + i * 18}" y="20" width="10" height="160" ${F}/>`).join("")));
add("dot-wave", "Dot Wave", "Dots", "ornament", Array.from({ length: 11 }, (_, i) => `<circle cx="${20 + i * 16}" cy="${f(100 + Math.sin(i * 0.9) * 44)}" r="${f(6 + (i % 3) * 2)}" ${F}/>`).join(""));
add("knot", "Knot", "Swirls", "ornament", `<path d="${smooth([[60, 150], [40, 80], [100, 40], [160, 80], [140, 150], [70, 100], [130, 100], [60, 150]], false)}" ${S(10)}/>`);
add("teardrop-pair", "Teardrop Pair", "Blobs", "ornament", `<path d="M70 30 C96 70 112 96 106 126 A40 40 0 0 1 30 116 C34 84 52 62 70 30 Z" ${F}/><path d="M146 72 C164 100 178 120 172 144 A30 30 0 0 1 116 138 C118 114 132 96 146 72 Z" ${S(8)}/>`);
add("grid-sphere", "Grid Sphere", "Spheres", "ornament", clip("gs", `<circle cx="100" cy="100" r="76"/>`, Array.from({ length: 9 }, (_, i) => `<rect x="${24 + i * 18}" y="0" width="7" height="200" ${F}/><rect x="0" y="${24 + i * 18}" width="200" height="7" ${F}/>`).join("")));

// ---------- write ----------
const index = [];
for (const d of lib) {
  writeFileSync(path.join(OUT, `${d.slug}.svg`), d.svg);
  index.push({ slug: d.slug, name: d.name, category: d.category, group: d.group, ...(d.mode ? { mode: d.mode } : {}) });
}
writeFileSync(path.join(ROOT, "src/data/doodles.json"), JSON.stringify(index, null, 2));
console.log(`${lib.length} doodles: ${["market", "mechanism", "page", "ornament"].map((g) => `${g} ${lib.filter((d) => d.group === g).length}`).join(", ")}`);
