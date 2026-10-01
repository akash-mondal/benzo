export const noun='sign',verb='inspect',help='benzo sign inspect --id ID --batch N --candidate private.pczt --name SIGNER [--randomizer HEX --sighash HEX]';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('sign inspect',args)};
