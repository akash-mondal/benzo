export const noun='settle',verb='',help='benzo settle --id ID';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('settle',args)};
