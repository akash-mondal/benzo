// benzo witness sign|verify — witness certificates: a witness key co-signs the frozen statement, and the
// public dir's certificates are checked q_w-of-n_w against the signed manifest's witness set.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { hash, requireThat, verifyRecord } from "../../manifest/schema";
import { loadPublicAuction } from "../../api/public-auction";
import { checkCertificates, freezeStatement, generateWitnessKey, signStatement, validateWitnessSet, witnessSetHash, type WitnessCert, type WitnessSet } from "../../witness";
import { repoRoot } from "../../manifest/root";
import { recomputeFrozen } from "../../witness/recompute";
import { custodyBinding, ownScan } from "../host-derive";
import { chainTip } from "../host-chain";

export const noun = "witness";
export const verb = "";
// The `witness strays` mode and its set-equality are deleted with the closed strays
// statement — the witness set certifies the frozen root only, and strays are attested per row at payment
// (the approval maps of the batch that pays them).
export const help = "benzo witness set --id AUCTION_ID --q N --keys HEX,HEX,HEX [--key private.pem] (operator: the signed witness-set record the manifest pins) | benzo witness keygen --name SIGNER [--show] (a signer host generates its own witness key; prints its public_hex; --show prints the EXISTING public half and refuses when there is none — a key is per signer and is never replaced) | benzo witness sign --dir <public-auction-dir> --signer <ed25519-spki-der-hex> --key <file under BNZ_STATE_DIR> | benzo witness verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> — co-sign the frozen-root certificate after recomputing the root from this witness's own vault scan, or check the certificates";

function argsOf(argv: string[]): { dir: string; signer: string; key: string; notes: string; name: string } {
  const out = { dir: "", signer: "", key: "", notes: "", name: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") out.dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") out.signer = argv[++i] ?? "";
    else if (argv[i] === "--key") out.key = argv[++i] ?? "";
    else if (argv[i] === "--name") out.name = argv[++i] ?? "";
    else throw new Error("usage");
  }
  return out;
}

const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);

