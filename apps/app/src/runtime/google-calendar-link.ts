import {calendarSourceKey,type AgentCalendar,type AgentCalendarSyncReview} from './agent-calendar';
import type {CanonicalCalendarSyncSettings} from './calendar-sync-settings';
import type {GmailAccount} from './cloud-protocol';
import type {GoogleAccountsCalendarLifecycle,GoogleAccountsCalendarReview,GoogleDisconnectContext} from './google-accounts';
/** needs-grant: no verified Calendar write grant, so nothing was read or changed. Only synced and syncing are read back.
 * review: the last sync readback with no control write sent after it, kept for the Calendar disconnect lifecycle. */
export type GoogleCalendarLink={outcome:'synced'|'syncing'|'needs-grant'|'not-linked'|'unconfirmed';message:string;review?:AgentCalendarSyncReview};
/** Same reviewed transition, same key: a retry replays its receipt; a newer revision is a new operation. */
async function operationKey(...parts:unknown[]){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts))));
 return 'alpha-calendar-connect:'+Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
}
/** A foreground refresh or another Calendar write holds the control; wait for it instead of failing the link. */
function settled(calendar:AgentCalendar,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  const check=()=>{if(signal.aborted)done(()=>reject(signal.reason));else if(calendar.state.status!=='loading'&&!calendar.state.mutating)done(resolve);};
  const unsubscribe=calendar.subscribe(check),done=(then:()=>void)=>{unsubscribe();signal.removeEventListener('abort',check);then();};
  signal.addEventListener('abort',check);check();
 });
}
/** One Calendar: after Google's grant readback, link the same Eliza Calendar to the owner's unique primary Google
 * calendar through the existing select/resume control (expected revisions, pending dispatch kept for review).
 * Two-way sync, link dedupe and the all-eligible bootstrap on resume stay in the shared Calendar service. */
