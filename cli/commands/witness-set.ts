// benzo witness set — the signed witness-set side-packet the manifest's `witness_set_hash` commits to (gate X,
// R8 G10). Built and signed exactly like the harness does it (tools/repro/markets.ts): signRecord over
// {version: 1, auction_id, q_w, keys} with the operator's manifest-signing key (the same key `auction sign`
// uses, so the packet verifies against the manifest's signer). The q_w-of-n_w witness board is pinned HERE,
// before bidding; `auction create --witness-set` takes the file this prints.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { jsonBytes, requireThat, signRecord } from "../../manifest/schema";
import { validateWitnessSet, witnessSetHash } from "../../witness";

export const noun = "witness", verb = "set";
export const help = "benzo witness set --id AUCTION_ID --q N --keys HEX,HEX,HEX [--key private.pem] — build and sign the witness-set record ({version:1, auction_id, q_w, keys}) with the manifest-signing key, write it to $BNZ_STATE_DIR/run/witness-set-<id>.json, print {file, witness_set_hash}; refuses q outside 1..keys.length, duplicate keys and malformed keys";

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--q", "--keys", "--key"].includes(argv[i]) || argv[i + 1] === undefined) {
      process.stderr.write(`ERROR witness set usage: ${help}\n`);
      return 2;
    }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  try {
    // settle/io resolves BNZ_STATE_DIR at import time; import it here so `benzo --help` runs with no state dir.
    const { STATE } = await import("../../settle/io");
    requireThat(/^[0-9a-f]{64}$/.test(o.id ?? ""), "auction id");
    const q = Number(o.q);
    requireThat(Number.isInteger(q), "q must be an integer");
    const keys = (o.keys ?? "").split(",");
    // The same checks `auction create --witness-set` accepts later (validateWitnessSet, the shared rule):
    // 2..16 keys, each a raw 64-hex Ed25519 public key, no duplicates, and q_w in 1..keys.length.
    const set = { version: 1 as const, auction_id: o.id, q_w: q, keys };
    validateWitnessSet(set, o.id);
    const defaultKey = path.join(STATE, "auction", "manifest-signing.pem");
    const key = o.key ? path.resolve(o.key) : defaultKey;
    requireThat(key === defaultKey, "witness-set signer must match the local manifest key (auction sign signs with it)");
    if (!existsSync(key)) {
      mkdirSync(path.dirname(key), { recursive: true, mode: 0o700 });
      writeFileSync(key, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
    }
    const record = signRecord(set, readFileSync(key, "utf8"));
    const file = path.join(STATE, "run", `witness-set-${o.id}.json`);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const bytes = jsonBytes(record);
    if (existsSync(file)) {
      // A re-run with the same inputs is idempotent; a DIFFERENT record for the same auction is refused,
      // so nobody can silently swap the witness board between two operator runs.
      requireThat(readFileSync(file).equals(bytes), `a different witness set is already written at ${file}; refusing to replace it`);
    } else {
      writeFileSync(file, bytes, { mode: 0o600 });
    }
    return { file, witness_set_hash: witnessSetHash(record) };
  } catch (e) {
    process.stderr.write(`ERROR witness set ${(e as Error).message}\n`);
    return 1;
  }
}
