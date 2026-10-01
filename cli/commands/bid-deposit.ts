export const noun='bid',verb='deposit',help='benzo bid deposit --id ID --file deposit.json [--pay]';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('bid deposit',args)};
