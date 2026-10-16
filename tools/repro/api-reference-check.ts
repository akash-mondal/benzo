// Gate DOC proof: serve a committed published auction directory with the shipped API server and assert
// every documented response's key set against the `<!-- shape: ID -->` blocks in docs/api-reference.md,
// so the reference cannot drift from the code silently. Offline; drives only 127.0.0.1.
// Run: npx esbuild tools/repro/api-reference-check.ts --bundle --platform=node --format=esm \
//        --outfile=tmp/api-reference-check.mjs && node tmp/api-reference-check.mjs
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { assertScratch } from "./scratch";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const DOC = "docs/api-reference.md";
const PRIMARY = "docs/evidence/phase-5/markets/launch/cold-f1170469"; // canonical SETTLED launch dir
const failures: string[] = [];

// ---- shape grammar (see docs/api-reference.md §5) ----------------------------------------------
// object shape: keys; a key ending in `?` is optional; the flag "$nullable" allows the object to be null.
// array shape: [element shape], applied to every element.
// string shape: "string" | "number" | "boolean" | "object" | "array", each with an optional "|null".
type Shape = string | { [k: string]: Shape } | Shape[];

function shapeKeys(shape: { [k: string]: Shape }): { required: Set<string>; optional: Set<string> } {
  const required = new Set<string>(), optional = new Set<string>();
  for (const k of Object.keys(shape)) {
    if (k === "$nullable") continue;
    (k.endsWith("?") ? optional : required).add(k.endsWith("?") ? k.slice(0, -1) : k);
  }
  return { required, optional };
}

function checkShape(id: string, where: string, observed: unknown, shape: Shape): void {
  const err = (why: string): void => { failures.push(`ERROR ${id} ${where}: ${why}`); };
  if (typeof shape === "string") {
    const kinds = shape.split("|");
    if (observed === null) return kinds.includes("null") ? undefined : err(`expected ${shape}, got null`);
    const kind = Array.isArray(observed) ? "array" : typeof observed;
    return kinds.includes(kind) ? undefined : err(`expected ${shape}, got ${kind}`);
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(observed)) return err(`expected array, got ${typeof observed}`);
    if (shape.length !== 1) return err(`bad documented array shape`);
    return observed.forEach((v, i) => checkShape(id, `${where}[${i}]`, v, shape[0]));
  }
  if (observed === null) return (shape as Record<string, unknown>).$nullable === true ? undefined : err(`unexpected null`);
  if (typeof observed !== "object" || Array.isArray(observed)) return err(`expected object, got ${Array.isArray(observed) ? "array" : typeof observed}`);
  const keys = Object.keys(observed as object);
  const { required, optional } = shapeKeys(shape);
  for (const k of required) if (!keys.includes(k)) err(`missing key ${k}`);
  for (const k of keys) if (!required.has(k) && !optional.has(k)) err(`undocumented key ${k}`);
  for (const k of keys) {
    const wanted = shape[k] ?? shape[`${k}?`];
    if (wanted !== undefined) checkShape(id, `${where}.${k}`, (observed as Record<string, unknown>)[k], wanted);
  }
}

// ---- parse the documented shapes ---------------------------------------------------------------
const doc = readFileSync(DOC, "utf8");
const shapes = new Map<string, Shape>();
for (const m of doc.matchAll(/<!-- shape: ([a-z0-9-]+) -->\s*```json\n([\s\S]*?)```/g)) {
  if (shapes.has(m[1])) { failures.push(`ERROR doc.shapes duplicate shape block ${m[1]}`); continue; }
  shapes.set(m[1], JSON.parse(m[2]) as Shape);
}

// ---- build the shipped server from this tree ---------------------------------------------------
execFileSync(process.execPath, ["cli/build.mjs"], { stdio: ["ignore", "ignore", "inherit"] });
console.log("OK build api/dist/server.mjs from the working tree");

// ---- fixtures: the committed directory, and a pre-result copy for the 409 bodies ----------------
const doc1 = JSON.parse(readFileSync(path.join(PRIMARY, "auction.json"), "utf8"));
const signer: string = doc1.signer, auctionId: string = doc1.auction_id;
const leafHash: string = doc1.frozen.leaves[0].ciphertext_hash;
const early = path.join("tmp", "api-reference-early");
rmSync(assertScratch(early), { recursive: true, force: true });
mkdirSync(early, { recursive: true });
// Derived from the committed directory (same signed manifest), stopped before the freeze: only the
// fields a DRAFT/OPEN document carries, so the not-ready bodies can be asserted offline (R21 item 5).
writeFileSync(path.join(early, "auction.json"), JSON.stringify({
  version: 1, auction_id: auctionId, signer, manifest: doc1.manifest, state: "OPEN", receipts: [],
}));
// Same derived document, corrupted only after its server has started: the per-request reload then fails
// closed and the server answers the invalid-document body (api/server.ts:25-30) instead of stale data.
// (A directory that already fails at startup refuses to serve at all — exit 1, cli/commands/api.ts:31-36.)
const broken = path.join("tmp", "api-reference-broken");
rmSync(assertScratch(broken), { recursive: true, force: true });
mkdirSync(broken, { recursive: true });
const badPacket = { ...doc1.manifest, signature: (doc1.manifest.signature[0] === "0" ? "1" : "0") + doc1.manifest.signature.slice(1) };
const breakDir = () => writeFileSync(path.join(broken, "auction.json"), JSON.stringify({
  version: 1, auction_id: auctionId, signer, manifest: badPacket, state: "OPEN", receipts: [],
}));
writeFileSync(path.join(broken, "auction.json"), JSON.stringify({
  version: 1, auction_id: auctionId, signer, manifest: doc1.manifest, state: "OPEN", receipts: [],
}));

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

