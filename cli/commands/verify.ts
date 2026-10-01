// benzo verify — independent gate R: public inputs only, cold copy, ERROR lines on corruption.
// By default re-derives every opening from its ciphertext with pinned tle + the published beacon (R16),
// then reproduces clear/. --offline trusts the published openings and prints WARN openings not re-derived.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { checkPublicAuction, loadPublicAuction, type PublicAuction } from "../../api/public-auction";
import type { Opened } from "../../clear/core";

export const noun = "verify";
export const verb = "";
export const help = "benzo verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> [--offline] — reproduce clear + settlement accounting from public inputs (default re-derives openings with tle; --offline trusts published openings)";

function tleBin(): string {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const stateDir = path.resolve(root, process.env.BNZ_STATE_DIR || ".benzo");
  const p = path.join(stateDir, "bin", "tle");
  if (!existsSync(p)) throw new Error(`tle not found at ${p}`);
  return p;
}

// Re-derive every opening with the pinned Go tle against drand quicknet (the published beacon binds the chain).
function deriveOpenings(pub: PublicAuction): Opened[] {
  const tle = tleBin();
  const chain = pub.beacon ? pub.beacon.chain_hash : pub.manifest.drand.chain_hash;
  return pub.frozen.leaves.map(leaf => {
    const r = spawnSync(tle, ["-d", "-c", chain], {
      input: Buffer.from(leaf.ciphertext_hex, "hex"),
      maxBuffer: 1 << 20,
    });
    const err = () => ((r.stderr ?? Buffer.alloc(0)).toString().trim() || `exit ${r.status}`);
    if (r.error) return { leaf_index: leaf.leaf_index, plaintext_hex: null, error: `tle: ${r.error.message}` };
    if (r.status !== 0) {
      // Only authenticated ciphertext failures are bad bids, matching the operator open path (clear/auction-cli.ts).
      if (/bad header MAC|failed to decrypt and authenticate payload chunk/.test(err()))
        return { leaf_index: leaf.leaf_index, plaintext_hex: null, error: "undecryptable" };
      return { leaf_index: leaf.leaf_index, plaintext_hex: null, error: `tle: ${err()}` };
    }
    return { leaf_index: leaf.leaf_index, plaintext_hex: r.stdout.toString("hex") };
  });
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", signerHex = "", offline = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") signerHex = argv[++i] ?? "";
    else if (argv[i] === "--offline") offline = true;
    else {
      process.stderr.write(`ERROR verify usage: ${help}\n`);
      return 2;
    }
  }
  if (!dir || !/^[0-9a-f]{88}$/.test(signerHex)) {
    process.stderr.write(`ERROR verify usage: ${help}\n`);
    return 2;
  }
  try {
    const pub = loadPublicAuction(dir, { signer: signerHex });
    if (pub.legacy) process.stderr.write("WARN legacy projections (no auction.json); fallback for Phase 2/3 evidence dirs\n");
    if (offline) {
      requireThat(pub.opened.length === pub.frozen.leaf_count, "--offline needs one published opening per leaf");
      process.stderr.write("WARN openings not re-derived\n");
    } else {
      const derived = deriveOpenings(pub);
      let deriveFailed = false;
      for (const d of derived) {
        if (d.error && d.error !== "undecryptable") {
          process.stderr.write(`ERROR derive ${d.leaf_index} ${d.error}\n`);
          deriveFailed = true;
        }
      }
      if (deriveFailed) return 1;
      if (pub.opened.length) {
        requireThat(pub.opened.length === derived.length, "published opening count");
        for (const d of derived) {
          const p = pub.opened.find(o => o.leaf_index === d.leaf_index);
          requireThat(p, `opening ${d.leaf_index} missing from published set`);
          requireThat(
            p!.plaintext_hex === d.plaintext_hex && (p!.error ?? null) === (d.error ?? null),
            `opening ${d.leaf_index} published differs from re-derived`,
          );
        }
      }
      pub.opened = derived;
    }
    const checks = checkPublicAuction(pub);
    let failed = false;
    for (const c of checks) {
      if (c.error) {
        failed = true;
        process.stderr.write(`ERROR ${c.id} ${c.error}\n`);
      } else {
        process.stdout.write(`OK ${c.id}\n`);
      }
    }
    return failed ? 1 : 0;
  } catch (e) {
    process.stderr.write(`ERROR verify ${(e as Error).message}\n`);
    return 1;
  }
}
