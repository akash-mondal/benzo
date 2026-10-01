export const noun='bid',verb='prepare',help='benzo bid prepare --manifest manifest.json --signer HEX';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('bid prepare',args)};
