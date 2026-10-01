export const noun='open',verb='',help='benzo open --id ID';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('open',args)};
