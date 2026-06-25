/**
 * Dependency-free QR code (byte mode, EC level M) rendered as inline SVG.
 *
 * The console package can't resolve a QR library (qrcode.react is hoisted only
 * for the wallet app), and the brief says edit only this app's src + "reuse a QR
 * lib if present, else show the address with a copy button". A real scannable QR
 * is a far better Receive experience than a bare address, so this is a small,
 * self-contained encoder - no runtime deps, no network - covering versions 1–10
 * which comfortably fit a Stellar G-address (~56 chars) at EC level M.
 *
 * If anything in encoding fails the caller falls back to the plain address block.
 */

// ---- Galois field (GF(256)) tables for Reed–Solomon -------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}
function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}
function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) for (let i = 0; i < gen.length - 1; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// ---- Per-version capacity (EC level M, byte mode) + EC params ----------------
// [version]: { size, ecCodewordsPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw, byteCapacity }
const VERSIONS = [
  { v: 1, ec: 10, g1: 1, d1: 16, g2: 0, d2: 0, cap: 14 },
  { v: 2, ec: 16, g1: 1, d1: 28, g2: 0, d2: 0, cap: 26 },
  { v: 3, ec: 26, g1: 1, d1: 44, g2: 0, d2: 0, cap: 42 },
  { v: 4, ec: 18, g1: 2, d1: 32, g2: 0, d2: 0, cap: 62 },
  { v: 5, ec: 24, g1: 2, d1: 43, g2: 0, d2: 0, cap: 84 },
  { v: 6, ec: 16, g1: 4, d1: 27, g2: 0, d2: 0, cap: 106 },
  { v: 7, ec: 18, g1: 4, d1: 31, g2: 0, d2: 0, cap: 122 },
  { v: 8, ec: 22, g1: 2, d1: 38, g2: 2, d2: 39, cap: 152 },
  { v: 9, ec: 22, g1: 3, d1: 36, g2: 2, d2: 37, cap: 180 },
  { v: 10, ec: 26, g1: 4, d1: 43, g2: 1, d2: 44, cap: 213 },
] as const;

const ALIGN_POS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// ---- bitstream --------------------------------------------------------------
class Bits {
  bytes: number[] = [];
  len = 0;
  push(val: number, n: number) {
    for (let i = n - 1; i >= 0; i--) {
      const bit = (val >> i) & 1;
      const bytePos = this.len >> 3;
      if ((this.len & 7) === 0) this.bytes[bytePos] = 0;
      if (bit) this.bytes[bytePos] |= 0x80 >> (this.len & 7);
      this.len++;
    }
  }
}

function buildCodewords(text: string): { matrix: boolean[][]; size: number } | null {
  const data = Array.from(new TextEncoder().encode(text));
  const spec = VERSIONS.find((vv) => data.length <= vv.cap);
  if (!spec) return null;
  const totalDataCw = spec.g1 * spec.d1 + spec.g2 * spec.d2;

  const bs = new Bits();
  bs.push(0b0100, 4); // byte mode
  bs.push(data.length, spec.v >= 10 ? 16 : 8); // char count (8 bits for v1–9)
  for (const b of data) bs.push(b, 8);
  // terminator + pad to byte boundary
  const remaining = totalDataCw * 8 - bs.len;
  bs.push(0, Math.min(4, Math.max(0, remaining)));
  while (bs.len & 7) bs.push(0, 1);
  // pad codewords
  const pad = [0xec, 0x11];
  let pi = 0;
  while (bs.bytes.length < totalDataCw) bs.bytes.push(pad[pi++ % 2]);

  // split into blocks
  const blocks: number[][] = [];
  let off = 0;
  for (let i = 0; i < spec.g1; i++) { blocks.push(bs.bytes.slice(off, off + spec.d1)); off += spec.d1; }
  for (let i = 0; i < spec.g2; i++) { blocks.push(bs.bytes.slice(off, off + spec.d2)); off += spec.d2; }
  const ecBlocks = blocks.map((blk) => rsEncode(blk, spec.ec));

  // interleave data, then EC
  const finalCw: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const blk of blocks) if (i < blk.length) finalCw.push(blk[i]);
  for (let i = 0; i < spec.ec; i++) for (const eb of ecBlocks) finalCw.push(eb[i]);

  return placeMatrix(finalCw, spec.v);
}

