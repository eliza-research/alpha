import {browserDeletionOwnerCurrent,browserDeletionOwnerVisible} from '../runtime/deletion-owner';
import {rendererDeletionClock,deletionWindow} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
import {stageReminderDeletion,settleReminderDeletions,undoReminderDeletion,type DeletableReminder,type ReminderDeletionState} from './reminder-deletions';
import {isReminderCreate,validateReminderCreate,validateReminderCreateResult,type ReminderCreateOperation,type ReminderCreateResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import { validateReminderOperation, reminderFields, reminderTiming, type ReminderOperation, type ReminderResult, type ReminderTarget } from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import { BrowserFiles } from './files';
import { initialReminderDue, completeReminderOccurrence, snoozeReminderOccurrence } from '../../../../.eliza/client-features/plugins/plugin-native-reminders/src/occurrence.ts';
import { WebPlugin } from '@capacitor/core';
import { devSurfacesEnabled } from '../build-flags';
import type { Reminder, ClockRequest } from '../daily';
import { revision } from './revision';
import {notificationState} from './notification-store';
import {reminderDocument} from './reminder-store';
type State=ReminderDeletionState&{deleteClaims?:Record<string,string>;receipts?:Record<string,{binding:string;result:ReminderResult|ReminderCreateResult}>};
const initial=():State=>({sourceRevision:revision(),reminders:[]});
async function notificationsAllowed(){const state=await notificationState();return state.appEnabled&&state.channels.reminders!==false;}
async function scheduledStatus():Promise<'scheduled'|'permission-denied'>{return await notificationsAllowed()?'scheduled':'permission-denied';}
function target(data:State,row:DeletableReminder):ReminderTarget {return {...(row.alertMinutes!==undefined?{timingVersion:2 as const}:{}),sourceId:'browser-reminders',sourceRevision:data.sourceRevision,reminderId:row.id,occurrenceId:row.occurrenceId!,revision:row.revision};}
function operationBinding(input:{operationId:string;bindingHash:string},operation:ReminderOperation|ReminderCreateOperation) {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId)||!/^[a-f0-9]{64}$/.test(input.bindingHash))throw Error('Invalid reminder operation binding.');
  return JSON.stringify([input.bindingHash,operation]);
}
/** Done and Snooze use the shared reminder engine's decisions: a one-off completes, a repeat
 * advances to its next civil occurrence. This browser owns storage, delivery state and revisions. */
