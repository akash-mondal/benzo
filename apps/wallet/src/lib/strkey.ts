/**
 * Minimal StrKey (ed25519 public key) validation — no @stellar/stellar-sdk dep,
 * no Buffer/node polyfills, just the wire rules. A shape match (`^G[A-Z2-7]{55}$`)
 * is NOT enough: a typo can stay shape-valid yet fail the checksum, and money sent
 * to a checksum-valid-but-wrong account is gone. We verify the real StrKey:
 *   • base32 decodes to 35 bytes
 *   • version byte == 6 << 3 (0x30, the ed25519 public-key prefix 'G')
 *   • trailing CRC16-XModem checksum matches the payload
 * Mirrors @stellar/stellar-sdk's StrKey.isValidEd25519PublicKey without the bundle.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B32_REV: Record<string, number> = {};
for (let i = 0; i < B32.length; i++) B32_REV[B32[i]] = i;

function base32Decode(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = B32_REV[ch];
    if (v === undefined) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** CRC16-XModem (poly 0x1021) — the checksum StrKey appends. */
function crc16(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** True iff `addr` is a checksum-valid Stellar ed25519 public key (G…). */
export function isValidStellarAddress(addr: string): boolean {
  const t = addr.trim();
  if (!/^G[A-Z2-7]{55}$/.test(t)) return false;
  const raw = base32Decode(t);
  if (!raw || raw.length !== 35) return false; // 1 version + 32 key + 2 checksum
  if (raw[0] !== (6 << 3)) return false; // ed25519 public key version byte
  const payload = raw.subarray(0, 33);
  const checksum = raw[33] | (raw[34] << 8); // little-endian
  return crc16(payload) === checksum;
}

/** GABC…WXYZ display form so the user can eyeball the parsed key on confirm. */
export function shortAddress(addr: string, n = 4): string {
  const t = addr.trim();
  return t.length > n * 2 + 1 ? `${t.slice(0, n)}…${t.slice(-n)}` : t;
}
