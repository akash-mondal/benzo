export const noun='auction',verb='balance-addresses',help='benzo auction balance-addresses --id ID [--file FILE] — part 2 bond-then-pay, after the clear: publish one fresh vault address per bonded winner ({leaf_index, ua}[])';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('auction balance-addresses',args)};
