import {readDevicePreferences} from './device-preferences';
import {beginNoticeAction as notificationAction} from './notice-action';
import {layoutBrowserDialog} from './dialog-layout';
import {browserScreenLocked} from './screen-locked';
import {focusActive,focusHoldsNotice,focusAllowedNotices} from './focus-state';
import {listWorkflowNotices,actOnWorkflowNotice} from './workflow-notices';
import {BrowserCalendar} from './calendar';
import { browserHostedResults } from './hosted-results';
import { browserApps } from './apps';
import { WebPlugin,registerPlugin } from '@capacitor/core';
import {testMocksEnabled} from '../build-flags';
import type { BrowserDaily } from './daily';
import { revision } from './revision';
import {notificationDocument,notificationState,NotificationPolicyChanged,type NotificationState as State} from './notification-store';

const apps=browserApps;
type Notice = {id:string;revision:string;source:'own'|'external'|'hosted';appLabel:string;title:string;text:string;at:number;clearable:boolean;canOpen:boolean;packageName?:string;epoch?:string};
type DeviceEvent = Notice & {source:'external';packageName:string;sourceKey:string;autoCancel:boolean;secret:boolean};
type Selection={packageName:string;preview:boolean};
type Identity = {id:string;revision:string;source?:string};
const locked=()=>document.hidden||document.documentElement.dataset.devBackground==='true'||!!browserScreenLocked();
const noticePolicy=(state:State)=>JSON.stringify([state.revision,state.epoch,state.enabled,state.paused,state.accessGranted,state.appEnabled,state.channels,state.apps]);
function trim(state:State){state.deviceEvents??=[];state.events=state.history&&state.enabled&&state.accessGranted&&!state.paused?state.events.filter(event=>event.at>Date.now()-86400000).slice(-100):[];state.dismissed=state.dismissed.slice(-500);}
/** The store that owns an action on a notice. Focus, calendar and reminder rows are validated against the listing. */
export const noticeRoute=(input:Identity):'focus'|'workflow'|'hosted'|'external'|'calendar'|'reminder'=>{
 //@ verify
 //@ ensures \result === 'focus' || \result === 'workflow' || \result === 'hosted' || \result === 'external' || \result === 'calendar' || \result === 'reminder'
 //@ ensures input.id.startsWith('focus:') <==> \result === 'focus'
 //@ ensures \result === 'workflow' ==> input.source === 'own' && input.id.startsWith('workflow:')
 //@ ensures \result === 'hosted' ==> input.source === 'hosted'
 //@ ensures \result === 'external' ==> input.source === 'external'
 //@ ensures \result === 'calendar' ==> input.id.startsWith('calendar:')
 //@ ensures !input.id.startsWith('focus:') && input.source === 'hosted' ==> \result === 'hosted'
 //@ ensures !input.id.startsWith('focus:') && input.source === 'external' ==> \result === 'external'
 //@ ensures !input.id.startsWith('focus:') && input.source === 'own' && input.id.startsWith('workflow:') ==> \result === 'workflow'
 return input.id.startsWith('focus:')?'focus':input.source==='own'&&input.id.startsWith('workflow:')?'workflow':input.source==='hosted'?'hosted':input.source==='external'?'external':input.id.startsWith('calendar:')?'calendar':'reminder';};
/** Dismissal marks kept within the bound. A mark whose notice is still posted outlives older marks whose notices are gone,
 * so a dismissed notice that is still posted does not reappear. */
export function retainDismissed(dismissed:string[],live:ReadonlySet<string>,limit=500):string[]{
 //@ verify
 //@ type live Set<string>
 //@ requires limit >= 0
 //@ ensures \result.length <= limit
 //@ ensures dismissed.length <= limit ==> \result === dismissed
 //@ ensures \result === RetainSpec(dismissed, live, limit)
 let excess=dismissed.length-limit;if(excess<=0)return dismissed;
 const kept:string[]=[];
 for(let i=0;i<dismissed.length;i++){
  //@ invariant 0 <= i && i <= dismissed.length && excess >= 0
  //@ invariant kept.length + dismissed.length - i - excess === limit
  //@ invariant Then(kept, DropGone(dismissed.slice(i), live, excess)) === DropGone(dismissed, live, dismissed.length - limit)
  const mark=dismissed[i];
  if(excess>0&&!live.has(mark))excess--;else kept.push(mark);}
 // Every mark still kept beyond the limit is live here: the oldest go. (slice(-limit) would keep them all at limit 0.)
 return kept.slice(kept.length-limit);}
