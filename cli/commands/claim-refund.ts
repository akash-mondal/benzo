// benzo claim-refund — R7 item 4 (Reviewer R F-5 = Reviewer G G5): the bid's one-time owner key signs a
// request naming a shielded destination, and the signers check it against the owner key inside their own
// fresh opening before the exception-queue refund is paid. Bidder side builds and signs the request;
// operator side records it (first claim per party wins) and settles what it promotes.
export const noun='claim-refund',verb='',help='benzo claim-refund --id ID --party leaf:N|deposit:TXID:POOL:INDEX|balance-late:TXID:POOL:INDEX|balance-excess:LEAF --destination SHIELDED_UA --owner-key-stdin | --id ID --file request.json — build/sign or record+settle an exception-queue refund claim';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('claim-refund',args)};
