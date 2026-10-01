export const noun='freeze',verb='',help='benzo freeze --id ID';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('freeze',args)};
