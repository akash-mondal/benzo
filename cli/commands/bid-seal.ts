export const noun='bid',verb='seal',help='benzo bid seal --manifest manifest.json --signer HEX --file private-bid.json';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('bid seal',args)};
