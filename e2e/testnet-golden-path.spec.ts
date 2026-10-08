// Test 2: the testnet golden path (docs/PHASE-1.md section 5, steps 6-10): two sealed bids paid at fixed C to per-bid
// vault addresses, scanned with the vault's viewing key, and refunded by a 2-of-3 FROST spend (gates A, B and D).
// 1. Protects DESIGN §4 steps 4 and 6 (the sealed bytes ride in the memo unchanged; every deposit is exactly C to its
//    own diversified address), DESIGN §6 (2-of-3 FROST custody spends received Ironwood notes) and threats 001, 013,
//    036 and 057.
// 2. Fails on: a memo trimmed or re-encoded anywhere between the page and the scanner, the scanner reporting the wrong
//    receiving address, a deposit that is not exactly C, a FROST signature over the wrong sighash or randomizer, or a
//    refund that does not return the vault's notes to the bidder.
// 3. Test 1 stops at `tle`; no other test pays, scans or signs on the chain.
// 4. No production seam: it drives the built sealer page, zcash-devtool, frostd, frost-client, zcash-sign and the
//    scanner, and checks their results against both lightwalletd endpoints.
import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { bin, DRAND, env, LWD, LWD_ALT, ROOT, STATE } from "./lib/env";
import { pinsMismatch } from "./lib/pins";
import { startFrostd, zcashSign, type Session } from "./lib/frost";
import { Run, waitFor, write } from "./lib/run";
import { sealBid, serveSealer } from "./lib/sealer";
import * as z from "./lib/zcash";

const IDS = ["B1", "D1", "D2", "D3", "A1", "A2", "A3", "A4", "A5"];
const C = Number(env("BNZ_COLLATERAL_ZATS"));
const ALT = LWD_ALT;
const MINE = 30 * 60_000; // each deposit and the refund is mined within 30 minutes of broadcast
const sha256 = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const minedHeight = (txid: string) => () => z.minedHeight(txid);


