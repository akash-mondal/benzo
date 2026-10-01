import {runCommand} from '../product';
export const noun='bid',verb='prepare',help='benzo bid prepare --manifest manifest.json --signer HEX';
export const run=(args:string[])=>runCommand('bid prepare',args);
