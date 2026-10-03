// R16 item 1 repro — a cancelled product auction refunds through its owner-signed claims and never wedges
// (Reviewer R F4): `destinations()` never throws for a single row, an unresolvable row becomes an exception
// row and the batch proceeds.
//
// Cases (both drive the shipped plan/check/ledger entry points against real chain data, real Go tle
// decryption and a real PCZT candidate; the live dev auction's own state is never touched):
//   C1 the shipped signer plan on a CANCELLED product auction consults the owner-signed claims. Before the
//      fix the CANCELLED/REFUNDING branch ignores claims.json entirely: every confirmed deposit lands in
//      obligations with no destination, so destinations() then refuses every product non-seller row and the
//      auction can refund nothing. After: the claimed deposit is payable to its owner-named destination and
//      every unresolvable deposit is an exception row with its reason (claimable after R).
//   C2 the shipped signer check (`settle check`) over a real batch of those rows. Before: destinations()
//      throws on the first product non-seller row ("stray refund refused") and no batch can proceed. After:
//      the claimed row's batch passes the signer check against a real PCZT candidate.
//
// Mechanics: everything runs in a scratch BNZ_STATE_DIR under tmp/e2e/ (tool/vault/frost symlinks, copied
// auction/product/settle state, docs flipped to REFUNDING with the openings stripped — the shape a real
// cancel leaves). The scratch settle ledger keeps the original mined batches (so the plan still counts the
// deposits it refunded) with its obligations table emptied (so the flipped plan pins fresh rows). The fresh
// claim is recorded through the shipped `benzo claim-refund --defer` with the bid's one-time owner key piped
// on stdin (never printed). The candidate PCZT is built from the bidder wallet (the vault is empty between
// drills; the input side is not what this boundary checks), inspected with that wallet's UFVK, and is
// created and inspected but never signed or broadcast.
//
// Usage: node tools/repro/r16-1-cancel-claims-repro.mjs <product-auction-id>
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r16-1-cancel-claims-repro.mjs <product-auction-id>"); process.exit(2); }
const SCRATCH = path.join(ROOT, "tmp/e2e/r16-1-state");
const scratch = (p) => path.join(SCRATCH, p);
const env = { ...process.env, BNZ_STATE_DIR: SCRATCH };
const sh = (cmd, args, input) => {
  const p = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 64 << 20, env });
  return { code: p.status, out: `${p.stdout ?? ""}${p.stderr ?? ""}`, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
};

// ---- scratch state (the live auction state is only read and copied) --------------------------------
rmSync(SCRATCH, { recursive: true, force: true });
for (const d of ["auction", "product", "settle", "run"]) mkdirSync(scratch(d), { recursive: true });
for (const d of ["bin", "vault", "proto", "frost", "signers"]) symlinkSync(path.join(STATE, d), scratch(d), "dir");
const realLedger = JSON.parse(readFileSync(path.join(STATE, "auction", `${id}.json`), "utf8"));
const realConfig = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const realPublicDir = path.resolve(realConfig.public_dir);
const manifest = JSON.parse(Buffer.from(realLedger.manifest.bytes, "base64").toString("utf8"));
// The candidate PCZT is built from the bidder wallet, so the scratch inspect key is that wallet's UFVK.
const bidderUfvk = sh(path.join(STATE, "bin", "zcash-devtool"), ["wallet", "-w", path.join(STATE, "bidder"), "list-accounts"]).out
  .match(/UFVK: (\S+)/)?.[1];
if (!bidderUfvk) { console.error("bidder UFVK unavailable"); process.exit(2); }
writeFileSync(scratch("ufvk.txt"), `${bidderUfvk}\n`, { mode: 0o600 });
// The cancelled shape a real `benzo cancel` leaves: state REFUNDING, no openings published.
const cancelled = (doc) => { const d = { ...doc, state: "REFUNDING" }; delete d.opened; return d; };
writeFileSync(scratch(`auction/${id}.json`), JSON.stringify(cancelled(realLedger)), { mode: 0o600 });
const publicDir = scratch("public");
cpSync(realPublicDir, publicDir, { recursive: true });
writeFileSync(path.join(publicDir, "auction.json"), JSON.stringify(cancelled(JSON.parse(readFileSync(path.join(realPublicDir, "auction.json"), "utf8")))));
writeFileSync(scratch(`product/${id}.json`), JSON.stringify({ ...realConfig, public_dir: publicDir }), { mode: 0o600 });
mkdirSync(scratch(`settle/${id}`), { recursive: true });
for (const f of ["routing-alice.json", "routing-bob.json", "routing-carol.json", "routing-commitment.json"])
  cpSync(path.join(STATE, "settle", id, f), scratch(`settle/${id}/${f}`));
// Keep the mined batches (the plan counts deposits refunded through them) but pin the flipped plan fresh.
cpSync(path.join(STATE, "settle", id, "ledger.sqlite"), scratch(`settle/${id}/ledger.sqlite`));
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(scratch(`settle/${id}/ledger.sqlite`));
  db.exec("DELETE FROM obligations"); db.close();
}

// ---- one real claim for a real bid deposit --------------------------------------------------------
const { memoSealedBid } = await import(path.join(ROOT, "settle/dist/envelopes.mjs"));
const notes = execFileSync(path.join(ROOT, "scan/target/release/benzo-scan"), ["scan", "test", path.join(STATE, "vault")], { maxBuffer: 64 << 20 })
  .toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(scratch(`settle/${id}/ledger.sqlite`), { readOnly: true });
  var owned = new Set(db.prepare("SELECT txid FROM batches WHERE txid IS NOT NULL AND state!='exception'").all().map((b) => String(b.txid)));
  db.close();
}
const target = notes.find((n) => manifest.deposit_addresses.includes(n.address) && (!n.spent_in_txid || owned.has(n.spent_in_txid))
  && n.memo_hex && memoSealedBid(n.memo_hex) && existsSync(path.join(STATE, "bids", id, createHash("sha256").update(Buffer.from(memoSealedBid(n.memo_hex), "hex")).digest("hex") + ".json")));