test("golden path on testnet", async ({ page }) => {
  test.setTimeout(75 * 60_000);
  const run = new Run("testnet-golden-path");

  const pinned = pinsMismatch();
  if (pinned) run.notRun(IDS, `pinned binaries do not match tools/pins.env: ${pinned}`);
  const answers = await fetch(`${DRAND}/info`).then((r) => r.ok).catch(() => false);
  if (!answers) run.notRun(IDS, `drand ${DRAND}/info did not answer`);
  for (const endpoint of LWD) {
    try {
      z.tip(endpoint);
    } catch (e) {
      run.notRun(IDS, `${endpoint} did not answer: ${(e as Error).message}`);
    }
  }
  const missing = ["vault/data.sqlite", "frost/alice.toml", "frost/bob.toml", "frost/carol.toml"].filter((f) => !existsSync(path.join(STATE, f)));
  if (missing.length) run.notRun(IDS, `missing in ${STATE}: ${missing.join(", ")}`);
  z.sync("bidder");
  const startBalance = z.spendable(z.balance("bidder"));
  if (startBalance < 2 * C + 30_000) run.notRun(IDS, `bidder spendable ${startBalance} zats < 2C + 30000 = ${2 * C + 30_000}`);

  const stopFrostd = await startFrostd();
  try {
    // 6. Seal two bids to two fresh vault addresses, recorded before paying.
    const addresses = [z.generateAddress("vault"), z.generateAddress("vault")];
    write("scan/addresses.json", JSON.stringify(addresses.map((address, i) => ({ bid: i + 1, address })), null, 1) + "\n");
    const server = await serveSealer();
    await page.goto(server.url);
    const T = Math.ceil(Date.now() / 1000) + 30 * 60;
    const auction = randomBytes(32).toString("hex");
    const sealed: Awaited<ReturnType<typeof sealBid>>[] = [];
    for (const address of addresses)
      sealed.push(
        await sealBid(page, {
          opening: new Date(T * 1000).toISOString().replace(".000Z", "Z"),
          auction,
          price: randomBytes(8).readBigUInt64BE().toString(),
          quantity: String(randomBytes(4).readUInt32BE()),
          collateral: String(C),
          address,
        }),
      );
    server.close();
    for (const s of sealed) if (!s.envelope) throw new Error(`sealer produced no envelope: ${s.error}`);
    sealed.forEach((s, i) => write(`memo/bid${i + 1}.sent.hex`, s.envelope + "\n"));

    // 7. Pay each bid's ZIP-321 URI from the bidder wallet.
    const tx1 = z.pay(sealed[0].uri);
    const sent1 = Date.now();
    z.sync("bidder");
    if (z.spendable(z.balance("bidder")) < C + 15_000) {
      const h = await waitFor({ height: 1, tip: minedHeight(tx1) }, sent1 + MINE);
      await waitFor({ height: h + 2, tip: () => { z.sync("bidder"); return z.balance("bidder").chain_tip_height; } }, sent1 + MINE + 10 * 60_000); // change: 3 confirmations
    }
    const tx2 = z.pay(sealed[1].uri);
    const sent2 = Date.now();
    const deposits = [
      { bid: 1, txid: tx1, height: await waitFor({ height: 1, tip: minedHeight(tx1) }, sent1 + MINE) },
      { bid: 2, txid: tx2, height: await waitFor({ height: 1, tip: minedHeight(tx2) }, sent2 + MINE) },
    ];
    write("memo/deposits.json", JSON.stringify(deposits, null, 1) + "\n");

    // 8. Scan the vault: sync, fetch full transactions, then read received notes.
    // GetTransaction can report a mined height ahead of the endpoint's cached sync tip.
    await waitFor({ height: Math.max(...deposits.map((d) => d.height)), tip: () => { z.sync("vault"); return z.balance("vault").chain_tip_height; } }, sent2 + MINE);
    z.enhance("vault");
    const mine = deposits.map((d) => z.scanVault().filter((l) => l.txid === d.txid));
    write("scan/operator-view.jsonl", mine.flat().map((l) => JSON.stringify(l)).join("\n") + "\n");
    mine.forEach((m, i) => write(`memo/bid${i + 1}.scanned.hex`, (m[0]?.memo_hex ?? "") + "\n"));
    write(
      "memo/sha256sums.txt",
      mine.flatMap((m, i) => [`${sha256(sealed[i].envelope)}  bid${i + 1}.sent`, `${sha256(m[0]?.memo_hex ?? "")}  bid${i + 1}.scanned`]).join("\n") + "\n",
    );

    await run.check("B1", "scanned memo equals the page envelope", () => {
      mine.forEach((m, i) => expect.soft(m[0]?.memo_hex, `bid${i + 1} memo`).toBe(sealed[i].envelope.padEnd(1024, "0")));
    });
    await run.check("D1", "each deposit once, at the address paid for that bid", () => {
      mine.forEach((m, i) => {
        expect.soft(m.length, `bid${i + 1} lines`).toBe(1);
        expect.soft(m[0]?.address, `bid${i + 1} address`).toBe(addresses[i]);
      });
    });
    await run.check("D2", "Ironwood, exactly C", () => {
      mine.forEach((m, i) => {
        expect.soft(m[0]?.pool, `bid${i + 1} pool`).toBe("ironwood");
        expect.soft(m[0]?.value_zats, `bid${i + 1} value`).toBe(C);
      });
    });
    await run.check("D3", "operator view differs only in txid, height, address, index, shuffled action position and ciphertext", () => {
      const [a, b] = mine.map((m) => m[0]);
      const rest = (l: z.ScanLine) => {
        // R50: the Orchard builder shuffles a bundle's actions, so the note's action_index is uniformly random per
        // transaction (like its txid), not a fingerprint; comparing it made D3 pass only when two shuffles agreed.
        const { txid, height, address, diversifier_index, memo_hex, action_index, ...others } = l;
        const len = parseInt(memo_hex.slice(10, 14), 16);
        return { ...others, memo_header: memo_hex.slice(0, 14), memo_tail: memo_hex.slice(14 + 2 * len) };
      };
      expect.soft(rest(a), "fields other than txid, height, address, diversifier index and ciphertext").toEqual(rest(b));
    });

    // 9. FROST refund, in PR #593's order: create-max, prove, zcash-sign with one session per randomizer, send.
    const lastDeposit = Math.max(...deposits.map((d) => d.height));
    await waitFor({ height: lastDeposit + 10, tip: () => z.tip() }, Date.now() + 16 * 150_000); // 16 blocks at twice the 75 s target
    z.sync("vault");
    z.sync("bidder");
    const before = { bidder: z.balance("bidder").total, vault: z.balance("vault").total };
    const refundTo = z.generateAddress("bidder");
    const dir = path.join(STATE, "run", `pczt-${new Date().toISOString().replace(/[:.]/g, "")}`);
    mkdirSync(dir, { recursive: true });
    const [created, proven, signed] = ["created", "proven", "signed"].map((n) => path.join(dir, `${n}.pczt`));
    z.pczt("vault", "create-max", "--address", refundTo, "--output", created);
    const inspectCreated = z.pczt("vault", "inspect", created);
    z.pczt("vault", "prove", created, "--output", proven);
    const signing = await zcashSign(proven, signed);
    const inspectSigned = z.pczt("vault", "inspect", signed);
    write("frost/pczt-inspect.txt", `# pczt inspect created.pczt\n${inspectCreated}\n# pczt inspect signed.pczt\n${inspectSigned}`);
    write(
      "frost/coordinator.txt",
      [`sighash ${signing.sighash}`, ...signing.sessions.map((s: Session, i) => `session ${i}: signers ${s.signers.join(",")} randomizer ${s.randomizer} signature ${s.signature}`)].join("\n") + "\n",
    );
    const sum = (re: RegExp, text: string) => [...text.matchAll(re)].reduce((acc, m) => acc + Number(m[1]), 0);
    const realSpends = [...inspectCreated.matchAll(/^ {2}- Spend: \d+ zatoshis$/gm)].length;
    const fee = sum(/^ {2}- Spend: (\d+) zatoshis$/gm, inspectCreated) - sum(/^ {2}- Output: (\d+) zatoshis/gm, inspectCreated);
    const refundTxid = z.send(signed);
    const sentRefund = Date.now();

    // 10. Settle: the refund is mined and both wallets are synced.
    const heightPrimary = await waitFor({ height: 1, tip: minedHeight(refundTxid) }, sentRefund + MINE);
    if (ALT) await waitFor({ height: heightPrimary, tip: () => z.tip(ALT) }, sentRefund + MINE);
    const heightAlt = ALT ? z.getTransaction(refundTxid, ALT).height : null;
    const raw = z.getTransaction(refundTxid).raw;
    write(
      "frost/refund.json",
      JSON.stringify(
        {
          txid: refundTxid,
          height: { [env("BNZ_LWD_URL")]: heightPrimary, ...(ALT ? { [ALT]: heightAlt } : { second_endpoint: "none (BNZ_LWD_SINGLE=1, R27/R47)" }) },
          header_hex: raw.subarray(0, 4).toString("hex"),
          version_group_id_hex: raw.subarray(4, 8).toString("hex"),
          consensus_branch_id: raw.readUInt32LE(8).toString(16).padStart(8, "0"),
        },
        null,
        1,
      ) + "\n",
    );
    await waitFor({ height: heightPrimary, tip: () => { z.sync("vault"); z.sync("bidder"); return Math.min(z.balance("vault").chain_tip_height, z.balance("bidder").chain_tip_height); } }, sentRefund + MINE);
    z.enhance("vault");
    const after = { bidder: z.balance("bidder").total, vault: z.balance("vault").total };
    const spent = z.scanVault().filter((l) => l.spent_in_txid === refundTxid);
    const depositLines = deposits.map((d) => spent.find((l) => l.txid === d.txid));
    write(
      "frost/settle.json",
      JSON.stringify(
        {
          deposits: deposits.map((d, i) => ({ txid: d.txid, value_zats: depositLines[i]?.value_zats ?? null, spent_in_txid: depositLines[i]?.spent_in_txid ?? null })),
          spent_vault_notes_zats: spent.reduce((acc, l) => acc + l.value_zats, 0),
          fee_zats: fee,
          bidder_total: { before: before.bidder, after: after.bidder },
          vault_total: { before: before.vault, after: after.vault },
        },
        null,
        1,
      ) + "\n",
    );

    await run.check("A1", "refund mined at one height on both endpoints and spends both deposits", () => {
      if (ALT) expect.soft(heightAlt, "height on the second endpoint").toBe(heightPrimary);
      depositLines.forEach((l, i) => expect.soft(l?.spent_in_txid, `deposit ${i + 1} spent in`).toBe(refundTxid));
    });
    if(!ALT)run.narrowed("A1","single lightwalletd endpoint; second-endpoint agreement not checked (BNZ_LWD_SINGLE=1, R27/R47)");
    await run.check("A2", "one 2-participant frostd session per randomizer", () => {
      expect.soft(signing.sessions.length, "sessions vs real spends in the PCZT").toBe(realSpends);
      for (const s of signing.sessions) {
        expect.soft(s.signers.length, "signers per session").toBe(2);
        expect.soft(s.participantsSaw, "message each participant signed").toEqual([signing.sighash, signing.sighash]);
        expect.soft(s.signature, "signature").toMatch(/^[0-9a-f]{128}$/);
      }
      expect.soft(new Set(signing.sessions.map((s) => s.randomizer)).size, "distinct randomizers").toBe(signing.sessions.length);
    });
    await run.check("A3", "byte-reversed sighash is the txid; signatures are in the raw tx", () => {
      expect.soft(Buffer.from(signing.sighash, "hex").reverse().toString("hex"), "reversed sighash").toBe(refundTxid);
      for (const s of signing.sessions) expect.soft(raw.includes(Buffer.from(s.signature, "hex")), `signature ${s.signature.slice(0, 16)}… in raw tx`).toBe(true);
    });
    await run.check("A4", "bidder total rose by the spent vault notes minus the fee", () => {
      expect.soft(after.bidder - before.bidder, "bidder total delta").toBe(spent.reduce((acc, l) => acc + l.value_zats, 0) - fee);
    });
    await run.check("A5", "vault total is 0", () => {
      expect.soft(after.vault, "vault total").toBe(0);
    });
  } finally {
    stopFrostd();
  }
});
