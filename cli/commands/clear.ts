export const noun='clear',verb='',help='benzo clear --id ID';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('clear',args)};
