// Specters: the demo collection the site's rounds sell. Each identity is a small pixel figure drawn from its number,
// so the same number always draws the same figure, and its traits come from the same draw. Nothing here is fetched.

export type Traits = { lineage: string; sheet: string; eyes: string; crown: string };

const LINEAGE = [["Dusk", "#2a2f45", "#3b4263"], ["Moss", "#1f3a26", "#2c5236"], ["Ember", "#3d2418", "#5a3322"], ["Tide", "#163238", "#21494f"], ["Gilded", "#3e3418", "#5b4c22"], ["Void", "#0f1210", "#1c211b"]] as const;
const SHEET = [["Bone", "#ece6d6"], ["Gold", "#e9cd84"], ["Mint", "#b6e3c6"], ["Lilac", "#c9b6e8"], ["Coral", "#f0a58a"], ["Sky", "#a9cdea"], ["Ash", "#9a9f96"]] as const;
const EYES = [["Round", "#14170f"], ["Sleepy", "#14170f"], ["Starry", "#e9cd84"], ["Shades", "#14170f"], ["Wink", "#14170f"]] as const;
const CROWN = ["None", "None", "None", "Crown", "Cap", "Horns", "Leaf", "Halo"] as const;

// A small seeded generator (mulberry32), so a number always gives the same figure.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashOf(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// The identity number a lot name names ("Specter #417", "#417"), else one drawn from the name.
export function specterNo(name: string): number {
  const m = /#\s?(\d{1,4})/.exec(name);
  return m ? Number(m[1]) % 10000 : hashOf(name) % 10000;
}
export const isSpecter = (lot?: string | null) => !!lot && /specter/i.test(lot);

export function traitsOf(no: number): Traits {
  const r = rng(no * 2654435761);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  return { lineage: pick(LINEAGE)[0], sheet: pick(SHEET)[0], eyes: pick(EYES)[0], crown: pick(CROWN) };
}

// 16 x 16 cells: a floating sheet ghost with a wavy hem, its face, an optional crown, a moon and a few stars.
export function specterSvg(no: number): string {
  const r = rng(no * 2654435761);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const [, sky, sky2] = pick(LINEAGE), [, sheet] = pick(SHEET), [eyes, ink] = pick(EYES), crown = pick(CROWN);
  const cells: string[] = [];
  const px = (x: number, y: number, c: string, o = 1) => cells.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"${o < 1 ? ` opacity="${o}"` : ""}/>`);
  // The sky: a lighter band low down, a moon and stars.
  for (let y = 11; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, sky2, 0.6);
  const mx = r() < 0.5 ? 1 : 12; px(mx, 1, "#f3eee2", 0.9); px(mx + 1, 1, "#f3eee2", 0.9); px(mx, 2, "#f3eee2", 0.9); px(mx + 1, 2, "#f3eee2", 0.5);
  for (let i = 0; i < 5; i++) px(Math.floor(r() * 16), Math.floor(r() * 9), "#f3eee2", 0.35 + r() * 0.4);
  // The ghost: dome, body, wavy hem; it floats a cell or two above the ground.
  const lift = r() < 0.5 ? 0 : 1, wide = r() < 0.4 ? 5 : 4, top = 4 - lift;
  for (let y = top; y < top + 9; y++) {
    const half = y === top ? wide - 2 : y === top + 1 ? wide - 1 : wide;
    for (let x = 8 - half; x < 8 + half; x++) px(x, y, sheet);
  }
  const hem = top + 9;
  for (let x = 8 - wide; x < 8 + wide; x++) if ((x + (r() < 0.15 ? 1 : 0)) % 2 === 0) px(x, hem, sheet);
  for (let x = 8 - wide; x < 8 + wide; x++) px(x, hem + 2, "#000", 0.18);
  // The face.
  const ey = top + 3;
  if (eyes === "Shades") { for (let x = 5; x < 11; x++) if (x !== 8) px(x, ey, ink); }
  else if (eyes === "Sleepy") { px(5, ey, ink); px(6, ey, ink); px(9, ey, ink); px(10, ey, ink); }
  else if (eyes === "Wink") { px(6, ey, ink); px(6, ey - 1, ink); px(9, ey, ink); px(10, ey, ink); }
  else { px(6, ey, ink); px(6, ey - 1, ink); px(9, ey, ink); px(9, ey - 1, ink); }
  if (r() < 0.55) { px(7, ey + 2, "#14170f"); px(8, ey + 2, "#14170f"); }
  if (r() < 0.4) { px(5, ey + 1, "#f0a58a", 0.6); px(10, ey + 1, "#f0a58a", 0.6); }
  // The crown.
  const cy = top - 1;
  if (crown === "Crown") { for (let x = 6; x < 10; x++) px(x, cy, "#e9cd84"); px(6, cy - 1, "#e9cd84"); px(9, cy - 1, "#e9cd84"); }
  if (crown === "Cap") { for (let x = 5; x < 11; x++) px(x, cy, "#d9825b"); px(10, cy, "#d9825b"); px(11, cy, "#d9825b"); }
  if (crown === "Horns") { px(5, cy, "#c94f4f"); px(10, cy, "#c94f4f"); px(5, cy - 1, "#c94f4f"); px(10, cy - 1, "#c94f4f"); }
  if (crown === "Leaf") { px(8, cy, "#8fa86a"); px(9, cy - 1, "#8fa86a"); px(7, cy - 1, "#8fa86a"); }
  if (crown === "Halo") for (let x = 6; x < 10; x++) px(x, cy - 1, "#e9cd84", 0.9);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" fill="${sky}"/>${cells.join("")}</svg>`;
}
export const specterUri = (no: number) => `data:image/svg+xml;utf8,${encodeURIComponent(specterSvg(no))}`;

// What a Specters round sells, drawn: the mint's pieces, each one-of-one, or the piece in a private sale or commission.
export function piecesFor(d: { id: string; lot: string | null; mode: string; manifest?: any; lot_names?: string[] | null }): { no: number; name: string }[] {
  if (!isSpecter(d.lot)) return [];
  const lots: string[] | undefined = d.lot_names ?? undefined;
  if (lots?.length) return lots.map((l) => ({ no: specterNo(l), name: l }));
  if (/mint|buyback/i.test(d.lot ?? "")) return Array.from({ length: Math.min(4, Number(d.manifest?.supply ?? 2)) }, (_, i) => { const no = (hashOf(`${d.id}:${i}`) % 9999) + 1; return { no, name: `#${no}` }; });
  return [{ no: specterNo(d.lot ?? ""), name: `#${specterNo(d.lot ?? "")}` }];
}
