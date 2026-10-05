export const noun='sign',verb='join',help='benzo sign join --id ID --name SIGNER --sighash HEX [--count N] [--server HOST:PORT] (signer host) | --id ID --batch N --candidate private.pczt --name SIGNER --randomizer HEX --sighash HEX';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('sign join',args)};
