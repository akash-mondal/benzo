#!/usr/bin/env node
/**
 * ADVERSARIAL claim-link audit (small amount to fit deployer USDC balance).
 *
 * Proves with on-chain evidence:
 *  1) a fresh account holding ONLY the link secret can claim;
 *  2) the spend is a real on-chain NULLIFIER: is_spent goes false -> true;
 *  3) a second claim with the SAME secret is rejected;
 *  4) an attacker WITHOUT the secret cannot derive/claim the note.
 */

import {
  BenzoClient, StellarCli, configFromEnv,
  accountFromClaimSecret, noteNullifier,
} from "@benzo/core";
import {
  Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder,
} from "@stellar/stellar-sdk";
import { makeFacade, explorer, usdcBalance, loadDeployment } from "./setup.mjs";

const USDC = (n) => BigInt(Math.round(n * 1e7));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;

async function freshAccount() {
  const horizon = new Horizon.Server(process.env.HORIZON_URL);
  const kp = Keypair.random();
  await fetch(`${process.env.FRIENDBOT_URL}?addr=${kp.publicKey()}`);
  await sleep(2500);
  const acct = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: "10000", networkPassphrase: PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(process.env.USDC_CODE, process.env.USDC_ISSUER) }))
    .setTimeout(60).build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
  return kp;
}

const dep = loadDeployment();
const cli = new StellarCli(configFromEnv());
const isSpentOnChain = async (n) =>
  String(await cli.view(dep.nullifierSet, "benzo-deployer", ["is_spent", "--nullifier", n.toString()]));

const AMT = USDC(0.3);

console.log("=== ADVERSARIAL claim-link audit ===\n");
const { client: alice } = makeFacade();
alice.createAccount("alice", process.env.DEPLOYER_SECRET);
console.log("[setup] Alice shields 0.5 USDC");
await alice.shield({ amount: USDC(0.5), fromAddress: alice.account.stellarAddress, fromSource: "benzo-deployer" });

console.log(`[create] claim link for ${Number(AMT) / 1e7} USDC`);
const { link } = await alice.createClaimLink({ amount: AMT });
console.log(`        LINK: ${link}`);
const secret = BenzoClient.parseClaimLink(link);

// Independently derive the claim account + the funded note's nullifier.
const claimAcct = accountFromClaimSecret(secret);
const probe = makeFacade().client;
probe.useAccount(claimAcct);
await probe.sync();
const notes = probe.spendableNotes();
if (notes.length !== 1) throw new Error(`expected 1 claimable note, got ${notes.length}`);
const NULL = noteNullifier(claimAcct.spendSk, BigInt(notes[0].leafIndex));
console.log(`\n[derive] claim note leafIndex=${notes[0].leafIndex} amount=${notes[0].note.amount}`);
console.log(`         nullifier=${NULL}`);
const spentBefore = await isSpentOnChain(NULL);
console.log(`[onchain] is_spent BEFORE claim = ${spentBefore}`);

// (4) attacker WITHOUT the secret
console.log("\n[attack-no-secret] wrong secret -> cannot derive the note");
let noSecretBlocked = false, noSecretMsg = "";
try {
  const c = makeFacade().client;
  const kp0 = await freshAccount();
  await c.claim({ claimSecret: new Uint8Array(32).fill(7), toAddress: kp0.publicKey() });
} catch (e) { noSecretBlocked = true; noSecretMsg = e.message; }
console.log(`        blocked=${noSecretBlocked} (${noSecretMsg})`);

// (1) legit claim
console.log("\n[claim] fresh account claims with the secret");
const claimantKp = await freshAccount();
const claimantAddr = claimantKp.publicKey();
const before = await usdcBalance(claimantAddr);
const claimant = makeFacade().client;
const claimed = await claimant.claim({ claimSecret: secret, toAddress: claimantAddr });
const after = await usdcBalance(claimantAddr);
console.log(`        claim tx ${claimed.txHash}  ${explorer(claimed.txHash)}`);
console.log(`        USDC ${before} -> ${after}`);

const spentAfter = await isSpentOnChain(NULL);
console.log(`[onchain] is_spent AFTER claim = ${spentAfter}`);

// (3) double-claim
console.log("\n[double-claim] same secret again");
let doubleBlocked = false, doubleMsg = "";
try {
  await makeFacade().client.claim({ claimSecret: secret, toAddress: claimantAddr });
} catch (e) { doubleBlocked = true; doubleMsg = e.message; }
console.log(`        blocked=${doubleBlocked} (${doubleMsg})`);

console.log("\n=== AUDIT SUMMARY ===");
console.log(JSON.stringify({
  claimTx: claimed.txHash,
  claimedUsdc: (Number(claimed.amount) / 1e7).toFixed(7),
  claimantBefore: before, claimantAfter: after,
  nullifier: NULL.toString(),
  isSpentBeforeClaim: spentBefore,
  isSpentAfterClaim: spentAfter,
  attackerWithoutSecretBlocked: noSecretBlocked,
  doubleClaimBlocked: doubleBlocked,
}, null, 2));
