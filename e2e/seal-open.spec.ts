// Test 1: the browser seal stays closed before round R and opens byte-exact after R through Go `tle` (gate C).
// 1. Protects DESIGN §4 steps 2-4 (fixed 128-byte plaintext, sealed locally to the exact round R, 494-byte memo
//    envelope) and threats 003 (wrong round or chain bypasses the seal), 021 (plaintext leaves the client) and 036
//    (memo overflow or truncation).
// 2. Fails on: an off-by-one round formula, a wrong byte order or offset in the plaintext, a network request while
//    sealing, a missing past-round guard, a ciphertext that official `tle` cannot open, or one that opens early.
// 3. No other test runs the sealer page or `tle`; test 2 checks only that the chain returns the page's bytes unchanged.
// 4. No production seam: it types into the built page served over http://127.0.0.1 and reads what a bidder would copy.
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { bin, DRAND, env } from "./lib/env";
import { latestRound, Run, waitFor, write } from "./lib/run";
import { recordNetwork, sealBid, serveSealer } from "./lib/sealer";
import { tleDecrypt } from "./lib/tools";

const IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
const GENESIS = Number(env("BNZ_DRAND_GENESIS"));
const PERIOD = Number(env("BNZ_DRAND_PERIOD"));
const CHAIN = env("BNZ_DRAND_CHAIN_HASH");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("seal in the browser, open with tle after R", async ({ page }) => {
  const run = new Run("seal-open");
  if (!existsSync(bin("tle"))) run.notRun(IDS, `tle missing at ${bin("tle")}`);
  const info = await fetch(`${DRAND}/info`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (info?.hash !== CHAIN) run.notRun(IDS, `drand ${DRAND}/info did not answer with the pinned chain`);

  const T = Math.ceil(Date.now() / 1000) + 30;
  test.setTimeout((T - Date.now() / 1000 + 120) * 1000);
  const R = 1 + Math.ceil((T - GENESIS) / PERIOD);
  const auction = randomBytes(32).toString("hex");
  const bids = [0, 1].map(() => ({
    opening: new Date(T * 1000).toISOString().replace(".000Z", "Z"),
    auction,
    price: randomBytes(8).readBigUInt64BE().toString(),
    quantity: String(randomBytes(4).readUInt32BE()),
    collateral: env("BNZ_COLLATERAL_ZATS"),
    address: "utest1" + randomBytes(20).toString("hex"),
  }));

  const server = await serveSealer();
  const events = recordNetwork(page);
  await page.goto(server.url);
  const firstKeystroke = Date.now();
  const sealed = [];
  for (const bid of bids) sealed.push(await sealBid(page, bid));
  const envelopeShown = Date.now();
  const past = await sealBid(page, { ...bids[0], opening: new Date(Date.now() - 60_000).toISOString() });
  server.close();
  write("tlock/requests.jsonl", events.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const envelopes = sealed.map((s) => Buffer.from(s.envelope, "hex"));
  const cts = envelopes.map((e) => (e.length >= 7 ? e.subarray(7, 7 + e.readUInt16BE(5)) : e));
  cts.forEach((ct, i) => write(`tlock/bid${i + 1}.ct.hex`, hex(ct) + "\n"));

  await run.check("C1", "envelope layout", () => {
    for (const e of envelopes) {
      expect.soft(e.length, "envelope length").toBe(512);
      expect.soft(hex(e.subarray(0, 5)), "envelope header").toBe("ff424e5a01");
      const len = e.readUInt16BE(5);
      expect.soft(e.subarray(7, 7 + 22).toString("latin1"), "binary age").toBe("age-encryption.org/v1\n");
      expect.soft(e.subarray(7 + len).every((b) => b === 0), "zero pad after ct_len bytes").toBe(true);
    }
  });

  await run.check("C2", "one tlock stanza for round R on the pinned chain", () => {
    for (const ct of cts) {
      const header = ct.toString("latin1").split("\n---")[0].split("\n");
      const stanzas = header.filter((l) => l.startsWith("-> "));
      expect.soft(stanzas, "stanzas").toEqual([`-> tlock ${R} ${CHAIN}`]);
    }
  });

  await run.check("C4", "a past opening time is refused", () => {
    expect.soft(past.envelope, "envelope for a past time").toBe("");
    expect.soft(past.error, "refusal").toMatch(/^refused: /);
  });

  await run.check("C5", "no network event while sealing", () => {
    const during = events.filter((e) => e.t >= firstKeystroke && e.t <= envelopeShown);
    expect.soft(during, "events between first keystroke and envelope").toEqual([]);
    expect.soft(events.some((e) => e.kind === "request" && e.url === server.url), "page-load request recorded").toBe(true);
  });

  const before: string[] = [];
  await run.check("C6", "closed before R", async () => {
    const latest = await latestRound();
    const status = (await fetch(`${DRAND}/public/${R}`)).status;
    expect.soft(latest, "latest round").toBeLessThan(R);
    expect.soft(status, `/public/${R}`).toBe(425);
    cts.forEach((ct, i) => {
      const r = tleDecrypt(ct);
      before.push(`bid${i + 1} utc=${new Date().toISOString()} latest=${latest} public_R_status=${status} tle_exit=${r.code} tle: ${r.stderr.trim()}`);
      expect.soft(r.code, "tle exit code").not.toBe(0);
      expect.soft(r.stderr, "tle error").toContain("too early to decrypt");
      expect.soft(r.stderr, "tle error names R").toContain(`${R}`);
    });
  });
  write("tlock/before.txt", before.join("\n") + "\n");

  await waitFor({ round: R }, (T + 60) * 1000);
  const beacon = await fetch(`${DRAND}/public/${R}`);
  write(`tlock/beacon-R.json`, await beacon.text());

  const after: string[] = [];
  const plaintexts: Buffer[] = [];
  await run.check("C7", "opens byte-exact after R", async () => {
    const latest = await latestRound();
    cts.forEach((ct, i) => {
      const r = tleDecrypt(ct);
      after.push(`bid${i + 1} utc=${new Date().toISOString()} latest=${latest} public_R_status=${beacon.status} tle_exit=${r.code} tle: ${r.stderr.trim()}`);
      write(`tlock/bid${i + 1}.pt.hex`, hex(r.stdout) + "\n");
      plaintexts.push(r.stdout);
      const pt = r.stdout;
      expect.soft(r.code, "tle exit code").toBe(0);
      expect.soft(pt.length, "plaintext length").toBe(128);
      expect.soft(pt[0], "version").toBe(0);
      expect.soft(hex(pt.subarray(1, 33)), "auction_id").toBe(bids[i].auction);
      expect.soft(pt.readBigUInt64BE(33).toString(), "price_zats").toBe(bids[i].price);
      expect.soft(String(pt.readUInt32BE(41)), "quantity").toBe(bids[i].quantity);
      expect.soft(hex(pt.subarray(125, 128)), "zero pad").toBe("000000");
    });
  });
  write("tlock/after.txt", after.join("\n") + "\n");

  await run.check("C3", "same envelope length, different nonces", () => {
    expect.soft(envelopes[0].readUInt16BE(5), "ct_len").toBe(envelopes[1].readUInt16BE(5));
    expect.soft(hex(plaintexts[0].subarray(45, 61)), "nonces").not.toBe(hex(plaintexts[1].subarray(45, 61)));
  });
});
