import {anyAbortSignal} from './abort-signal';
/** Passive singleton for the existing web plugin. Binding is injected after main initialization. */
import {parseOwnerReminderList,type CoreReminderNotice,type ReminderNotificationBinding,type ReminderNotificationSource} from './owner-reminder-notification-protocol';
export interface ReminderVisibility { foreground:boolean; shadeOpen:boolean; unlocked:boolean; appEnabled:boolean; reminderChannelEnabled:boolean; }
export interface ReminderUi { canOpen():boolean; beforeOpen():void; opened():void; }
export type AgentReminderStatus='unconfigured'|'ready'|'paused'|'unavailable'|'unconfirmed';
export class OwnerReminderNotificationPort {
 private source:ReminderNotificationSource|null=null;private detach:(()=>void)|undefined;private binding:ReminderNotificationBinding|null=null;
 private gate:ReminderVisibility={foreground:false,shadeOpen:false,unlocked:false,appEnabled:false,reminderChannelEnabled:false};
 private rows:CoreReminderNotice[]=[];private controller:AbortController|undefined;private flight:Promise<void>|undefined;private actions=new Set<AbortController>();
 private listeners=new Set<()=>void>();private reads=0;private lastRead=-Infinity;private epoch=0;private blocked=false;
 private uncertain=new Set<string>();private reconcileRequested=false;private policyCheck:(()=>Promise<void>)|undefined;
 private ui:ReminderUi|undefined;status:AgentReminderStatus='unconfigured';
 constructor(private clock=()=>Date.now()){}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private publish(){for(const listener of this.listeners){try{listener();}catch{/* Observer failure cannot alter notification authority. */}}}
 bind(source:ReminderNotificationSource){this.detach?.();this.retire();this.source=source;this.detach=source.subscribeBinding(()=>this.changed());this.changed();return()=>{if(this.source===source){this.detach?.();this.detach=undefined;this.source=null;this.retire();}};}
 bindUi(ui:ReminderUi){this.ui=ui;return()=>{if(this.ui===ui)this.ui=undefined;};}
 private ownerCurrent(binding:ReminderNotificationBinding,epoch:number){return this.epoch===epoch&&this.binding===binding&&binding.current()&&binding.actionAllowed()&&this.gate.foreground&&this.gate.unlocked&&this.gate.appEnabled&&this.gate.reminderChannelEnabled;}
 private visible(){return this.gate.foreground&&this.gate.shadeOpen&&this.gate.unlocked&&this.gate.appEnabled&&this.gate.reminderChannelEnabled;}
 private cancelRead(){this.controller?.abort();this.controller=undefined;this.rows=[];this.lastRead=-Infinity;}
 private retire(){this.epoch++;this.cancelRead();for(const action of this.actions)action.abort();this.actions.clear();this.binding=null;this.reads=0;this.blocked=false;this.status='unconfigured';this.uncertain.clear();this.reconcileRequested=false;this.publish();}
 private changed(){
  let next:ReminderNotificationBinding|null=null;try{next=this.source?.binding()??null;}catch{}
  if(!next&&!this.binding)return;
  if(!next||!this.binding||next.key!==this.binding.key||!this.binding.current()){this.retire();this.binding=next;this.status=next?'ready':'unconfigured';this.publish();}
  else if(!this.binding.actionAllowed()){this.epoch++;this.cancelRead();for(const action of this.actions)action.abort();this.actions.clear();this.publish();}
  else if(!this.binding.passiveAllowed()){this.cancelRead();this.publish();}
 }
 visibility(next:ReminderVisibility){const before=this.visible(),privacyLost=this.gate.foreground&&!next.foreground||this.gate.unlocked&&!next.unlocked||this.gate.appEnabled&&!next.appEnabled||this.gate.reminderChannelEnabled&&!next.reminderChannelEnabled;this.gate={...next};
  if(privacyLost){this.epoch++;this.cancelRead();for(const action of this.actions)action.abort();this.actions.clear();}
  if(before&&!this.visible()){this.cancelRead();this.publish();}
  if(!before&&this.visible()){this.reads=0;this.blocked=this.uncertain.size>0;this.status=this.uncertain.size?'unconfirmed':this.binding?'ready':'unconfigured';}
 }
 surface(foreground:boolean,shadeOpen:boolean){this.visibility({...this.gate,foreground,shadeOpen});}
 policy(unlocked:boolean,appEnabled:boolean,reminderChannelEnabled:boolean){this.visibility({...this.gate,unlocked,appEnabled,reminderChannelEnabled});}
 privacy(unlocked:boolean){this.visibility({...this.gate,unlocked});}
 bindPolicy(check:()=>Promise<void>){this.policyCheck=check;}
 invalidatePolicy(){this.visibility({...this.gate,appEnabled:false,reminderChannelEnabled:false});}
 refresh(){if(!this.visible())return;this.reads=0;this.blocked=false;this.reconcileRequested=this.uncertain.size>0;this.lastRead=-Infinity;this.status=this.uncertain.size?'unconfirmed':this.binding?'ready':'unconfigured';this.publish();}
 async list():Promise<{items:CoreReminderNotice[];status:AgentReminderStatus}>{
  this.changed();const binding=this.binding;if(!binding||!this.visible()||!binding.passiveAllowed())return {items:[],status:this.status};
  if(this.blocked)return {items:[],status:this.status};
  if(this.actions.size)return {items:[...this.rows],status:this.status};
  if(this.flight){await this.flight;return {items:[...this.rows],status:this.status};}
  if(this.clock()-this.lastRead<5000)return {items:[...this.rows],status:this.status};
  if(this.reads>=24){this.status='paused';return {items:[...this.rows],status:this.status};}
  const epoch=this.epoch,controller=this.controller=new AbortController();this.reads++;
  const task=(async()=>{try{
   const reconcile=this.uncertain.size>0&&this.reconcileRequested;this.reconcileRequested=false;
   const raw=await (reconcile?binding.readback(anyAbortSignal([controller.signal,AbortSignal.timeout(2500)])):binding.listUnread(anyAbortSignal([controller.signal,AbortSignal.timeout(2500)])));
   if(controller.signal.aborted||!this.ownerCurrent(binding,epoch)||!this.visible()||!binding.passiveAllowed())return;
   const rows=await parseOwnerReminderList(raw,binding.identity,this.clock());
   if(controller.signal.aborted||!this.ownerCurrent(binding,epoch)||!this.visible()||!binding.passiveAllowed())return;
   if(reconcile){for(const row of rows)if(row.readAt!==null)this.uncertain.delete(row.id);}
   this.rows=rows.filter(row=>row.readAt===null&&!this.uncertain.has(row.id));this.lastRead=this.clock();this.blocked=this.uncertain.size>0;this.status=this.uncertain.size?'unconfirmed':'ready';this.publish();
  }catch{if(!controller.signal.aborted&&this.ownerCurrent(binding,epoch)){this.rows=[];this.blocked=true;this.status=this.uncertain.size?'unconfirmed':'unavailable';this.publish();}}
  finally{if(this.controller===controller)this.controller=undefined;}})();this.flight=task;
  try{await task;}finally{if(this.flight===task)this.flight=undefined;}
  return {items:this.visible()?[...this.rows]:[],status:this.status};
 }
 canOpen(row:CoreReminderNotice){return !this.actions.size&&!this.uncertain.has(row.id)&&!!row.conversationId&&!!row.messageId&&!!this.ui?.canOpen();}
 /** Explicit user action only. No retry of a dispatched markRead, including lost acknowledgement. */
 async act(input:{id:string;revision:string},open:boolean):Promise<'read'|'gone'|'unknown'>{
  this.changed();const binding=this.binding,epoch=this.epoch;
  if(this.actions.size)throw Error('A reminder action is already pending');
  if(this.uncertain.has(input.id))throw Error('Reminder read status is unconfirmed. Refresh to check.');
  if(!binding||!this.visible()||!binding.passiveAllowed())throw Error('Reminder connection changed');
  const shown=this.rows.find(row=>row.id===input.id&&row.revision===input.revision);if(!shown||open&&!this.canOpen(shown))throw Error('Reminder is no longer available');
  this.controller?.abort();if(this.flight)await this.flight;
  if(this.actions.size)throw Error('A reminder action is already pending');
  const controller=new AbortController(),signal=anyAbortSignal([controller.signal,AbortSignal.timeout(10000)]);this.actions.add(controller);
  const current=()=>{signal.throwIfAborted();if(!this.ownerCurrent(binding,epoch))throw Error('Reminder owner changed');};
  try{
   current();const fresh=await parseOwnerReminderList(await binding.listUnread(signal),binding.identity,this.clock());current();
   this.rows=fresh.filter(row=>row.readAt===null);this.lastRead=this.clock();this.publish();
   const exact=fresh.find(row=>row.id===shown.id&&row.revision===shown.revision);if(!exact)throw Error('Reminder changed');
   if(this.policyCheck){await this.policyCheck();current();}
   if(open){if(!this.ui?.canOpen())throw Error('Stop voice before opening this reminder');this.ui.beforeOpen();const result=await binding.openConversation(exact.conversationId!,exact.messageId!,signal);current();if(result.opened!==true)throw Error('Reminder source did not open');this.ui.opened();}
   if(this.policyCheck){await this.policyCheck();current();}
   let acknowledged=false;
   try{current();this.uncertain.add(exact.id);const reply=await binding.markRead(exact.id,signal);current();acknowledged=!!reply&&typeof reply==='object'&&!Array.isArray(reply)&&Object.keys(reply).length===1&&(reply as {ok?:unknown}).ok===true;}catch{current();}
   if(acknowledged){this.uncertain.delete(exact.id);this.rows=this.rows.filter(row=>row.id!==exact.id);this.publish();return 'read';}
   // A false/lost ack is not a second mutation. Reconcile once against the same owner.
   try{const rows=await parseOwnerReminderList(await binding.readback(signal),binding.identity,this.clock());current();const found=rows.find(row=>row.id===exact.id);this.rows=this.rows.filter(row=>row.id!==exact.id);this.publish();if(found&&found.readAt!==null){this.uncertain.delete(exact.id);return 'read';}}catch{current();}
   this.blocked=true;this.status='unconfirmed';this.publish();return 'unknown';
  }finally{this.actions.delete(controller);if(this.binding===binding&&this.uncertain.has(shown.id)){this.blocked=true;this.status='unconfirmed';this.publish();}}
 }
}
export const ownerReminderNotifications=new OwnerReminderNotificationPort();
