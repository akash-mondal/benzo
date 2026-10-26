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

// ---------- detailed redraws (Oct 26): engraved drawings for every doodle you can click ----------
// The shader reads only alpha, so detail is geometry: solid bodies with engraved cuts (a mask of thin black lines),
// rims, seams, rivets and hatching. Cuts are 3.5-5 units on the 200 grid, so they hold at field size and up close.
const redo = (slug, body) => { const d = lib.find((x) => x.slug === slug); if (!d) throw new Error(`no doodle ${slug}`); d.svg = svg(body); };
const C = (d, w = 4.5) => `<path d="${d}" fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const Cc = (cx, cy, r, w = 4.5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="${w}"/>`;
const Cd = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#000"/>`;
const mask = (id, cuts) => `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200"><rect width="200" height="200" fill="#fff"/>${cuts}</mask></defs>`;
const L = (d, w = 4) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>`;
const hatch = (x0, x1, y0, y1, step, w = 3, slope = 1) => Array.from({ length: Math.ceil((x1 - x0 + (y1 - y0)) / step) }, (_, i) => `M${x0 + i * step - (y1 - y0) * slope} ${y1} L${x0 + i * step} ${y0}`).join(" ");
const sparks = (pts) => pts.map(([x, y, r]) => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="#fff"/>`).join("");

// Uniform price: the gavel, banded head and ridged caps, a gripped handle, the sound block, the strike.
redo("gavel", mask("gv", C("M64 58 V82 M136 58 V82") + C("M58 70 H142", 3) + C("M100 118 V148 M100 158 V164", 3.5) + C("M24 166 H120", 3) + Cd(42, 70, 3) + Cd(158, 70, 3)) +
  `<g mask="url(#gv)" transform="rotate(-38 100 100)"><rect x="52" y="48" width="96" height="44" rx="12" fill="#fff"/><rect x="36" y="40" width="20" height="60" rx="8" fill="#fff"/><rect x="144" y="40" width="20" height="60" rx="8" fill="#fff"/><rect x="92" y="92" width="16" height="84" rx="8" fill="#fff"/></g>` +
  `<g>${mask("gb", C("M30 172 H118", 3))}<rect mask="url(#gb)" x="22" y="160" width="104" height="24" rx="8" fill="#fff"/></g>` + L("M138 160 L156 150 M142 176 L164 176 M134 144 L146 128", 5));
// OTC: two hollow arrows passing each other, a sealed coin between them.
redo("swap-arrows", mask("sw", C("M44 72 H140 M126 58 L144 72 L126 86", 4) + C("M156 128 H60 M74 114 L56 128 L74 142", 4) + Cc(100, 100, 13, 3.5)) +
  `<g mask="url(#sw)">${L("M34 72 H150 M120 42 L152 72 L120 102", 20)}${L("M166 128 H50 M80 98 L48 128 L80 158", 20)}</g>` + dot(100, 100, 9) + L("M18 72 h4 M178 128 h4", 6));
// RFQ: the price tag with its eyelet, a looped string, quoted lines and a stitched edge.
redo("price-tag", mask("pt", Cc(140, 58, 11, 5) + C("M94 108 L124 78 M80 104 L114 70 M88 128 L132 84", 5) + C("M106 34 H160 V88 L96 152 L46 102 Z", 3) + `<path d="M106 34 H160 V88 L96 152 L46 102 Z" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="1 9" transform="translate(0 0)"/>`) +
  `<path mask="url(#pt)" d="M100 22 H172 V94 L96 170 L28 102 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>` + L("M140 58 C150 20 186 16 186 36 C186 52 166 54 158 42", 4.5));
// Launch: a riveted rocket with a rimmed porthole, panel seams, finned tail and a two-tongue flame.
redo("rocket", mask("rk", Cc(100, 72, 15, 5) + Cd(100, 72, 9) + C("M76 104 H124 M80 124 H120", 3.5) + C("M100 22 V40", 3) + Cd(82, 114, 2.6) + Cd(118, 114, 2.6) + C("M54 124 L46 140 M146 124 L154 140", 3) + C("M90 156 Q100 176 110 156", 3)) +
  `<g mask="url(#rk)"><path d="M100 12 C138 42 146 94 132 138 H68 C54 94 62 42 100 12 Z" fill="#fff"/><path d="M70 100 L36 144 L40 158 L72 140 Z M130 100 L164 144 L160 158 L128 140 Z" fill="#fff"/><path d="M78 140 H122 V150 H78 Z" fill="#fff"/><path d="M84 152 C84 176 100 192 100 192 C100 192 116 176 116 152 Z" fill="#fff"/></g>` + sparks([[34, 40, 7], [168, 70, 5], [40, 86, 4]]));
