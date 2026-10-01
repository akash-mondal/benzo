export const noun='auction',verb='publish',help='benzo auction publish --id ID --dir public-dir --config private-operator.json';
export const run=async(args:string[])=>{const {runCommand}=await import('../product');return runCommand('auction publish',args)};
