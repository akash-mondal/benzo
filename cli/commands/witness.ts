// benzo witness sign|verify — gate X witness certificates: a witness key co-signs the frozen statement, and the
// public dir's certificates are checked q_w-of-n_w against the signed manifest's witness set.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hash, requireThat, verifyRecord } from "../../manifest/schema";
import { loadPublicAuction } from "../../api/public-auction";
import { depositParty, strayNotes } from "../../settle/deposits";
import { checkCertificates, freezeStatement, generateWitnessKey, signStatement, signStrays, straysStatementBytes, validateWitnessSet, witnessSetHash, type StraysEntry, type WitnessCert, type WitnessSet } from "../../witness";
import { repoRoot } from "../../manifest/root";
import { recomputeFrozen } from "../../witness/recompute";
import { custodyBinding, ownScan } from "../host-derive";
import { chainTip } from "../host-chain";

export const noun = "witness";
export const verb = "";
export const help = "benzo witness sign --dir <public-auction-dir> --signer <ed25519-spki-der-hex> --key <file under BNZ_STATE_DIR> | benzo witness strays --dir <public-auction-dir> --signer <ed25519-spki-der-hex> --key <file under BNZ_STATE_DIR> --notes <scanner-output.jsonl> | benzo witness verify --dir <public-auction-dir> --signer <ed25519-spki-der-hex> — co-sign the frozen-root certificate after recomputing the root from this witness's own vault scan, sign the strays statement from this witness's own scan, or check the certificates";

function argsOf(argv: string[]): { dir: string; signer: string; key: string; notes: string; name: string } {
  const out = { dir: "", signer: "", key: "", notes: "", name: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") out.dir = argv[++i] ?? "";
    else if (argv[i] === "--signer") out.signer = argv[++i] ?? "";
    else if (argv[i] === "--key") out.key = argv[++i] ?? "";
    else if (argv[i] === "--notes") out.notes = argv[++i] ?? "";
    else if (argv[i] === "--name") out.name = argv[++i] ?? "";
    else throw new Error("usage");
  }
  return out;
}

const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);