// Buyback: two hollow return arcs around a coin stamped with a Z.
redo("loop-arrows", mask("la", C("M145 86 A50 50 0 0 0 58 74 M44 62 L58 76 L74 64", 4) + C("M55 114 A50 50 0 0 0 142 126 M156 138 L142 124 L126 136", 4) + C("M88 86 H112 L88 114 H112", 5) + Cc(100, 100, 30, 3)) +
  `<g mask="url(#la)">${L("M154 84 A58 58 0 0 0 50 72 M32 56 L50 78 L74 60", 18)}${L("M46 116 A58 58 0 0 0 150 128 M168 144 L150 122 L126 140", 18)}<circle cx="100" cy="100" r="36" fill="#fff"/></g>`);
// Drop: an isometric crate with planks, corner brackets, nails and a stencilled arrow.
redo("crate", mask("cr", C("M100 94 V176 M32 60 L100 94 L168 60", 5) + C("M44 84 L90 107 M44 112 L90 135 M110 107 L156 84 M110 135 L156 112", 3.5) + C("M66 43 L134 77", 4) + [[38, 70], [38, 128], [94, 102], [94, 160], [106, 102], [106, 160], [162, 70], [162, 128]].map(([x, y]) => Cd(x, y, 2.6)).join("") + C("M130 128 V146 M122 138 L130 146 L138 138", 3.5)) +
  `<path mask="url(#cr)" d="M100 22 L172 58 V142 L100 178 L28 142 V58 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`);
// Bid: a sealed admission ticket: notched, perforated, a wax seal, printed lines and a serial.
redo("emblem-bid", mask("eb", Cc(66, 100, 20, 4.5) + `<path d="M66 86 L70 96 L80 96 L72 102 L75 112 L66 106 L57 112 L60 102 L52 96 L62 96 Z" fill="#000"/>` + `<path d="M124 56 V144" stroke="#000" stroke-width="5" stroke-dasharray="1 11" stroke-linecap="round"/>` + C("M142 76 H164 M142 92 H160 M142 108 H164 M142 124 H156", 3.5) + C("M98 84 H110 M98 100 H112 M98 116 H108", 3) + `<path d="M30 56 H170 V84 A16 16 0 0 0 170 116 V144 H30 V116 A16 16 0 0 0 30 84 Z" fill="none" stroke="#000" stroke-width="2.5" transform="translate(100 100) scale(0.9) translate(-100 -100)"/>`) +
  `<path mask="url(#eb)" d="M20 48 H180 V82 A18 18 0 0 0 180 118 V152 H20 V118 A18 18 0 0 0 20 82 Z" fill="#fff"/>`);
// Start a round: a quill with a split nib, a rachis, combed barbs and an ink drop.
redo("quill", mask("qu", C("M60 146 C88 104 118 66 148 26", 3.5) + Array.from({ length: 11 }, (_, i) => { const t = 0.12 + i * 0.075, x = 60 + (148 - 60) * t, y = 146 + (26 - 146) * t; return C(`M${f(x)} ${f(y)} l${f(10 - i * 0.3)} ${f(5 + i * 0.4)}`, 2.6) + C(`M${f(x)} ${f(y)} l${f(-5 - i * 0.2)} ${f(-9 + i * 0.2)}`, 2.6); }).join("")) +
  `<path mask="url(#qu)" d="M156 16 C100 32 66 82 54 146 C100 134 146 92 156 16 Z" fill="#fff"/>` + `<path d="M56 140 L40 168 L46 174 L62 148 Z" fill="#fff"/>` + L("M36 176 L30 186", 4) + `<path d="M150 170 C158 180 158 188 150 190 C142 188 142 180 150 170 Z" fill="#fff"/>`);
