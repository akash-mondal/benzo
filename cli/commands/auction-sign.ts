export const noun='auction',verb='sign',help='benzo auction sign --id ID [--key private.pem]';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('auction sign',args)};
