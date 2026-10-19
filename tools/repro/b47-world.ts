// B47's offline stub harness (tools/repro/b47-settle-e2e.ts), kept as a shared COPY so the B50 worker cases
// drive the real `bin/benzo settle` exactly as b47 does without touching the b47 fold. Same test-only seams
// as b47's header documents: BNZ_TEST_CHAIN (the shared fake chain-state file) and BNZ_TEST_STUBS (the orb
// stub's config) are read only by these stubs, refused when BNZ_NETWORK=main, and never read by shipped code.
// H3 (B50) knob: fixture.json may carry `pool_by_amount` (amount -> pool name), so a repro can build a
// candidate whose payments span two pools (the stub `benzo-pczt inspect` reports those amounts in that pool).
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type StubKnobs = {
  realPczt: string;
  confirmations: number;
  changeAddr: string;
  uaOrchard: string;
};

export function makeStubs(k: StubKnobs) {
  const REAL_PCZT = k.realPczt, CONFIRMATIONS = k.confirmations, CHANGE_ADDR = k.changeAddr, UA_ORCHARD = k.uaOrchard;
const CHAIN_GUARD = `if (process.env.BNZ_NETWORK === "main") { process.stderr.write("test stubs refuse BNZ_NETWORK=main\\n"); process.exit(1); }
if (!process.env.BNZ_TEST_CHAIN) { process.stderr.write("test stubs need BNZ_TEST_CHAIN\\n"); process.exit(1); }
`;
const STUB_SCAN = `${CHAIN_GUARD}const fs = require("fs");
const chain = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
for (const n of chain.notes) console.log(JSON.stringify(n));
`;
const STUB_DEVTOOL = `${CHAIN_GUARD}const fs = require("fs"), crypto = require("crypto");
const chainFile = process.env.BNZ_TEST_CHAIN, a = process.argv.slice(2);
const txidOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
function mine(c, txid) {
  const p = c.pending.find(x => x.txid === txid);
  if (!p) return;
  c.pending = c.pending.filter(x => x.txid !== txid);
  c.tip += 1;
  for (const s of p.spends) { const n = c.notes.find(n => n.txid + ":" + n.pool + ":" + n.action_index === s); if (n) n.spent_in_txid = txid; }
  // B49: the change note's txid IS the transaction's txid (as on a real chain) — it is the scan's own
  // evidence that the txid mined at this height, which the reserve gate's "paid" rule reads.
  if (p.change_zats > 0) c.notes.push({ txid, height: c.tip, pool: "ironwood",
    address: p.change_address, diversifier_index: "99", action_index: 0, value_zats: p.change_zats, memo_hex: null, spent_in_txid: null });
  c.mined[txid] = { height: c.tip, rows: p.rows };
}
if (a[0] === "wallet") {
  const verb = a[3];
  if (verb === "sync" || verb === "enhance") process.exit(0);
  const c = JSON.parse(fs.readFileSync(chainFile, "utf8"));
  if (verb === "balance") { console.log(JSON.stringify({ chain_tip_height: c.tip })); process.exit(0); }
  if (verb === "list-tx") {
    for (const t of [...c.pending]) mine(c, t.txid);
    fs.writeFileSync(chainFile, JSON.stringify(c));
    console.log(JSON.stringify(Object.entries(c.mined).map(([txid, m]) => ({ txid, mined_height: m.height }))));
    process.exit(0);
  }
  process.stderr.write("zcash-devtool stub: unknown wallet verb " + verb + "\\n"); process.exit(1);
}
if (a[0] === "pczt") {
  const verb = ["extract", "prove", "redact", "send-without-storing", "send"].find(v => a.includes(v));
  if (verb === "extract") { process.stdout.write(txidOf(fs.readFileSync(0)) + "\\n"); process.exit(0); }
  if (verb === "prove") { fs.copyFileSync(a[a.indexOf("prove") + 1], a[a.indexOf("--output") + 1]); process.exit(0); }
  if (verb === "redact") { fs.copyFileSync(a[a.indexOf("--output") - 1], a[a.indexOf("--output") + 1]); process.exit(0); }
  if (verb === "send" || verb === "send-without-storing") {
    const file = a[a.length - 1], buf = fs.readFileSync(file), txid = txidOf(buf), body = JSON.parse(buf.toString("utf8"));
    const c = JSON.parse(fs.readFileSync(chainFile, "utf8"));
    const record = { txid, spends: body.spends, change_zats: body.change_zats, change_address: ${JSON.stringify(CHANGE_ADDR)}, rows: body.rows };
    if (c.send_mode === "mempool") {
      c.send_mode = "ok";
      c.pending.push(record);
      fs.writeFileSync(chainFile, JSON.stringify(c));
      process.stderr.write("Error: Send failed: (-1) transaction already exists in mempool\\n");
      process.exit(1);
    }
    if (c.send_mode === "fail") { process.stderr.write("Error: Send failed: (-1) mock node rejection\\n"); process.exit(1); }
    c.broadcasts.push(txid);
    c.pending.push(record);
    mine(c, txid);
    fs.writeFileSync(chainFile, JSON.stringify(c));
    process.stdout.write(txid + "\\n");
    process.exit(0);
  }
  process.stderr.write("zcash-devtool stub: unknown pczt verb " + verb + "\\n"); process.exit(1);
}
process.stderr.write("zcash-devtool stub: unknown " + a.join(" ") + "\\n"); process.exit(1);
`;
const STUB_GRPCURL = `${CHAIN_GUARD}const fs = require("fs");
const a = process.argv.slice(2), method = a[a.length - 1].split("/").pop();
const c = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
const body = a.includes("-d") ? JSON.parse(a[a.indexOf("-d") + 1]) : {};
if (method === "GetLatestBlock") { console.log(JSON.stringify({ height: c.tip })); process.exit(0); }
if (method === "GetTransaction") {
  const txid = Buffer.from(body.hash, "base64").reverse().toString("hex");
  const m = c.mined[txid];
  if (!m) { process.stderr.write("NotFound\\n"); process.exit(1); }
  console.log(JSON.stringify({ height: m.height })); process.exit(0);
}
if (method === "GetBlock") { console.log(JSON.stringify({ height: body.height, hash: Buffer.alloc(32, 17).toString("base64"), time: 1793600000 })); process.exit(0); }
if (method === "GetBlockRange") {
  for (let h = body.start.height; h <= body.end.height; h++) {
    const vtx = Object.entries(c.mined).filter(([, m]) => m.height === h).map(([txid]) => ({ txid: Buffer.from(txid, "hex").reverse().toString("base64") }));
    console.log(JSON.stringify({ height: h, vtx }));
  }
  process.exit(0);
}
process.stderr.write("NotFound\\n"); process.exit(1);
`;
const STUB_PCZT = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const state = path.dirname(path.dirname(process.argv[1]));
const fix = JSON.parse(fs.readFileSync(path.join(state, "fixture.json"), "utf8"));
const a = process.argv.slice(2), cmd = a[0];
const chain = () => JSON.parse(fs.readFileSync(process.env.BNZ_TEST_CHAIN, "utf8"));
const txidOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
if (cmd === "classify-address") {
  if (a.includes("--stdin")) {
    const r = cp.spawnSync(${JSON.stringify(REAL_PCZT)}, ["classify-address", "--stdin"], { input: fs.readFileSync(0), maxBuffer: 1 << 28 });
    process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? ""); process.exit(r.status ?? 1);
  }
  process.stdout.write(cp.execFileSync(${JSON.stringify(REAL_PCZT)}, ["classify-address", a[1]])); process.exit(0);
}
if (cmd === "ufvk-ak") { console.log(fix.groupKey); process.exit(0); }
if (cmd === "owns") { console.log((fix.internal_addresses ?? []).includes(a[2]) ? "internal" : "external"); process.exit(0); }
if (cmd === "address") { console.log(${JSON.stringify(UA_ORCHARD)}); process.exit(0); }
if (cmd === "create") {
  const rows = JSON.parse(fs.readFileSync(0, "utf8")), c = chain();
  const confirmed = (n) => n.height && c.tip - n.height + 1 >= ${CONFIRMATIONS};
  const spendable = c.notes.filter(n => (n.spent_in_txid ?? null) === null && Number(n.value_zats) > 0 && confirmed(n));
  const available = spendable.reduce((s, n) => s + Number(n.value_zats), 0);
  const fee = 5000 * Math.max(2, spendable.length);
  const required = rows.reduce((s, r) => s + Number(r.amount_zats), 0) + fee;
  if (required > available) {
    process.stderr.write("Error: proposal: InsufficientFunds { available: Zatoshis(" + available + "), required: Zatoshis(" + required + ") }\\n");
    process.exit(1);
  }
  fs.writeFileSync(a[2], JSON.stringify({ rows, input_zats: available, fee_zats: fee, change_zats: available - required,
    spends: spendable.map(n => n.txid + ":" + n.pool + ":" + n.action_index).sort(), expiry_height: c.tip + 364 }));
  process.exit(0);
}
if (cmd === "inspect") {
  const buf = fs.readFileSync(a[1]), body = JSON.parse(buf.toString("utf8"));
  const outputs = body.rows.map((r, i) => ({ index: i, pool: (fix.pool_by_amount || {})[String(r.amount_zats)] || "ironwood", is_change: false, recipient: r.recipient, amount_zats: String(r.amount_zats) }));
  const output = body.rows.reduce((s, r) => s + Number(r.amount_zats), 0);
  const input = Number(body.input_zats ?? output);
  console.log(JSON.stringify({ outputs, input_zats: input, output_zats: output, fee_zats: input - output,
    expiry_height: Number(body.expiry_height ?? chain().tip + 364), txid: txidOf(buf),
    shielded_sighash: txidOf(buf),
    randomizers: [{ pool: "ironwood", index: 0, alpha: crypto.createHash("sha256").update(Buffer.concat([buf, Buffer.from("alpha")])).digest("hex") }] }));
  process.exit(0);
}
process.stderr.write("benzo-pczt stub: unknown command " + cmd + "\\n"); process.exit(1);
`;
const STUB_SIGN = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), crypto = require("crypto");
const a = process.argv.slice(2);
const input = a[a.indexOf("-i") + 1], output = a[a.indexOf("-o") + 1];
const buf = fs.readFileSync(input);
const sighash = crypto.createHash("sha256").update(buf).digest("hex");
const alpha = crypto.createHash("sha256").update(Buffer.concat([buf, Buffer.from("alpha")])).digest("hex");
const shared = path.dirname(process.env.BNZ_TEST_CHAIN);
fs.writeFileSync(path.join(shared, "current-sign.json"), JSON.stringify({ sighash }));
console.log("SIGHASH: " + sighash);
console.log("Randomizer #0 (ironwood): " + alpha);
let acc = "";
process.stdin.on("data", (d) => {
  acc += d;
  if (/^[0-9a-f]{128}$/m.test(acc)) { fs.writeFileSync(output, buf); process.exit(0); }
});
`;
// The FROST layer is stubbed at the frost-client boundary (the h-fixtures stub class): the coordinator prints
// the session's signature once both participants joined, the participant prints the approved sighash on the
// prompts the real `benzo sign join` answers. The real join code (approval check included) runs.
const STUB_FROST = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), crypto = require("crypto");
const a = process.argv.slice(2), cmd = a[0];
const shared = path.dirname(process.env.BNZ_TEST_CHAIN);
if (cmd === "sessions") {
  if (a.includes("--close-all")) { console.log("closed"); process.exit(0); }
  process.stderr.write("Session with ID 00000000-0000-4000-8000-000000000001\\n");
  process.exit(0);
}
if (cmd === "coordinator") {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d));
  process.stdin.on("end", () => {
    process.stdout.write("Waiting for participants to send their commitments\\n");
    const joins = path.join(shared, "joins.log");
    fs.writeFileSync(joins, "");
    const deadline = Date.now() + 120000;
    const poll = setInterval(() => {
      let n = 0;
      try { n = fs.readFileSync(joins, "utf8").split("\\n").filter(Boolean).length; } catch {}
      if (n >= 2 || Date.now() > deadline) {
        clearInterval(poll);
        const body = Buffer.concat(chunks);
        process.stdout.write(crypto.createHash("sha256").update(body).digest("hex") + crypto.createHash("sha256").update("b47-signature").digest("hex") + "\\n");
        process.exit(0);
      }
    }, 50);
  });
  process.stdin.resume();
} else if (cmd === "participant") {
  const sign = JSON.parse(fs.readFileSync(path.join(shared, "current-sign.json"), "utf8"));
  process.stdout.write("Joining signing session...\\n");
  process.stdout.write("Message to be signed (hex-encoded):\\n" + sign.sighash + "\\n");
  process.stdout.write("Do you want to sign it? (y/n)\\n");
  fs.appendFileSync(path.join(shared, "joins.log"), (process.env.BNZ_TEST_HOST ?? "host") + "\\n");
  process.stdin.on("data", () => process.exit(0));
  setTimeout(() => process.exit(0), 60000);
} else { process.stderr.write("frost-client stub: unknown " + cmd + "\\n"); process.exit(1); }
`;
// The orb/orbctl PATH stub: it records nothing exotic — it maps /home/benzo/<x> onto the host's own world
// directory and runs the REAL `benzo sign …` commands (and the frost stub) against that host's state dir.
const STUB_ORB = `${CHAIN_GUARD}const fs = require("fs"), path = require("path"), cp = require("child_process");
const cmd = path.basename(process.argv[1]).replace(/\\.cjs$/, "");
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(process.env.BNZ_TEST_STUBS, "utf8"));
const hostOf = (m) => m.replace(/^benzo-/, "");
const mapPath = (host, p) => p.startsWith("/home/benzo/") ? path.join(cfg.shared, "hosts", host, p.slice("/home/benzo/".length)) : p;
if (cmd === "orbctl") {
  const at = args.indexOf("-m") + 1, host = hostOf(args[at]);
  if (args[0] === "push") {
    const dst = mapPath(host, "/home/benzo/" + args[at + 2]);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(args[at + 1], dst, { recursive: true });
    process.exit(0);
  }
  if (args[0] === "pull") {
    fs.copyFileSync(mapPath(host, "/home/benzo/" + args[at + 1]), args[at + 2]);
    process.exit(0);
  }
  process.stderr.write("orbctl stub: unknown " + args.join(" ") + "\\n"); process.exit(1);
}
if (args[0] !== "run") { process.stderr.write("orb stub: unknown " + args.join(" ") + "\\n"); process.exit(1); }
const at = args.indexOf("-m") + 1, host = hostOf(args[at]);
let rest = args.slice(args.indexOf("-u") + 2);
if (rest[0] === "env") {
  rest = rest.slice(1);
  while (rest.length && rest[0].includes("=") && !rest[0].startsWith("/")) rest = rest.slice(1);
}
const env = { ...process.env, BNZ_STATE_DIR: cfg.hosts[host], BNZ_TEST_HOST: host,
  BNZ_PCZT_BIN: path.join(cfg.hosts[host], "bin", "benzo-pczt"), BNZ_SCAN_BIN: path.join(cfg.hosts[host], "bin", "benzo-scan") };