if (!target) { console.error("no claimable bid deposit with an owner key"); process.exit(2); }
const party = `deposit:${target.txid}:${target.diversifier_index}`;
const ownerPrivate = JSON.parse(readFileSync(path.join(STATE, "bids", id, createHash("sha256").update(Buffer.from(memoSealedBid(target.memo_hex), "hex")).digest("hex") + ".json"), "utf8")).owner_private_hex;
const dest = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder")]).out.trim();
if (!dest.startsWith("utest1")) { console.error(`fresh bidder address unavailable: ${dest}`); process.exit(2); }
const request = JSON.parse(sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", id, "--party", party, "--destination", dest, "--owner-key-stdin"], ownerPrivate).out);
const recorded = sh(path.join(ROOT, "bin/benzo"), ["claim-refund", "--id", id, "--defer"], JSON.stringify(request));
console.log(`fresh claim for ${party} (deposit ${target.value_zats} zats): record-time check ${recorded.code === 0 ? "accepted" : `refused ${recorded.out.trim().slice(-120)}`}`);
console.log(`owner-named destination recorded at record time: ${request.destination_commit === createHash("sha256").update(Buffer.concat([Buffer.from(request.salt, "hex"), Buffer.from(request.destination_ua, "utf8")])).digest("hex")}`);

// ---- C1: the shipped signer plan on the cancelled auction -----------------------------------------
const planRun = sh(process.execPath, [path.join(ROOT, "settle/dist/plan.mjs"), id]);
console.log(`C1 plan exit ${planRun.code}`);
for (const line of planRun.stderr.trim().split("\n").filter(Boolean)) console.log(`C1 plan: ${line}`);
let outcome = "INCONCLUSIVE", plan = null;
if (planRun.code === 0) {
  plan = JSON.parse(planRun.stdout);
  console.log(`C1 obligations: ${JSON.stringify(plan.obligations.map((o) => o.party))}`);
  console.log(`C1 destinations: ${JSON.stringify(plan.destinations)}`);
  console.log(`C1 exceptions: ${JSON.stringify(plan.exceptions.map((o) => ({ party: o.party.slice(0, 34), reason: o.reason ?? null })))}`);
  const claimed = plan.destinations?.[party];
  if (claimed === undefined && plan.obligations.some((o) => o.party === party) && Object.keys(plan.destinations ?? {}).length === 0) {
    outcome = "CONFIRMED";
    console.log("CONFIRMED: the CANCELLED/REFUNDING branch ignores the owner-signed claim — every confirmed deposit lands in obligations with no destination, so a cancelled product auction can refund nothing.");
  } else if (claimed === dest && plan.obligations.length === 1 && plan.exceptions.length > 0) {
    outcome = "FIXED";
    console.log(`FIXED: the claimed deposit is payable to its owner-named destination and ${plan.exceptions.length} unresolvable deposits wait in the exception queue with their reasons — the batch proceeds.`);
  }
} else console.log(`C1 plan stderr: ${planRun.out.trim().slice(-200)}`);

// ---- C2: the shipped signer check over a real batch ------------------------------------------------
const candidate = scratch("candidate.pczt");
const created = sh(path.join(ROOT, "settle/target/release/benzo-pczt"), ["create", path.join(STATE, "bidder"), candidate, "364"],
  JSON.stringify([{ recipient: dest, amount_zats: String(target.value_zats) }]));
console.log(`C2 candidate PCZT from the bidder wallet: ${created.code === 0 ? "created" : `create failed ${created.out.trim().slice(-120)}`}`);
if (created.code === 0) {
  execFileSync(process.execPath, ["node_modules/.bin/esbuild", "settle/ledger.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${scratch("ledger.mjs")}`, "--log-level=error"], { cwd: ROOT });
  const { Ledger } = await import(scratch("ledger.mjs"));
  const ledger = new Ledger(SCRATCH, id);
  ledger.pin(plan ? plan.obligations : [], plan ? plan.exceptions : []);
  ledger.eligible();
  const batch = ledger.allocate(13);
  console.log(`C2 scratch batch ${batch?.id} with ${batch?.outputs.length} rows: ${JSON.stringify(batch?.outputs.map((o) => o.party.slice(0, 34)))}`);
  ledger.close();
  const check = sh(process.execPath, [path.join(ROOT, "settle/dist/cli.mjs"), "check", id, String(batch.id), candidate, "alice"]);
  console.log(`C2 check exit ${check.code}`);
  if (check.code !== 0) console.log(`C2 check stderr: ${check.out.trim().slice(-220)}`);
  if (check.code !== 0 && /stray refund refused|envelope destination refused/.test(check.out)) {
    outcome = outcome === "FIXED" ? "FIXED" : "CONFIRMED";
    console.log("CONFIRMED: destinations() throws for a product non-seller row inside the signer check — no batch can proceed at all.");
  } else if (check.code === 0 && outcome === "FIXED") {
    console.log("FIXED: the signer check resolved the claimed row's destination and the batch passed against a real PCZT.");
  } else if (check.code === 0) console.log("check passed but C1 did not flip — inspect the plan output above");
}
console.log(`outcome ${outcome}`);
