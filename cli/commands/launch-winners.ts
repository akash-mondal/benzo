export const noun='launch',verb='winners',help='benzo launch winners --id ID — launch, after opening: the winning leaves and their lots (before delivery records and the clear)';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('launch winners',args)};