// Mine: a receipt with a header band, itemised lines and amounts, a total rule and a barcode.
redo("emblem-receipt", mask("er", `<rect x="62" y="30" width="76" height="14" rx="4" fill="#000"/>` + C("M64 62 H112 M124 62 H138 M64 80 H104 M124 80 H138 M64 98 H116 M124 98 H138", 4) + C("M64 118 H138", 2.5) + C("M64 132 H96 M114 132 H138", 5) + Array.from({ length: 14 }, (_, i) => `<rect x="${64 + i * 5.3}" y="146" width="${i % 3 ? 2.2 : 3.6}" height="16" fill="#000"/>`).join("")) +
  `<path mask="url(#er)" d="M48 16 H152 V182 L139 172 L126 182 L113 172 L100 182 L87 172 L74 182 L61 172 L48 182 Z" fill="#fff"/>`);
// Verify: a rimmed lens with a glint, a check cut through the glass and a banded handle.
redo("emblem-verify", mask("ev", Cc(86, 86, 48, 4) + C("M58 88 L78 108 L114 68", 12) + C("M56 56 A40 40 0 0 1 82 44", 4) + C("M134 128 L144 138 M146 140 L156 150", 4)) +
  `<g mask="url(#ev)"><circle cx="86" cy="86" r="62" fill="#fff"/>${L("M128 128 L176 176", 22)}</g>` + dot(176, 176, 5));
// Every lot: three filed folders with tabs, labels and a stitched spine.
redo("emblem-lots", mask("el", C("M54 48 H96 M54 100 H112 M54 152 H128", 4.5) + C("M140 48 H150 M150 100 H160 M160 152 H170", 4.5) + `<path d="M30 74 H174 M22 126 H182" stroke="#000" stroke-width="3" stroke-dasharray="1 8" stroke-linecap="round"/>`) +
  `<g mask="url(#el)"><path d="M36 30 H84 L92 38 H164 V66 H36 Z" fill="#fff"/><path d="M26 82 H90 L98 90 H174 V118 H26 Z" fill="#fff"/><path d="M16 134 H96 L104 142 H184 V170 H16 Z" fill="#fff"/></g>`);

// The market's other round glyphs, each in the same engraved manner.
redo("podium", mask("pd", C("M78 110 H122 M30 140 H66 M136 152 H170", 3.5) + `<text x="100" y="104" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="30" fill="#000">1</text><text x="47" y="134" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="22" fill="#000">2</text><text x="153" y="148" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="20" fill="#000">3</text>`) +
  `<path mask="url(#pd)" d="M70 70 H130 V176 H70 Z M22 108 H70 V176 H22 Z M130 124 H178 V176 H130 Z" fill="#fff"/>` + `<path d="M100 18 L107 34 L124 35 L111 46 L115 63 L100 54 L85 63 L89 46 L76 35 L93 34 Z" fill="#fff"/>` + sparks([[60, 40, 6], [142, 46, 5]]));
redo("auction-bell", mask("ab", C("M60 120 C60 90 74 74 100 72", 4) + C("M44 150 H156", 3) + Cc(100, 52, 6, 3)) +
  `<g mask="url(#ab)"><path d="M40 150 C40 96 62 64 100 62 C138 64 160 96 160 150 Z" fill="#fff"/><rect x="24" y="148" width="152" height="22" rx="10" fill="#fff"/><circle cx="100" cy="52" r="13" fill="#fff"/></g>` + L("M150 40 L168 22 M160 62 L184 56 M40 40 L28 26", 6) + L("M60 180 H140", 4));
redo("pact", mask("pc", Cc(40, 100, 18, 3.5) + Cc(160, 100, 18, 3.5) + C("M92 100 L100 92 L108 100 L100 108 Z", 3)) +
  `<g mask="url(#pc)"><circle cx="40" cy="100" r="30" fill="#fff"/><circle cx="160" cy="100" r="30" fill="#fff"/><path d="M100 72 L128 100 L100 128 L72 100 Z" fill="#fff"/></g>` + `<path d="M70 100 H72 M128 100 H130" stroke="#fff" stroke-width="10"/>` + L("M40 140 V160 M160 140 V160 M40 160 H160", 5) + L("M100 128 V160", 5));
