// Y2 (Phase 5 part 1 §2–§3 + §11, gate Y): one live product auction whose custody lives entirely on the three
// OrbStack signer hosts — fresh per-auction DKG on the hosts, per-host view-only vaults, host envelope + witness
// keys, witness certificates and envelope-opens reports produced ON the hosts, every batch approved by hosts from
// their own data and signed with host-held shares — plus the mid-batch kill drill (bob's host stopped after it
// joined the first signing session; the batch is re-planned and completed with alice + carol).
// Build+run: npx esbuild tools/repro/y2-host-custody.ts --bundle --packages=external --platform=node --format=esm --outfile=tmp/y2.mjs && node tmp/y2.mjs
import { randomBytes } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, STATE, env } from "../../e2e/lib/env";
import { signRecord } from "../../manifest/schema";
import { witnessSetHash } from "../../witness";
import * as z from "../../e2e/lib/zcash";

const OUT = path.join(ROOT, "tmp/y2"); mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "y2.out"); writeFileSync(LOG, "");
const say = (s: string) => { console.log(s); writeFileSync(LOG, readFileSync(LOG, "utf8") + s + "\n"); };
const C = Number(env("BNZ_COLLATERAL_ZATS")), H = "/home/benzo/.benzo", NAMES = ["alice", "bob", "carol"];
const FROSTD = `host.orb.internal:${env("BNZ_FROSTD_ADDR").split(":").at(-1)}`;
const sh = (cmd: string, args: string[], input?: string) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 5).join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout.trim();
};
const benzo = (args: string[], input?: any) => { const out = sh(path.join(ROOT, "bin/benzo"), args, input === undefined ? undefined : JSON.stringify(input)); return out.startsWith("{") || out.startsWith("[") ? JSON.parse(out.split("\n").filter(l => l.startsWith("{") || l.startsWith("[")).at(-1)!) : out; };
// `orb run` has returned an empty stdout once for a command that succeeded (live Y2, a host `cat`); retry empties.
const host = (n: string, args: string[]) => { for (let i = 0; ; i++) { const out = sh("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", ...args]); if (out || i >= 2) return out; } };
const hostBenzo = (n: string, args: string[]) => { const out = host(n, [`${H}/bin/benzo`, ...args]); return JSON.parse(out.split("\n").filter(l => l.startsWith("{")).at(-1)!); };
const push = (n: string, src: string, dest: string) => { sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "rm", "-rf", `/home/benzo/${dest}`]); sh("orbctl", ["push", "-m", `benzo-${n}`, src, dest]); sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "chown", "-R", "benzo:benzo", `/home/benzo/${dest}`]); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const latestRound = async () => (await (await fetch(`${env("BNZ_DRAND_URLS").split(",")[0]}/${env("BNZ_DRAND_CHAIN_HASH")}/public/latest`)).json()).round as number;
const requireBefore = (t: number) => { if (Date.now() / 1000 >= t) throw new Error(`deposits matured after T_freeze ${t}`); };
let ok = true; const check = (id: string, pass: boolean, detail = "") => { say(`${pass ? "PASS" : "ERROR"} ${id}${detail ? " " + detail : ""}`); ok &&= pass; };

