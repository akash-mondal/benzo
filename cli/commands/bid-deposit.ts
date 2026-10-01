import {runCommand} from '../product';
export const noun='bid',verb='deposit',help='benzo bid deposit --id ID --file deposit.json [--pay]';
export const run=(args:string[])=>runCommand('bid deposit',args);