export async function linkGoogleCalendar(scope:CanonicalCalendarSyncSettings,accounts:readonly GmailAccount[],signal:AbortSignal):Promise<GoogleCalendarLink>{
 const granted=accounts.filter(account=>account.connected&&account.grantedCapabilities.includes('google.calendar.write'));
 if(!granted.length)return{outcome:'needs-grant',message:accounts.some(account=>account.connected&&account.grantedCapabilities.includes('google.calendar.read'))?'Google Calendar access is read only, so Calendar is not synced. Approve Calendar changes for Google to sync; Calendar keeps working in Eliza.':'Google Calendar is not connected. Calendar keeps working in Eliza.'};
 const emails=new Set(granted.map(account=>account.label.toLowerCase()));
 const fence=()=>!signal.aborted&&scope.current()&&scope.canChange();
 const ready=async()=>{await settled(scope.calendar,signal);return fence();};
 // sent: a control write was dispatched, so any later failure is unconfirmed. revision: our last committed transition.
 // latest: the last readback with no write sent after it.
 let sent=false,revision:number|undefined,latest:AgentCalendarSyncReview|undefined;
 const result=(outcome:GoogleCalendarLink['outcome'],message:string):GoogleCalendarLink=>latest?{outcome,message,review:latest}:{outcome,message};
 const stopped=()=>result('not-linked',signal.aborted||!scope.current()?'Calendar sync was not finished. Calendar keeps working in Eliza.':'Finish or close the Calendar draft, then connect Google Calendar again.');
 const unconfirmed=(reason='')=>result('unconfirmed',`${reason}Calendar sync was not confirmed; check it before another change.`);
 try{
  // Review, select the primary, review, resume, review: Synced is the last readback, never the last request.
  for(let step=0;step<3;step++){
   if(!await ready())return stopped();
   if(!['ready','partial','unavailable'].includes(scope.calendar.state.status))return sent?unconfirmed():result('not-linked','Waiting for Calendar. Nothing was sent; connect Google Calendar again when Calendar is ready.');
   const review=latest=await scope.calendar.reviewSync(),control=review.control,owner=scope.calendar.state.ownerKey;
   if(revision!==undefined&&control.revision!==revision)return result('not-linked','Calendar sync changed elsewhere. Review Calendar sync; saved events are unchanged.');
   const saved=control.destination&&review.sources.find(source=>source.connectorAccountId===control.destination?.connectorAccountId&&source.calendarId===control.destination.providerCalendarId);
   if(control.destination&&!saved)return result('not-linked','The saved Google sync calendar is unavailable. Review Calendar sync; saved events are unchanged.');
   // Only an approved (and, when Google named one, the returned) account may be reported Synced or resumed.
   if(saved&&!emails.has(saved.accountEmail?.toLowerCase()??''))return result('not-linked','The saved Google sync calendar is not on the Google account approved for Calendar changes. Review Calendar sync; saved events are unchanged.');
   // Active with a background dispatch (the push resume starts) is on, not Synced: it has no checkpoint to read back.
   if(saved&&!control.paused)return control.pendingDispatch?result('syncing',`Sync on. Calendar is syncing with ${saved.summary} in Google.`):result('synced',`Calendar syncs with ${saved.summary} in Google.`);
   if(control.pendingDispatch)return result('not-linked','A prior Calendar sync operation needs review in Calendar sync before Google can sync.');
   if(step===2)break; // The last step only reads back.
   const primary=review.sources.filter(source=>source.primary===true&&emails.has(source.accountEmail?.toLowerCase()??''));
   if(!saved&&primary.length!==1)return result('not-linked','Choose the Google calendar to sync in Calendar sync. Calendar keeps working in Eliza.');
   // A reviewed destination keeps its mappings: resume it rather than replace it with the primary.
   const operation=saved?'resume':'select',target=saved||primary[0];
   const key=await operationKey(owner,operation,control.revision,target.connectorAccountId,target.calendarId);
   if(!await ready())return stopped();
   // Sent only once changeSync's own fence, owner and destination checks pass, right before its control write.
   revision=(await scope.calendar.changeSync(review,operation,key,fence,saved?undefined:calendarSourceKey(target),()=>{sent=true;latest=undefined;})).revision;
  }
 }catch(error){
  const reason=(error instanceof Error?error.message:'').replace(/\.$/,'');
  return sent?unconfirmed(`${reason||'Calendar sync could not be verified'}. `):!fence()?stopped():result('not-linked',`${reason||'Calendar sync could not be reviewed'}. Calendar sync was not finished; nothing was sent. Calendar keeps working in Eliza.`);
 }
 return unconfirmed();
}
/** createGoogleAccounts' fourth argument when the Google panel was opened from Calendar. capture and current are synchronous
 * snapshots of that Calendar's last captured sync review: no network and no second store. current keeps the lease only while
 * the same owner's Calendar scope is current, with the sources that Calendar already holds; changeSync re-verifies owner,
 * session and scope before the pause write. pause is the canonical changeSync pause, never a link-level pause. retain records
 * the operation key and UNKNOWN context, which the callsite does before any pause or revoke. */
export function googleCalendarDisconnectLifecycle(scope:CanonicalCalendarSyncSettings,captured:()=>AgentCalendarSyncReview|undefined,credentialBinding:()=>string|null,retained:Map<string,GoogleDisconnectContext>):GoogleAccountsCalendarLifecycle{
 const snapshot=(live:boolean):GoogleAccountsCalendarReview|null=>{
  const review=captured(),cloud=credentialBinding();
  if(!review||!cloud||!scope.current())return null;
  const [ownerKey,sessionId]=JSON.parse(review.binding) as [string,string];
  if(scope.calendar.state.ownerKey!==ownerKey)return null;
  const [origin,ownerId,agentId]=JSON.parse(ownerKey) as [string,string,string];
  return structuredClone({lease:{origin,ownerId,agentId,sessionId,credentialBinding:cloud,sourceGeneration:review.binding},control:review.control,sources:live?scope.calendar.state.calendars:review.sources});
 };
 return {
  capture:()=>snapshot(false),current:()=>snapshot(true),
  retain(context){retained.set(context.pauseKey,context);},
  async pause(request,signal){
   signal.throwIfAborted();const review=captured();
   if(!review||request.operation!=='pause'||request.expectedRevision!==review.control.revision)throw Error('Calendar sync changed; review Calendar sync');
   return scope.calendar.changeSync(review,'pause',request.idempotencyKey,()=>!signal.aborted&&scope.current());
  },
 };
}
