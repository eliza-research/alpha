import {cachedDevicePreferences,editDevicePreferences,initializeDevicePreferences,readDevicePreferences} from '../browser/device-preferences';
import {browserLocalAgentEnabled} from './local-agent';

/** Owner switches for agent writes through Google. Off never disconnects or revokes Google; reads keep working. */
export type GoogleAgentAccess={gmailChanges:boolean;calendarEdits:boolean};
/** Development host route that hands the switches to the private Google tool host (scripts/local-agent-dev-bridge.ts). */
export const GOOGLE_AGENT_ACCESS_PATH='/__alpha-agent-google-access';
export function googleAgentAccess():GoogleAgentAccess{
 const saved=cachedDevicePreferences();
 return {gmailChanges:saved?.agentGmailChanges!==false,calendarEdits:saved?.agentCalendarEdits!==false};
}
/** The saved Calendar edits switch, read fresh from the device document: undefined when it cannot be read, never on. */
export async function savedGoogleCalendarEdits():Promise<boolean|undefined>{
 try{return (await readDevicePreferences()).agentCalendarEdits;}catch{return undefined;}
}
export async function publishGoogleAgentAccess(){
 if(!browserLocalAgentEnabled)return;
 // Before the saved settings load, the default (on) must not overwrite a saved off on the host.
 // Loading them fires alpha:device-settings, which publishes again.
 initializeDevicePreferences();if(!cachedDevicePreferences())return;
 await fetch(GOOGLE_AGENT_ACCESS_PATH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(googleAgentAccess())}).catch(()=>{});
}
export async function setGoogleAgentAccess(change:Partial<GoogleAgentAccess>){
 await editDevicePreferences(state=>{
  if(change.gmailChanges!==undefined)state.agentGmailChanges=change.gmailChanges;
  if(change.calendarEdits!==undefined)state.agentCalendarEdits=change.calendarEdits;
 });
 await publishGoogleAgentAccess();
}
