#!/usr/bin/env node
// Token-2022 Confidential Transfer — a STANDALONE capability demo on Solana devnet (R25 F6: NOT an
// escrow delivery — the Solana escrow pays native SOL only, so `deliver.kind = "ct"` is exception-
// queued at attest; confidential SPL delivery needs escrow token support, future work). One live
// demonstration (PHASE-5 R19 deliver.kind = "ct"): a FRESH token account configured from the bidder's
// `deliver.elgamal`, funded with a confidential transfer whose amount is hidden on chain, then the
// bidder (account owner) applies the pending balance and withdraws — full control proven.
//
// The Token-2022 machinery is driven through the official `spl-token` CLI (spl-token-cli 5.6.1,
// the token-2022 repo's own client); `crosschain/ct.ts` holds the checks no tool performs: the
// deliver ↔ account-configuration binding and the amount-hidden assertion over the raw transaction.
// The deliver rides the shipped envelope payload v2 (deliver.kind = "ct").
//
// Keys: the devnet deployer (.benzo/solana/deployer.json) is the delivery crank; the winner wallet
// and the account keypairs are fresh files under $BNZ_STATE_DIR/ct-live/. Key files are referenced
// by path only and never printed.
// Output: `PASS ct-<id>` / `ERROR ct-<id> <reason>` lines; exit 0 only if all PASS.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const REPO = process.env.BNZ_REPO_ROOT ?? process.cwd();
const STATE = process.env.BNZ_STATE_DIR ?? path.join(REPO, ".benzo");
const KEYDIR = path.join(STATE, "ct-live");
const WORK = path.join(REPO, "tmp/ct-live");
const RPC = process.argv[2] || "https://api.devnet.solana.com";
const SPL = process.env.BNZ_SPL_TOKEN ?? "spl-token";
const SOL = process.env.BNZ_SOLANA ?? "solana";
const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const UA = "utest1redacted";
const LOT = 100n; // the standard lot in whole tokens (decimals 0)

mkdirSync(KEYDIR, { recursive: true, mode: 0o700 });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

let failures = 0;
const pass = (id, note = "") => console.log(`PASS ${id}${note ? " " + note : ""}`);
const fail = (id, reason) => { failures++; console.log(`ERROR ${id} ${reason}`); };
const check = (id, cond, reason) => (cond ? pass(id, reason) : fail(id, reason));

function run(cmd, args, opts = {}) {
  const out = execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: 300000, ...opts });
  return out;
}
function spl(args, configFile) {
  return run(SPL, [...args, "-C", configFile, "-u", RPC]);
}
function keygenNew(file) {
  run(SOL + "-keygen", ["new", "--no-bip39-passphrase", "-s", "--force", "-o", file], { stdio: ["ignore", "ignore", "ignore"] });
}
function writeConfig(name, keypairPath) {
  const p = path.join(KEYDIR, name);
  writeFileSync(p, JSON.stringify({
    json_rpc_url: RPC, websocket_url: "", keypair_path: keypairPath, address_labels: {}, commitment: "confirmed",
  }, null, 2) + "\n", { mode: 0o600 });
  return p;
}
const sigOf = (out) => {
  const m = /Signature:\s*([1-9A-HJ-NP-Za-km-z]{32,})/.exec(out);
  return m ? m[1] : "";
};
const elgamalOfDisplay = (out) => {
  const m = /Encryption key:\s*([+A-Za-z0-9/]{20,}={0,2})/.exec(out);
  return m ? Buffer.from(m[1], "base64").toString("hex") : "";
};

