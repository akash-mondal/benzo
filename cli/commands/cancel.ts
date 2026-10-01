export const noun='cancel',verb='',help='benzo cancel --id ID';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('cancel',args)};