redo("two-coins", mask("tc", Cc(126, 114, 38, 3.5) + C("M112 96 H140 L112 132 H140 M126 86 V96 M126 132 V142", 5) + Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return C(`M${f(126 + Math.cos(a) * 44)} ${f(114 + Math.sin(a) * 44)} L${f(126 + Math.cos(a) * 49)} ${f(114 + Math.sin(a) * 49)}`, 2.5); }).join("")) +
  `<circle cx="72" cy="84" r="48" fill="none" stroke="#fff" stroke-width="10"/>` + L("M58 62 H86 L58 106 H86", 6) + `<circle mask="url(#tc)" cx="126" cy="114" r="52" fill="#fff"/>`);
redo("quote-bubble", mask("qb", C("M62 74 H138 M62 96 H120 M62 118 H104", 5) + `<text x="150" y="122" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="34" fill="#000">?</text>`) +
  `<path mask="url(#qb)" d="M26 34 H174 V140 H90 L48 176 V140 H26 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>` + dot(174, 34, 0));
redo("ledger-sheet", mask("lg", C("M62 50 H138", 6) + C("M62 76 H106 M120 76 H138 M62 98 H106 M120 98 H138 M62 120 H106 M120 120 H138", 4) + C("M114 66 V130", 2.5) + C("M62 146 H138", 3) + C("M98 162 H138", 5)) +
  `<rect mask="url(#lg)" x="38" y="20" width="124" height="162" rx="14" fill="#fff"/>` + `<path d="M140 20 L162 42 H140 Z" fill="#fff"/>`);
redo("sprout", mask("sp", C("M100 104 C78 96 58 78 48 54", 3.5) + C("M100 92 C118 74 140 60 162 52", 3.5) + C("M66 82 L72 70 M82 94 L90 82 M122 80 L118 68 M140 68 L138 56", 2.6)) +
  `<g mask="url(#sp)"><path d="M100 106 C58 110 34 82 32 42 C74 42 98 66 100 106 Z M100 94 C112 58 140 38 174 40 C172 80 142 100 100 94 Z" fill="#fff"/></g>` + L("M100 176 V96", 9) + `<path d="M48 178 C70 160 130 160 152 178 Z" fill="#fff"/>`);
redo("flag", mask("fl", C("M70 46 C96 38 114 60 146 50", 3.5) + C("M70 70 C96 62 114 84 146 74", 3.5) + C("M70 94 C96 86 114 108 146 98", 3.5)) +
  `<path mask="url(#fl)" d="M56 28 C92 12 118 44 160 28 V112 C118 128 92 96 56 112 Z" fill="#fff"/>` + L("M50 18 V184", 10) + dot(50, 16, 8) + `<path d="M30 184 H72 L66 172 H36 Z" fill="#fff"/>`);
redo("return-coin", mask("rc", Cc(100, 100, 30, 3.5) + C("M88 86 H112 L88 114 H112 M100 76 V86 M100 114 V124", 5)) +
  `<circle mask="url(#rc)" cx="100" cy="100" r="40" fill="#fff"/>` + L("M162 104 A62 62 0 1 1 134 48", 11) + `<path d="M114 24 L146 42 L120 68 Z" fill="#fff"/>` + L("M100 12 v6 M100 182 v6 M12 100 h6", 5));
redo("basket", mask("bk", C("M40 104 H160 M44 130 H156 M50 154 H150", 3.5) + C("M70 86 L74 168 M100 86 V170 M130 86 L126 168", 3.5)) +
  `<path mask="url(#bk)" d="M18 84 H182 L162 174 H38 Z" fill="#fff"/>` + L("M54 84 L86 26 M146 84 L114 26", 10) + dot(86, 24, 7) + dot(114, 24, 7) + `<rect x="10" y="76" width="180" height="14" rx="7" fill="#fff"/>`);
redo("gift-box", mask("gf", C("M100 58 V176", 14) + C("M30 120 H170", 3) + C("M36 92 H164", 2.5)) +
  `<g mask="url(#gf)"><rect x="30" y="84" width="140" height="94" rx="8" fill="#fff"/><rect x="20" y="58" width="160" height="32" rx="8" fill="#fff"/></g>` + L("M92 58 V178 M108 58 V178", 4) + `<path d="M100 56 C70 14 38 32 60 52 C68 60 86 58 100 56 Z M100 56 C130 14 162 32 140 52 C132 60 114 58 100 56 Z" fill="#fff"/>` + dot(100, 56, 8));