async function afterAdmission(id: string, manifest: any, signer: string, publicDir: string, refunds: string[]) {
    const R = manifest.drand.R;
    while (Date.now() / 1000 < manifest.T_submit + 2) await sleep(5_000); // freeze needs now >= T_submit
    // 5. Freeze right after admission (it must happen BEFORE T_freeze; a missed cutoff cancels the auction);
    // witness certificates signed ON two hosts over the pushed public dir.
    const stateOf = () => benzo(["auction", "status", "--id", id]).state as string;
    if (stateOf() === "OPEN") { requireBefore(manifest.T_freeze); benzo(["freeze", "--id", id]); }
    for (const n of (JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8")).witness_cert ?? []).length >= 2 ? [] : ["alice", "bob"]) {
      push(n, publicDir, `y2pub-${id.slice(0, 12)}`);
      host(n, [`${H}/bin/benzo`, "witness", "sign", "--dir", `/home/benzo/y2pub-${id.slice(0, 12)}`, "--signer", signer, "--key", `${H}/witness/${n}.key`]);
      const hostDoc = JSON.parse(host(n, ["cat", `/home/benzo/y2pub-${id.slice(0, 12)}/auction.json`]));
      const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
      for (const c of hostDoc.witness_cert ?? []) if (!(doc.witness_cert ?? []).some((x: any) => JSON.stringify(x) === JSON.stringify(c))) (doc.witness_cert ??= []).push(c);
      writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(doc));
    }
    // 6. Open after R, clear; envelope-opens reports computed ON each host from its own key and vault.
    while ((await latestRound()) < R) await sleep(10_000);
    if (stateOf() === "SEALED-WAIT") benzo(["open", "--id", id]);
    if (stateOf() === "OPENED") benzo(["clear", "--id", id]);
    for (const n of NAMES) {
      for (const v of ["sync", "enhance"]) host(n, [`${H}/bin/zcash-devtool`, "wallet", "-w", `${H}/vaults/${id}/wallet`, v, "-s", env("BNZ_LWD_URL")]);
      push(n, publicDir, `y2pub-${id.slice(0, 12)}`);
      const report = hostBenzo(n, ["sign", "envelope-opens", "--id", id, "--name", n, "--public", `/home/benzo/y2pub-${id.slice(0, 12)}`, "--witness-key", `${H}/witness/${n}.key`]);
      mkdirSync(path.join(STATE, "settle", id), { recursive: true });
      writeFileSync(path.join(STATE, "settle", id, `envelope-opens-${n}.json`), JSON.stringify(report));
    }
    // 7. Settle with the kill drill: bob's host is stopped mid-session; the batch completes with alice + carol.
    const settle = spawnSync(path.join(ROOT, "bin/benzo"), ["settle", "--id", id], { encoding: "utf8", env: { ...process.env, BNZ_DRILL_STOP: "bob" }, maxBuffer: 64 << 20 });
    writeFileSync(path.join(OUT, "settle.log"), (settle.stdout || "") + "\n----\n" + (settle.stderr || ""));
    sh("orb", ["start", "benzo-bob"]);
    const custody = JSON.parse(readFileSync(path.join(STATE, "settle", id, "batch-1.custody.json"), "utf8"));
    const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
    check("y2-settled", settle.status === 0 && (doc.settlement?.receipts ?? []).length > 0, `exit ${settle.status}, receipts ${(doc.settlement?.receipts ?? []).length}`);
    check("y2-kill-drill-abandoned-bob", custody.events.some((e: any) => e.abandoned_session?.failed?.includes("bob")));
    check("y2-completed-with-alice-carol", JSON.stringify(custody.pair) === JSON.stringify(["alice", "carol"]), `pair ${custody.pair.join("+")}`);
    check("y2-host-approvals", custody.events.filter((e: any) => e.approve === "approved").length >= 3, custody.events.map((e: any) => e.signer ? `${e.signer}:${e.approve}` : "abandoned").join(" "));
    const parties = (doc.settlement?.receipts ?? []).map((r: any) => r.party);
    check("y2-no-duplicate-outputs", new Set(parties).size === parties.length);
    check("y2-no-share-on-mac", !existsSync(path.join(STATE, "auctions", id)));
    // §11 H7: the coordinator holds only the redacted candidate, and no bid refund destination appears in anything the
    // operator keeps for this auction: settle state, product ledger, auction ledger, public dir (refunds[3] is the seller
    // routing UA, which the operator chose; run/y2-<id>/refunds.json is the test harness's bidder state).
    const insp = JSON.parse(readFileSync(path.join(STATE, "settle", id, "batch-1.inspect.json"), "utf8"));
    check("y2-h7-redacted-candidate", insp.outputs.filter((o: any) => !o.is_change).every((o: any) => o.recipient === null && o.redacted === true));
    if (refunds.length) {
      const leaked = refunds.slice(0, 3).filter(a => [path.join(STATE, "settle", id), path.join(STATE, "product"), path.join(STATE, "auction"), publicDir].some(d => existsSync(d) && spawnSync("grep", ["-rqa", a, d]).status === 0));
      check("y2-h7-destinations-not-on-mac", leaked.length === 0, `${leaked.length} of 3 refund destinations found in operator files`);
    }
    // 8. Envelope refunds landed at the bidders' own destinations; cold verify of the public dir.
    z.sync("bidder"); z.enhance("bidder");
    const got = z.run(z.scanner, ["scan", "test", path.join(STATE, "bidder")]).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
    const refunded = refunds.slice(0, 3).filter(a => got.some((n: any) => n.address === a && n.value_zats > 0)).length;
    if (refunds.length) check("y2-envelope-refunds-landed", refunded >= 1, `${refunded} of 3 bid destinations received`); else say("SKIP y2-envelope-refunds-landed (resumed run: bid destinations are sealed and not stored)");
    const cold = path.join(OUT, "cold"); rmSync(cold, { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
    const v = spawnSync(path.join(ROOT, "bin/benzo"), ["verify", "--dir", cold, "--signer", signer], { encoding: "utf8" });
    check("y2-cold-verify", v.status === 0, (v.stdout + v.stderr).split("\n").filter(l => /^ERROR/.test(l)).slice(0, 2).join(" | "));
}
async function main() {
  // frostd on the Mac (hosts reach it at host.orb.internal over TLS).
  const frostd = spawn(path.join(STATE, "bin/frostd"), ["-i", "127.0.0.1", "-p", env("BNZ_FROSTD_ADDR").split(":").at(-1)!, "-c", path.join(STATE, "tls/frostd.pem"), "-k", path.join(STATE, "tls/frostd.key")], { stdio: "ignore" });
  await sleep(2000);
  try {
    for (const n of NAMES) sh("orb", ["start", `benzo-${n}`]);
    if (process.env.RESUME_ID) {
      const rid = process.env.RESUME_ID, pdir = path.join(ROOT, "tmp/y2/public", rid), doc = JSON.parse(readFileSync(path.join(pdir, "auction.json"), "utf8"));
      const m = JSON.parse(Buffer.from(doc.manifest.bytes, "base64").toString("utf8"));
      say(`resume ${rid}`);
      // The bidders' refund addresses, saved by the fresh run (they live nowhere else on the operator side).
      const saved = path.join(STATE, "run", `y2-${rid}`, "refunds.json");
      await afterAdmission(rid, m, doc.signer, pdir, existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : []);
    } else {
    const id = randomBytes(32).toString("hex");
    say(`auction ${id}`);
    // 1. Fresh DKG on the hosts.
    const pk = (n: string) => host(n, ["cat", `${H}/contacts/${n}.pubkey`]);
    const dkg = NAMES.map((n, i) => new Promise<string>((resolve, reject) => {
      setTimeout(() => {
        const args = ["run", "-m", `benzo-${n}`, "-u", "benzo", `${H}/bin/benzo`, "sign", "dkg", "--id", id, "--name", n, "--server", FROSTD, ...(i === 0 ? ["--peers", `${pk("bob")},${pk("carol")}`] : [])];
        const p = spawn("orb", args); let out = "", err = "";
        p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (err += d));
        p.on("close", c => c === 0 ? resolve(JSON.parse(out.trim().split("\n").at(-1)!).group_key) : reject(new Error(`${n} dkg: ${err.trim().slice(-300)}`)));
      }, i === 0 ? 0 : 2500);
    }));
    const keys = await Promise.all(dkg);
    const groupKeys = keys.join(",");
    const k = benzo(["auction", "keys", "--id", id, "--group-keys", groupKeys]);
    // Hosts import the operator's UFVK (zcash-sign draws the non-ak components at random; one UFVK per auction).
    for (const n of NAMES) {
      sh("orbctl", ["push", "-m", `benzo-${n}`, path.join(STATE, "vaults", id, "ufvk.txt"), `ufvk-${id.slice(0, 12)}.txt`]);
      sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "chown", "benzo:benzo", `/home/benzo/ufvk-${id.slice(0, 12)}.txt`]);
      hostBenzo(n, ["auction", "keys", "--id", id, "--group-keys", groupKeys, "--ufvk", `/home/benzo/ufvk-${id.slice(0, 12)}.txt`]);
      sh("orb", ["run", "-m", `benzo-${n}`, "-u", "root", "rm", "-f", `/home/benzo/ufvk-${id.slice(0, 12)}.txt`]);
    }
    check("y2-dkg-on-hosts", new Set(keys).size === 1 && k.group_key === keys[0], `group ${k.group_key.slice(0, 12)}… escrow ${k.escrow_ua.slice(0, 16)}…`);
    // 2. Host envelope keys + host witness keys (private halves never leave the hosts).
    const envelopeKeys = NAMES.map(n => {
      const f = `${H}/signers/${n}/envelope-key.json`;
      const exists = spawnSync("orb", ["run", "-m", `benzo-${n}`, "-u", "benzo", "test", "-f", f]).status === 0;
      return exists ? JSON.parse(host(n, ["cat", f])).public_hex : hostBenzo(n, ["sign", "envelope-key", "--name", n]).public_hex;
    });
    const witnessPubs = NAMES.map(n => {
      const reg = path.join(STATE, "custody", `witness-${n}.pub`);
      if (existsSync(reg)) return readFileSync(reg, "utf8").trim();
      const w = hostBenzo(n, ["witness", "keygen", "--name", n]); mkdirSync(path.dirname(reg), { recursive: true }); writeFileSync(reg, w.public_hex); return w.public_hex;
    });
    // 3. Per-auction vault deposit addresses, manifest, sign, publish.
    const vault = path.join(STATE, "vaults", id, "wallet");
    const addr = () => sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", vault, "--network", "test"]).split("\n").at(-1)!;
    const deposits = [k.escrow_ua, addr(), addr()];
    const refunds = Array.from({ length: 4 }, () => sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"]).split("\n").at(-1)!);
    const privateDir = path.join(STATE, "run", `y2-${id}`), publicDir = path.join(ROOT, "tmp/y2/public", id); mkdirSync(privateDir, { recursive: true });
    writeFileSync(path.join(privateDir, "refunds.json"), JSON.stringify(refunds)); // test-harness bidder state, for RESUME_ID
    const witnessSet = signRecord({ version: 1, auction_id: id, q_w: 2, keys: witnessPubs }, readFileSync(path.join(STATE, "auction", "manifest-signing.pem"), "utf8"));
    writeFileSync(path.join(privateDir, "witness-set.json"), JSON.stringify(witnessSet));
    const operator = { settlement: { signers: ["alice", "bob"], batch_cap: 13, pczt_expiry_blocks: 364 }, routing: { bidders: deposits.map(deposit_ua => ({ deposit_ua })), seller_ua: refunds[3], fee_reserve_ua: addr() } };
    writeFileSync(path.join(privateDir, "operator.json"), JSON.stringify(operator));
    const now = Math.ceil(Date.now() / 1000), release = now + 33 * 60, R = 1 + Math.ceil((release - Number(env("BNZ_DRAND_GENESIS"))) / 3);
    const manifest = { version: 1, network: "test", auction_id: id, escrow_ua: k.escrow_ua, frost_group_key: k.group_key, lot: "Y2 host-custody auction", supply: 2, reserve_zats: "10", tick_zats: "10", B_max_zats: "3000", q_max: 1, C_zats: String(C), fee_zats: "0", deposit_addresses: deposits, envelope_keys: envelopeKeys, witness_set_hash: witnessSetHash(witnessSet), drand: { chain_hash: env("BNZ_DRAND_CHAIN_HASH"), public_key: env("BNZ_DRAND_PUBLIC_KEY"), scheme: "bls-unchained-g1-rfc9380", genesis: Number(env("BNZ_DRAND_GENESIS")), period: 3, R }, T_submit: now + 4 * 60, T_freeze: now + 30 * 60, confirmations: 10, clearing: { mode: "uniform", band: "floor_pro_rata_units", dust: "ascending_leaf_index", tie: "ascending_leaf_index", minimum_fill: 1 }, refund: { invalid: "full_C", reorg: "C_minus_fee_remove_leaf", cancel: "full_C" }, freeze: "merkle_root_v1" };
    benzo(["auction", "create", "--witness-set", path.join(privateDir, "witness-set.json")], manifest);
    const packet = benzo(["auction", "sign", "--id", id]);
    benzo(["auction", "publish", "--id", id, "--dir", publicDir, "--config", path.join(privateDir, "operator.json")]);
    const signer = packet.signer, manifestFile = path.join(publicDir, "manifest.json");
    // 4. Three bids (two win, one refunds in full), sealed to the HOSTS' envelope keys; one funding transaction.
    const bids = deposits.map((address, i) => ({ ...benzo(["bid", "seal", "--manifest", manifestFile, "--signer", signer], { price_zats: String(200 + 10 * i), quantity: 1, address, refund_ua: refunds[i] }), address }));
    const paid = benzo(["bid", "deposit", "--id", id, "--pay"], { bids, reserve: { address: operator.routing.fee_reserve_ua, amount_zats: "70000" } }); // fee reserve: payouts pay network fees from it
    say(`funding ${paid.txid}`);
    const vaultSync = () => { for (const v of ["sync", "enhance"]) z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, v, "-s", env("BNZ_LWD_URL")]); };
    for (let h = 0; ; await sleep(30_000)) {
      vaultSync();
      const t = JSON.parse(z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, "list-tx", "--json"])).find((t: any) => t.txid === paid.txid);
      const tip = JSON.parse(z.run(path.join(STATE, "bin/zcash-devtool"), ["wallet", "-w", vault, "balance", "--json"])).chain_tip_height;
      if (t?.mined_height && tip >= t.mined_height + 9) break;
      if (++h > 80) throw new Error("funding did not mature");
    }
    for (const b of bids) benzo(["bid", "deposit", "--id", id], { txid: paid.txid, address: b.address, envelope_hex: b.envelope_hex, envelope_ct_hex: b.envelope_ct_hex, owner_sig_hex: b.owner_sig_hex });
    await afterAdmission(id, manifest, signer, publicDir, refunds);
    }
    say(ok ? "RESULT PASS all Y2 assertions" : "RESULT FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally { frostd.kill(); for (const n of NAMES) spawnSync("orb", ["start", `benzo-${n}`]); }
}
main().catch(e => { say(`FATAL ${String(e?.stack ?? e).slice(0, 1500)}`); process.exitCode = 1; });
