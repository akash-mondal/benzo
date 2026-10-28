// The host openings cache. After a successful derivation the
// signer host writes its own openings to $BNZ_STATE_DIR/auctions/<id>/openings.json —
// {frozen_root, beacon_sha256, openings: {leaf_index: plaintext|null}} — and its memo openings to
// memo-openings.json the same way, keyed by sha256(ciphertext) since strays are per note. Mode 0600: the file
// holds decrypted bids. It is a cache of THIS host's own computation, never packet input: it is reused only
// when BOTH keys equal this packet's frozen root and beacon; a missing, unreadable or non-matching file is a
// full rebuild, never an error. `benzo verify --openings-cache` (host-only) reads the same file and skips
// re-decrypting exactly the leaves it covers.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonBytes } from "../manifest/schema";

export type OpeningsFile = { frozen_root: string; beacon_sha256: string; openings: Record<string, string | null> };

// The design's beacon key: sha256 over the beacon signature's 48 raw bytes.
export const beaconSha256 = (beacon: { signature: string }): string =>
  createHash("sha256").update(Buffer.from(beacon.signature, "hex")).digest("hex");

// The cached openings when the file is well-formed AND both keys equal this packet's frozen root and beacon;
// null (a full rebuild) otherwise. A well-formed value is null (the bid did not open) or a 128-byte plaintext
// in hex — anything else makes the file unusable and it is rebuilt.
export function loadOpenings(file: string, frozenRoot: string, beaconSha: string): Record<string, string | null> | null {
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as OpeningsFile;
    if (!doc || doc.frozen_root !== frozenRoot || doc.beacon_sha256 !== beaconSha) return null;
    if (!doc.openings || typeof doc.openings !== "object" || Array.isArray(doc.openings)) return null;
    for (const value of Object.values(doc.openings)) if (value !== null && !(typeof value === "string" && /^[0-9a-f]{256}$/.test(value))) return null;
    return doc.openings;
  } catch { return null; } // a missing or unreadable cache is a rebuild, never an error
}

// Write the cache atomically (temp file + rename) with mode 0600.
export function saveOpenings(file: string, frozenRoot: string, beaconSha: string, openings: Record<string, string | null>): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const doc: OpeningsFile = { frozen_root: frozenRoot, beacon_sha256: beaconSha, openings };
  writeFileSync(file + ".new", jsonBytes(doc), { mode: 0o600 });
  renameSync(file + ".new", file);
}