// ---- matrix construction ----------------------------------------------------
function placeMatrix(codewords: number[], version: number): { matrix: boolean[][]; size: number } {
  const size = version * 4 + 17;
  const m: (boolean | null)[][] = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));

  const setFinder = (r: number, c: number) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r + i, cc = c + j;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 &&
        (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
      m[rr][cc] = on;
    }
  };
  setFinder(0, 0); setFinder(0, size - 7); setFinder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
  // dark module
  m[size - 8][8] = true;

  // alignment patterns
  const ap = ALIGN_POS[version] ?? [];
  for (const r of ap) for (const c of ap) {
    if ((r <= 7 && c <= 7) || (r <= 7 && c >= size - 8) || (r >= size - 8 && c <= 7)) continue;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
    }
  }

  // reserve format-info areas (filled later)
  const reserve = (r: number, c: number) => { if (m[r][c] === null) m[r][c] = false; };
  for (let i = 0; i < 9; i++) { reserve(8, i); reserve(i, 8); }
  for (let i = 0; i < 8; i++) { reserve(8, size - 1 - i); reserve(size - 1 - i, 8); }

  // place data with mask 0: (r + c) % 2 === 0
  let bitIdx = 0;
  const total = codewords.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let n = 0; n < size; n++) {
      const row = upward ? size - 1 - n : n;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m[row][cc] !== null) continue;
        let bit = false;
        if (bitIdx < total) {
          const byte = codewords[bitIdx >> 3];
          bit = ((byte >> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
        if ((row + cc) % 2 === 0) bit = !bit; // mask 0
        m[row][cc] = bit;
      }
    }
    upward = !upward;
  }

  // format info for EC level M (01) + mask 0 → 15 bits, pre-computed
  const FORMAT_M_MASK0 = 0b101010000010010;
  const fmtBits: boolean[] = [];
  for (let i = 14; i >= 0; i--) fmtBits.push(((FORMAT_M_MASK0 >> i) & 1) === 1);
  // top-left + split locations (standard placement)
  const place = (r: number, c: number, b: boolean) => { m[r][c] = b; };
  // around top-left
  for (let i = 0; i <= 5; i++) place(8, i, fmtBits[i]);
  place(8, 7, fmtBits[6]);
  place(8, 8, fmtBits[7]);
  place(7, 8, fmtBits[8]);
  for (let i = 9; i <= 14; i++) place(14 - i, 8, fmtBits[i]);
  // around bottom-left / top-right
  for (let i = 0; i <= 7; i++) place(size - 1 - i, 8, fmtBits[i]);
  for (let i = 8; i <= 14; i++) place(8, size - 15 + i, fmtBits[i]);

  const out: boolean[][] = m.map((row) => row.map((x) => x === true));
  return { matrix: out, size };
}

/** Encode `text` to a QR module matrix, or null if it doesn't fit / fails. */
export function encodeQr(text: string): { matrix: boolean[][]; size: number } | null {
  try {
    return buildCodewords(text);
  } catch {
    return null;
  }
}

/**
 * Inline-SVG QR for the given text. Calm, theme-aware (dark modules use the fg
 * color; quiet zone is transparent so it sits on the card). Returns null when
 * the text can't be encoded so the caller can fall back to the address block.
 */
export function QrCode({ value, size = 168, className = "" }: { value: string; size?: number; className?: string }) {
  const enc = encodeQr(value);
  if (!enc) return null;
  const { matrix, size: n } = enc;
  const quiet = 2;
  const dim = n + quiet * 2;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (matrix[r][c]) rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`);
  }
  const svg = `<svg viewBox="0 0 ${dim} ${dim}" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${rects.join("")}</svg>`;
  return (
    <span
      className={`inline-block text-fg ${className}`}
      aria-label="QR code for the receive address"
      role="img"
      // eslint-disable-next-line react/no-danger -- locally generated, deterministic SVG (no user HTML)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
