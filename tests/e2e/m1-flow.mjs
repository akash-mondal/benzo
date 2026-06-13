#!/usr/bin/env node
// M1 exit criterion: a USDC dollar is shielded, privately transferred
// note->note, and unshielded by a different key to a different account —
// on Stellar testnet, with every tx hash printed.
import { runPrivatePaymentFlow } from "./flow.mjs";

const r = await runPrivatePaymentFlow();
console.log("\n=== M1 SUMMARY ===");
console.log(
  JSON.stringify(
    { txs: r.txs, timings: r.timings, balances: r.balances },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
process.exit(0);
