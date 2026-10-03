// benzo sign envelope-opens — R10 item 4: the signer's own envelope-opening report, written before any
// batch is planned. One entry per refund row the signer can resolve from an envelope: {leaf, party, ok,
// dest_sha256} — the destination itself never appears. A row's refund is payable only when at least two
// signers report ok with the same dest_sha256 (settle/plan.ts); R12 item 3: an envelope this signer cannot
// open is reported ok:false and the report never throws.
export const noun='sign',verb='envelope-opens',help='benzo sign envelope-opens --id ID --name SIGNER --witness-key FILE — write and sign (with the signer\'s own witness key, pinned witness set) the signer\'s envelope-opening report (per-row ok flag and destination hash, never the destination) before any batch is planned';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('sign envelope-opens',args)};