redo("ticket-roll", mask("tr", Cc(70, 100, 40, 3) + Cc(70, 100, 26, 3) + Cd(70, 100, 10) + `<path d="M140 108 V136" stroke="#000" stroke-width="5" stroke-dasharray="1 9" stroke-linecap="round"/>` + C("M152 114 H176 M152 128 H170", 3.5)) +
  `<circle mask="url(#tr)" cx="70" cy="100" r="56" fill="#fff"/><path mask="url(#tr)" d="M96 92 H186 V112 A8 8 0 0 0 186 128 V148 H96 Z" fill="#fff"/>`);

// The pieces of a sealed bid (background, softened): each gains its own engraved detail.
redo("sealed-envelope", mask("se", C("M30 60 L100 112 L170 60", 5) + C("M30 150 L80 104 M170 150 L120 104", 3.5) + Cc(100, 118, 20, 3.5) + `<text x="100" y="126" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="22" fill="#000">B</text>`) + `<rect mask="url(#se)" x="18" y="46" width="164" height="112" rx="12" fill="#fff"/>`);
redo("padlock", mask("pl", Cc(100, 124, 12, 0) + Cd(100, 122, 11) + C("M100 128 V150", 9) + C("M56 104 H144 M56 162 H144", 3)) + L("M64 92 V66 A36 36 0 0 1 136 66 V92", 14) + `<rect mask="url(#pl)" x="42" y="88" width="116" height="92" rx="16" fill="#fff"/>`);
redo("vault-door", mask("vd", Cc(100, 100, 60, 3.5) + Cc(100, 100, 22, 4) + Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return C(`M${f(100 + Math.cos(a) * 28)} ${f(100 + Math.sin(a) * 28)} L${f(100 + Math.cos(a) * 52)} ${f(100 + Math.sin(a) * 52)}`, 6); }).join("") + Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return Cd(f(100 + Math.cos(a) * 70), f(100 + Math.sin(a) * 70), 3); }).join("")) + `<circle mask="url(#vd)" cx="100" cy="100" r="80" fill="#fff"/>`);
redo("magnifier", mask("mg", Cc(84, 84, 40, 3.5) + C("M62 60 A30 30 0 0 1 84 50", 4)) + `<g mask="url(#mg)"><circle cx="84" cy="84" r="54" fill="#fff"/></g>` + L("M124 124 L172 172", 20));
redo("zec-coin", mask("zc", Cc(100, 100, 62, 3.5) + C("M74 72 H126 L74 128 H126 M100 52 V72 M100 128 V148", 11) + Array.from({ length: 36 }, (_, i) => { const a = (i / 36) * Math.PI * 2; return C(`M${f(100 + Math.cos(a) * 70)} ${f(100 + Math.sin(a) * 70)} L${f(100 + Math.cos(a) * 77)} ${f(100 + Math.sin(a) * 77)}`, 2.6); }).join("")) + `<circle mask="url(#zc)" cx="100" cy="100" r="80" fill="#fff"/>`);
redo("shield-z", mask("sz2", C("M100 30 L154 50 V96 C154 134 130 158 100 170 C70 158 46 134 46 96 V50 Z", 3.5) + C("M74 68 H126 L74 128 H126", 14)) + `<path mask="url(#sz2)" d="M100 16 L168 40 V96 C168 142 136 170 100 184 C64 170 32 142 32 96 V40 Z" fill="#fff"/>`);
redo("hourglass", mask("hg", C("M76 150 Q100 132 124 150", 3)) + L("M48 22 H152 M48 178 H152", 12) + L("M58 26 C58 78 100 86 100 100 C100 114 58 122 58 174 H142 C142 122 100 114 100 100 C100 86 142 78 142 26", 8) + `<path mask="url(#hg)" d="M72 166 Q100 124 128 166 Z" fill="#fff"/>` + `<path d="M84 60 Q100 74 116 60 Z" fill="#fff"/>` + L("M100 100 V150", 3) + L("M40 26 V174 M160 26 V174", 6));
redo("merkle-tree", L("M100 46 L56 100 M100 46 L144 100 M56 100 L34 152 M56 100 L78 152 M144 100 L122 152 M144 100 L166 152", 6) + [[100, 42, 16], [56, 100, 14], [144, 100, 14], [34, 156, 12], [78, 156, 12], [122, 156, 12], [166, 156, 12]].map(([x, y, r], i) => `${mask("mk" + i, Cc(x, y, r - 5, 3) + Cd(x, y, 2.5))}<circle mask="url(#mk${i})" cx="${x}" cy="${y}" r="${r}" fill="#fff"/>`).join(""));