const verb = rest[0].split("/").pop();
if (verb === "rm" || verb === "chown") process.exit(0);
if (verb === "cat") {
  const name = path.basename(rest[rest.length - 1]).replace(/\\.pubkey$/, "");
  console.log(require("crypto").createHash("sha256").update("b47-contact-" + name).digest("hex"));
  process.exit(0);
}
if (verb === "frost-client") {
  const argv = rest.slice(1);
  if (argv[0] === "sessions" && argv.includes("--close-all")) { console.log("closed"); process.exit(0); }
  const r = cp.spawnSync(path.join(cfg.hosts[host], "bin", "frost-client"), argv, { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}
if (verb === "benzo") {
  const argv = rest.slice(1).map(x => mapPath(host, x));
  const r = cp.spawnSync(process.execPath, [cfg.benzo, ...argv], { encoding: "utf8", maxBuffer: 64 << 20, env });
  process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");
  process.exit(r.status ?? 1);
}
process.stderr.write("orb stub: unknown remote command " + rest.join(" ") + "\\n"); process.exit(1);
`;

  const stub = (bin: string, name: string, source: string) => {
    const impl = path.join(bin, name + ".cjs");
    writeFileSync(impl, source); chmodSync(impl, 0o755);
    writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`); chmodSync(path.join(bin, name), 0o755);
  };
  const writeStateBin = (bin: string) => {
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    stub(bin, "benzo-scan", STUB_SCAN);
    stub(bin, "zcash-devtool", STUB_DEVTOOL);
    stub(bin, "grpcurl", STUB_GRPCURL);
    stub(bin, "benzo-pczt", STUB_PCZT);
    stub(bin, "zcash-sign", STUB_SIGN);
    stub(bin, "frost-client", STUB_FROST);
  };
  return { CHAIN_GUARD, STUB_SCAN, STUB_DEVTOOL, STUB_GRPCURL, STUB_PCZT, STUB_SIGN, STUB_FROST, STUB_ORB, stub, writeStateBin };
}
