import {runCommand} from '../product';
export const noun='auction',verb='sign',help='benzo auction sign --id ID [--key private.pem]';
export const run=(args:string[])=>runCommand('auction sign',args);
