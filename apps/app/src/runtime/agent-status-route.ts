import {Capacitor} from '@capacitor/core';
import {testMocksEnabled} from '../build-flags';
import {connectionController} from './connection-ui';
type Shell = {S():{view?:string|null};openView(view:string,patch?:Record<string,unknown>|null,chat?:unknown,opts?:{push?:boolean}):unknown};
/** Where a tap on an unavailable agent goes. Product Android hides the connection chooser, so it opens
 * Settings > Agent connection (Back returns to the calling view); development and browser builds keep the chooser. */
export function showAgentStatus(shell:Shell|null|undefined){
 if(!shell||!Capacitor.isNativePlatform()||testMocksEnabled){connectionController.open();return;}
 const from=shell.S().view;
 shell.openView('settings',{page:'agent-connection'},undefined,{push:!!from&&from!=='settings'});
}
