import type {DomainRecovery} from '../browser/domain-document';
import {captureDevicePreferences,cachedDevicePreferences,editDevicePreferences,initializeDevicePreferences} from '../browser/device-preferences';
import {Capacitor} from '@capacitor/core';
import {browserLocalAgentEnabled,saveNativeGoogleAgentAccess} from './local-agent';

/** Owner switches for agent writes through Google. Off never disconnects or revokes Google; reads keep working. */
export type GoogleAgentAccess={gmailChanges:boolean;calendarEdits:boolean};
/** Development host route that hands the switches to the private Google tool host (scripts/local-agent-dev-bridge.ts). */
export const GOOGLE_AGENT_ACCESS_PATH='/__alpha-agent-google-access';
export function googleAgentAccess():GoogleAgentAccess{
 const saved=cachedDevicePreferences();
 return {gmailChanges:saved?.agentGmailChanges!==false,calendarEdits:saved?.agentCalendarEdits!==false};
}
/** UI intent capture only. The phone's Google host reads the file publishGoogleAgentAccess writes, and treats a missing one as off. */
export async function captureGoogleCalendarAccess(){
 try{const {state,receipt}=await captureDevicePreferences();return{calendarEdits:state.agentCalendarEdits,receipt};}catch{return undefined;}
}
/** Hands the saved switches to the agent's Google host. On the phone a failed save throws, so Settings never shows a state the host does not enforce. */
export async function publishGoogleAgentAccess(){
 const native=Capacitor.isNativePlatform();
 if(!native&&!browserLocalAgentEnabled)return;
 // Before the saved settings load, the default (on) must not overwrite a saved off on the host.
 // Loading them fires alpha:device-settings, which publishes again.
 initializeDevicePreferences();if(!cachedDevicePreferences())return;
 if(native){await saveNativeGoogleAgentAccess(googleAgentAccess());return;}
 await fetch(GOOGLE_AGENT_ACCESS_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(googleAgentAccess())}).catch(()=>{});
}
export async function setGoogleAgentAccess(change:Partial<GoogleAgentAccess>,guard?:{current():boolean;expectedCalendarEdits:boolean;receipt:DomainRecovery}){
 await editDevicePreferences(state=>{
  // Rechecked inside the canonical edit, including every document conflict retry.
  if(guard&&(!guard.current()||state.agentCalendarEdits!==guard.expectedCalendarEdits))throw Error('Calendar choice changed. Review it again.');
  if(change.gmailChanges!==undefined)state.agentGmailChanges=change.gmailChanges;
  if(change.calendarEdits!==undefined)state.agentCalendarEdits=change.calendarEdits;
 },undefined,guard?.receipt);
 await publishGoogleAgentAccess();
}
