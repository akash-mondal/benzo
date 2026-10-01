import {runCommand} from '../product';
export const noun='bid',verb='seal',help='benzo bid seal --manifest manifest.json --signer HEX --file private-bid.json';
export const run=(args:string[])=>runCommand('bid seal',args);