async function main() {
  console.log(`live rpc ${RPC}`);
  // the shipped modules under test, bundled from this working tree
  writeFileSync(path.join(WORK, "entry.mjs"), [
    'export * as ct from "../../crosschain/ct";',
    'export * as del from "../../envelope/deliver";',
    'export * as envmod from "../../envelope/index";',
    "",
  ].join("\n"));
  execFileSync(path.join(REPO, "node_modules/.bin/esbuild"), [
    path.join(WORK, "entry.mjs"), "--bundle", "--platform=node", "--format=esm",
    "--banner:js=import { createRequire } from \"module\"; const require = createRequire(import.meta.url);",
    "--outfile=" + path.join(WORK, "lib.mjs"), "--log-level=warning",
  ], { cwd: REPO });
  const { ct, del, envmod } = await import(pathToFileURL(path.join(WORK, "lib.mjs")).href);

  // ---- keys: the crank is the devnet deployer; the winner and account keypairs are fresh ----
  const deployerPath = path.join(STATE, "solana", "deployer.json");
  const crankCfg = writeConfig("crank-config.json", deployerPath);
  const winnerPath = path.join(KEYDIR, "winner.json");
  keygenNew(winnerPath);
  const winnerCfg = writeConfig("winner-config.json", winnerPath);
  const mintPath = path.join(KEYDIR, "mint.json");
  keygenNew(mintPath);
  const srcPath = path.join(KEYDIR, "source.json");
  keygenNew(srcPath);
  const freshPath = path.join(KEYDIR, "fresh.json");
  keygenNew(freshPath);
  const scratchPath = path.join(KEYDIR, "scratch.json");
  keygenNew(scratchPath);
  const crankAddr = run(SOL + "-keygen", ["pubkey", deployerPath]).trim();
  const winnerAddr = run(SOL + "-keygen", ["pubkey", winnerPath]).trim();
  console.log(`live crank ${crankAddr}`);
  console.log(`live winner ${winnerAddr}`);

  // the winner needs fee money (its own apply/withdraw transactions — the delivery stipend idea)
  const fundOut = run(SOL, ["transfer", winnerAddr, "0.05", "--allow-unfunded-recipient", "--keypair", deployerPath, "-u", RPC]);
  check("ct-winner-funded", sigOf(fundOut).length > 30, `winner gas tx ${sigOf(fundOut)}`);

  // ---- mint with confidential transfers auto-approved + the crank's source account ----
  const mintOut = spl(["--program-id", TOKEN2022, "create-token", mintPath, "--decimals", "0", "--enable-confidential-transfers", "auto"], crankCfg);
  const mint = run(SOL + "-keygen", ["pubkey", mintPath]).trim();
  check("ct-mint-created", sigOf(mintOut).length > 30, `mint ${mint} tx ${sigOf(mintOut)}`);
  spl(["create-account", mint, srcPath], crankCfg);
  spl(["configure-confidential-transfer-account", "--address", run(SOL + "-keygen", ["pubkey", srcPath]).trim()], crankCfg);
  spl(["mint", mint, String(LOT), srcPath], crankCfg);
  spl(["deposit-confidential-tokens", mint, String(LOT), "--address", run(SOL + "-keygen", ["pubkey", srcPath]).trim()], crankCfg);
  spl(["apply-pending-balance", "--address", run(SOL + "-keygen", ["pubkey", srcPath]).trim()], crankCfg);
  const srcDisplay = spl(["display", run(SOL + "-keygen", ["pubkey", srcPath]).trim()], crankCfg);
  check("ct-source-funded-confidential", /Encryption key:/.test(srcDisplay), "source holds the lot as available confidential balance");

  // ---- the bidder's FRESH account, configured from its own ElGamal key ----
  const fresh = run(SOL + "-keygen", ["pubkey", freshPath]).trim();
  spl(["create-account", mint, freshPath], winnerCfg);
  spl(["configure-confidential-transfer-account", "--address", fresh], winnerCfg);
  const freshDisplay = spl(["display", fresh], winnerCfg);
  const configuredHex = elgamalOfDisplay(freshDisplay);
  check("ct-fresh-account-configured", /^[0-9a-f]{64}$/.test(configuredHex), `fresh account ${fresh} elgamal ${configuredHex.slice(0, 16)}…`);

  // ---- the sealed deliver (R19 payload v2) carries exactly that configuration ----
  // (no salt here: the sealer generates the mandatory salt inside the sealed envelope, R25 item 1)
  const deliver = { chain: "solana", kind: "ct", to: fresh, elgamal: configuredHex };
  const keys = [envmod.generateEnvelopeKey(), envmod.generateEnvelopeKey(), envmod.generateEnvelopeKey()];
  const envCt = envmod.sealEnvelopePayload({ refund: UA, deliver }, keys.map((k) => k.public_hex));
  const opened = keys.map((k) => envmod.openEnvelopePayload(envCt, k.private_hex));
  opened.forEach((o) => del.requireDeliver(o.deliver)); // the sealed deliver carries the mandatory salt
  check("ct-envelope-deliver-roundtrip",
    opened.every((o) => o.refund === UA && o.deliver?.kind === "ct" && o.deliver?.to === fresh && o.deliver?.elgamal === configuredHex),
    `deliver ${JSON.stringify(deliver)}`);

  // ---- the delivery: verify the account is configured from deliver.elgamal, then transfer hidden ----
  const doctored = { ...deliver, elgamal: randomBytes(32).toString("hex") };
  check("ct-deliver-elgamal-matches",
    !ct.deliverMatchesAccount(doctored, { address: fresh, elgamalHex: configuredHex }) &&
      ct.deliverMatchesAccount(deliver, { address: fresh, elgamalHex: configuredHex }),
    `a doctored deliver.elgamal is refused; ${deliver.elgamal.slice(0, 16)}… matches the account`);
  // negative probe for the amount-hidden assertion: a PUBLIC mint of a sentinel leaks the amount
  {
    const sentinel = 77n;
    spl(["create-account", mint, scratchPath], crankCfg);
    const probeSig = sigOf(spl(["mint", mint, String(sentinel), scratchPath], crankCfg));
    const raw = await fetchRawTx(probeSig);
    check("ct-amount-hidden-probe", ct.amountLeaks(raw, sentinel) !== null, `public mint ${probeSig} leaks the sentinel (assertion works)`);
  }
  const deliverOut = spl(["transfer", mint, String(LOT), fresh, "--from", run(SOL + "-keygen", ["pubkey", srcPath]).trim(), "--confidential"], crankCfg);
  const deliverSig = sigOf(deliverOut);
  const deliverRaw = await fetchRawTx(deliverSig);
  check("ct-delivery-tx", deliverSig.length > 30, `confidential transfer tx ${deliverSig}`);
  check("ct-amount-hidden", ct.amountLeaks(deliverRaw, LOT) === null, `the delivered amount appears nowhere in tx ${deliverSig}`);
  const freshAfter = spl(["display", fresh], winnerCfg);
  const pendingLow = /Pending Balance Low:\s*(\S+)/.exec(freshAfter)?.[1] ?? "";
  const zeroCt = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  check("ct-pending-encrypted", pendingLow.length > 20 && pendingLow !== zeroCt,
    `the fresh account's pending balance is a non-zero ciphertext ${pendingLow.slice(0, 16)}… (amount hidden)`);

  // ---- the bidder applies and withdraws: full control of the delivered lot ----
  spl(["apply-pending-balance", "--address", fresh], winnerCfg);
  const withdrawOut = spl(["withdraw-confidential-tokens", mint, String(LOT), "--address", fresh], winnerCfg);
  check("ct-winner-withdraws", sigOf(withdrawOut).length > 30, `withdraw tx ${sigOf(withdrawOut)}`);
  const bal = Number(spl(["balance", "--address", fresh], winnerCfg).trim());
  check("ct-winner-balance", bal === Number(LOT), `winner plaintext balance ${bal} (want ${LOT})`);

  console.log(failures === 0
    ? "RESULT PASS one live Token-2022 Confidential Transfer delivery (deliver.kind=ct) on Solana devnet"
    : `RESULT FAIL ${failures} ct assertion(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function fetchRawTx(sig) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "base64", maxSupportedTransactionVersion: 0 }] }),
      });
      const j = await res.json();
      if (!j.result) throw new Error(`getTransaction ${sig}: ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
      return Buffer.from(j.result.transaction[0], "base64");
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exitCode = 1;
});
