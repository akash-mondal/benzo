import {runCommand} from '../product';
export const noun='auction',verb='create',help='benzo auction create --file unsigned-manifest.json';
export const run=(args:string[])=>runCommand('auction create',args);
