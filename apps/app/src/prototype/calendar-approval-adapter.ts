import {connectionController} from '../runtime/connection-ui';
import {alphaClient} from '../runtime/alpha-client';
import {calendarReviewText,inboxChoiceText,calendarApprovalStatus,type CalendarApproval,type CalendarApprovalResolution} from '../runtime/calendar-approval';
import {reviewCalendarApproval} from './calendar-approval-review';
type Shell=Record<string,any>;
/** Presentation only: stored messages, model context and copied source text remain unchanged. */
export function installCalendarApprovalAdapter(Component:Shell){
 const p=Component.prototype,render=p.renderVals,unmount=p.componentWillUnmount;
 const states=new WeakMap<object,{abort?:AbortController;statuses:Map<string,string>;results:Map<string,CalendarApprovalResolution>}>();
 const state=(shell:Shell)=>{let value=states.get(shell);if(!value){value={statuses:new Map(),results:new Map()};states.set(shell,value);}return value;};
 const binding=()=>{const snapshot=connectionController.getSnapshot();return JSON.stringify([snapshot.session,snapshot.history?.conversationId]);};
 const labels=(shell:Shell,row:CalendarApproval)=>{
  const port=connectionController.getAppRecordClient?.(),model=shell.agentCalendar?.state;
  if(!port?.current()||!model||model.savedAt!==null||model.status!=='ready'||model.ownerKey!==JSON.stringify([new URL(port.identity.origin).origin,port.identity.ownerId,port.identity.agentId]))return {};
  const p=row.payload,matches=(value:Shell)=>value.calendarId===p.calendarId&&value.side==='owner'&&String(value.grantId??'')===String(p.grantId??'')&&(!p.expectedProvider||value.provider===p.expectedProvider);
  const sources=model.calendars.filter(matches);if(sources.length!==1)return {};
  const events=(model.feed?.events??[]).filter((event:Shell)=>matches(event)&&(event.externalId===p.eventId||event.id===p.eventId)&&(p.expectedEventStartAtMs==null||Date.parse(event.startAt)===p.expectedEventStartAtMs));
  const event=events.length===1?events[0]:undefined,start=Date.parse(event?.startAt??''),end=Date.parse(event?.endAt??'');
  return {calendar:sources[0].summary||undefined,account:sources[0].accountEmail||undefined,event:event?.title,eventStartsAt:start,eventEndsAt:end,eventAllDay:event?.isAllDay===true,...(event&&Number.isFinite(start)&&Number.isFinite(end)&&end>start?{targetVerified:true as const}:{})};
 };
 async function review(shell:Shell,id:string){
  const value=state(shell),snapshot=connectionController.getSnapshot();
  if(value.abort||!shell.live||document.hidden||snapshot.open||snapshot.busy||shell.S().typing)return;
  if(String(shell.S().draft||'').trim()){shell.toast('Send or clear draft first');return;}
  // A decision must not replace or become part of an unfinished message edit.
  if(shell.messageEditTarget){shell.toast('Finish editing first');return;}
  const observed=alphaClient.getState().context;if(observed.sensitive){shell.toast('Close private content');return;}
  const key=binding(),context=JSON.stringify(observed),controller=value.abort=new AbortController();
  const current=()=>{controller.signal.throwIfAborted();const now=connectionController.getSnapshot();if(!shell.live||document.hidden||binding()!==key||now.open||now.busy||shell.S().typing||shell.messageEditTarget||JSON.stringify(alphaClient.getState().context)!==context||String(shell.S().draft||'').trim())throw Error('The agent, conversation or draft changed. Review the request again.');};
  const retire=()=>{try{current();}catch{controller.abort();}},hidden=()=>{if(document.hidden)controller.abort();},suspend=()=>controller.abort();
  const unsubscribe=connectionController.subscribe?.(retire),unobserve=alphaClient.subscribe?.(retire);
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',suspend);window.addEventListener('alpha:device-state',suspend);
  let dispatched=false;
  try{
   const result=await reviewCalendarApproval(signal=>connectionController.readCalendarApproval(id,signal),controller.signal,current,row=>{value.statuses.set(key+id,calendarApprovalStatus(row));if(shell.live)shell.setState({});},row=>labels(shell,row));
   if(!result)return;current();value.results.delete(key+id);value.statuses.set(key+id,'Checking…');shell.setState({});
   dispatched=true;const outcome=await connectionController.resolveCalendarApproval(result.request,result.decision,controller.signal);current();
   value.results.set(key+id,outcome);value.statuses.set(key+id,outcome.text);shell.setState({});shell.toast(outcome.text);
  }catch(error){let admitted=false;try{current();admitted=true;}catch{/* Retired observations publish nothing to the replacement context. */}if(admitted){const message=dispatched?'Change not confirmed':error instanceof Error?error.message:'Unavailable';value.statuses.set(key+id,message);shell.setState({});shell.toast(message);}}
  finally{unsubscribe?.();unobserve?.();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',suspend);window.removeEventListener('alpha:device-state',suspend);if(value.abort===controller)value.abort=undefined;controller.abort();}
 }
 p.renderVals=function(){
  const out=render.call(this),value=state(this),key=binding();
  out.msgs=(out.msgs||[]).map((message:Shell)=>{
   if(!message.isAgent)return message;
   const source=String(message.text||'');
   // A verified device receipt may already replace the original review prose.
   // Keep that projection and never interpret its summary as Calendar commands.
   if(typeof message.displayText==='string'&&message.displayText!==source)return {...message,messageActionsLabel:message.messageActionsLabel?'Message actions: '+message.displayText:message.messageActionsLabel};
   // Order: the Calendar projection, then inbox choices (prose only); maps-chat-adapter.ts runs after this.
   const parsed=calendarReviewText(source),displayText=inboxChoiceText(parsed.displayText);
   return {...message,displayText,hasCalendarText:message.hasCalendarText!==false&&!!displayText,messageActionsLabel:message.messageActionsLabel?'Message actions: '+(displayText||'Calendar request'):message.messageActionsLabel,calendarReviews:parsed.ids.map(id=>({id,status:value.statuses.get(key+id)||'',canOpen:value.results.get(key+id)?.kind==='succeeded',open:()=>void review(this,id),openCalendar:()=>{if(this.live&&!document.hidden&&binding()===key){this.openView('calendar');void this.refreshAgentCalendar?.();}}}))};
  });return out;
 };
 p.componentWillUnmount=function(){states.get(this)?.abort?.abort();states.delete(this);return unmount?.call(this);};
}