// OTC, redrawn: two solid arrows passing, each grooved along its shaft, a sealed coin between them.
redo("swap-arrows", mask("sw2", C("M44 72 H126", 3.5) + C("M156 128 H74", 3.5) + C("M132 58 L146 72 L132 86", 3) + C("M68 114 L54 128 L68 142", 3) + Cc(100, 100, 9, 3)) +
  `<g mask="url(#sw2)">${L("M30 72 H130", 18)}<path d="M126 42 L164 72 L126 102 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>${L("M170 128 H70", 18)}<path d="M74 98 L36 128 L74 158 Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><circle cx="100" cy="100" r="16" fill="#fff"/></g>`);

// A detail pass on every doodle not redrawn by hand: a solid shape gets an engraved inner contour (its own outline,
// drawn smaller as a cut), a thick line gets a groove down its middle (a thinner cut along it).
const handDrawn = new Set(["gavel", "swap-arrows", "price-tag", "rocket", "loop-arrows", "crate", "emblem-bid", "quill", "emblem-receipt", "emblem-verify", "emblem-lots",
  "podium", "auction-bell", "pact", "two-coins", "quote-bubble", "ledger-sheet", "sprout", "flag", "return-coin", "basket", "gift-box", "ticket-roll",
  "sealed-envelope", "padlock", "vault-door", "magnifier", "zec-coin", "shield-z", "hourglass", "merkle-tree"]);
for (const d of lib) {
  if (handDrawn.has(d.slug)) continue;
  const body = d.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  if (/<mask|clip-path|<text/.test(body)) continue; // already carries cuts or clipping of its own
  // Grooves along thick strokes.
  const grooves = [...body.matchAll(/<(path|circle|ellipse|rect)\b([^>]*?)stroke="#fff" stroke-width="([\d.]+)"([^>]*)\/>/g)]
    .filter((m) => Number(m[3]) >= 9).map((m) => `<${m[1]}${m[2]}stroke="#000" stroke-width="${f(Number(m[3]) * 0.26)}"${m[4]}/>`).join("");
  // Inner contours inside solid fills.
  // (small dots and pips stay plain: an inner line on them reads as a crescent)
  const big = (m) => { const a = m[0], n = (k) => Number(a.match(new RegExp(`\\b${k}="([\\d.]+)"`))?.[1] ?? 999); return m[1] === "circle" ? n("r") >= 18 : m[1] === "ellipse" ? Math.min(n("rx"), n("ry")) >= 14 : m[1] === "rect" ? Math.min(n("width"), n("height")) >= 30 : true; };
  const contours = [...body.matchAll(/<(path|circle|ellipse|rect)\b([^>]*?)fill="#fff"([^>]*)\/>/g)].filter(big)
    .map((m) => `<g transform="translate(100 100) scale(0.8) translate(-100 -100)"><${m[1]}${m[2]}fill="none" stroke="#000" stroke-width="4.5"${m[3].replace(/\bmask="[^"]*"/, "")}/></g>`).join("");
  if (!grooves && !contours) continue;
  const id = `dp-${d.slug}`;
  d.svg = svg(`<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200"><rect width="200" height="200" fill="#fff"/>${grooves}${contours}</mask></defs><g mask="url(#${id})">${body}</g>`);
}

// ---------- write ----------
const index = [];
for (const d of lib) {
  writeFileSync(path.join(OUT, `${d.slug}.svg`), d.svg);
  index.push({ slug: d.slug, name: d.name, category: d.category, group: d.group, ...(d.mode ? { mode: d.mode } : {}) });
}
writeFileSync(path.join(ROOT, "src/data/doodles.json"), JSON.stringify(index, null, 2));
console.log(`${lib.length} doodles: ${["market", "mechanism", "page", "ornament"].map((g) => `${g} ${lib.filter((d) => d.group === g).length}`).join(", ")}`);