export async function run(argv: string[]): Promise<number> {
  const mode = argv[0];
  if (mode === "keygen") {
    // A signer host generates its own witness key here; only the public half is printed (it goes into the
    // signed witness set). The private half never leaves this machine's state dir.
    try {
      const show = argv.slice(1).includes("--show");
      const o = argsOf(argv.slice(1).filter(a => a !== "--show"));
      requireThat(/^[a-z]{1,16}$/.test(o.name ?? ""), "--name");
      const st = path.resolve(repoRoot(), process.env.BNZ_STATE_DIR ?? ".benzo"), f = path.join(st, "witness", `${o.name}.key`);
      if (show) {
        // (G1): print the existing key's public half again; never generate or replace one.
        requireThat(existsSync(f), "witness key missing (generate it once with witness keygen)");
        const privateHex = readFileSync(f, "utf8").trim();
        requireThat(/^[0-9a-f]{64}$/.test(privateHex), "stored witness key");
        const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(privateHex, "hex")]), type: "pkcs8", format: "der" });
        const public_hex = createPublicKey(key).export({ type: "spki", format: "der" }).subarray(12).toString("hex");
        process.stdout.write(JSON.stringify({ name: o.name, public_hex, key_file: f }) + "\n");
        return 0;
      }
      requireThat(!existsSync(f), "witness key already exists; refusing to replace it");
      mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      const k = generateWitnessKey();
      writeFileSync(f, k.private_hex, { mode: 0o600, flag: "wx" });
      process.stdout.write(JSON.stringify({ name: o.name, public_hex: k.public_hex, key_file: f }) + "\n");
      return 0;
    } catch (e) { process.stderr.write(`ERROR witness keygen ${(e as Error).message}\n`); return 1; }
  }
  if (argv.includes("--help") || !["sign", "verify"].includes(mode)) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  try {
    const o = argsOf(argv.slice(1));
    requireThat(o.dir && /^[0-9a-f]{88}$/.test(o.signer) && (mode === "verify" || o.key), "usage");
    const pub = loadPublicAuction(o.dir, { signer: o.signer });
    requireThat(pub.witnessSet, "missing witness set");
    // A manifest that carries witness_set_hash binds this side-packet; refuse a mismatched one.
    if (pub.manifest.witness_set_hash) requireThat(witnessSetHash(pub.witnessSet!) === pub.manifest.witness_set_hash, "witness set hash mismatch");
    else process.stderr.write("WARN no witness set (pre-Phase-5 manifest)\n");
    const spec = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, o.signer), pub.manifest.auction_id);
    const root = repoRoot();
    const state = path.resolve(root, process.env.BNZ_STATE_DIR || ".benzo");
    const witnessKey = (file: string): string => {
      const resolved = path.resolve(file);
      requireThat(existsSync(resolved) && resolved.startsWith(state + path.sep), "witness key must live under BNZ_STATE_DIR");
      return resolved;
    };
    // R8 G10: on a canonical product dir the certificate is also recorded in the public
    // document, where the signer path and the rebuilt publishes expect it.
    const docFile = path.join(o.dir, "auction.json");
    const record = (field: string, cert: unknown): void => {
      if (!existsSync(docFile)) return;
      const doc = JSON.parse(readFileSync(docFile, "utf8"));
      doc[field] = [...(doc[field] ?? []).filter((c: any) => JSON.stringify(c) !== JSON.stringify(cert)), cert];
      writeFileSync(docFile, canonical(doc) + "\n");
    };
    requireThat(pub.frozen, "missing frozen");
    const statement = freezeStatement(pub.manifest, pub.frozen!);
    if (mode === "sign") {
      const resolved = witnessKey(o.key);
      // (judge finding): a FIRST certificate is refused once round R is out, by this witness's own clock. After R
      // anyone can read the prices, so an operator that froze late could pick which bids count; an honest witness
      // will not certify that. Re-signing the root this witness already pinned (an idempotent re-run) stays allowed.
      // An auction left uncertified at R is cancelled and refunds every deposit in full (settle/plan.ts).
      const pinFile = path.join(state, "auctions", pub.manifest.auction_id, "frozen-root.txt");
      const already = existsSync(pinFile) && readFileSync(pinFile, "utf8").trim() === pub.frozen!.root;
      const release = pub.manifest.drand.genesis + (pub.manifest.drand.R - 1) * pub.manifest.drand.period;
      requireThat(already || Date.now() / 1000 < release, `witness signing closed: round ${pub.manifest.drand.R} was released at ${new Date(release * 1000).toISOString()}; a first certificate after the release could follow the prices`);
      // On a signer host (it holds this auction's DKG share) certifying also pins the manifest — the
      // signer key, group key and vault addresses are checked and its hash recorded before any later approval.
      if (existsSync(path.join(state, "auctions", pub.manifest.auction_id, "group-key.txt"))) custodyBinding(pub.manifest.auction_id, state, root, pub, o.signer);
      // Design §5: the root is recomputed from THIS witness's own scan of the auction vault before anything is
      // signed; a leaf it cannot see, or a different root, is refused and never certified.
      const own = recomputeFrozen(pub.manifest as any, pub.manifest_hash, pub.frozen!, await ownScan(state, root, pub.manifest.auction_id, (pub.manifest as any).network), { confirmedAt: chainTip(state) });
      requireThat(own.root === pub.frozen!.root && own.leaf_count === pub.frozen!.leaf_count, `root mismatch: own scan ${own.root} (${own.leaf_count} leaves) vs frozen ${pub.frozen!.root} (${pub.frozen!.leaf_count})`);
      const cert: WitnessCert = { statement, signatures: [signStatement(statement, readFileSync(resolved, "utf8").trim())] };
      // The root this witness certified is pinned for its own later settlement approvals.
      const pinDir = path.join(state, "auctions", pub.manifest.auction_id);
      if (existsSync(pinDir)) { const f = path.join(pinDir, "frozen-root.txt"); if (!existsSync(f)) writeFileSync(f, pub.frozen!.root + "\n", { mode: 0o600 }); else requireThat(readFileSync(f, "utf8").trim() === pub.frozen!.root, "this witness already pinned a different root for the auction"); }
      record("witness_cert", cert);
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
