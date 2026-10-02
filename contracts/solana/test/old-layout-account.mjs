#!/usr/bin/env node
// R9 item 1 probe: write the pre-R9 (layout v1) escrow state account and print its address.
// run.sh loads it at genesis with `solana-test-validator --account`, which is the only way to
// hand the program an account layout it did not write (the stand-in for an old-layout account
// left behind by an in-place upgrade — forbidden by R9 item 1 and refused by the recorded
// layout version). Layout v1 is 235 bytes; this account is 236 bytes but RECORDS layout
// version 1 at byte 235, so the program must refuse it with BadLayout (0x14) and never
// interpret any field. The auction id is the fixed sha256("benzo-escrow-layout-v1-probe") —
// driver.mjs derives the same value.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

const programId = new PublicKey(process.argv[2]);
const out = process.argv[3];
if (!process.argv[2] || !process.argv[3]) {
  console.error("usage: old-layout-account.mjs <program-id> <out.json>");
  process.exit(1);
}
const auctionId = createHash("sha256").update("benzo-escrow-layout-v1-probe").digest();
const [pda, bump] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), auctionId], programId);

const data = Buffer.alloc(236);
data[0] = 1; // format-version byte
data[1] = bump;
auctionId.copy(data, 3);
data[235] = 1; // layout v1 recorded — the wrong version for this program (v2)

writeFileSync(out, JSON.stringify({
  pubkey: pda.toBase58(),
  account: {
    lamports: 10_000_000,
    data: [data.toString("base64"), "base64"],
    owner: programId.toBase58(),
    executable: false,
    rentEpoch: 0,
    space: 236,
  },
}, null, 2) + "\n");
console.log(pda.toBase58());
