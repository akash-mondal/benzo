import {runCommand} from '../product';
export const noun='sign',verb='join',help='benzo sign join --id ID [--batch N --candidate private.pczt --name SIGNER --randomizer HEX --sighash HEX]';
export const run=(args:string[])=>runCommand('sign join',args);
