export const noun='auction',verb='status',help='benzo auction status --id ID';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('auction status',args)};
