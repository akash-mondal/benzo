// benzo witness sign|verify — gate X witness certificates: a witness key co-signs the frozen statement, and the
// public dir's certificates are checked q_w-of-n_w against the signed manifest's witness set.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { requireThat, verifyRecord } from "../../manifest/schema";
import { loadPublicAuction } from "../../api/public-auction";
import { checkCertificates, freezeStatement, signStatement, validateWitnessSet, type WitnessCert, type WitnessSet } from "../../witness";

export const noun = "witness";
export const verb = "";
export const help = "benzo witness sign --dir <public-auction-dir> --signer <ed25519-spki-der-hex> --key <file under BNZ_STATE_DIR> | benzo witness verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> — co-sign or check the frozen-root certificate";

function argsOf(argv: string[]): { dir: string; signer: string; key: string } {
  const out = { dir: "", signer: "", key: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") out.dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") out.signer = argv[++i] ?? "";
    else if (argv[i] === "--key") out.key = argv[++i] ?? "";
    else throw new Error("usage");
  }
  return out;
}

export async function run(argv: string[]): Promise<number> {
  const mode = argv[0];
  if (argv.includes("--help") || !["sign", "verify"].includes(mode)) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  try {
    const o = argsOf(argv.slice(1));
    requireThat(o.dir && /^[0-9a-f]{88}$/.test(o.signer) && (mode !== "sign" || o.key), "usage");
    const pub = loadPublicAuction(o.dir, { signer: o.signer });
    requireThat(pub.frozen, "missing frozen");
    requireThat(pub.witnessSet, "missing witness set");
    const spec = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, o.signer), pub.manifest.auction_id);
    const statement = freezeStatement(pub.manifest, pub.frozen!);
    if (mode === "sign") {
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
      const state = path.resolve(root, process.env.BNZ_STATE_DIR || ".benzo");
      const resolved = path.resolve(o.key);
      requireThat(existsSync(resolved) && resolved.startsWith(state + path.sep), "witness key must live under BNZ_STATE_DIR");
      const cert: WitnessCert = { statement, signatures: [signStatement(statement, readFileSync(resolved, "utf8").trim())] };
      process.stdout.write(JSON.stringify(cert) + "\n");
      return 0;
    }
    checkCertificates(pub.witnessCerts, spec, statement);
    process.stdout.write("OK witness\n");
    return 0;
  } catch (e) {
    if (/usage$/.test((e as Error).message)) {
      process.stderr.write(`ERROR witness usage: ${help}\n`);
      return 2;
    }
    process.stderr.write(`ERROR witness ${(e as Error).message}\n`);
    return 1;
  }
}
