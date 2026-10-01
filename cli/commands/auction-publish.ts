import {runCommand} from '../product';
export const noun='auction',verb='publish',help='benzo auction publish --id ID --dir public-dir --config private-operator.json';
export const run=(args:string[])=>runCommand('auction publish',args);
