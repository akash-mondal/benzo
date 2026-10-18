export const noun='auction',verb='create',help='benzo auction create --file unsigned-manifest.json [--witness-set FILE] [--config PRIVATE-OPERATOR.json]';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('auction create',args)};