async function serve(dir: string, port: number, signerHex: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["api/dist/server.mjs", "--dir", dir, "--port", String(port), "--signer", signerHex], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server start timeout for ${dir}`)), 10000);
    child.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("api listening")) { clearTimeout(t); resolve(); } });
    child.on("exit", (c) => { clearTimeout(t); reject(new Error(`server exited ${c} for ${dir}`)); });
  });
  return child;
}

let serverA: ChildProcess | null = null, serverB: ChildProcess | null = null, serverC: ChildProcess | null = null;
const get = async (port: number, url: string, method = "GET") => {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method });
  return { status: res.status, body: await res.json() as unknown };
};

try {
  const portA = await freePort(), portB = await freePort(), portC = await freePort();
  serverA = await serve(PRIMARY, portA, signer);
  serverB = await serve(early, portB, signer);
  serverC = await serve(broken, portC, signer);
  console.log(`OK serve primary=${PRIMARY} port=${portA} early=tmp/api-reference-early port=${portB} broken=tmp/api-reference-broken port=${portC}`);
  breakDir();

  const cases: { shape: string; method: string; url: string; port: number; expect: number }[] = [
    { shape: "auction", method: "GET", url: `/auction/${auctionId}`, port: portA, expect: 200 },
    { shape: "operator", method: "GET", url: "/operator", port: portA, expect: 200 },
    { shape: "freeze", method: "GET", url: "/freeze", port: portA, expect: 200 },
    { shape: "result", method: "GET", url: "/result", port: portA, expect: 200 },
    { shape: "allocation", method: "GET", url: "/allocation", port: portA, expect: 200 },
    { shape: "receipt", method: "GET", url: `/receipt/${leafHash}`, port: portA, expect: 200 },
    { shape: "not-ready", method: "GET", url: "/result", port: portB, expect: 409 },
    { shape: "not-ready", method: "GET", url: "/allocation", port: portB, expect: 409 },
    { shape: "not-ready", method: "GET", url: `/receipt/${leafHash}`, port: portB, expect: 409 },
    { shape: "invalid-document", method: "GET", url: "/operator", port: portC, expect: 400 },
    { shape: "not-found", method: "GET", url: `/auction/${"de".repeat(32)}`, port: portA, expect: 404 },
    { shape: "not-found", method: "GET", url: "/no-such-route", port: portA, expect: 404 },
    { shape: "method-not-allowed", method: "POST", url: "/operator", port: portA, expect: 405 },
    { shape: "error", method: "GET", url: "/receipt/not-a-hash", port: portA, expect: 400 },
    { shape: "error", method: "GET", url: `/receipt/${"ab".repeat(32)}`, port: portA, expect: 400 },
  ];
  const exercised = new Set<string>();
  for (const c of cases) {
    const id = `shape.${c.shape}`;
    if (!shapes.has(c.shape)) { failures.push(`ERROR ${id} ${c.method} ${c.url}: shape block missing from ${DOC}`); continue; }
    exercised.add(c.shape);
    const { status, body } = await get(c.port, c.url, c.method);
    if (status !== c.expect) { failures.push(`ERROR ${id} ${c.method} ${c.url}: HTTP ${status}, expected ${c.expect}`); continue; }
    const before = failures.length;
    checkShape(id, `${c.method} ${c.url}`, body, shapes.get(c.shape)!);
    if (failures.length === before) {
      const keys = body && typeof body === "object" ? Object.keys(body as object).length : 0;
      console.log(`OK ${id} ${c.method} ${c.url} -> ${c.expect} (${keys} keys)`);
    }
  }
  for (const name of shapes.keys()) if (!exercised.has(name)) failures.push(`ERROR doc.shapes shape ${name} is documented but not exercised`);

  // Startup contract: a --signer mismatch refuses to serve (exit 1); missing --dir is usage (exit 2).
  const startup = (args: string[]) => {
    const out = execFileSync(process.execPath, ["api/dist/server.mjs", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out;
  };
  try {
    startup(["--dir", PRIMARY, "--port", String(await freePort()), "--signer", "00".repeat(44)]);
    failures.push("ERROR startup.signer-mismatch served with a wrong --signer");
  } catch (e) {
    const status = (e as { status?: number }).status, text = `${(e as { stdout?: string }).stdout}${(e as { stderr?: string }).stderr}`;
    if (status === 1 && text.includes("signer mismatch")) console.log("OK startup.signer-mismatch refuses to serve, exit 1");
    else failures.push(`ERROR startup.signer-mismatch exit ${status}, expected 1 with a signer mismatch: ${text.trim().slice(0, 120)}`);
  }
  try {
    startup(["--port", String(await freePort())]);
    failures.push("ERROR startup.usage served without --dir");
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 2) console.log("OK startup.usage missing --dir, exit 2");
    else failures.push(`ERROR startup.usage exit ${status}, expected 2`);
  }
} finally {
  serverA?.kill();
  serverB?.kill();
  serverC?.kill();
}

for (const line of failures) console.log(line);
if (failures.length) {
  console.log(`FAIL api-reference ${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`PASS api-reference ${shapes.size} documented shapes, all key sets match ${DOC}`);
