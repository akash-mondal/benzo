// Clean-machine driver for the bidder bundle proof (gate PK). Runs INSIDE the fresh /tmp directory
// with an empty HOME, using only Node builtins plus the pinned chrome-headless-shell binary and the
// pinned Go `tle` (both by absolute path) — it resolves nothing from any checkout's node_modules.
// Serves the extracted benzo-bidder-<version>.tgz over 127.0.0.1, drives the sealer page headless
// over the DevTools protocol, waits for the drand quicknet round, opens the ciphertext with tle and
// asserts the plaintext equals the inputs chosen. Args come as BR_* environment variables.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const DIR = process.env.BR_DIR, CHROME = process.env.BR_CHROME, TLE = process.env.BR_TLE;
const DRAND = process.env.BR_DRAND, CHAIN = process.env.BR_CHAIN;
const GENESIS = Number(process.env.BR_GENESIS), PERIOD = Number(process.env.BR_PERIOD), R = Number(process.env.BR_ROUND);
const IN = JSON.parse(process.env.BR_INPUTS ?? "{}");
let failed = false;
const ok = (line) => console.log(`OK ${line}`);
const err = (id, why) => { failed = true; console.log(`ERROR ${id} ${why}`); };
const hex = (b) => Buffer.from(b).toString("hex");

