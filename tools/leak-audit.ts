// Public export/history audit. Sensitive values stay in memory and never enter findings.
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

type Sensitive = { label: string; value: string; release_time?: number | string };
type Finding = { rule: string; label: string; file: string; line?: number; commit?: string; sha256: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const findings: Finding[] = [];
const seen = new Set<string>();
function main() {
  const argv = process.argv.slice(2), paths: string[] = [];
  let sensitiveFile = "", git = false, allowlistFile = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sensitive") sensitiveFile = argv[++i] ?? "";
    else if (argv[i] === "--allowlist") allowlistFile = argv[++i] ?? "";
    else if (argv[i] === "--git") git = true;
    else if (argv[i] === "--paths") { while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) paths.push(argv[++i]); }
    else throw Error("usage: leak-audit --sensitive FILE --paths P1 P2 … [--git] [--allowlist FILE]");
  }
  if (!sensitiveFile || (!paths.length && !git)) throw Error("sensitive file and scan paths or --git required");
  const sensitive = JSON.parse(readFileSync(sensitiveFile, "utf8")) as Sensitive[];
  if (!Array.isArray(sensitive) || !sensitive.every(v => typeof v.label === "string" && v.label.length && typeof v.value === "string" && v.value.length)) throw Error("sensitive values must be a nonempty-value {label,value,release_time?} list");
  const release = (v: Sensitive): number | undefined => {
    if (v.release_time === undefined) return undefined;
    if (!/^[0-9a-f]{256}$/i.test(v.value)) throw Error("release_time needs a 128-byte plaintext hex value");
    const seconds = typeof v.release_time === "number" ? v.release_time : Date.parse(v.release_time) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) throw Error("invalid release_time");
    return seconds;
  };
  const entries = sensitive.map(v => ({ ...v, release: release(v), variants: [...new Set([
    v.value, Buffer.from(v.value).toString("hex"), Buffer.from(v.value).toString("base64"),
    ...(/^(?:[0-9a-f]{2})+$/i.test(v.value) ? [Buffer.from(v.value, "hex").toString("base64")] : []),
  ])] }));
  const allowlist: string[] = allowlistFile ? JSON.parse(readFileSync(allowlistFile, "utf8")) : [];
  if (!Array.isArray(allowlist) || !allowlist.every(p => typeof p === "string")) throw Error("allowlist must be an array of exact file paths");
  const allowed = new Set(allowlist.map(p => relative(process.cwd(), resolve(p))));
  const add = (rule: string, label: string, file: string, text: string, index: number, value: string, commit?: string) => {
    const row: Finding = { rule, label, file, ...(commit ? { commit } : { line: text.slice(0, index).split("\n").length }), sha256: digest(value) };
    const key = JSON.stringify(row); if (!seen.has(key)) { seen.add(key); findings.push(row); }
  };
  const scan = (file: string, bytes: Buffer, time: number, commit?: string) => {
    const text = bytes.toString("utf8");
    for (const entry of entries) {
      // Bid plaintext is intended public after release, unlike keys/destinations.
      if (entry.release !== undefined && time >= entry.release) continue;
      for (const variant of entry.variants) {
        let offset = 0, index: number;
        while ((index = text.indexOf(variant, offset)) !== -1) {
          add(entry.release === undefined ? "exact-value" : "bid-before-release", entry.label, file, text, index, entry.value, commit);
          offset = index + variant.length;
        }
      }
    }
    const patterns: [string, RegExp][] = [
      ["address", /\b(?:utest1|uregtest1|u1|ztestsapling1|zs1)[a-z0-9]{20,}\b|\b(?:t1|t3|tm|t2)[1-9A-HJ-NP-Za-km-z]{33}\b/g],
      ["viewing-key", /\b(?:uviewtest1|uview1|uview|zxviewtestsapling1|zxviews1|zxview)[a-zA-Z0-9]{20,}\b/g],
      ["mnemonic", /\b(?:[a-z]{3,12}[ \t\r\n]+){23}[a-z]{3,12}\b/g],
      ["pem-private-key", /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g],
      ["age-armor", /-----BEGIN AGE ENCRYPTED FILE-----[\s\S]*?-----END AGE ENCRYPTED FILE-----/g],
    ];
    for (const [rule, pattern] of patterns) {
      if (rule === "address" && allowed.has(file)) continue;
      for (const match of text.matchAll(pattern)) add(rule, rule, file, text, match.index!, match[0], commit);
    }
  };
  const command = (args: string[]) => execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024 });
  // For tracked working files use the last commit time, as specified; untracked files use mtime.
  const visit = (input: string) => {
    const stat = lstatSync(input);
    if (stat.isSymbolicLink()) throw Error("symlink scan path refused");
    if (stat.isDirectory()) { for (const name of readdirSync(input).sort()) visit(resolve(input, name)); return; }
    if (!stat.isFile()) return;
    const file = relative(process.cwd(), resolve(input));
    let time = stat.mtimeMs / 1000;
    const tracked = command(["ls-files", "--", file]).toString().trim();
    if (tracked) {
      const timestamp = command(["log", "-1", "--format=%ct", "--", file]).toString().trim();
      if (timestamp) time = Number(timestamp);
    }
    scan(file, readFileSync(input), time);
  };
  for (const p of paths) visit(p);
  if (git) {
    // Scan complete historical blobs rather than diff fragments (multiline secrets can span hunks).
    const blobs = new Map<string, { oid: string; file: string; time: number; commit: string }>();
    for (const row of command(["log", "--all", "--format=%H %ct"]).toString().trim().split("\n").reverse()) {
      if (!row) continue;
      const [commit, timestamp] = row.split(" ");
      for (const record of command(["ls-tree", "-rz", "--full-tree", commit]).toString().split("\0")) {
        if (!record) continue;
        const [meta, file] = record.split("\t"), [mode, kind, oid] = meta.split(" ");
        if (kind !== "blob" || mode === "120000") continue;
        const key = oid + " " + file, old = blobs.get(key), time = Number(timestamp);
        if (!old || time < old.time) blobs.set(key, { oid, file, time, commit });
      }
    }
    for (const b of blobs.values()) scan(b.file, command(["cat-file", "blob", b.oid]), b.time, b.commit);
  }
  process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
  process.exitCode = findings.length ? 1 : 0;
}
try { main(); } catch { process.stderr.write("ERROR leak-audit input or scan failed (values suppressed)\n"); process.exitCode = 2; }