async function decide(row:DeletableReminder,action:'done'|'snooze') {
  const host={now:Date.now(),alertStatus:await scheduledStatus(),nextOccurrenceId:()=>crypto.randomUUID()};
  if((action==='snooze'?snoozeReminderOccurrence(row,host):completeReminderOccurrence(row,host))==='unchanged')return 'unchanged';
  row.revision=revision();return row.status;
}
export class BrowserDaily extends WebPlugin {
  constructor(private files:BrowserFiles){super();window.addEventListener('focus',()=>void this.notifyListeners('appResumed',{}));}
  async deletionSelection(expected:ReminderTarget){const data=await reminderDocument.read(initial),row=data.reminders.find(r=>r.id===expected.reminderId);if(!row||Object.entries(target(data,row)).some(([key,value])=>expected[key as keyof ReminderTarget]!==value))throw Error('Reminder changed. Review it again.');return {row:structuredClone(row),owner:'manual:'+data.sourceRevision};}
  async stageDeletion(expected:ReminderTarget,owner:string,id?:string,binding?:string,journalBinding?:{scope:string;proposalId:string;operationHash:string}){return reminderDocument.edit(initial,data=>{
    if(!browserDeletionOwnerCurrent(owner))throw Error('Deletion owner changed during review.');
    const row=data.reminders.find(r=>r.id===expected.reminderId);if(!row||Object.entries(target(data,row)).some(([key,value])=>expected[key as keyof ReminderTarget]!==value))throw Error('Reminder changed. Review it again.');
    if(binding&&id){if(data.deleteClaims?.[id])throw Error('Deletion operation already used.');if(Object.keys(data.deleteClaims||{}).length>=500)throw Error('Action deletion history requires review.');(data.deleteClaims??={})[id]=binding;}
    const staged=stageReminderDeletion(data,row,owner,id,binding);if(journalBinding)data.deletions![staged.id].journalBinding=journalBinding;return staged;
  });}
  async deletionReceipt(id:string){const data=await reminderDocument.read(initial);return {entry:data.deletions?.[id]||null,row:data.reminders.find(r=>r.pendingDeletion===id||r.id===data.deletions?.[id]?.target.row.id)};}
  async pendingDeletions(){const data=await reminderDocument.read(initial),clock=rendererDeletionClock();return Object.values(data.deletions||{}).filter(e=>!e.acknowledged&&['queued','paused','unknown','dispatching'].includes(e.phase)&&browserDeletionOwnerVisible(e.owner)).map(e=>({...e,kind:'reminder',window:e.phase==='queued'?deletionWindow(e.deadline,clock):undefined}));}
  async settleDeletions(){
    // Polling an empty store must not create a document or a recovery revision.
    const data=await reminderDocument.read(initial);
    if(!Object.values(data.deletions||{}).some(entry=>entry.phase==='queued'))return;
    await reminderDocument.edit(initial,data=>settleReminderDeletions(data,browserDeletionOwnerCurrent));
  }
  async dismissDeletion(id:string){return reminderDocument.edit(initial,data=>{const entry=data.deletions?.[id];if(!entry||!browserDeletionOwnerVisible(entry.owner)||!['unknown','dispatching'].includes(entry.phase))throw Error('Uncertain deletion is unavailable.');entry.acknowledged=true;return {status:'acknowledged'};});}
  async undoDeletion(id:string){return reminderDocument.edit(initial,data=>undoReminderDeletion(data,id,browserDeletionOwnerVisible));}
  async notifyReminder(id:string,occurrenceId:string){await this.notifyListeners('reminderOpened',{id,occurrenceId});}
  async surfaceInfo(){return {developmentBuild:devSurfacesEnabled,assistant:false,reminderCreationVersion:1 as const,reminderTimingVersion:2 as const,topInset:0,bottomInset:0};}
  async closeAssistant(){window.dispatchEvent(new Event('alpha-back',{cancelable:true}));return {closed:true};}
  async scheduleReminder(input:{id:string;title:string;body?:string;at:number;recurrence?:Reminder['recurrence'];dueAt?:number;alertMinutes?:number|null}) {
    if(!Number.isSafeInteger(input.at)||input.at<=Date.now())return {status:'past',id:input.id,mode:'inexact'};
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.id))throw Error('Invalid reminder identity.');
    reminderFields({title:input.title,body:input.body||'',schedule:{at:input.at,recurrence:input.recurrence||null,...(input.dueAt!==undefined||input.alertMinutes!==undefined?{dueAt:input.dueAt,alertMinutes:input.alertMinutes}:{})}});
    const dueAt=input.dueAt??(input.recurrence?initialReminderDue(input.recurrence,input.at):input.at);
    if(input.recurrence&&initialReminderDue(input.recurrence,input.at)!==dueAt)throw Error('Reminder civil time changed');
    const mode=input.alertMinutes===null?'none':'inexact';
    return reminderDocument.edit(initial,async data=>{const status=input.alertMinutes===null?'pending':await scheduledStatus();const previous=data.reminders.find(r=>r.id===input.id);if(previous?.alertMinutes!==undefined&&input.alertMinutes===undefined)throw Error('Explicit reminder timing cannot be discarded');data.reminders=data.reminders.filter(r=>r.id!==input.id);data.reminders.push({...input,body:input.body||'',mode,createdAt:previous?.createdAt||Date.now(),status,occurrenceId:crypto.randomUUID(),dueAt,history:previous?.history||[],revision:revision()});return {status,id:input.id,mode};});
  }
  async listReminders(){
    const due=(data:State)=>data.reminders.some(row=>!row.pendingDeletion&&row.status==='scheduled'&&row.at<=Date.now());
    const result=async(data:State)=>({reminders:data.reminders.filter(row=>row.status!=='cancelled').map(row=>({...row,target:target(data,row)})),notificationsEnabled:await notificationsAllowed()});
    const data=await reminderDocument.read(initial);
    // Polling an unchanged schedule must not mint new reset/recovery revisions.
    if(!due(data))return result(data);
    return reminderDocument.edit(initial,async data=>{for(const row of data.reminders)if(!row.pendingDeletion&&row.status==='scheduled'&&row.at<=Date.now()){row.status=await notificationsAllowed()?'posted':'permission-denied';if(row.status==='posted')row.postedAt=Date.now();row.revision=revision();}return result(data);});
  }

  async selectedReminder(input:{id:string}):Promise<ReminderTarget>{const data=await reminderDocument.read(initial),row=data.reminders.find(r=>r.id===input.id);if(!row)throw Error('Reminder no longer exists.');return target(data,row);}
  async reminderOperationReceipt(input:{operationId:string;bindingHash:string;operation:ReminderOperation|ReminderCreateOperation}) {
    const operation=isReminderCreate(input.operation)?validateReminderCreate(input.operation):validateReminderOperation(input.operation),binding=operationBinding(input,operation),receipt=(await reminderDocument.read(initial)).receipts?.[input.operationId];
    if(!receipt)return {status:'unknown'};if(receipt.binding!==binding)throw Error('Reminder receipt binding changed.');return {status:'succeeded',result:receipt.result};
  }
  async operateReminder(input:{operationId:string;bindingHash:string;operation:ReminderOperation|ReminderCreateOperation}) {
    const operation=isReminderCreate(input.operation)?validateReminderCreate(input.operation):validateReminderOperation(input.operation),binding=operationBinding(input,operation);
    if(operation.type==='reminder_cancel')throw Error('Use the reviewed deletion window.');
    return reminderDocument.edit(initial,async data=>{
      const receipt=data.receipts?.[input.operationId];if(receipt){if(receipt.binding!==binding)throw Error('Reminder receipt binding changed.');return {status:'succeeded',result:receipt.result};}
      if(document.hidden)throw Error('Return to Alpha to review the reminder.');
      if(isReminderCreate(operation)){
        if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId)||data.reminders.some(r=>r.id===input.operationId))throw Error('Reminder creation identity already exists');
        if(Object.keys(data.receipts||{}).length>=500)throw Error('Reminder receipt history is full');
        const {title,body,schedule}=operation.fields;
        if(schedule.at<=Date.now()||schedule.recurrence&&initialReminderDue(schedule.recurrence,schedule.at)!==schedule.dueAt)throw Error('Choose a valid future reminder schedule');
        const row:DeletableReminder={id:input.operationId,title,body,at:schedule.at,dueAt:schedule.dueAt,alertMinutes:schedule.alertMinutes,...(schedule.recurrence?{recurrence:schedule.recurrence}:{}),mode:schedule.alertMinutes===null?'none':'inexact',status:schedule.alertMinutes===null?'pending':await scheduledStatus(),createdAt:Date.now(),occurrenceId:crypto.randomUUID(),revision:revision(),history:[]};
        const result=validateReminderCreateResult(operation,{version:1,kind:operation.type,sourceId:'browser-reminders',reminderId:row.id,occurrenceId:row.occurrenceId,revision:row.revision,status:row.status,at:row.at,dueAt:row.dueAt,alertMinutes:row.alertMinutes,fields:operation.fields},input.operationId);
        if(document.hidden)throw Error('Return to Alpha to review the reminder.');
        data.reminders.push(row);(data.receipts??={})[input.operationId]={binding,result};return {status:'succeeded',result};
      }
      const row=data.reminders.find(r=>r.id===operation.target.reminderId);
      if(!row||operation.target.timingVersion!==target(data,row).timingVersion||Object.entries(target(data,row)).some(([k,v])=>operation.target[k as keyof ReminderTarget]!==v))throw Error('Reminder changed. Review it again.');
      if(operation.type!=='reminder_read_selected'&&(row.status==='cancelled'||row.status==='completed'&&operation.type!=='reminder_update'))throw Error('Reminder is no longer active.');
      if(operation.type==='reminder_update'){
        row.title=operation.fields.title;row.body=operation.fields.body;
        if(operation.fields.schedule){const schedule=operation.fields.schedule;if(schedule.at<=Date.now())throw Error('Choose a future reminder time.');row.at=schedule.at;row.recurrence=schedule.recurrence||undefined;row.dueAt=schedule.dueAt??(schedule.recurrence?initialReminderDue(schedule.recurrence,schedule.at):schedule.at);if(schedule.recurrence&&initialReminderDue(schedule.recurrence,schedule.at)!==row.dueAt)throw Error('Reminder civil time changed');if(schedule.alertMinutes===undefined)delete row.alertMinutes;else row.alertMinutes=schedule.alertMinutes;row.mode=row.alertMinutes===null?'none':'inexact';row.occurrenceId=crypto.randomUUID();row.status=row.alertMinutes===null?'pending':await scheduledStatus();delete row.snoozedAt;delete row.postedAt;delete row.completedAt;}
        row.revision=revision();
      }else if(operation.type==='reminder_complete'||operation.type==='reminder_snooze')await decide(row,operation.type==='reminder_complete'?'done':'snooze');
      const result:ReminderResult={...reminderTiming(row),version:1,kind:operation.type,sourceId:'browser-reminders',reminderId:row.id,occurrenceId:row.occurrenceId!,revision:row.revision,status:row.status,at:row.at};
      if(operation.type==='reminder_read_selected')result.fields={title:row.title,body:row.body,schedule:{at:row.alertMinutes===undefined?row.at:row.dueAt!-(row.alertMinutes??0)*60000,recurrence:row.recurrence||null,...reminderTiming(row)}};
      if(document.hidden)throw Error('Return to Alpha to review the reminder.');
      (data.receipts??={})[input.operationId]={binding,result};return {status:'succeeded',result};
    });
  }
  async reminderDecision(input:{id:string;occurrenceId:string;action:'done'|'snooze'}){return reminderDocument.edit(initial,async data=>{
    if(!['done','snooze'].includes(input.action))throw Error('Invalid reminder decision.');
    const row=data.reminders.find(r=>r.id===input.id);if(!row||row.occurrenceId!==input.occurrenceId||['completed','cancelled'].includes(row.status))return {status:'stale'};
    return {status:await decide(row,input.action)};
  });}
  async clockDecision(input:{id:string;revision:string;action:'cancel'|'dismiss'|'snooze';minutes?:number}){
    if(!['cancel','dismiss','snooze'].includes(input.action)||input.action==='snooze'&&(!Number.isInteger(input.minutes)||input.minutes!<1||input.minutes!>60))throw Error('Choose 1 to 60 snooze minutes.');
    return reminderDocument.edit(initial,async data=>{const row=data.reminders.find(r=>r.id===input.id&&r.id.startsWith('alarm_'));if(!row||row.revision!==input.revision)return {status:'stale'};
      if(input.action==='cancel'){row.status='cancelled';row.cancelledAt=Date.now();row.revision=revision();}
      else if(row.status!=='posted')return {status:'stale'};
      else if(input.action==='dismiss')await decide(row,'done');
      else{row.at=Date.now()+input.minutes!*60000;row.snoozedAt=Date.now();row.status=await scheduledStatus();delete row.postedAt;row.revision=revision();}
      return {status:'applied'};
    });
  }
  async clockHandoff(input:ClockRequest){
    if(input.reviewed!==true||!['set','show','dismiss','snooze'].includes(input.action))throw Error('Review the alarm action first.');
    // Browser alarms are one-time reminders. A reviewed repeat is refused, never saved as a single alarm.
    if(input.action==='set'&&Object.hasOwn(input,'days'))return {action:input.action,status:'failed' as const,message:'Repeating alarms are not available in this browser. No alarm was saved.'};
    if(input.action==='set'){
      if(!Number.isInteger(input.hour)||input.hour<0||input.hour>23||!Number.isInteger(input.minute)||input.minute<0||input.minute>59||typeof input.label!=='string'||input.label.length>200||input.label.includes('\0'))throw Error('Choose a valid alarm time and label.');
      const date=new Date();date.setHours(input.hour,input.minute,0,0);if(date.getTime()<=Date.now())date.setDate(date.getDate()+1);const saved=await this.scheduleReminder({id:'alarm_'+crypto.randomUUID(),title:input.label||'Alarm',at:date.getTime()});if(saved.status!=='scheduled')throw Error(saved.status==='permission-denied'?'The alarm was saved but notifications are disabled. Enable notifications and review its time.':'The alarm time passed. Choose another time.');
    }else if(input.action==='show')window.dispatchEvent(new Event('alpha:clock-open'));
    else{
      if(input.action==='snooze'&&(!Number.isInteger(input.snoozeMinutes)||input.snoozeMinutes<1||input.snoozeMinutes>60))throw Error('Choose 1 to 60 snooze minutes.');
      await reminderDocument.edit(initial,async data=>{for(const row of data.reminders.filter(r=>r.id.startsWith('alarm_')&&r.status==='posted')){if(input.action==='dismiss')await decide(row,'done');else if(input.action==='snooze'){row.at=Date.now()+input.snoozeMinutes*60000;row.snoozedAt=Date.now();row.status=await scheduledStatus();delete row.postedAt;row.revision=revision();}}});
    }
    window.dispatchEvent(new Event('alpha:alarms-changed'));return {action:input.action,status:'opened',message:input.action==='set'?'Alarm saved.':input.action==='show'?'Alarms':input.action==='dismiss'?'Alarm dismissed.':'Alarm snoozed.'};
  }
  async capabilities(){return {platform:'web',actions:['calendar','reminder','browser','files','photos','maps','settings','notifications'].map(action=>({action,available:true,mode:'browser'}))};}
  pdfSelected(input:{selectionId:string;page:number}){return this.files.pdfSelected(input);}
  readSelected(input:{selectionId:string}){return this.files.readSelected(input);}
  openSelected(input:{selectionId:string}){return this.files.openSelected(input);}
  shareSelected(input:{selectionId:string}){return this.files.shareSelected(input);}
  renameSelected(input:{selectionId:string;name:string}){return this.files.renameSelected(input);}
  forgetSelected(input:{selectionId:string}){return this.files.forgetSelected(input);}
  restoreSelected(){return this.files.restoreSelected();}
  async perform(input:{action:string;url?:string}){if(input.action==='files'||input.action==='photos')return this.files.pick(input.action==='photos');if(input.action==='browser'&&input.url){const url=new URL(input.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Enter an HTTP or HTTPS address.');window.open(url.href,'_blank','noopener,noreferrer');}else window.dispatchEvent(new CustomEvent('alpha:browser-open-view',{detail:input.action==='reminder'?'calendar':input.action}));return {status:'opened',action:input.action,message:''};}
}
