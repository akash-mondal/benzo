// R5 / crosschain.md §5 repro — `benzo fund quote` is a dry NEAR Intents 1Click quote only:
// it targets the bidder's own shielded UA with a round amount the user chose (never C plus a
// fee), never deposits, and refuses anything else. Checks (each prints one PASS/ERROR <id> line):
//   r5-quote-dry             a real dry quote (HTTP 200) against the live 1Click API, `dry:true`
//                            in the request and no deposit address in the response
//   r5-round-amount-refused  a fractional --zec is refused with the round-amount rule
//   r5-shielded-only-refused a t-addr --to is refused (shielded-only, design §5)
// Usage: node tools/repro/r5-fund-quote-repro.mjs   (needs npm ci; network to 1click.chaindefuser.com)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
console.log(`commit ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim()}`);
console.log(`utc ${new Date().toISOString()}`);
console.log("command node tools/repro/r5-fund-quote-repro.mjs");
const UA = "u1redacted"; // official zcash-test-vectors unified_address row (public test vector)
const run = (args) => {
  try {
    const out = execFileSync("node", [path.join(ROOT, "cli/dist/benzo.mjs"), ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 << 20 });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
};
let failures = 0;
const pass = (id, note) => console.log(`PASS ${id} ${note}`);
const fail = (id, why) => { failures++; console.log(`ERROR ${id} ${why}`); };

{
  const r = run(["fund", "quote", "--from", "nep141:wrap.near", "--zec", "1", "--to", UA, "--refund-to", "0x0000000000000000000000000000000000000001"]);
  let doc = null;
  try { doc = JSON.parse(r.out.split(/\n(?=GUIDANCE)/)[0]); } catch { /* fall through */ }
  const dry = doc?.request?.dry === true && doc?.quote && typeof doc.quote === "object" && !("depositAddress" in doc.quote);
  if (r.code === 0 && doc?.status >= 200 && doc?.status < 300 && dry) {
    pass("r5-quote-dry", `HTTP ${doc.status}, quote keys ${Object.keys(doc.quote).slice(0, 10).join(",")} ${JSON.stringify(doc.quote).slice(0, 160)}`);
  } else {
    fail("r5-quote-dry", `rc=${r.code} status=${doc?.status} out=${(r.out + r.err).slice(0, 200)}`);
  }
}
{
  const r = run(["fund", "quote", "--from", "nep141:wrap.near", "--zec", "1.5", "--to", UA, "--refund-to", "0x0000000000000000000000000000000000000001"]);
  if (r.code !== 0 && /--zec must be a positive whole number of ZEC/.test(r.err)) pass("r5-round-amount-refused", r.err.trim());
  else fail("r5-round-amount-refused", `rc=${r.code}: ${(r.err || r.out).slice(0, 160)}`);
}
{
  const r = run(["fund", "quote", "--from", "nep141:wrap.near", "--zec", "1", "--to", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "--refund-to", "0x0000000000000000000000000000000000000001"]);
  if (r.code !== 0 && /refused: (transparent address \(t-addr\)|not a shielded destination)/.test(r.err)) pass("r5-shielded-only-refused", r.err.trim());
  else fail("r5-shielded-only-refused", `rc=${r.code}: ${(r.err || r.out).slice(0, 160)}`);
}
console.log(failures === 0 ? "RESULT PASS benzo fund quote is a dry quote only" : `RESULT FAIL ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
