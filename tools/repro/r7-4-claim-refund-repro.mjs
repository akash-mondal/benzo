// R7 item 4 repro — benzo claim-refund completes exception-queue refunds, and benzo verify accepts correct
// exception states only (Reviewer R F-5 = Reviewer G G5).
//
// Checks (observations printed; before/after outputs show the flip):
//   C1 does `benzo claim-refund` exist at all?
//   C2 a CORRECT exception state (result obligations whose rows are unpaid `exception` rows, with receipts
//      only where payments happened) must verify — on the current code it is refused twice over ("missing
//      envelope N" for the envelope-less leaf and "settlement missing obligation leaf:N" for every
//      exception-queued refund).
//   C3 wrong exception states must refuse: an exception row with a receipt, a paid-looking row without a
//      receipt, and a corrupted amount.
//   --live additionally drives the shipped claim path end to end against a live auction (needs frostd).
//
// Usage: node tools/repro/r7-4-claim-refund-repro.mjs <auction-id> [--live]
import { spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
for (const l of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const STATE = path.resolve(ROOT, process.env.BNZ_STATE_DIR);
const [id, ...rest] = process.argv.slice(2);
const live = rest.includes("--live");
if (!/^[0-9a-f]{64}$/.test(id)) { console.error("usage: r7-4-claim-refund-repro.mjs <auction-id> [--live]"); process.exit(2); }
const cli = (args, input, stdinText) => {
  const p = spawnSync(path.join(ROOT, "bin/benzo"), args, { input: stdinText ?? (input === undefined ? undefined : JSON.stringify(input)), encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
const config = JSON.parse(readFileSync(path.join(STATE, "product", `${id}.json`), "utf8"));
const publicDir = path.resolve(config.public_dir);
const doc = JSON.parse(readFileSync(path.join(publicDir, "auction.json"), "utf8"));
const signer = JSON.parse(readFileSync(path.join(publicDir, "signer.json"), "utf8")).signer;

// C1
const help = cli(["claim-refund", "--help"]);
console.log(`C1 benzo claim-refund: ${help.code === 0 ? "available" : "absent — " + help.out.trim().slice(-80)}`);

// C2/C3: a synthetic settlement summary over the real published directory: every result obligation except the
// seller is a correct unpaid exception row (never paid to an unauthenticated destination), the seller is paid.
const result = JSON.parse(readFileSync(path.join(publicDir, "result.json"), "utf8"));
const exceptionRows = result.allocations.map((a) => ({ party: `leaf:${a.leaf_index}`, amount_zats: a.refund_zats, state: "exception" }));
const sellerAmount = result.conservation.payout_zats;
const sellerReceipt = { auction_id: id, party: "seller", txid: "0".repeat(64), pool: "ironwood", output_index: 0, amount_zats: sellerAmount };
const settlement = { rows: [...exceptionRows, { party: "seller", amount_zats: sellerAmount, state: "paid" }], receipts: [sellerReceipt] };
// canonical JSON (sorted keys), the byte form public documents are stored in
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const base = path.join(ROOT, "tmp/e2e/r7/claim-repro");
rmSync(base, { recursive: true, force: true }); mkdirSync(base, { recursive: true });
const withSettlement = (name, mutate) => {
  const dir = path.join(base, name);
  cpSync(publicDir, dir, { recursive: true });
  const d = JSON.parse(readFileSync(path.join(dir, "auction.json"), "utf8"));
  d.settlement = JSON.parse(JSON.stringify(settlement));
  mutate?.(d.settlement);
  writeFileSync(path.join(dir, "auction.json"), canonical(d) + "\n");
  writeFileSync(path.join(dir, "summary.json"), canonical(d.settlement) + "\n");
  return cli(["verify", "--dir", dir, "--signer", signer]);
};
const show = (label, r) => console.log(`${label}: exit ${r.code} ${r.out.split("\n").filter((l) => l.startsWith("ERROR") || l.startsWith("WARN")).join(" | ").slice(0, 300) || "(no error lines)"}`);
// leak-audit (gate LA): outputs never carry a full destination UA — a delivery address in evidence links a
// payout to a recipient. Comparisons below keep the full values; only the printed form is abbreviated.
const ab = (a) => (typeof a === "string" && a.length > 20 ? a.slice(0, 8) + "…" + a.slice(-6) : a);

const correct = withSettlement("correct", null);
show("C2 correct exception state verifies", correct);
show("C3 exception row with a receipt", withSettlement("with-receipt", (s) => s.receipts.push({ ...sellerReceipt, party: "leaf:0" })));
show("C3 exception row flipped to paid, no receipt", withSettlement("flipped", (s) => { s.rows.find((r) => r.party === "leaf:0").state = "refunded"; }));
show("C3 corrupted exception amount", withSettlement("corrupt-amount", (s) => { s.rows.find((r) => r.party === "leaf:0").amount_zats = String(BigInt(s.rows.find((r) => r.party === "leaf:0").amount_zats) + 1n); }));

// C4 --live: the shipped claim path — owner-signed request -> recorded claim -> paid refund.
if (live) {
  const frozen = doc.frozen;
  for (const a of result.allocations.slice(0, 2)) {
    const leaf = frozen.leaves.find((l) => l.leaf_index === a.leaf_index);
    const keyFile = path.join(STATE, "bids", id, leaf.ciphertext_hash + ".json");
    const ownerPrivate = JSON.parse(readFileSync(keyFile, "utf8")).owner_private_hex;
    const destination = spawnSync(path.join(ROOT, "settle/target/release/benzo-pczt"), ["address", path.join(STATE, "bidder"), "--network", "test"], { encoding: "utf8" }).stdout.trim();
    const request = cli(["claim-refund", "--id", id, "--party", `leaf:${a.leaf_index}`, "--destination", destination, "--owner-key-stdin"], undefined, ownerPrivate);
    console.log(`C4 build claim leaf:${a.leaf_index} -> ${request.code === 0 ? "signed for " + ab(destination) : "refused " + request.out.trim().slice(-120)}`);
    const reqFile = path.join(base, `claim-${a.leaf_index}.json`);
    writeFileSync(reqFile, request.out.trim(), { mode: 0o600 });
    const recorded = cli(["claim-refund", "--id", id, "--file", reqFile]);
    console.log(`C4 settle claim leaf:${a.leaf_index}: exit ${recorded.code} ${recorded.out.split("\n").filter((l) => l.startsWith("ERROR")).join(" | ").slice(0, 200)}`);
    console.log(`C4 paid to owner-named ${ab(destination)}: ${recorded.out.includes("settled") || recorded.code === 0 ? "see receipts" : "no"}`);
  }
  const cold = path.join(base, "cold"); rmSync(cold, { recursive: true, force: true }); cpSync(publicDir, cold, { recursive: true });
  show("C4 verify on the cold settled copy", cli(["verify", "--dir", cold, "--signer", signer]));
}
