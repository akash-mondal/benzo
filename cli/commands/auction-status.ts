import {runCommand} from '../product';
export const noun='auction',verb='status',help='benzo auction status --id ID';
export const run=(args:string[])=>runCommand('auction status',args);