function record(state:State,row:Notice,event:string){trim(state);if(state.history&&row.packageName){state.events.push({id:crypto.randomUUID(),appLabel:row.appLabel,packageName:row.packageName,at:Date.now(),state:event});trim(state);}}

/** Synthetic device events persist; Alpha observations and redacted history remain separate. */
export class BrowserNotifications extends WebPlugin {
 private session=revision();
 constructor(private daily:BrowserDaily,private calendar=new BrowserCalendar()){super();window.addEventListener('alpha:notifications-document-changed',()=>this.changed());const retire=()=>{this.session=revision();};window.addEventListener('alpha:device-state',retire);window.addEventListener('blur',retire);window.addEventListener('pagehide',retire);window.addEventListener('pageshow',retire);document.addEventListener('visibilitychange',retire);}
 private async state(){const state=await notificationState(),before=JSON.stringify(state);trim(state);if(JSON.stringify(state)===before)return state;return notificationDocument.edit(state=>{trim(state);return state;});}
 private allowed(state:State,row:Notice){return state.enabled&&!state.paused&&state.accessGranted&&apps.some(app=>app.packageName===row.packageName)&&state.apps.some(app=>app.packageName===row.packageName);}
 private observe(state:State,row:DeviceEvent):Notice {
  const hidden=locked()||row.secret||!state.apps.find(app=>app.packageName===row.packageName)?.preview;
  return {id:row.id,revision:`${row.revision}:${state.epoch}:${this.session}`,source:'external',packageName:row.packageName,appLabel:row.appLabel,title:hidden?row.appLabel:row.title,text:hidden?'':row.text,at:row.at,clearable:row.clearable,canOpen:!locked()&&!row.secret&&row.canOpen};
 }
 private batching=0;
 // A batch reports once when it ends.
 private changed(){if(this.batching)return;window.dispatchEvent(new Event('focus'));void this.notifyListeners('changed',{});}
 private async postedMarks(){const {reminders}=await this.daily.listReminders();return new Set<string>([...reminders.filter(row=>row.status==='posted'&&!!row.occurrenceId).map(row=>row.occurrenceId!),...focusAllowedNotices().map(row=>row.id)]);}
 private mark(state:State,marks:string[],live:ReadonlySet<string>){state.dismissed=retainDismissed([...state.dismissed,...marks.filter(mark=>!state.dismissed.includes(mark))],live);trim(state);}
 async crossAppStatus(){const state=await this.state();const {events,dismissed,deviceEvents,...policy}=state;return {...policy,apps:state.apps.map(app=>({...app,label:apps.find(value=>value.packageName===app.packageName)?.label||app.packageName.replace('browser.',''),available:apps.some(value=>value.packageName===app.packageName)})),connected:state.accessGranted};}
 async notificationApps(){return {apps:apps.map(({view,...app})=>app)};}
 async setNotificationPolicy(input:{expectedRevision:string;enabled?:boolean;history?:boolean;apps?:Selection[]}){
  await notificationDocument.edit(state=>{
   if(state.revision!==input.expectedRevision)throw Error('Settings changed. Refresh and try again.');
   for(const flag of ['enabled','history'] as const)if(input[flag]!==undefined){if(typeof input[flag]!=='boolean')throw Error('Invalid notification policy.');state[flag]=input[flag]!;}
   if(input.apps!==undefined){if(!Array.isArray(input.apps)||input.apps.length>apps.length||new Set(input.apps.map(app=>app.packageName)).size!==input.apps.length||input.apps.some(app=>!apps.some(known=>known.packageName===app.packageName)||typeof app.preview!=='boolean'))throw Error('Choose a development app.');state.apps=input.apps.map(({packageName,preview})=>({packageName,preview}));}
   state.revision=revision();state.epoch=revision();state.events=[];trim(state);
  });
  this.changed();return this.crossAppStatus();
 }
 async resumeCrossApp(input:{expectedRevision:string}){await notificationDocument.edit(state=>{if(state.revision!==input.expectedRevision)throw Error('Settings changed. Refresh and try again.');state.paused=false;state.epoch=revision();state.revision=revision();});this.changed();return this.crossAppStatus();}
 async notificationHistory(){const state=await this.state();return {items:[...state.events].reverse()};}
 async clearNotificationHistory(){await notificationDocument.edit(state=>{state.events=[];state.epoch=revision();});this.changed();}
 async status(){const state=await this.state();return {appEnabled:state.appEnabled,permissionGranted:true,interruption:(await readDevicePreferences()).doNotDisturb||focusActive()?'none':'all',channels:Object.entries(state.channels).map(([id,enabled])=>({id,name:id==='reminders'?'Reminders':id==='calendar'?'Calendar':id,importance:enabled?3:0,blocked:!enabled})),scope:'browser'};}
 async inject(input:{packageName:string;title:string;text:string;id?:string;clearable?:boolean;autoCancel?:boolean;secret?:boolean;canOpen?:boolean}){
  const app=apps.find(app=>app.packageName===input.packageName);if(!app||typeof input.title!=='string'||typeof input.text!=='string'||input.title.length>200||input.text.length>2000||input.id!==undefined&&!/^[\w-]{1,128}$/.test(input.id))throw Error('Review the event fields.');
  for(const flag of ['clearable','autoCancel','secret','canOpen'] as const)if(input[flag]!==undefined&&typeof input[flag]!=='boolean')throw Error('Review the event options.');
  const observed=(await notificationState()).epoch,sourceKey=`${app.packageName}/${input.id||crypto.randomUUID()}`;
  const result=await notificationDocument.edit(state=>{
   trim(state);const previous=state.deviceEvents!.find(row=>row.sourceKey===sourceKey);
   const row:DeviceEvent={sourceKey,id:previous?.id||crypto.randomUUID(),revision:revision(),source:'external',appLabel:app.label,title:input.title,text:input.text,at:Date.now(),clearable:input.clearable!==false,autoCancel:input.autoCancel!==false,secret:input.secret===true,canOpen:input.canOpen!==false,packageName:app.packageName};
   state.deviceEvents=[...state.deviceEvents!.filter(event=>event.sourceKey!==sourceKey),row].slice(-100);
   const collected=this.allowed(state,row);
   // A source event still exists on the simulated device when collection is off.
   // A prior observation cannot cross a policy/history boundary into the new history.
   if(state.epoch===observed&&collected)record(state,row,previous?'updated':'posted');
   return {status:'posted',collected,id:row.id,revision:this.observe(state,row).revision};
  });
  this.changed();return result;
 }
 async list(){return this.readNotices(true);}
 async focusSnapshot(){return this.readNotices(false);}
 private async readNotices(applyFocus:boolean){
  const {reminders}=await this.daily.listReminders(),state=await this.state(),hidden=locked();
  const own:Notice[]=state.appEnabled&&state.channels.reminders?reminders.filter(row=>!row.pendingDeletion&&row.status==='posted'&&!state.dismissed.includes(row.occurrenceId!)).map(row=>({id:row.id,revision:row.occurrenceId!,source:'own',appLabel:'Alpha Phone',title:hidden?'Alpha Phone':row.title,text:hidden?'':row.body||'',at:row.postedAt||row.at,clearable:true,canOpen:!hidden})):[];
  let calendar:Notice[]=[],calendarStatus:'ready'|'unavailable'|'disabled'='disabled';
  if(state.appEnabled&&state.channels.calendar){try{calendar=(await this.calendar.listAlerts()).items.map(row=>({id:row.id,revision:row.revision,source:'own',appLabel:'Calendar',title:hidden?'Calendar':row.title,text:hidden?'':row.text,at:row.at,clearable:true,canOpen:!hidden}));calendarStatus='ready';}catch{calendarStatus='unavailable';}}

  const external=state.deviceEvents!.filter(row=>this.allowed(state,row)).map(row=>({...this.observe(state,row),...(!applyFocus?{revision:row.revision}:{})}));
  const workflow=state.appEnabled?await listWorkflowNotices():[],hosted=await browserHostedResults.list();
  // All sources are asynchronous. Apply the current lock state after the last read.
  if(noticePolicy((await notificationState()))!==noticePolicy(state))throw new NotificationPolicyChanged();
  const nowHidden=locked();
  const items=[...[...own,...calendar,...external,...workflow,...hosted].filter(row=>!applyFocus||!focusHoldsNotice(row.at)),...(applyFocus&&state.appEnabled?focusAllowedNotices().filter(row=>!state.dismissed.includes(row.id)).map(row=>({...row,title:hidden?'Messages':row.title,text:hidden?'':row.text,canOpen:!hidden})):[])].sort((a,b)=>b.at-a.at).slice(0,100);
  return {scope:'browser',calendarStatus,items:nowHidden?items.map(row=>({...row,title:row.appLabel,text:'',canOpen:false})):items};
 }
 private async external(input:Identity,opening:boolean){
  const action=notificationAction();try{
  const view=await notificationDocument.edit(state=>{
   trim(state);const row=state.deviceEvents!.find(row=>row.id===input.id);
   if(!row||!this.allowed(state,row)||locked()||this.observe(state,row).revision!==input.revision||(!opening&&!row.clearable)||(opening&&!this.observe(state,row).canOpen))throw Error('Notification changed.');
   record(state,row,opening?'opened':'dismissed');
   if(!opening||row.autoCancel)state.deviceEvents=state.deviceEvents!.filter(event=>event.id!==row.id);
   return apps.find(app=>app.packageName===row.packageName)!.view;
  },action.signal);
  if(opening&&!action.signal.aborted&&!locked())window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:view}));this.changed();
  }finally{action.dispose();}
 }
 async open(input:Identity){if(input.id.startsWith('focus:'))return this.focusAction(input,true);if(input.source==='own'&&input.id.startsWith('workflow:')){if(!(await this.state()).appEnabled)throw Error('Notifications are disabled.');return actOnWorkflowNotice(input,true);}if(input.source==='hosted')return browserHostedResults.action(input,true);if(input.source==='external')return this.external(input,true);if(locked())throw Error('Unlock to open this notification.');const {items}=await this.list();if(!items.some(row=>row.source==='own'&&row.id===input.id&&row.revision===input.revision))throw Error('Notification changed.');if(input.id.startsWith('calendar:')){await this.calendar.alertAction({...input,open:true});this.changed();return;}window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:'calendar'}));await this.daily.notifyReminder(input.id,input.revision);}
 async dismiss(input:Identity){if(input.id.startsWith('focus:'))return this.focusAction(input,false);if(input.source==='own'&&input.id.startsWith('workflow:')){if(!(await this.state()).appEnabled)throw Error('Notifications are disabled.');return actOnWorkflowNotice(input,false);}if(input.source==='hosted')return browserHostedResults.action(input,false);if(input.source==='external')return this.external(input,false);if(locked())throw Error('Unlock to dismiss this notification.');const {items}=await this.list();if(!items.some(row=>row.source==='own'&&row.id===input.id&&row.revision===input.revision))throw Error('Notification changed.');if(input.id.startsWith('calendar:')){await this.calendar.alertAction({...input,open:false});this.changed();return;}const live=await this.postedMarks();await notificationDocument.edit(state=>{if(locked())throw Error('Unlock to dismiss this notification.');this.mark(state,[input.revision],live);});this.changed();}
 async focusAction(input:Identity,open:boolean){const action=notificationAction();try{if(locked()||!(await this.list()).items.some(row=>row.id===input.id&&row.revision===input.revision))throw Error('Notification changed.');const live=await this.postedMarks();action.signal.throwIfAborted();await notificationDocument.edit(state=>{if(locked())throw Error('Notification changed.');this.mark(state,[input.id],live);},action.signal);if(open&&!action.signal.aborted&&!locked())window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:'messages'}));this.changed();}finally{action.dispose();}}
 /** One listing validates every focus, calendar and reminder row, one edit records their dismissals, and one change
  * notice follows the batch. Each row has the outcome a dismissal of that row alone would have had. */
 async clear(input:{items:Identity[]}){
  if(!Array.isArray(input.items)||input.items.length>100)throw Error('Refresh notifications.');
  const outcomes=input.items.map(item=>({id:item.id,status:'unavailable'})),marks:{index:number;mark:string}[]=[],claimed=new Set<string>(),listedRoutes=['focus','calendar','reminder'];
  this.batching++;
  try{
   let listed:Identity[]|null=null;
   if(input.items.some(item=>listedRoutes.includes(noticeRoute(item)))&&!locked()){try{listed=(await this.list()).items;}catch{listed=null;}}
   for(const [index,item] of input.items.entries()){
    const route=noticeRoute(item);
    try{
     if(!listedRoutes.includes(route)){await this.dismiss(item);outcomes[index].status='requested';continue;}
     const identity=JSON.stringify([item.id,item.revision]);
     if(!listed||claimed.has(identity)||!listed.some(row=>(route==='focus'||row.source==='own')&&row.id===item.id&&row.revision===item.revision))continue;
     claimed.add(identity);
     if(route==='calendar'){await this.calendar.alertAction({...item,open:false});outcomes[index].status='requested';}
     else marks.push({index,mark:route==='focus'?item.id:item.revision});
    }catch{/* This row stays; the others are still cleared. */}
   }
   if(marks.length){
    const action=notificationAction();
    try{const live=await this.postedMarks();action.signal.throwIfAborted();await notificationDocument.edit(state=>{if(locked())throw Error('Notification changed.');this.mark(state,marks.map(row=>row.mark),live);},action.signal);for(const {index} of marks)outcomes[index].status='requested';}
    catch{/* None of these rows was dismissed. */}
    finally{action.dispose();}
   }
  }finally{this.batching--;}
  if(input.items.length)this.changed();
  return {outcomes};
 }
 async deviceEvents(){const state=await this.state();return {items:state.deviceEvents!.map(row=>({id:row.id,revision:row.revision,appLabel:row.appLabel,packageName:row.packageName,notificationId:row.sourceKey.slice(row.packageName.length+1),title:row.title,text:row.text,clearable:row.clearable,autoCancel:row.autoCancel,secret:row.secret}))};}
 async removeDeviceEvent(input:{id:string;revision:string}){await notificationDocument.edit(state=>{trim(state);const row=state.deviceEvents!.find(row=>row.id===input.id);if(!row||row.revision!==input.revision)throw Error('The device event changed.');state.deviceEvents=state.deviceEvents!.filter(event=>event.id!==row.id);if(this.allowed(state,row))record(state,row,'removed');});this.changed();}
 private show(dialog:HTMLDialogElement,actions:HTMLElement[]){
  dialog.classList.add('alpha-notification-dialog');
  const shell=document.querySelector('.os');if(shell){const theme=getComputedStyle(shell);for(const name of ['--bg','--fg','--s2','--line','--acc'])dialog.style.setProperty(name,theme.getPropertyValue(name));}
  const style=document.createElement('style');style.textContent=`
   .alpha-notification-dialog{box-sizing:border-box;font:14px/1.5 'Public Sans',system-ui,sans-serif;box-shadow:0 16px 60px #0003}
   .alpha-notification-dialog::backdrop{background:#0005}
   .alpha-notification-dialog h2{font-size:22px;line-height:1.2;margin:0 0 20px}
   .alpha-notification-dialog h3{font-size:16px;margin:24px 0 12px}
   .alpha-notification-dialog input:not([type=checkbox]),.alpha-notification-dialog select,.alpha-notification-dialog textarea{box-sizing:border-box;width:100%;min-width:0;min-height:42px;border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;font:inherit;color:inherit;background:var(--s2,#f3f3f3)}
   .alpha-notification-dialog textarea{min-height:72px;resize:vertical}
   .alpha-notification-dialog input[type=checkbox]{width:18px;height:18px;flex-shrink:0;accent-color:var(--acc,#00f)}
   .alpha-notification-dialog button{min-height:44px;border:1px solid var(--line,#ddd);border-radius:9px;padding:8px 12px;font:inherit;color:inherit;background:var(--s2,#f3f3f3);cursor:pointer;overflow-wrap:anywhere}
   .alpha-notification-dialog button:disabled{opacity:.5;cursor:wait}
   .alpha-notification-dialog :focus-visible{outline:2px solid var(--acc,#00f);outline-offset:2px}
   .alpha-notification-dialog [role=status]:empty{display:none}
  `;dialog.prepend(style);layoutBrowserDialog(dialog,actions);
  const previous=document.activeElement as HTMLElement|null;const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();dialog.close();};window.addEventListener('alpha-back',back,true);dialog.addEventListener('close',()=>{window.removeEventListener('alpha-back',back,true);if(previous?.isConnected)previous.focus();},{once:true});document.body.append(dialog);dialog.showModal();
 }
 async compose(){
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Development notification');dialog.style.cssText='width:min(340px,85vw);max-height:85dvh;overflow:auto;border:0;border-radius:18px;padding:24px;background:var(--bg,#fff);color:var(--fg,#111)';const heading=document.createElement('h2');heading.textContent='Post notification';dialog.append(heading);
  const app=document.createElement('select');for(const choice of apps){const option=document.createElement('option');option.value=choice.packageName;option.textContent=choice.label;app.append(option);}
  const eventId=document.createElement('input');eventId.maxLength=128;eventId.placeholder='New event';
  const title=document.createElement('input');title.value='Development event';title.maxLength=200;const body=document.createElement('textarea');body.value='Ready for review.';body.maxLength=2000;
  for(const [name,control] of [['App',app],['Event ID',eventId],['Title',title],['Message',body]] as const){const label=document.createElement('label');label.textContent=name;label.style.cssText='display:grid;gap:6px;margin:14px 0';label.append(control);dialog.append(label);}
  const ongoing=document.createElement('input'),keep=document.createElement('input'),secret=document.createElement('input');for(const [name,control] of [['Ongoing notification',ongoing],['Keep after opening',keep],['Secret notification',secret]] as const){control.type='checkbox';const label=document.createElement('label');label.style.cssText='display:flex;gap:12px;margin:12px 0';label.append(control,document.createTextNode(name));dialog.append(label);}
  const status=document.createElement('p');status.setAttribute('role','status');const post=document.createElement('button');post.textContent='Post';post.onclick=async()=>{post.disabled=true;try{const result=await this.inject({packageName:app.value,title:title.value,text:body.value,...(eventId.value?{id:eventId.value}:{}),clearable:!ongoing.checked,autoCancel:!keep.checked,secret:secret.checked});await render();status.textContent=result.collected?'Posted to notification center.':'Posted to device. Select this app in notification settings to show it in Alpha.';}catch{status.textContent='The event could not be saved. Try again.';}finally{post.disabled=false;}};
  const done=document.createElement('button');done.textContent='Done';done.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();const actions=document.createElement('div');actions.style.cssText='display:flex;gap:10px;margin:18px 0';post.style.cssText='background:var(--acc,#00f);color:white;border-color:transparent;flex:1';done.style.flex='1';actions.append(post,done);dialog.append(status,actions);
  const source=document.createElement('section');dialog.append(source);
  const render=async()=>{const {items}=await this.deviceEvents();source.replaceChildren();const heading=document.createElement('h3');heading.textContent='Active device events';source.append(heading);for(const row of items){const entry=document.createElement('div');entry.style.cssText='display:grid;gap:8px;margin:16px 0';const text=document.createElement('span');text.textContent=`${row.appLabel} · ${row.title}`;const edit=document.createElement('button');edit.textContent=`Edit ${row.title}`;edit.onclick=()=>{app.value=row.packageName;eventId.value=row.notificationId;title.value=row.title;body.value=row.text;ongoing.checked=!row.clearable;keep.checked=!row.autoCancel;secret.checked=row.secret;};const remove=document.createElement('button');remove.textContent=`Remove ${row.title}`;remove.onclick=async()=>{remove.disabled=true;try{await this.removeDeviceEvent(row);await render();}catch{status.textContent='The event changed. Reopen device events.';remove.disabled=false;}};entry.append(text,edit,remove);source.append(entry);}if(!items.length){const empty=document.createElement('p');empty.textContent='No active device events';source.append(empty);}};
  this.show(dialog,[post,done]);await render();
 }
 private async controls(title:string,fields:{label:string;checked:boolean;change:(checked:boolean)=>Promise<void>}[]){
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label',title);dialog.style.cssText='width:min(340px,85vw);max-height:85dvh;overflow:auto;border:0;border-radius:18px;padding:24px;background:var(--bg,#fff);color:var(--fg,#111)';const heading=document.createElement('h2');heading.textContent=title;dialog.append(heading);
  for(const field of fields){const label=document.createElement('label'),control=document.createElement('input');label.textContent=field.label;label.style.cssText='display:flex;gap:20px;align-items:center;margin:20px 0';control.type='checkbox';control.checked=field.checked;control.onchange=async()=>{control.disabled=true;try{await field.change(control.checked);this.changed();}catch{control.checked=!control.checked;}finally{control.disabled=false;}};label.append(control);dialog.append(label);}
  const done=document.createElement('button');done.textContent='Done';done.onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();this.changed();};dialog.append(done);this.show(dialog,[done]);return {status:'opened'};
 }
 async openNotificationAccess(){if(!testMocksEnabled)return registerPlugin<{openSettings(input:{page:string}):Promise<{status:string}>}>('AlphaDevice').openSettings({page:'privacy'});const state=await this.state();return this.controls('Notification access',[{label:'Allow development app events',checked:state.accessGranted,change:async enabled=>{await notificationDocument.edit(state=>{state.accessGranted=enabled;state.epoch=revision();state.revision=revision();trim(state);});}}]);}
 async setAlertPreferences(input:{appEnabled?:boolean;channelId?:string;enabled?:boolean}){
  if(Object.keys(input).some(key=>!['appEnabled','channelId','enabled'].includes(key)))throw Error('Invalid alert preference.');
  if(input.appEnabled!==undefined){if(typeof input.appEnabled!=='boolean'||input.channelId!==undefined||input.enabled!==undefined)throw Error('Invalid alert preference.');await notificationDocument.edit(state=>{state.appEnabled=input.appEnabled!;});}
  else{const state=await this.state();if(typeof input.channelId!=='string'||!Object.hasOwn(state.channels,input.channelId)||typeof input.enabled!=='boolean')throw Error('Choose an alert type.');await notificationDocument.edit(state=>{state.channels[input.channelId!]=input.enabled!;});}
  this.changed();return {status:'saved'};
 }
 async openChannelSettings(input:{id:string}){const state=await this.state();if(!(input.id in state.channels))throw Error('Choose a notification channel.');if(!testMocksEnabled)return registerPlugin<{openSettings(input:{page:string}):Promise<{status:string}>}>('AlphaDevice').openSettings({page:input.id==='calendar'?'calendar':'reminders'});return this.controls(input.id==='calendar'?'Calendar notifications':'Reminders notifications',[{label:input.id==='calendar'?'Show calendar alerts':'Show reminders',checked:state.channels[input.id],change:async enabled=>{await notificationDocument.edit(state=>{state.channels[input.id]=enabled;});}}]);}
 async openAppSettings(){if(!testMocksEnabled)return registerPlugin<{openSettings(input:{page:string}):Promise<{status:string}>}>('AlphaDevice').openSettings({page:'notifications'});const state=await this.state();return this.controls('Alpha notifications',[{label:'Show Alpha notifications',checked:state.appEnabled,change:async enabled=>{await notificationDocument.edit(state=>{state.appEnabled=enabled;});}}]);}
}
