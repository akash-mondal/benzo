#!/usr/bin/env node
/**
 * ITEM D — send-by-@handle.
 *
 * Bob registers `@bob` → his public payment address in the on-chain registry.
 * Alice resolves `@bob` and sends to it; the funds land in Bob's shielded
 * balance. Shows the registration tx, the send tx, and Bob's balance change.
 */

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stroopsToUsdc } from "@benzo/sdk";
import { makeFacade, explorer } from "./setup.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
mkdirSync(`${repo}/tests/wallets`, { recursive: true });
const USDC = (n) => BigInt(Math.round(n * 1e7));

// Alice (funded public edge) + Bob (fresh).
const { client: alice } = makeFacade();
const { client: bob } = makeFacade();
alice.createAccount("alice", process.env.DEPLOYER_SECRET);
const bobAcct = bob.createAccount("bob");

// A unique handle per run (so re-runs don't collide on the registry).
const handle = `@bob-${Date.now().toString(36)}`;
console.log("=== ITEM D: send-by-@handle ===\n");

// Alice must hold a shielded note to send. Shield 2.5 USDC first.
console.log("[setup] Alice shields 2.5 USDC to fund the send");
const sh = await alice.shield({
  amount: USDC(2.5),
  fromAddress: alice.account.stellarAddress,
  fromSource: "benzo-deployer",
});
console.log(`        shield tx ${sh.txHash}`);

// Bob registers his handle (owner = the deployer that pays gas for him).
console.log(`\n[register] Bob registers ${handle} -> his public payment address`);
const reg = await bob.registerHandle({
  handle,
  ownerAddress: process.env.DEPLOYER_PUBLIC,
  ownerSource: "benzo-deployer",
});
console.log(`        registration tx ${reg.txHash}\n        ${explorer(reg.txHash)}`);

// Alice resolves the handle and sends to it.
console.log(`\n[resolve] Alice resolves ${handle}`);
const resolved = await alice.resolveHandle(handle);
console.log(`        resolved spendPub=${resolved.spendPub.toString().slice(0, 16)}…  (== Bob's: ${resolved.spendPub === bobAcct.spendPub})`);

console.log(`\n[send] Alice -> ${handle}, 1.0 USDC`);
const handleSend = await alice.sendToHandle({ handle, amount: USDC(1.0), memo: "via handle" });
const sent = await handleSend.settled();
console.log(`        send tx ${sent.txHash}\n        ${explorer(sent.txHash)}`);

// Bob sees the funds.
await bob.sync();
const bobBal = await bob.getBalance();
console.log(`\n[balance] bob spendable = ${stroopsToUsdc(bobBal)} USDC (arrived via @handle)`);

console.log("\n=== D SUMMARY ===");
console.log(
  JSON.stringify(
    {
      handle,
      registrationTx: reg.txHash,
      sendTx: sent.txHash,
      resolvedMatchesBob: resolved.spendPub === bobAcct.spendPub,
      bobBalanceUsdc: stroopsToUsdc(bobBal),
    },
    null,
    2,
  ),
);
process.exit(bobBal >= USDC(1.0) ? 0 : 1);
