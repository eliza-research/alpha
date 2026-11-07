import {deletedNoteOrigins} from './deleted-note-origins';
import {browserDeletionRecovery} from './deletion-recovery';
import type {JournalEntry} from '../runtime/device-actions';
import {WebPlugin} from '@capacitor/core';
import type {ReminderTarget} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract';
import type {BrowserDaily} from './daily';
import type {BrowserCalendar} from './calendar';
import {BrowserReviews} from './review';
import {browserDeletionOwner} from '../runtime/deletion-owner';
export class BrowserDeletions extends WebPlugin{
 private reviews=new BrowserReviews();
 constructor(private daily:BrowserDaily,private calendar:BrowserCalendar){super();}
 async receipt(input:{entry:JournalEntry}){const type=(input.entry.record.operation as {type:string}).type;if(type==='calendar_delete')return {recovery:browserDeletionRecovery(input.entry,await this.calendar.deletionReceipt(input.entry.operationId))};if(type==='reminder_cancel'){const saved=await this.daily.deletionReceipt(input.entry.operationId);return {recovery:browserDeletionRecovery(input.entry,saved.entry,saved.row)};}return {recovery:null};}
 async pending(){await this.calendar.settleDeletions();await this.daily.settleDeletions();return {deletions:[...await this.calendar.pendingDeletions(),...await this.daily.pendingDeletions()],deletedOrigins:await deletedNoteOrigins()};}
 async dismiss(input:{kind:string;id:string}){if(input.kind==='calendar')return this.calendar.dismissDeletion(input.id);if(input.kind==='reminder')return this.daily.dismissDeletion(input.id);throw Error('Unknown deletion kind.');}
 async undo(input:{kind:string;id:string}){if(input.kind==='calendar')return this.calendar.undoDeletion(input.id);if(input.kind==='reminder')return this.daily.undoDeletion(input.id);throw Error('Unknown deletion kind.');}
 async reviewReminder(input:{target:ReminderTarget}){return this.review(input.target);}
 async reviewAgentReminder(input:{operation:{type:string;target:ReminderTarget};operationId:string;bindingHash:string;journalIdentity:{scope:string;proposalId:string}}){
  if(input.operation.type!=='reminder_cancel'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId)||!/^[a-f0-9]{64}$/.test(input.bindingHash))throw Error('Invalid deletion operation.');
  const owner=browserDeletionOwner(),operationHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input.operation))))).map(v=>v.toString(16).padStart(2,'0')).join('');return this.review(input.operation.target,owner,input.operationId,JSON.stringify([input.bindingHash,input.operation]),{...input.journalIdentity,operationHash});
 }
 private async review(target:ReminderTarget,owner?:string,id=crypto.randomUUID() as string,binding?:string,journalBinding?:{scope:string;proposalId:string;operationHash:string}){
  // A changed or missing selection is a definite refusal before admission: nothing is staged.
  let selected:Awaited<ReturnType<BrowserDaily['deletionSelection']>>;try{selected=await this.daily.deletionSelection(target);}catch{return {status:'stale'};}
  const captured=owner||selected.owner;
  if(!await this.reviews.confirm(id,'Delete reminder?',selected.row.title+'\n\nIts alert pauses now. You can undo for 10 seconds.','Delete reminder'))return {status:'cancelled'};
  return {status:'queued',deletion:await this.daily.stageDeletion(target,captured,id,binding,journalBinding)};
 }
}