export async function run(argv: string[]): Promise<number> {
  const mode = argv[0];
  if (mode === "keygen") {
    // §11 H5: a signer host generates its own witness key here; only the public half is printed (it goes into the
    // signed witness set). The private half never leaves this machine's state dir.
    try {
      const o = argsOf(argv.slice(1));
      requireThat(/^[a-z]{1,16}$/.test(o.name ?? ""), "--name");
      const st = path.resolve(repoRoot(), process.env.BNZ_STATE_DIR ?? ".benzo"), f = path.join(st, "witness", `${o.name}.key`);
      requireThat(!existsSync(f), "witness key already exists; refusing to replace it");
      mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      const k = generateWitnessKey();
      writeFileSync(f, k.private_hex, { mode: 0o600, flag: "wx" });
      process.stdout.write(JSON.stringify({ name: o.name, public_hex: k.public_hex, key_file: f }) + "\n");
      return 0;
    } catch (e) { process.stderr.write(`ERROR witness keygen ${(e as Error).message}\n`); return 1; }
  }
  if (argv.includes("--help") || !["sign", "strays", "verify"].includes(mode)) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  try {
    const o = argsOf(argv.slice(1));
    requireThat(o.dir && /^[0-9a-f]{88}$/.test(o.signer) && (mode === "verify" || o.key) && (mode !== "strays" || o.notes), "usage");
    const pub = loadPublicAuction(o.dir, { signer: o.signer });
    requireThat(pub.witnessSet, "missing witness set");
    // R4 item 2: a manifest that carries witness_set_hash binds this side-packet; refuse a mismatched one.
    if (pub.manifest.witness_set_hash) requireThat(witnessSetHash(pub.witnessSet!) === pub.manifest.witness_set_hash, "witness set hash mismatch");
    else { requireThat(mode !== "strays", "strays certification requires a pinned witness set"); process.stderr.write("WARN no witness set (pre-Phase-5 manifest)\n"); }
    const spec = validateWitnessSet(verifyRecord<WitnessSet>(pub.witnessSet!, o.signer), pub.manifest.auction_id);
    const root = repoRoot();
    const state = path.resolve(root, process.env.BNZ_STATE_DIR || ".benzo");
    const witnessKey = (file: string): string => {
      const resolved = path.resolve(file);
      requireThat(existsSync(resolved) && resolved.startsWith(state + path.sep), "witness key must live under BNZ_STATE_DIR");
      return resolved;
    };
    // R8 G10 (design §5): on a canonical product dir the certificate is also recorded in the public
    // document, where the signer path and the rebuilt publishes expect it.
    const docFile = path.join(o.dir, "auction.json");
    const record = (field: string, cert: unknown): void => {
      if (!existsSync(docFile)) return;
      const doc = JSON.parse(readFileSync(docFile, "utf8"));
      doc[field] = [...(doc[field] ?? []).filter((c: any) => JSON.stringify(c) !== JSON.stringify(cert)), cert];
      writeFileSync(docFile, canonical(doc) + "\n");
    };
    if (mode === "strays") {
      // R23 item 1 (Reviewer G G1): the strays statement is built from THIS witness's own scan (its
      // benzo-scan output), never from operator input — every deposit-address note outside the frozen
      // set, by output position, with its memo hash and received value. Scans that disagree refuse
      // loudly (one strays statement per auction).
      const resolved = witnessKey(o.key);
      const notes = readFileSync(o.notes, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
      const strays: StraysEntry[] = strayNotes(notes, pub.manifest.deposit_addresses, pub.frozen)
        .map(n => { requireThat(typeof n.memo_hex === "string" && /^[0-9a-f]{1024}$/.test(n.memo_hex), "witness scan memo"); return { party: depositParty(n), memo_sha256: hash(Buffer.from(n.memo_hex, "hex")), value_zats: String(n.value_zats) }; })
        .sort((a, b) => a.party.localeCompare(b.party));
      const statement = { version: 1 as const, auction_id: pub.manifest.auction_id, strays };
      const cert = { statement, signatures: [signStrays(statement, readFileSync(resolved, "utf8").trim())] };
      if (existsSync(docFile)) for (const c of (JSON.parse(readFileSync(docFile, "utf8")).strays_cert ?? []))
        requireThat(straysStatementBytes(c.statement).equals(straysStatementBytes(statement)), "two strays statements for one auction");
      record("strays_cert", cert);
      process.stdout.write(JSON.stringify(cert) + "\n");
      return 0;
    }
    requireThat(pub.frozen, "missing frozen");
    const statement = freezeStatement(pub.manifest, pub.frozen!);
    if (mode === "sign") {
      const resolved = witnessKey(o.key);
      // Ruling R28 item 1: on a signer host (it holds this auction's DKG share) certifying also pins the manifest — the
      // signer key, group key and vault addresses are checked and its hash recorded before any later approval.
      if (existsSync(path.join(state, "auctions", pub.manifest.auction_id, "group-key.txt"))) custodyBinding(pub.manifest.auction_id, state, root, pub, o.signer);
      // Design §5: the root is recomputed from THIS witness's own scan of the auction vault before anything is
      // signed; a leaf it cannot see, or a different root, is refused and never certified.
      const own = recomputeFrozen(pub.manifest as any, pub.manifest_hash, pub.frozen!, await ownScan(state, root, pub.manifest.auction_id, (pub.manifest as any).network), { confirmedAt: chainTip(state) });
      requireThat(own.root === pub.frozen!.root && own.leaf_count === pub.frozen!.leaf_count, `root mismatch: own scan ${own.root} (${own.leaf_count} leaves) vs frozen ${pub.frozen!.root} (${pub.frozen!.leaf_count})`);
      const cert: WitnessCert = { statement, signatures: [signStatement(statement, readFileSync(resolved, "utf8").trim())] };
      // Ruling R28 item 2: the root this witness certified is pinned for its own later settlement approvals.
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
