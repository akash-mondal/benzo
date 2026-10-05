export const noun='launch',verb='deliver',help='benzo launch deliver --id ID < record.json — launch, before the clear: record a winner\'s owner-signed token-chain destinations {leaf_index, destinations, signature}';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('launch deliver',args)};
