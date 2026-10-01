import {runCommand} from '../product';
export const noun='sign',verb='inspect',help='benzo sign inspect --id ID --batch N --candidate private.pczt --name SIGNER [--randomizer HEX --sighash HEX]';
export const run=(args:string[])=>runCommand('sign inspect',args);
