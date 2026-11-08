import {devicePreferencesDocument} from './preference-documents';
import type {DomainRecovery} from './domain-document';

export const initialDevicePreferences=()=>({askBeforeAgentActions:false,agentGmailChanges:true,agentCalendarEdits:true,autoLoadMailImages:true,wifiActive:true,bluetoothActive:false,cellularActive:false,airplaneMode:false,microphoneEnabled:true,locationEnabled:true,doNotDisturb:false,preAirplane:null as null|{wifiActive:boolean;bluetoothActive:boolean;cellularActive:boolean},powerSave:false,batteryPercent:100,charging:true,textScalePercent:100,brightness:100,music:70,ring:70,alarm:70});
export type DevicePreferences=ReturnType<typeof initialDevicePreferences>;
function validate(raw:unknown):DevicePreferences{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Device settings need recovery.');
 const state={...initialDevicePreferences(),...raw};
 for(const key of ['askBeforeAgentActions','agentGmailChanges','agentCalendarEdits','autoLoadMailImages','wifiActive','bluetoothActive','cellularActive','airplaneMode','microphoneEnabled','locationEnabled','doNotDisturb','powerSave','charging'] as const)if(typeof state[key]!=='boolean')throw Error('Device settings need recovery.');
 for(const key of ['batteryPercent','textScalePercent','brightness','music','ring','alarm'] as const)if(!Number.isFinite(state[key])||state[key]<(key==='textScalePercent'?75:0)||state[key]>(key==='textScalePercent'?150:100))throw Error('Device settings need recovery.');
 if(state.preAirplane!==null&&(!state.preAirplane||typeof state.preAirplane!=='object'||Array.isArray(state.preAirplane)||Object.keys(state.preAirplane).some(key=>!['wifiActive','bluetoothActive','cellularActive'].includes(key))||['wifiActive','bluetoothActive','cellularActive'].some(key=>typeof (state.preAirplane as unknown as Record<string,unknown>)[key]!=='boolean')))throw Error('Device settings need recovery.');
 return state;
}
let cached:DevicePreferences|undefined,error:unknown,sequence=0,installed=false;
export const cachedDevicePreferences=()=>cached;
export const devicePreferencesStatus=()=>cached?'ready':error?'unavailable':'loading';
const changed=()=>{window.dispatchEvent(new Event('alpha:device-settings'));window.dispatchEvent(new Event('focus'));};
export async function readDevicePreferences(signal?:AbortSignal){return validate(await devicePreferencesDocument.read(initialDevicePreferences,signal));}
/** Read a choice and its exact canonical revision without initializing or migrating preferences. */
export async function captureDevicePreferences(signal?:AbortSignal){
 const receipt=await devicePreferencesDocument.capture(signal);signal?.throwIfAborted();
 if(receipt.format!=='domain'||receipt.legacyChanged)throw Error('Device settings need recovery.');
 const state=validate(receipt.raw===null?initialDevicePreferences():JSON.parse(receipt.raw));
 return{state,receipt};
}
export async function refreshDevicePreferences(){
 const token=++sequence;
 try{const next=await readDevicePreferences();if(token===sequence){const different=!cached||JSON.stringify(cached)!==JSON.stringify(next);cached=Object.freeze({...next,preAirplane:next.preAirplane?Object.freeze({...next.preAirplane}):null});error=undefined;if(different)changed();}return next;}
 catch(reason){if(token===sequence){const different=!!cached||!error;cached=undefined;error=reason;if(different)changed();}throw reason;}
}
export async function editDevicePreferences<R>(edit:(state:DevicePreferences)=>R|Promise<R>,signal?:AbortSignal,expected?:DomainRecovery):Promise<R>{
 const result=await devicePreferencesDocument.edit(initialDevicePreferences,async state=>{Object.assign(state,validate(state));const result=await edit(state);validate(state);return result;},signal,expected);
 await refreshDevicePreferences();return result;
}
export function initializeDevicePreferences(){
 if(installed)return;installed=true;const refresh=()=>void refreshDevicePreferences().catch(()=>{});
 window.addEventListener('alpha:device-preferences-document-changed',refresh);
 window.addEventListener('alpha:device-roles-document-changed',()=>window.dispatchEvent(new Event('focus')));
 window.addEventListener('storage',event=>{if(event.key===null||event.key==='alpha.browser.device.v1')refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();
}