// 1. static file server over the extracted bundle (the same node:http pattern as e2e/lib/sealer.ts)
const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url ?? "/", "http://x").pathname) || "index.html";
  try {
    const body = readFileSync(path.join(DIR, name));
    res.writeHead(200, { "content-type": name.endsWith(".html") ? "text/html" : "text/javascript" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}/`;
ok(`static-server ${origin} serving ${DIR}`);

// 2. pinned Playwright Chromium (chrome-headless-shell), CDP on an ephemeral port
const profile = path.join(path.dirname(DIR), "chromium-profile");
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const devtools = path.join(profile, "DevToolsActivePort");
for (let i = 0; existsSync(devtools) === false && i < 100; i++) await new Promise((r) => setTimeout(r, 100));
if (!existsSync(devtools)) { err("browser.start", `no DevToolsActivePort under ${profile}`); process.exit(1); }
const [port, browserPath] = readFileSync(devtools, "utf8").trim().split("\n");
ok(`browser ${CHROME} cdp-port=${port}`);

const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page");
if (!page) { err("browser.page", "no page target"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map(), events = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

// 3. fill the form with the chosen inputs (fields the driver owns fill the hidden owner/nonce/
// commitment slots too, so the 128-byte plaintext is fully predicted) and click "Seal locally"
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Page.navigate", { url: origin });
let envelope = "", error = "", round = "";
for (let i = 0; i < 240 && !envelope && !error; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (i === 0) {
    await cdp("Runtime.evaluate", { expression: `(() => {
      const set = (id, v) => { document.getElementById(id).value = v; };
      set("opening", ${JSON.stringify(IN.opening)}); set("auction", ${JSON.stringify(IN.auction)});
      set("price", ${JSON.stringify(IN.price)}); set("quantity", ${JSON.stringify(IN.quantity)});
      set("collateral", ${JSON.stringify(IN.collateral)}); set("address", ${JSON.stringify(IN.address)});
      set("nonce", ${JSON.stringify(IN.nonce)}); set("owner", ${JSON.stringify(IN.owner)}); set("commitment", ${JSON.stringify(IN.commitment)});
      document.getElementById("seal").click();
      return "clicked";
    })()` });
    continue;
  }
  const r = await cdp("Runtime.evaluate", { expression: `document.getElementById("envelope").textContent + "\\u0000" + document.getElementById("error").textContent + "\\u0000" + document.getElementById("round").textContent`, returnByValue: true });
  const [envelope0, error0, round0] = r.result.value.split("\u0000");
  envelope = envelope0; error = error0; round = round0;
}
ws.close();
chrome.kill();
server.close();

if (error || !envelope) { err("page.seal", `page refused: ${error || "no envelope after 60 s"}`); process.exit(1); }
ok(`page-seal round=${round} envelope=${envelope.length / 2} bytes`);
if (round !== String(R)) err("page.round", `page sealed to round ${round}, expected ${R}`);

const requests = events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => e.params.request.url);
const offOrigin = requests.filter((u) => !u.startsWith(origin));
if (requests.length === 0) err("network.requests", "no request recorded (page load not seen)");
else if (offOrigin.length) err("network.origin", `requests left the static origin: ${offOrigin.join(" ")}`);
else ok(`network-requests ${requests.length} request(s), all to the static origin (${requests.map((u) => u.slice(origin.length)).join(" ")})`);

// 4. the memo envelope layout: ff424e5a02 || u16be ct_len || tlock_ct || envelope_tag (18) || zero pad
const memo = Buffer.from(envelope, "hex");
const ctLen = memo.readUInt16BE(5);
const ct = memo.subarray(7, 7 + ctLen);
const stanza = ct.toString("latin1").split("\n---")[0].split("\n").filter((l) => l.startsWith("-> "));
if (stanza.length !== 1 || stanza[0] !== `-> tlock ${R} ${CHAIN}`) err("ct.stanza", `stanzas [${stanza.join(", ")}], expected one -> tlock ${R} ${CHAIN}`);
else ok(`ct.stanza ${stanza[0]}`);
const work = path.join(path.dirname(DIR), "tle-work");
mkdirSync(work, { recursive: true });
const inFile = path.join(work, "bid.age"), outFile = path.join(work, "bid.pt");
writeFileSync(inFile, ct);

// 5. before R the seal must not open (tle refuses against the real quicknet)
const early = spawnSync(TLE, ["-d", "-c", CHAIN, "-o", outFile + ".early", inFile], { encoding: "buffer" });
const earlyErr = early.stderr.toString().trim();
if (early.status === 0) err("tle.before-R", "tle opened the ciphertext before R");
else if (!earlyErr.includes("too early")) err("tle.before-R", `tle refused with an unexpected error: ${earlyErr.split("\n")[0]}`);
else ok(`tle-before-R refused (exit ${early.status}): ${earlyErr.split("\n")[0]}`);

// 6. wait for the drand round (poll the beacon, bounded deadline), then open with tle
const deadlineSec = GENESIS + (R - 1) * PERIOD + 150;
let polls = 0, reached = false;
while (Date.now() / 1000 < deadlineSec) {
  polls++;
  const res = await fetch(`${DRAND}/public/${R}`).catch(() => null);
  if (res && res.status === 200) { reached = true; break; }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!reached) err("wait.round", `round ${R} not published within the deadline (polls=${polls})`);
else ok(`wait-round ${R} published after ${polls} poll(s) of ${DRAND}/public/${R}`);

const late = spawnSync(TLE, ["-d", "-c", CHAIN, "-o", outFile, inFile], { encoding: "buffer" });
if (late.status !== 0) { err("tle.after-R", `tle exit ${late.status}: ${late.stderr.toString().trim().split("\n")[0]}`); process.exit(1); }
const pt = readFileSync(outFile);
ok(`tle-after-R exit=0 plaintext=${pt.length} bytes`);

// 7. the plaintext must equal the inputs chosen (v0 layout: version | auction_id | price u64be |
// quantity u32be | nonce | owner | commitment | zero pad)
const expected = Buffer.alloc(128);
Buffer.from(IN.auction, "hex").copy(expected, 1);
expected.writeBigUInt64BE(BigInt(IN.price), 33, false);
expected.writeUInt32BE(Number(IN.quantity), 41, false);
Buffer.from(IN.nonce, "hex").copy(expected, 45);
Buffer.from(IN.owner, "hex").copy(expected, 61);
Buffer.from(IN.commitment, "hex").copy(expected, 93);
if (pt.length !== 128) err("plaintext.match", `plaintext length ${pt.length}, expected 128`);
else if (hex(pt) !== hex(expected)) err("plaintext.match", `plaintext differs\n  got      ${hex(pt)}\n  expected ${hex(expected)}`);
else ok(`plaintext-equals-inputs ${hex(pt)}`);

console.log(failed ? "FAIL bidder-bundle clean-machine proof" : "PASS bidder-bundle clean-machine proof");
process.exit(failed ? 1 : 0);
